import { robustJsonParse } from '../../agent/parser';
import { callProvider } from '../../providers';
import type { TraceStore } from '../trace/TraceStore';
import { PlannerOutputSchema } from './PlannerOutputSchema';
import {
  buildV2PlannerSystemPrompt,
  buildV2PlannerUserMessage,
  buildV2PlannerValidationFeedback,
} from './PlannerPrompt';
import type { PlannerInput, PlannerOutput } from './types';

export interface V2PlannerProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type V2PlannerProvider = (
  system: string,
  user: string,
  model?: string,
) => Promise<V2PlannerProviderResult>;

export interface V2PlannerClientOptions {
  provider?: V2PlannerProvider;
  traceStore?: Pick<TraceStore, 'recordPlannerInput' | 'recordPlannerOutput'>;
  schema?: PlannerOutputSchema;
}

export interface V2PlannerCallInput {
  plannerInput: PlannerInput;
  model?: string;
}

export interface V2PlannerCallResult {
  output: PlannerOutput;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export class V2PlannerClientError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
    readonly attempts: number,
    readonly rawText: string,
    readonly inputTokens: number,
    readonly outputTokens: number,
    readonly durationMs: number,
  ) {
    super(message);
    this.name = 'V2PlannerClientError';
  }
}

export class V2PlannerClient {
  private readonly provider: V2PlannerProvider;
  private readonly schema: PlannerOutputSchema;
  private readonly traceStore?: Pick<TraceStore, 'recordPlannerInput' | 'recordPlannerOutput'>;

  constructor(options: V2PlannerClientOptions = {}) {
    this.provider = options.provider ?? callProvider;
    this.schema = options.schema ?? new PlannerOutputSchema();
    this.traceStore = options.traceStore;
  }

  async call(input: V2PlannerCallInput): Promise<V2PlannerCallResult> {
    const startedAt = Date.now();
    const systemPrompt = buildV2PlannerSystemPrompt();
    const baseUserMessage = buildV2PlannerUserMessage(input.plannerInput);
    let userMessage = baseUserMessage;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastRawText = '';
    let lastErrors: string[] = [];

    this.traceStore?.recordPlannerInput(input.plannerInput.episodeId, input.plannerInput);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let providerResult: V2PlannerProviderResult;
      try {
        providerResult = await this.provider(systemPrompt, userMessage, input.model);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = formatErrorMessage(error);
        const errors = [`provider_error:${message}`];
        this.recordPlannerOutput(input.plannerInput.episodeId, {
          attempts: attempt,
          rawText: lastRawText,
          validation: { ok: false, errors },
          metrics: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs,
          },
        });
        throw new V2PlannerClientError(
          message,
          errors,
          attempt,
          lastRawText,
          totalInputTokens,
          totalOutputTokens,
          durationMs,
        );
      }
      totalInputTokens += providerResult.inputTokens;
      totalOutputTokens += providerResult.outputTokens;
      lastRawText = providerResult.text;

      const validation = this.parseAndValidate(providerResult.text, input.plannerInput);
      if (validation.ok) {
        const durationMs = Date.now() - startedAt;
        const result: V2PlannerCallResult = {
          output: validation.output,
          rawText: providerResult.text,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        };

        this.recordPlannerOutput(input.plannerInput.episodeId, {
          attempts: attempt,
          rawText: providerResult.text,
          validation: { ok: true, errors: [] },
          output: validation.output,
          metrics: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs,
          },
        });

        return result;
      }

      lastErrors = validation.errors;
      if (attempt === 1) {
        userMessage = `${baseUserMessage}\n\n${buildV2PlannerValidationFeedback(lastErrors)}`;
      }
    }

    const durationMs = Date.now() - startedAt;
    this.recordPlannerOutput(input.plannerInput.episodeId, {
      attempts: 2,
      rawText: lastRawText,
      validation: { ok: false, errors: lastErrors },
      metrics: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
      },
    });

    throw new V2PlannerClientError(
      `Planner output invalid after retry: ${lastErrors.join('; ')}`,
      lastErrors,
      2,
      lastRawText,
      totalInputTokens,
      totalOutputTokens,
      durationMs,
    );
  }

  private parseAndValidate(rawText: string, plannerInput: PlannerInput): { ok: true; output: PlannerOutput } | { ok: false; errors: string[] } {
    const parsed = robustJsonParse(rawText);
    if (!parsed) {
      return { ok: false, errors: ['Planner response did not contain a valid JSON object'] };
    }

    const validation = this.schema.validate(parsed, collectValidationContext(plannerInput));
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    return { ok: true, output: validation.value };
  }

  private recordPlannerOutput(episodeId: string, payload: unknown): void {
    this.traceStore?.recordPlannerOutput(episodeId, payload);
  }
}

function collectValidationContext(input: PlannerInput): { allowedRefs: string[]; regionRefs: Record<string, string> } {
  const refs = new Set<string>();
  const regionRefs: Record<string, string> = {};
  for (const item of [...input.current.interactions, ...input.current.readables, ...input.current.navigation]) {
    refs.add(item.refId);
  }
  for (const region of input.current.regions) {
    if (region.refIds[0]) {
      regionRefs[region.regionId] = region.refIds[0];
    }
    for (const refId of region.refIds) {
      refs.add(refId);
    }
  }
  if (input.current.focus?.refId) {
    refs.add(input.current.focus.refId);
  }
  return { allowedRefs: [...refs], regionRefs };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
