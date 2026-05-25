import { ProjectionService } from '../brain1/ProjectionService';
import { ContinuityGraph } from '../graph/ContinuityGraph';
import { BrowseGentV2Harness } from '../harness/BrowseGentV2Harness';
import { PlannerInputComposer } from '../planner/PlannerInputComposer';
import { V2PlannerClient } from '../planner/V2PlannerClient';
import { DeadStateDetector, type DeadStateEvidence } from '../runtime/DeadStateDetector';
import { FailureClassifier, type FailureEvidence } from '../runtime/FailureClassifier';
import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
import { UncertaintySignals, type RuntimeUncertainty } from '../runtime/UncertaintySignals';
import { V2ToolDispatcher } from '../tools/V2ToolDispatcher';
import type {
  V2AgentHarnessRuntime,
  V2AgentLoopInput,
  V2AgentLoopOptions,
  V2AgentLoopResult,
  V2PlannerClientLike,
} from './types';

export class V2AgentLoop {
  private readonly projectionService = new ProjectionService();
  private readonly plannerInputComposer = new PlannerInputComposer();
  private readonly failureClassifier = new FailureClassifier();
  private readonly uncertaintySignals = new UncertaintySignals();
  private readonly deadStateDetector = new DeadStateDetector();

  constructor(private readonly options: V2AgentLoopOptions = {}) {}

  async run(input: V2AgentLoopInput): Promise<V2AgentLoopResult> {
    const harness = this.createHarness();
    const plannerClient = this.createPlannerClient(harness);
    const dispatcher = this.options.dispatcherFactory?.(harness) ?? new V2ToolDispatcher(harness);
    const graph = new ContinuityGraph();
    const maxSteps = Math.max(1, input.maxSteps);
    const metrics = {
      plannerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      plannerDurationMs: 0,
      toolExecutions: 0,
    };

    try {
      let observation = await harness.open(input.url);
      let graphSnapshot = graph.applyObservation(observation);
      let lastResult: V2ToolResult | undefined;
      let transitionEvidence: TransitionEvidence | undefined;
      let failureEvidence: FailureEvidence[] = [];
      let deadStateEvidence: DeadStateEvidence | undefined;
      let runtimeUncertainty: RuntimeUncertainty | undefined;
      let lastSuccessfulEvidenceValue: string | undefined;

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        const projection = this.projectionService.project(observation, graphSnapshot);
        const plannerInput = this.plannerInputComposer.compose({
          episodeId: `episode_${stepIndex + 1}_${observation.observationId}`,
          goal: input.goal,
          projection,
          graphSnapshot,
          transitionEvidence,
          lastResult,
          failureEvidence: failureEvidence.length > 0 ? failureEvidence : undefined,
          deadStateEvidence,
          runtimeUncertainty,
        });
        harness.recordPlannerInput?.(plannerInput.episodeId, plannerInput);
        metrics.plannerCalls += 1;
        let plannerResult: Awaited<ReturnType<V2PlannerClientLike['call']>>;
        try {
          plannerResult = await plannerClient.call({
            plannerInput,
            model: input.model,
          });
        } catch (error) {
          const plannerMetrics = readPlannerErrorMetrics(error);
          metrics.inputTokens += plannerMetrics.inputTokens;
          metrics.outputTokens += plannerMetrics.outputTokens;
          metrics.plannerDurationMs += plannerMetrics.durationMs;
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: `planner_client_error:${formatErrorMessage(error)}`,
            steps: metrics.plannerCalls,
            metrics,
          });
        }
        harness.recordPlannerOutput?.(plannerInput.episodeId, {
          attempts: 1,
          rawText: plannerResult.rawText,
          validation: { ok: true, errors: [] },
          output: plannerResult.output,
          metrics: {
            inputTokens: plannerResult.inputTokens,
            outputTokens: plannerResult.outputTokens,
            durationMs: plannerResult.durationMs,
          },
        });

        metrics.inputTokens += plannerResult.inputTokens;
        metrics.outputTokens += plannerResult.outputTokens;
        metrics.plannerDurationMs += plannerResult.durationMs;

        if (plannerResult.output.done === true) {
          return await this.complete(harness, {
            success: true,
            value: plannerResult.output.val ?? '',
            steps: metrics.plannerCalls,
            metrics,
          });
        }

