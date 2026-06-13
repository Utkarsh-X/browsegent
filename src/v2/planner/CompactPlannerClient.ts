import { callProvider } from '../../providers';
import type { TraceStore } from '../trace/TraceStore';
import type { V2PlannerClientLike } from '../agent/types';
import { buildCompactPlannerView } from './CompactPlannerView';
import { buildCompactShadowInput, type CompactShadowPlannerInput } from './CompactShadowInput';
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
    const { input: compactInput, indexToRef, refToIndex } = shadowInputResult;

    // Record the compact input to trace
    this.traceStore?.recordCompactPlannerInput?.(episodeId, compactInput);

    // 2. Call the compact shadow planner. In enforced compact mode, legacy
    // primary refs are advisory; the compact action/read surface is authoritative.
    let result = await callCompactShadowPlanner(
      this.provider,
      compactInput,
      indexToRef,
      model,
      { mode }
    );
    let attempts = 1;
    let totalInputTokens = result.inputTokens;
    let totalOutputTokens = result.outputTokens;

    if (result.status === 'invalid_output' && isRecoverableCompatibilityError(result.errors)) {
      const retryInput = buildCompatibilityRetryInput(
        compactInput,
        toCompactValidationErrors(result.errors, refToIndex),
        result.rawText,
      );
      result = await callCompactShadowPlanner(
        this.provider,
        retryInput,
        indexToRef,
        model,
        { mode }
      );
      attempts = 2;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }

    const durationMs = Date.now() - startedAt;

    if (result.status === 'valid') {
      const callResult = {
        output: result.output,
        rawText: result.rawText,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
      };

      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts,
        rawText: result.rawText,
        validation: { ok: true, errors: [] },
        output: result.output,
        metrics: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        },
      });

      return callResult;
    } else if (result.status === 'invalid_output') {
      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts,
        rawText: result.rawText,
        validation: { ok: false, errors: result.errors },
        metrics: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        },
      });

      throw Object.assign(
        new Error(`Planner output invalid: ${result.errors.join('; ')}`),
        {
          code: 'PLANNER_INVALID_OUTPUT',
          name: 'PlannerInvalidOutputError',
          errors: result.errors,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        }
      );
    } else {
      // provider_error
      this.traceStore?.recordPlannerOutput?.(episodeId, {
        attempts,
        rawText: '',
        validation: { ok: false, errors: [`provider_error: ${result.error}`] },
        metrics: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        },
      });

      throw Object.assign(
        new Error(result.error),
        {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        }
      );
    }
  }
}

function isRecoverableCompatibilityError(errors: readonly string[]): boolean {
  return errors.some(error => /not compatible with tool|read-only|action compatibility/i.test(error));
}

function buildCompatibilityRetryInput(
  input: CompactShadowPlannerInput,
  errors: readonly string[],
  previousOutput: string,
): CompactShadowPlannerInput {
  return {
    ...input,
    validationFeedback: {
      previousErrors: errors.slice(0, 3),
      previousOutput,
      instruction: 'Choose an index whose tools include the requested tool. For typing, choose an index with type. Use read-only indexes only for get or inspect_region.',
    },
  };
}

function toCompactValidationErrors(
  errors: readonly string[],
  refToIndex: Readonly<Record<string, string>>,
): string[] {
  const mappings = Object.entries(refToIndex).sort(([left], [right]) => right.length - left.length);
  return errors.map(error => {
    let compactError = error;
    for (const [runtimeRef, compactIndex] of mappings) {
      compactError = compactError.split(runtimeRef).join(compactIndex);
    }
    return compactError;
  });
}
