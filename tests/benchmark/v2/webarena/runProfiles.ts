/**
 * Run profiles for WebArena benchmarks: one place declaring which model runs,
 * how fast, and how hard the provider may be pushed. Resolution is pure; the
 * runner applies the resolved profile through environment variables that the
 * existing provider layer already reads per request (pacing + backoff), so no
 * new provider plumbing is introduced.
 */

export interface WebArenaRunProfile {
  name: string;
  /** Any provider-routable model string; OpenRouter-first (`openrouter/...`). */
  model: string;
  /** Minimum interval between provider requests (shared pacer). */
  requestMinIntervalMs: number;
  providerRetries: number;
  providerRetryBaseMs: number;
  providerRetryMaxMs: number;
  maxSteps: number;
  attemptsPerTask: number;
}

export type RunProfileOverrides = Partial<Omit<WebArenaRunProfile, 'name'>>;

const DEFAULT_PROFILE: Omit<WebArenaRunProfile, 'name'> = {
  // Fast iteration on the local pilot; gentle pacing for free-tier quota headroom.
  model: 'gemini-2.5-flash-lite',
  requestMinIntervalMs: 4000,
  providerRetries: 6,
  providerRetryBaseMs: 3000,
  providerRetryMaxMs: 30000,
  maxSteps: 15,
  attemptsPerTask: 1,
};

export const RUN_PROFILE_PRESETS: Record<string, RunProfileOverrides> = {
  'flash-lite-fast': {},
  // Full-strength comparable runs through OpenRouter; conservative pacing so
  // long pilots never trip upstream rate limits mid-run.
  'openrouter-default': {
    model: 'openrouter/anthropic/claude-sonnet-4.5',
    requestMinIntervalMs: 1500,
    providerRetries: 8,
    providerRetryBaseMs: 5000,
    providerRetryMaxMs: 60000,
  },
};

/** Unknown presets always throw (typo safety); pass overrides on top of a known preset for custom runs. */
export function resolveRunProfile(options: {
  preset?: string;
  overrides?: RunProfileOverrides;
}): WebArenaRunProfile {
  const presetName = options.preset ?? 'flash-lite-fast';
  const preset = RUN_PROFILE_PRESETS[presetName];
  if (!preset) throw new Error(`unknown_run_profile_preset:${presetName}`);
  return { name: presetName, ...DEFAULT_PROFILE, ...preset, ...options.overrides };
}

/** Applies the profile through the env vars the provider layer reads per request. */
export function applyProfileToEnv(profile: WebArenaRunProfile, env: Record<string, string | undefined> = process.env): void {
  env.BROWSEGENT_GEMINI_MIN_INTERVAL_MS = String(profile.requestMinIntervalMs);
  env.BROWSEGENT_OPENROUTER_RETRIES = String(profile.providerRetries);
  env.BROWSEGENT_OPENROUTER_RETRY_BASE_MS = String(profile.providerRetryBaseMs);
  env.BROWSEGENT_OPENROUTER_RETRY_MAX_MS = String(profile.providerRetryMaxMs);
}