        if (plannerResult.output.escalate) {
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: `planner_escalated:${plannerResult.output.escalate}`,
            steps: metrics.plannerCalls,
            metrics,
          });
        }

        const plan = plannerResult.output.plan ?? [];
        if (plan.length === 0) {
          return await this.complete(harness, {
            success: false,
            value: '',
            failureReason: 'planner_no_action',
            steps: metrics.plannerCalls,
            metrics,
          });
        }

        for (const plannedStep of plan) {
          lastResult = await dispatcher.dispatch(plannedStep, { goal: input.goal });
          metrics.toolExecutions += 1;
          transitionEvidence = lastResult.evidence;
          observation = await harness.observe();
          graphSnapshot = graph.applyObservation(observation);
          if (transitionEvidence) {
            graphSnapshot = graph.applyTransition(transitionEvidence);
          }
          lastSuccessfulEvidenceValue = successfulToolEvidencePreview(lastResult) ?? lastSuccessfulEvidenceValue;

          if (!lastResult.success) {
            const currentProjection = this.projectionService.project(observation, graphSnapshot);
            const failure = this.failureClassifier.classify(lastResult, {
              observationId: observation.observationId,
              projection: currentProjection,
              targetRef: lastResult.targetRef,
              source: 'v2_agent_loop',
            });
            harness.recordFailureEvidence?.(failure);
            failureEvidence = appendBoundedFailure(failureEvidence, failure);
            const uncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
            });
            const deadState = this.deadStateDetector.assess({
              projection: currentProjection,
              failures: failureEvidence,
              uncertainty,
              localMechanismsExhausted: true,
            });
            deadStateEvidence = deadState.evidence;
            runtimeUncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
              deadStateEvidence,
            });
            break;
          }

          if (shouldInterruptMiniPlan(lastResult)) {
            break;
          }
        }
      }

      if (lastSuccessfulEvidenceValue) {
        return await this.complete(harness, {
          success: true,
          value: lastSuccessfulEvidenceValue,
          steps: metrics.plannerCalls,
          metrics,
        });
      }

      return await this.complete(harness, {
        success: false,
        value: '',
        failureReason: 'v2_max_steps_exhausted',
        steps: metrics.plannerCalls,
        metrics,
      });
    } finally {
      await harness.close();
    }
  }

  private createHarness(): V2AgentHarnessRuntime {
    if (this.options.harnessFactory) {
      return this.options.harnessFactory();
    }

    return new BrowseGentV2Harness({
      headed: this.options.headed ?? true,
      traceDir: this.options.traceDir,
      runId: this.options.runId,
      runtimeMode: 'agent',
      viewport: this.options.viewport,
    });
  }

  private createPlannerClient(harness: V2AgentHarnessRuntime): V2PlannerClientLike {
    if (this.options.plannerClient) {
      return this.options.plannerClient;
    }

    const recordPlannerInput = harness.recordPlannerInput?.bind(harness);
    const recordPlannerOutput = harness.recordPlannerOutput?.bind(harness);

    return new V2PlannerClient({
      traceStore: recordPlannerInput && recordPlannerOutput
        ? {
            recordPlannerInput,
            recordPlannerOutput,
          }
        : undefined,
    });
  }

  private async complete(
    harness: V2AgentHarnessRuntime,
    result: Omit<V2AgentLoopResult, 'tracePath'>,
  ): Promise<V2AgentLoopResult> {
    const manifest = await harness.flushTrace();
    return {
      ...result,
      tracePath: manifest.artifacts.trace.path,
    };
  }
}

function appendBoundedFailure(existing: FailureEvidence[], next: FailureEvidence): FailureEvidence[] {
  return [...existing, next].slice(-8);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPlannerErrorMetrics(error: unknown): { inputTokens: number; outputTokens: number; durationMs: number } {
  if (!error || typeof error !== 'object') {
    return { inputTokens: 0, outputTokens: 0, durationMs: 0 };
  }

  const candidate = error as { inputTokens?: unknown; outputTokens?: unknown; durationMs?: unknown };
  return {
    inputTokens: numberOrZero(candidate.inputTokens),
    outputTokens: numberOrZero(candidate.outputTokens),
    durationMs: numberOrZero(candidate.durationMs),
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const MINI_PLAN_INTERRUPT_KINDS = new Set(['click', 'type', 'navigate', 'scroll', 'wait']);
const READ_TOOL_KINDS = new Set(['get', 'inspect_region', 'search_page']);
const MUTATION_EVIDENCE_KINDS = new Set(['click', 'type', 'navigate']);

function shouldInterruptMiniPlan(result: V2ToolResult): boolean {
  return result.success && result.evidence !== undefined && MINI_PLAN_INTERRUPT_KINDS.has(result.kind);
}

function successfulToolEvidencePreview(result: V2ToolResult): string | undefined {
  if (!result.success) {
    return undefined;
  }

  if (READ_TOOL_KINDS.has(result.kind)) {
    return previewResultValue(result.value) ?? previewToolTarget(result.target);
  }

  if (
    MUTATION_EVIDENCE_KINDS.has(result.kind)
    && result.evidence
    && result.evidence.strength !== 'none'
    && result.evidence.strength !== 'negative'
  ) {
    return previewResultValue(result.value) ?? previewToolTarget(result.target);
  }

  return undefined;
}

function previewResultValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return compactResultPreview(value);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.inputValue === 'string' && record.inputValue.trim()) {
    return compactResultPreview(record.inputValue);
  }
  if (typeof record.url === 'string' && record.url.trim()) {
    return compactResultPreview(record.url);
  }
  if (typeof record.value === 'string' && record.value.trim()) {
    return compactResultPreview(record.value);
  }
  if (typeof record.text === 'string' && record.text.trim()) {
    return compactResultPreview(record.text);
  }
  if (Array.isArray(record.preview)) {
    const preview = record.preview.filter((item): item is string => typeof item === 'string').join(' ');
    return preview ? compactResultPreview(preview) : undefined;
  }
  return undefined;
}

function previewToolTarget(target: V2ToolResult['target']): string | undefined {
  if (!target) {
    return undefined;
  }

  const parts = [target.name, target.text, target.role]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  const uniqueParts = parts.filter((part, index) => parts.findIndex(existing => existing.toLowerCase() === part.toLowerCase()) === index);

  return uniqueParts.length > 0 ? compactResultPreview(uniqueParts.join(' ')) : undefined;
}

function compactResultPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}
