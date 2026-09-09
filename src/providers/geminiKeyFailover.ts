/**
 * Provider-level Gemini key failover.
 *
 * Measured failure shape (fresh50 run 5, `webvoyager_lite_1788899130707`): the
 * benchmark pins one pool key per run and a quota-signature 429 threw
 * immediately — 7 tasks (14%) died on infrastructure while the same tasks were
 * proven solvable on other keys in the same comparison. The retry ladder's
 * ≤30 s backoff cannot recover an exhausted quota, so the repair is rotation,
 * not longer waits.
 *
 * Semantics:
 * - Daily/per-day quota exhaustion blocks the key for the remainder of the
 *   process (a run-scoped outage; the key will not recover mid-run).
 * - Any other quota-signature 429 (per-minute/per-minute-model limits) blocks
 *   the key for a short cooldown only, after which it becomes usable again.
 * - When every pool key is blocked, callers fall back to the original
 *   quota-error behavior — honest task failure is never masked.
 * - With zero failover keys configured the rotator is inert and request
 *   behavior is byte-identical to the single-key path.
 */

export interface GeminiFailoverKey {
  value: string;
  envName: string;
}

const NUMBERED_KEY_PATTERNS = [
  /^GEMINI_API_KEY_\d+$/,
  /^GOOGLE_API_KEY_\d+$/,
  /^BROWSEGENT_GEMINI_API_KEY_\d+$/,
];

const DAILY_QUOTA_PATTERN = /per\s*day|daily/i;
const PER_MINUTE_COOLDOWN_MS = 60_000;

export function collectGeminiFailoverKeyPool(
  env: Record<string, string | undefined> = process.env,
): GeminiFailoverKey[] {
  const activeKey = env.GEMINI_API_KEY?.trim();
  const seen = new Set<string>();
  const entries: GeminiFailoverKey[] = [];

  for (const envName of Object.keys(env).sort()) {
    if (!NUMBERED_KEY_PATTERNS.some(pattern => pattern.test(envName))) continue;
    const value = env[envName]?.trim();
    if (!value || value === activeKey || seen.has(value)) continue;
    seen.add(value);
    entries.push({ value, envName });
  }

  return entries;
}

export interface GeminiQuotaKeyRotator {
  /** Record a quota-signature 429 against the given key. */
  markBlocked(key: string, errorBody: string): void;
  /** Next usable key, or undefined when the whole pool is blocked/inert. */
  nextKey(excludeKey: string): GeminiFailoverKey | undefined;
  /** True when the given key is currently unusable. */
  isBlocked(key: string): boolean;
  blockedCount(): number;
  poolSize(): number;
}

export function createGeminiQuotaKeyRotator(
  pool: GeminiFailoverKey[],
  now: () => number = Date.now,
): GeminiQuotaKeyRotator {
  // value -> 'run' (exhausted for the process) | cooldown-until epoch ms
  const blocked = new Map<string, 'run' | number>();

  function isBlockedAt(key: string, at: number): boolean {
    const state = blocked.get(key);
    if (state === undefined) return false;
    if (state === 'run') return true;
    if (at >= state) {
      blocked.delete(key);
      return false;
    }
    return true;
  }

  return {
    markBlocked(key, errorBody) {
      blocked.set(key, DAILY_QUOTA_PATTERN.test(errorBody) ? 'run' : now() + PER_MINUTE_COOLDOWN_MS);
    },
    nextKey(excludeKey) {
      const at = now();
      return pool.find(entry => entry.value !== excludeKey && !isBlockedAt(entry.value, at));
    },
    isBlocked(key) {
      return isBlockedAt(key, now());
    },
    blockedCount() {
      const at = now();
      let count = 0;
      for (const key of blocked.keys()) {
        if (isBlockedAt(key, at)) count += 1;
      }
      return count;
    },
    poolSize() {
      return pool.length;
    },
  };
}

/** One-based pool index derived from a numbered env name suffix, for telemetry. */
export function numberedKeyIndex(envName: string): number | undefined {
  const match = envName.match(/_(\d+)$/);
  return match ? Number(match[1]) : undefined;
}
