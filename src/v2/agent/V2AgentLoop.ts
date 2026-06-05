import { ProjectionService } from '../brain1/ProjectionService';
import { buildFinalizationEvidence } from './FinalizationEvidence';
import { ContinuityGraph } from '../graph/ContinuityGraph';
import type { ContinuityGraphSnapshot } from '../graph/types';
import { BrowseGentV2Harness } from '../harness/BrowseGentV2Harness';
import { PlannerInputComposer } from '../planner/PlannerInputComposer';
import { V2PlannerClient } from '../planner/V2PlannerClient';
import type { PlannerOutput } from '../planner/types';
import { DeadStateDetector, type DeadStateEvidence } from '../runtime/DeadStateDetector';
import { FailureClassifier, type FailureEvidence } from '../runtime/FailureClassifier';
import type { BrowserObservation, TransitionEvidence, V2ToolResult } from '../runtime/types';
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
    const progressMemory = new ActionProgressMemory();
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
          if (isPlannerInvalidOutputError(error)) {
            return await this.complete(harness, {
              success: false,
              value: '',
              failureReason: 'planner_invalid_output_dead_end',
              steps: metrics.plannerCalls,
              metrics,
            });
          }
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
            failureReason: formatPlannerEscalation(plannerResult.output.escalate, plannerResult.output.reason),
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

        for (let planIndex = 0; planIndex < plan.length; planIndex += 1) {
          const plannedStep = plan[planIndex];
          lastResult = await dispatcher.dispatch(plannedStep, { goal: input.goal });
          metrics.toolExecutions += 1;
          transitionEvidence = lastResult.evidence;
          observation = await harness.observe();
          graphSnapshot = graph.applyObservation(observation);
          if (transitionEvidence) {
            graphSnapshot = graph.applyTransition(transitionEvidence);
          }
          lastSuccessfulEvidenceValue = successfulToolEvidencePreview(lastResult) ?? lastSuccessfulEvidenceValue;
          const progressSignals = progressMemory.record(lastResult);

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

          runtimeUncertainty = undefined;
          if (progressSignals.length > 0) {
            const currentProjection = this.projectionService.project(observation, graphSnapshot);
            runtimeUncertainty = this.uncertaintySignals.fromRuntimeState({
              projection: currentProjection,
              transitionEvidence,
              graphSnapshot,
              failures: failureEvidence,
              deadStateEvidence,
              extraSignals: progressSignals,
            });
          }

          const nextStep = plan[planIndex + 1];
          // observation is the fresh post-action observation. Use it to validate queued refs.
          if (!shouldContinueMiniPlan({ lastResult, nextStep, freshObservation: observation })) {
            break;
          }
        }
      }

      if (lastSuccessfulEvidenceValue) {
        const finalizationResult = await this.attemptFinalization(
          harness, plannerClient, observation, graphSnapshot,
          input.goal, lastSuccessfulEvidenceValue, metrics,
        );
        if (finalizationResult) return finalizationResult;

        return await this.complete(harness, {
          success: false,
          value: lastSuccessfulEvidenceValue,
          failureReason: 'v2_max_steps_exhausted',
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

  private async attemptFinalization(
    harness: V2AgentHarnessRuntime,
    plannerClient: V2PlannerClientLike,
    observation: BrowserObservation,
    graphSnapshot: ContinuityGraphSnapshot | undefined,
    goal: string,
    evidenceValue: string,
    metrics: { plannerCalls: number; inputTokens: number; outputTokens: number; plannerDurationMs: number; toolExecutions: number },
  ): Promise<V2AgentLoopResult | undefined> {
    const projection = this.projectionService.project(observation, graphSnapshot);
    const finalizationEvidence = buildFinalizationEvidence({
      goal,
      projection,
      lastSuccessfulEvidenceValue: evidenceValue,
    });
    const finalizationInput = this.plannerInputComposer.compose({
      episodeId: `episode_finalization_${observation.observationId}`,
      goal: `${goal}\n\nFinalization evidence:\n${finalizationEvidence}\n\nReturn done with the best answer if the evidence answers the goal. Otherwise escalate with a concise reason. Do not return a plan.`,
      projection,
      graphSnapshot,
    });
    harness.recordPlannerInput?.(finalizationInput.episodeId, finalizationInput);
    metrics.plannerCalls += 1;
    try {
      const result = await plannerClient.call({ plannerInput: finalizationInput, mode: 'finalization' });
      harness.recordPlannerOutput?.(finalizationInput.episodeId, {
        attempts: 1,
        rawText: result.rawText,
        validation: { ok: true, errors: [] },
        output: result.output,
        metrics: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs: result.durationMs,
        },
      });
      metrics.inputTokens += result.inputTokens;
      metrics.outputTokens += result.outputTokens;
      metrics.plannerDurationMs += result.durationMs;

      if (result.output.done === true) {
        return await this.complete(harness, {
          success: true,
          value: result.output.val ?? evidenceValue,
          steps: metrics.plannerCalls,
          metrics,
        });
      }
    } catch {
      // Finalization planner call failed — fall through to max_steps_exhausted
    }
    return undefined;
  }
}

function appendBoundedFailure(existing: FailureEvidence[], next: FailureEvidence): FailureEvidence[] {
  return [...existing, next].slice(-8);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatPlannerEscalation(kind: string, reason: string | undefined): string {
  const compactReason = reason?.replace(/\s+/g, ' ').trim();
  return compactReason ? `planner_escalated:${kind}:${compactReason}` : `planner_escalated:${kind}`;
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

function isPlannerInvalidOutputError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  if (candidate.code === 'PLANNER_INVALID_OUTPUT') {
    return true;
  }

  if (candidate.name === 'PlannerInvalidOutputError') {
    return true;
  }

  return typeof candidate.message === 'string'
    && candidate.message.includes('Planner output invalid after retry');
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const READ_TOOL_KINDS = new Set(['get', 'inspect_region', 'search_page']);
const MUTATION_EVIDENCE_KINDS = new Set(['click', 'type', 'select', 'press', 'navigate']);
const PROGRESS_HISTORY_LIMIT = 8;
const REPEAT_SIGNAL_THRESHOLD = 2;

interface ActionProgressEntry {
  kind: string;
  targetKey: string;
  valueKey?: string;
  noProgressMutation: boolean;
}

class ActionProgressMemory {
  private readonly entries: ActionProgressEntry[] = [];

  record(result: V2ToolResult): string[] {
    const entry = progressEntryForResult(result);
    if (!entry) {
      return [];
    }

    this.entries.push(entry);
    if (this.entries.length > PROGRESS_HISTORY_LIMIT) {
      this.entries.shift();
    }

    const signals: string[] = [];

    if (entry.noProgressMutation) {
      const count = this.entries.filter(existing =>
        existing.noProgressMutation
        && existing.kind === entry.kind
        && existing.targetKey === entry.targetKey,
      ).length;
      if (count >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_no_progress_transition:${entry.kind}:${entry.targetKey}:${count}`);
      }
    }

    if (entry.valueKey) {
      const count = this.entries.filter(existing =>
        existing.kind === entry.kind
        && existing.targetKey === entry.targetKey
        && existing.valueKey === entry.valueKey,
      ).length;
      if (count >= REPEAT_SIGNAL_THRESHOLD) {
        signals.push(`repeated_value_preview:${entry.kind}:${entry.targetKey}:${count}`);
      }
    }

    return signals;
  }
}

function isNoProgressMutation(result: V2ToolResult): boolean {
  if (!MUTATION_EVIDENCE_KINDS.has(result.kind) || !result.evidence) {
    return false;
  }

  const evidence = result.evidence;
  if (evidence.urlChanged || evidence.generationChanged) {
    return false;
  }

  if (evidence.strength === 'strong' || evidence.strength === 'negative') {
    return false;
  }

  if (previewResultValue(result.value)) {
    return false;
  }

  if (evidence.transitionClass === 'microstate' && evidence.strength === 'none') {
    return true;
  }

  if (evidence.transitionClass === 'structural_local') {
    return true;
  }

  return false;
}

function progressEntryForResult(result: V2ToolResult): ActionProgressEntry | undefined {
  if (!result.success) {
    return undefined;
  }

  const kind = normalizeSignalToken(result.kind);
  const targetKey = normalizeSignalToken(result.targetRef ?? result.target?.refId ?? 'global');
  const noProgressMutation = isNoProgressMutation(result);
  const valuePreview = READ_TOOL_KINDS.has(result.kind) ? previewResultValue(result.value) : undefined;

  if (!noProgressMutation && !valuePreview) {
    return undefined;
  }

  return {
    kind,
    targetKey,
    valueKey: valuePreview ? normalizeProgressValue(valuePreview) : undefined,
    noProgressMutation,
  };
}


function normalizeSignalToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'unknown';
}

function normalizeProgressValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
}

function shouldContinueMiniPlan(input: {
  lastResult: V2ToolResult;
  nextStep: NonNullable<PlannerOutput['plan']>[number] | undefined;
  freshObservation: BrowserObservation;
}): boolean {
  if (!input.lastResult.success || !input.nextStep) {
    return false;
  }
  const nextStep = input.nextStep;

  if (input.lastResult.evidence?.urlChanged || input.lastResult.evidence?.generationChanged) {
    return false;
  }

  if (input.lastResult.evidence?.transitionClass === 'structural_macrostate') {
    return false;
  }

  if (
    nextStep.ref
    && !input.freshObservation.refs.some(ref => ref.refId === nextStep.ref && ref.state === 'live')
  ) {
    return false;
  }

  if (input.lastResult.kind === 'navigate') {
    return false;
  }

  if (
    input.lastResult.kind === 'click'
    && input.lastResult.evidence
    && input.lastResult.evidence.strength !== 'none'
  ) {
    return false;
  }

  if (
    input.lastResult.kind === 'press'
    && input.lastResult.evidence
    && input.lastResult.evidence.strength !== 'none'
  ) {
    return false;
  }

  return input.lastResult.kind === 'type'
    || input.lastResult.kind === 'select'
    || input.lastResult.kind === 'get'
    || input.lastResult.kind === 'search_page'
    || input.lastResult.kind === 'inspect_region'
    || input.lastResult.kind === 'wait'
    || input.lastResult.kind === 'scroll';
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
