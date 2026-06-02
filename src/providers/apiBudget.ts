import { countTokens } from '../brain1/serializer';
import type { LlmProvider } from '../config/runtime';

export type ProviderCallStatus = 'success' | 'error' | 'blocked';
export type ProviderFailureType = 'quota' | 'budget_exceeded' | 'http_error' | 'network_error' | 'unknown';

export interface ProviderCallRecord {
  provider: LlmProvider;
  model: string;
  status: ProviderCallStatus;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  failureType?: ProviderFailureType;
  keyIndex?: number;
  keyEnvName?: string;
}

export interface ProviderUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Partial<Record<LlmProvider, { calls: number; inputTokens: number; outputTokens: number }>>;
  byStatus: Partial<Record<ProviderCallStatus, number>>;
  records: ProviderCallRecord[];
}

export interface ProviderBudgetCheckInput {
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  env?: Record<string, string | undefined>;
}

export interface ActiveGeminiKeyMetadata {
  keyIndex?: number;
  envName?: string;
}

export class ProviderBudgetExceededError extends Error {
  readonly code = 'API_BUDGET_EXCEEDED';

  constructor(
    readonly provider: LlmProvider,
    readonly model: string,
    readonly inputTokens: number,
    readonly maxInputTokens: number,
  ) {
    super(
      `API_BUDGET_EXCEEDED: ${provider} prompt estimate ${inputTokens} tokens exceeds configured input budget ${maxInputTokens}.`,
    );
    this.name = 'ProviderBudgetExceededError';
  }
}

export class ProviderUsageTracker {
  private readonly records: ProviderCallRecord[] = [];

  record(record: ProviderCallRecord): void {
    this.records.push({ ...record });
  }

  reset(): void {
    this.records.length = 0;
  }

  snapshot(): ProviderUsageSummary {
    const byProvider: ProviderUsageSummary['byProvider'] = {};
    const byStatus: ProviderUsageSummary['byStatus'] = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const record of this.records) {
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;

      const providerSummary = byProvider[record.provider] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
      providerSummary.calls += 1;
      providerSummary.inputTokens += record.inputTokens;
      providerSummary.outputTokens += record.outputTokens;
      byProvider[record.provider] = providerSummary;
    }

    return {
      totalCalls: this.records.length,
      totalInputTokens,
      totalOutputTokens,
      byProvider,
      byStatus,
      records: this.records.map(record => ({ ...record })),
    };
  }
}

const providerUsageTracker = new ProviderUsageTracker();

export function estimateProviderInputTokens(system: string, user: string): number {
  return countTokens(`${system}\n${user}`);
}

export function assertProviderInputWithinBudget(input: ProviderBudgetCheckInput): void {
  const maxInputTokens = readProviderInputTokenBudget(input.provider, input.env ?? process.env);
  if (!maxInputTokens || input.inputTokens <= maxInputTokens) return;
  throw new ProviderBudgetExceededError(input.provider, input.model, input.inputTokens, maxInputTokens);
}

export function readActiveGeminiKeyMetadata(
  env: Record<string, string | undefined> = process.env,
): ActiveGeminiKeyMetadata | undefined {
  const keyIndex = readPositiveInteger(env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX);
  const envName = sanitizeEnvName(env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME);
  if (keyIndex === undefined && envName === undefined) return undefined;
  return { keyIndex, envName };
}

export function recordProviderCall(record: ProviderCallRecord): void {
  providerUsageTracker.record(record);
}

export function getProviderUsageSnapshot(): ProviderUsageSummary {
  return providerUsageTracker.snapshot();
}

export function resetProviderUsageTracker(): void {
  providerUsageTracker.reset();
}

function readProviderInputTokenBudget(
  provider: LlmProvider,
  env: Record<string, string | undefined>,
): number | undefined {
  if (provider === 'gemini') {
    return readPositiveInteger(env.BROWSEGENT_GEMINI_MAX_INPUT_TOKENS)
      ?? readPositiveInteger(env.BROWSEGENT_PROVIDER_MAX_INPUT_TOKENS);
  }
  return readPositiveInteger(env.BROWSEGENT_PROVIDER_MAX_INPUT_TOKENS);
}

function readPositiveInteger(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function sanitizeEnvName(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return /^[A-Z0-9_]+$/.test(trimmed) ? trimmed : undefined;
}
