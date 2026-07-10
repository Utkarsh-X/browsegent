import { robustJsonParse } from '../../agent/parser';
import { callProvider, type ProviderCallOptions } from '../../providers';
import type { TraceStore } from '../trace/TraceStore';
import { PlannerOutputSchema, type PlannerOutputValidationContext } from './PlannerOutputSchema';
import {
  buildV2PlannerSystemPrompt,
  buildV2PlannerUserMessage,
  buildV2PlannerValidationFeedback,
} from './PlannerPrompt';
import { buildV2PlannerResponseSchema } from './V2PlannerResponseSchema';
import type { PlannerInput, PlannerOutput, PlannerSerializationConfig } from './types';

export interface V2PlannerProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type V2PlannerProvider = (
  system: string,
  user: string,
  model?: string,
  options?: ProviderCallOptions,
) => Promise<V2PlannerProviderResult>;

export interface V2PlannerClientOptions {
  provider?: V2PlannerProvider;
  traceStore?: Pick<TraceStore, 'recordPlannerInput' | 'recordPlannerOutput'>;
  schema?: PlannerOutputSchema;
  plannerSerialization?: PlannerSerializationConfig;
}

export interface V2PlannerCallInput {
  plannerInput: PlannerInput;
  model?: string;
  mode?: 'normal' | 'finalization';
}

export interface V2PlannerCallResult {
  output: PlannerOutput;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

interface ProviderPayloadAttemptSummary {
  attempt: number;
  systemBytes: number;
  userBytes: number;
  totalBytes: number;
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
  private readonly plannerSerialization: PlannerSerializationConfig;

  constructor(options: V2PlannerClientOptions = {}) {
    this.provider = options.provider ?? callProvider;
    this.schema = options.schema ?? new PlannerOutputSchema();
    this.traceStore = options.traceStore;
    this.plannerSerialization = options.plannerSerialization ?? { mode: 'json' };
  }

