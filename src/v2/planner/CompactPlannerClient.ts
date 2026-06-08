import { callProvider } from '../../providers';
import type { TraceStore } from '../trace/TraceStore';
import type { V2PlannerClientLike } from '../agent/types';
import { buildCompactPlannerView } from './CompactPlannerView';
import { buildCompactShadowInput } from './CompactShadowInput';
import { callCompactShadowPlanner } from './CompactShadowPlanner';
import type { PlannerInput, PlannerOutput } from './types';
import type { V2PlannerProvider } from './V2PlannerClient';

export interface CompactPlannerClientOptions {
  provider?: V2PlannerProvider;
  traceStore?: {
    recordCompactPlannerInput?: (episodeId: string, input: unknown) => void;
    recordPlannerOutput?: (episodeId: string, output: unknown) => void;
  };
}

export class CompactPlannerClient implements V2PlannerClientLike {
  private readonly provider: V2PlannerProvider;
  private readonly traceStore?: CompactPlannerClientOptions['traceStore'];

  constructor(options: CompactPlannerClientOptions = {}) {
    this.provider = options.provider ?? callProvider;
    this.traceStore = options.traceStore;
  }

  async call(input: {
    plannerInput: PlannerInput;
    model?: string;
    mode?: 'normal' | 'finalization';
  }): Promise<{
    output: PlannerOutput;
    rawText: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  }> {
    const startedAt = Date.now();
    const { plannerInput, model, mode } = input;
    const episodeId = plannerInput.episodeId ?? 'unknown';

    // 1. Build compact view and compact input
    const compactView = buildCompactPlannerView(plannerInput);
    const shadowInputResult = buildCompactShadowInput(compactView);
    const { input: compactInput, indexToRef, refToIndex, eligibility } = shadowInputResult;

    // Record the compact input to trace
    this.traceStore?.recordCompactPlannerInput?.(episodeId, compactInput);

    // 2. Check eligibility
    let eligible = true;
    if (plannerInput.workingSet?.primaryRefs?.[0]) {
      const primaryRef = plannerInput.workingSet.primaryRefs[0].refId;
      if (refToIndex[primaryRef] === undefined) {
        eligible = false;
      }
    }

    if (!eligible) {
      throw Object.assign(
        new Error('compact_planner_input_ineligible'),
        {
          code: 'COMPACT_PLANNER_INPUT_INELIGIBLE',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - startedAt,
        }
      );
    }

    // 3. Call the compact shadow planner
    const result = await callCompactShadowPlanner(
      this.provider,
      compactInput,
      indexToRef,
      model,
      { mode }
    );

    const durationMs = Date.now() - startedAt;

    if (result.status === 'valid') {
      const callResult = {
        output: result.output,
        rawText: result.rawText,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
      };

      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts: 1,
        rawText: result.rawText,
        validation: { ok: true, errors: [] },
        output: result.output,
        metrics: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        },
      });

      return callResult;
    } else if (result.status === 'invalid_output') {
      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts: 1,
        rawText: result.rawText,
        validation: { ok: false, errors: result.errors },
        metrics: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        },
      });

      throw Object.assign(
        new Error(`Planner output invalid: ${result.errors.join('; ')}`),
        {
          code: 'PLANNER_INVALID_OUTPUT',
          name: 'PlannerInvalidOutputError',
          errors: result.errors,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        }
      );
    } else {
      // provider_error
      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts: 1,
        rawText: '',
        validation: { ok: false, errors: [`provider_error: ${result.error}`] },
        metrics: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        },
      });

      throw Object.assign(
        new Error(result.error),
        {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        }
      );
    }
  }
}
