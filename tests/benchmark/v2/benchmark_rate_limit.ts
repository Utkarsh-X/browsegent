export interface BenchmarkRateLimitInput {
  requestRpm?: number;
  requestMinIntervalMs?: number;
  env?: Record<string, string | undefined>;
}

export interface BenchmarkRateLimitMetadata {
  mode: 'disabled' | 'paced';
  requestRpm?: number;
  minIntervalMs: number;
}

export function resolveBenchmarkRateLimit(input: BenchmarkRateLimitInput = {}): BenchmarkRateLimitMetadata {
  const env = input.env ?? process.env;
  const requestRpm = input.requestRpm ?? readPositiveNumber(env.BROWSEGENT_BENCHMARK_REQUEST_RPM);
  const explicitMinIntervalMs = input.requestMinIntervalMs
    ?? readPositiveNumber(env.BROWSEGENT_BENCHMARK_REQUEST_MIN_INTERVAL_MS);
  const minIntervalMs = explicitMinIntervalMs ?? rpmToIntervalMs(requestRpm);

  if (!minIntervalMs || minIntervalMs <= 0) {
    return { mode: 'disabled', requestRpm, minIntervalMs: 0 };
  }

  return {
    mode: 'paced',
    requestRpm,
    minIntervalMs,
  };
}

function rpmToIntervalMs(requestRpm: number | undefined): number {
  if (!requestRpm || requestRpm <= 0) return 0;
  return Math.ceil(60_000 / requestRpm);
}

function readPositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
