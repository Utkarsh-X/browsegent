import { ProjectionService } from '../brain1/ProjectionService';
import { ContinuityGraph } from '../graph/ContinuityGraph';
import { BrowseGentV2Harness } from '../harness/BrowseGentV2Harness';
import { PlannerInputComposer } from '../planner/PlannerInputComposer';
import { V2PlannerClient } from '../planner/V2PlannerClient';
import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
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

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        const projection = this.projectionService.project(observation, graphSnapshot);
        const plannerInput = this.plannerInputComposer.compose({
          episodeId: `episode_${stepIndex + 1}_${observation.observationId}`,
          goal: input.goal,
          projection,
          graphSnapshot,
          transitionEvidence,
          lastResult,
        });
        harness.recordPlannerInput?.(plannerInput.episodeId, plannerInput);
        const plannerResult = await plannerClient.call({
          plannerInput,
          model: input.model,
        });
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

        metrics.plannerCalls += 1;
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

          if (!lastResult.success) {
            break;
          }
        }
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
