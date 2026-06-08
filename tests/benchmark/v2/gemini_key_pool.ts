export interface GeminiKeyPoolEntry {
  envName: string;
  value: string;
}

export interface GeminiKeySelection {
  key: string;
  keyIndex: number;
  keyCount: number;
  envName: string;
}

export interface GeminiKeyPoolDiagnostics {
  configuredKeyCount: number;
  uniqueKeyCount: number;
  duplicateKeyCount: number;
}

export type EnvLike = Record<string, string | undefined>;

const KEY_NAME_PATTERNS = [
  /^GEMINI_API_KEY(?:_\d+)?$/,
  /^GOOGLE_API_KEY(?:_\d+)?$/,
  /^BROWSEGENT_GEMINI_API_KEY(?:_\d+)?$/,
];

export function collectGeminiKeyPool(env: EnvLike = process.env): GeminiKeyPoolEntry[] {
  const seenValues = new Set<string>();
  const entries: GeminiKeyPoolEntry[] = [];

  for (const entry of collectRecognizedKeyEntries(env)) {
    if (seenValues.has(entry.value)) continue;
    seenValues.add(entry.value);
    entries.push(entry);
  }

  return entries;
}

export function collectGeminiKeyPoolDiagnostics(env: EnvLike = process.env): GeminiKeyPoolDiagnostics {
  const configured = collectRecognizedKeyEntries(env);
  const uniqueValues = new Set(configured.map(entry => entry.value));

  return {
    configuredKeyCount: configured.length,
    uniqueKeyCount: uniqueValues.size,
    duplicateKeyCount: configured.length - uniqueValues.size,
  };
}

function collectRecognizedKeyEntries(env: EnvLike): GeminiKeyPoolEntry[] {
  const entries: GeminiKeyPoolEntry[] = [];
  const activeEnvName = env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME;

  const numberedValues = new Set<string>();
  const rawEntries: GeminiKeyPoolEntry[] = [];

  for (const envName of Object.keys(env).sort(compareKeyEnvNames)) {
    if (!KEY_NAME_PATTERNS.some(pattern => pattern.test(envName))) continue;

    const isNumbered = /^(?:GEMINI_API_KEY|GOOGLE_API_KEY|BROWSEGENT_GEMINI_API_KEY)_\d+$/.test(envName);
    const value = env[envName]?.trim();
    if (!value) continue;

    if (isNumbered) {
      numberedValues.add(value);
    }
    rawEntries.push({ envName, value });
  }

  for (const entry of rawEntries) {
    const envName = entry.envName;
    const isUnnumbered = envName === 'GEMINI_API_KEY' || envName === 'GOOGLE_API_KEY' || envName === 'BROWSEGENT_GEMINI_API_KEY';

    if (isUnnumbered) {
      if (activeEnvName) {
        continue;
      }
      if (numberedValues.has(entry.value)) {
        continue;
      }
    }

    entries.push(entry);
  }

  return entries;
}

export function selectGeminiKeyForRun(
  runId: string,
  pool: GeminiKeyPoolEntry[],
  requestedIndex?: number,
): GeminiKeySelection | undefined {
  return selectGeminiKeyForAttempt(runId, pool, 0, requestedIndex);
}

export function selectGeminiKeyForAttempt(
  runId: string,
  pool: GeminiKeyPoolEntry[],
  attemptOffset: number,
  requestedIndex?: number,
): GeminiKeySelection | undefined {
  if (pool.length === 0) return undefined;
  const zeroBasedStartIndex = requestedIndex === undefined
    ? stableIndex(runId, pool.length)
    : normalizeRequestedIndex(requestedIndex, pool.length);
  const zeroBasedIndex = (zeroBasedStartIndex + normalizeAttemptOffset(attemptOffset)) % pool.length;
  const selected = pool[zeroBasedIndex];
  return {
    key: selected.value,
    keyIndex: zeroBasedIndex + 1,
    keyCount: pool.length,
    envName: selected.envName,
  };
}

export function applyGeminiKeySelection(env: EnvLike, selection: GeminiKeySelection | undefined): void {
  if (!selection) return;
  env.GEMINI_API_KEY = selection.key;
  env.GOOGLE_API_KEY = selection.key;
  env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX = String(selection.keyIndex);
  env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME = selection.envName;
}

export function redactSecrets(value: string, secrets: Iterable<string | undefined>): string {
  let redacted = value;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    redacted = redacted.split(secret).join('[REDACTED_SECRET]');
  }
  return redacted;
}

export function readRequestedGeminiKeyIndex(env: EnvLike = process.env): number | undefined {
  const raw = env.BROWSEGENT_BENCHMARK_KEY_INDEX;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('BROWSEGENT_BENCHMARK_KEY_INDEX must be a positive one-based integer.');
  }
  return parsed;
}

function normalizeRequestedIndex(requestedIndex: number, keyCount: number): number {
  if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > keyCount) {
    throw new Error(`Requested Gemini key index ${requestedIndex} is outside the available pool of ${keyCount}.`);
  }
  return requestedIndex - 1;
}

function normalizeAttemptOffset(attemptOffset: number): number {
  if (!Number.isInteger(attemptOffset) || attemptOffset < 0) {
    throw new Error('Gemini key attempt offset must be a non-negative integer.');
  }
  return attemptOffset;
}

function stableIndex(runId: string, keyCount: number): number {
  let hash = 0;
  for (const char of runId) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % keyCount;
}

function compareKeyEnvNames(left: string, right: string): number {
  const leftBase = baseRank(left);
  const rightBase = baseRank(right);
  if (leftBase !== rightBase) return leftBase - rightBase;
  const leftIndex = suffixIndex(left);
  const rightIndex = suffixIndex(right);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return left.localeCompare(right);
}

function baseRank(envName: string): number {
  if (envName.startsWith('GEMINI_API_KEY')) return 0;
  if (envName.startsWith('GOOGLE_API_KEY')) return 1;
  return 2;
}

function suffixIndex(envName: string): number {
  const match = envName.match(/_(\d+)$/);
  return match ? Number(match[1]) : 0;
}