  async call(input: V2PlannerCallInput): Promise<V2PlannerCallResult> {
    const startedAt = Date.now();
    const systemPrompt = buildV2PlannerSystemPrompt();
    const baseUserMessage = buildV2PlannerUserMessage(
      input.plannerInput,
      this.plannerSerialization,
    );
    let userMessage = baseUserMessage;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastRawText = '';
    let lastErrors: string[] = [];
    const providerPayloadAttempts: ProviderPayloadAttemptSummary[] = [];

    this.traceStore?.recordPlannerInput(input.plannerInput.episodeId, input.plannerInput);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let providerResult: V2PlannerProviderResult;
      providerPayloadAttempts.push(summarizeProviderPayloadAttempt(attempt, systemPrompt, userMessage));
      try {
        providerResult = await this.provider(systemPrompt, userMessage, input.model, {
          responseSchema: buildV2PlannerResponseSchema(),
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = formatErrorMessage(error);
        const errors = [`provider_error:${message}`];
        this.recordPlannerOutput(input.plannerInput.episodeId, {
          attempts: attempt,
          rawText: lastRawText,
          validation: { ok: false, errors },
          providerPayload: summarizeProviderPayload(this.plannerSerialization, providerPayloadAttempts),
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

      const validation = this.parseAndValidate(providerResult.text, input);
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
          providerPayload: summarizeProviderPayload(this.plannerSerialization, providerPayloadAttempts),
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
        const guidance = buildActionCompatibilityGuidance(
          lastErrors,
          input.plannerInput,
        );
        const feedbackSuffix = guidance ? `\nChoose a compatible ref:\n${guidance}` : '';
        userMessage = `${baseUserMessage}\n\n${buildV2PlannerValidationFeedback(lastErrors)}${feedbackSuffix}`;
      }
    }

    const durationMs = Date.now() - startedAt;
    const rescuedOutput = buildReadableOnlyClickRescue(
      lastRawText,
      input.plannerInput,
      lastErrors,
    );
    if (rescuedOutput) {
      const result: V2PlannerCallResult = {
        output: rescuedOutput,
        rawText: lastRawText,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
      };

      this.recordPlannerOutput(input.plannerInput.episodeId, {
        attempts: 2,
        rawText: lastRawText,
        validation: { ok: true, errors: [] },
        output: rescuedOutput,
        recovery: {
          kind: 'readable_only_click_to_get',
          sourceErrors: lastErrors,
        },
        providerPayload: summarizeProviderPayload(this.plannerSerialization, providerPayloadAttempts),
        metrics: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        },
      });

      return result;
    }

    this.recordPlannerOutput(input.plannerInput.episodeId, {
      attempts: 2,
      rawText: lastRawText,
      validation: { ok: false, errors: lastErrors },
      providerPayload: summarizeProviderPayload(this.plannerSerialization, providerPayloadAttempts),
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

  private parseAndValidate(rawText: string, input: V2PlannerCallInput): { ok: true; output: PlannerOutput } | { ok: false; errors: string[] } {
    // Detect truncated navigate URL before attempting JSON parse.
    // When the LLM generates an oversized URL consuming the entire output budget,
    // the JSON is irrecoverably truncated. Detect this pattern and return actionable feedback.
    if (isTruncatedNavigateOutput(rawText)) {
      return {
        ok: false,
        errors: [
          'url_truncated: The navigate URL consumed the entire output budget and was truncated. ' +
          'Use a short URL (under 200 characters) or navigate via page elements instead of constructing URLs.',
        ],
      };
    }

    const parsed = robustJsonParse(rawText);
    if (!parsed) {
      return { ok: false, errors: ['Planner response did not contain a valid JSON object'] };
    }

    if (input.mode === 'finalization' && Array.isArray(parsed.plan) && parsed.plan.length > 0) {
      return { ok: false, errors: ['finalization_attempted_plan: finalization mode cannot return a plan, only done or escalate'] };
    }

    const validationContext = {
      ...collectValidationContext(input.plannerInput),
      mode: input.mode,
      actionCompatibilityScope: input.mode === 'finalization' ? 'all_steps' as const : 'first_step' as const,
    };
    const validation = this.schema.validate(parsed, validationContext);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    return { ok: true, output: validation.value };
  }

  private recordPlannerOutput(episodeId: string, payload: unknown): void {
    this.traceStore?.recordPlannerOutput(episodeId, payload);
  }
}

function buildActionCompatibilityGuidance(
  errors: string[],
  input: PlannerInput,
): string | undefined {
  const surface = input.workingSet?.actionSurface;
  if (!surface) return undefined;

  const lines: string[] = [];
  for (const error of errors) {
    const typeMatch = error.match(/ref "([^"]+)" is not compatible with tool "type"/);
    if (typeMatch) {
      lines.push(formatInvalidRefDetail(typeMatch[1], input, surface));
      if (surface.typeableRefs.length > 0) {
        lines.push(`Typeable refs available: ${formatRefAlternatives(surface.typeableRefs, input)}`);
      }
    }

    const clickMatch = error.match(/ref "([^"]+)" is not compatible with tool "(click|close)"/);
    if (clickMatch) {
      const invalidRef = clickMatch[1];
      lines.push(formatInvalidRefDetail(invalidRef, input, surface));
      if (isReadableOnlyRef(invalidRef, surface)) {
        lines.push(
          `Ref ${invalidRef} is readable-only evidence, not a click target. If its text answers the goal, return done; otherwise use get("${invalidRef}") to extract it before answering.`,
        );
      }
      if (surface.clickableRefs.length > 0) {
        lines.push(`Clickable refs available: ${formatRefAlternatives(surface.clickableRefs, input)}`);
      }
    }

    const selectMatch = error.match(/ref "([^"]+)" is not compatible with tool "select"/);
    if (selectMatch) {
      lines.push(formatInvalidRefDetail(selectMatch[1], input, surface));
      if (surface.selectableRefs.length > 0) {
        lines.push(`Selectable refs available: ${formatRefAlternatives(surface.selectableRefs, input)}`);
      }
    }
  }

  return lines.length > 0 ? [...new Set(lines)].join('\n') : undefined;
}

function buildReadableOnlyClickRescue(
  rawText: string,
  input: PlannerInput,
  errors: string[],
): PlannerOutput | undefined {
  const surface = input.workingSet?.actionSurface;
  if (!surface) return undefined;

  const parsed = robustJsonParse(rawText);
  if (!parsed || !Array.isArray(parsed.plan)) return undefined;

  const firstStep = parsed.plan[0];
  if (!firstStep || typeof firstStep !== 'object') return undefined;

  const tool = (firstStep as { tool?: unknown }).tool;
  const ref = (firstStep as { ref?: unknown }).ref;
  if ((tool !== 'click' && tool !== 'close') || typeof ref !== 'string') return undefined;
  if (!input.current.refs?.[ref]) return undefined;
  if (!isReadableOnlyRef(ref, surface)) return undefined;

  const compatibilityError = `ref "${ref}" is not compatible with tool "${tool}"`;
  if (!errors.some(error => error.includes(compatibilityError))) return undefined;

  return {
    plan: [{ tool: 'get', ref }],
    confidence: 'low',
  };
}

function formatInvalidRefDetail(
  refId: string | undefined,
  input: PlannerInput,
  surface: NonNullable<PlannerOutputValidationContext['actionSurface']>,
): string {
  if (!refId) return 'Invalid ref detail: unknown';
  const ref = input.current.refs?.[refId];
  if (!ref) return `Invalid ref detail: ${refId} is not present in current refs`;
  const facts = [
    `role=${ref.role ?? 'unknown'}`,
    `kind=${ref.kind ?? 'unknown'}`,
    `tools=${formatRefTools(refId, surface)}`,
  ];
  const label = firstNonEmpty(ref.name, ref.text);
  if (label) {
    facts.push(`label="${truncateForGuidance(label, 120)}"`);
  }
  return `Invalid ref detail: ${refId} ${facts.join(' ')}`;
}

function formatRefAlternatives(refIds: string[], input: PlannerInput): string {
  return refIds.slice(0, 5).map(refId => formatRefAlternative(refId, input)).join(', ');
}

function formatRefAlternative(refId: string, input: PlannerInput): string {
  const ref = input.current.refs?.[refId];
  if (!ref) return refId;
  const label = firstNonEmpty(ref.name, ref.text);
  const role = ref.role ?? ref.kind ?? 'ref';
  if (!label) return `${refId} (${role})`;
  return `${refId} (${role} "${truncateForGuidance(label, 80)}")`;
}

function formatRefTools(
  refId: string,
  surface: NonNullable<PlannerOutputValidationContext['actionSurface']>,
): string {
  const tools: string[] = [];
  if (surface.clickableRefs.includes(refId)) tools.push('clickable');
  if (surface.typeableRefs.includes(refId)) tools.push('typeable');
  if (surface.selectableRefs.includes(refId)) tools.push('selectable');
  if (surface.readableRefs.includes(refId)) tools.push('readable');
  if (surface.ambiguousRefs.includes(refId)) tools.push('ambiguous');
  return tools.length > 0 ? tools.join('|') : 'none';
}

function isReadableOnlyRef(
  refId: string | undefined,
  surface: NonNullable<PlannerOutputValidationContext['actionSurface']>,
): boolean {
  if (!refId) return false;
  return surface.readableRefs.includes(refId)
    && !surface.clickableRefs.includes(refId)
    && !surface.typeableRefs.includes(refId)
    && !surface.selectableRefs.includes(refId);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function truncateForGuidance(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function summarizeProviderPayloadAttempt(
  attempt: number,
  systemPrompt: string,
  userMessage: string,
): ProviderPayloadAttemptSummary {
  const systemBytes = byteLength(systemPrompt);
  const userBytes = byteLength(userMessage);
  return {
    attempt,
    systemBytes,
    userBytes,
    totalBytes: systemBytes + userBytes,
  };
}

function summarizeProviderPayload(
  config: PlannerSerializationConfig,
  attempts: ProviderPayloadAttemptSummary[],
) {
  return {
    serializationMode: config.mode,
    attempts,
    totalSystemBytes: sum(attempts.map(attempt => attempt.systemBytes)),
    totalUserBytes: sum(attempts.map(attempt => attempt.userBytes)),
    totalBytes: sum(attempts.map(attempt => attempt.totalBytes)),
    maxUserBytes: max(attempts.map(attempt => attempt.userBytes)),
    maxTotalBytes: max(attempts.map(attempt => attempt.totalBytes)),
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function max(values: number[]): number {
  return values.reduce((current, value) => Math.max(current, value), 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function collectValidationContext(input: PlannerInput): PlannerOutputValidationContext {
  const refs = new Set<string>();
  const regionRefs: Record<string, string> = {};
  const currentRefs = new Set(Object.keys(input.current.refs ?? {}));
  for (const refId of Object.keys(input.current.refs ?? {})) {
    refs.add(refId);
  }
  for (const item of [...input.current.interactions, ...input.current.readables, ...input.current.navigation]) {
    if (currentRefs.has(item.refId)) {
      refs.add(item.refId);
    }
  }
  for (const region of input.current.regions) {
    const selectedRegionRefs = region.refIds.filter(refId => currentRefs.has(refId));
    if (selectedRegionRefs[0]) {
      regionRefs[region.regionId] = selectedRegionRefs[0];
    }
    for (const refId of selectedRegionRefs) {
      refs.add(refId);
    }
  }
  if (input.current.focus?.refId && currentRefs.has(input.current.focus.refId)) {
    refs.add(input.current.focus.refId);
  }
  return { allowedRefs: [...refs], regionRefs, actionSurface: input.workingSet?.actionSurface };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Detect planner output truncated mid-URL.
 * Conditions: mentions "navigate" and "url", text does NOT end with valid JSON
 * structural closure, and has a long unfinished string value (500+ chars without
 * closing quote) at the end.
 */
export function isTruncatedNavigateOutput(rawText: string): boolean {
  if (!rawText.includes('"navigate"') || !rawText.includes('"url"')) return false;
  const trimmed = rawText.trimEnd();
  // If text ends with } or ], JSON structure might be intact — not truncated
  if (trimmed.endsWith('}') || trimmed.endsWith(']')) return false;
  // Long unfinished URL value at end of text
  return /"url"\s*:\s*"[^"]{500,}$/.test(trimmed);
}
