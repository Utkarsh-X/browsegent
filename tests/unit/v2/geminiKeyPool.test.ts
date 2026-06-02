import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGeminiKeySelection,
  collectGeminiKeyPool,
  collectGeminiKeyPoolDiagnostics,
  redactSecrets,
  selectGeminiKeyForAttempt,
  selectGeminiKeyForRun,
} from '../../benchmark/v2/gemini_key_pool';

test('collectGeminiKeyPool reads Gemini and Google key variants without duplicates', () => {
  const pool = collectGeminiKeyPool({
    GEMINI_API_KEY: 'key-a',
    GOOGLE_API_KEY: 'key-a',
    GEMINI_API_KEY_2: 'key-b',
    GOOGLE_API_KEY_3: 'key-c',
    BROWSEGENT_GEMINI_API_KEY_4: 'key-b',
  });

  assert.deepEqual(pool.map(entry => entry.value), ['key-a', 'key-b', 'key-c']);
  assert.deepEqual(pool.map(entry => entry.envName), ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GOOGLE_API_KEY_3']);
});

test('collectGeminiKeyPoolDiagnostics reports configured and unique key counts without secrets', () => {
  const diagnostics = collectGeminiKeyPoolDiagnostics({
    GEMINI_API_KEY: 'key-a',
    GOOGLE_API_KEY: 'key-a',
    GEMINI_API_KEY_2: 'key-b',
    GOOGLE_API_KEY_3: 'key-c',
    BROWSEGENT_GEMINI_API_KEY_4: 'key-b',
    UNRELATED_API_KEY: 'key-ignored',
  });

  assert.deepEqual(diagnostics, {
    configuredKeyCount: 5,
    uniqueKeyCount: 3,
    duplicateKeyCount: 2,
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /key-a|key-b|key-c/);
});

test('selectGeminiKeyForRun supports explicit one-based key index', () => {
  const selection = selectGeminiKeyForRun(
    'benchmark_unit',
    [
      { envName: 'GEMINI_API_KEY', value: 'key-a' },
      { envName: 'GEMINI_API_KEY_2', value: 'key-b' },
    ],
    2,
  );

  assert.deepEqual(selection, {
    key: 'key-b',
    keyIndex: 2,
    keyCount: 2,
    envName: 'GEMINI_API_KEY_2',
  });
});

test('selectGeminiKeyForAttempt rotates sequentially from explicit start index', () => {
  const pool = [
    { envName: 'GEMINI_API_KEY', value: 'key-a' },
    { envName: 'GEMINI_API_KEY_2', value: 'key-b' },
    { envName: 'GEMINI_API_KEY_3', value: 'key-c' },
  ];

  const selections = [0, 1, 2, 3].map(offset =>
    selectGeminiKeyForAttempt('benchmark_unit', pool, offset, 2),
  );

  assert.deepEqual(selections.map(selection => selection?.key), ['key-b', 'key-c', 'key-a', 'key-b']);
  assert.deepEqual(selections.map(selection => selection?.keyIndex), [2, 3, 1, 2]);
});

test('applyGeminiKeySelection sets both Gemini-compatible env names', () => {
  const env: Record<string, string | undefined> = {};

  applyGeminiKeySelection(env, {
    key: 'selected-key',
    keyIndex: 1,
    keyCount: 1,
    envName: 'GEMINI_API_KEY',
  });

  assert.equal(env.GEMINI_API_KEY, 'selected-key');
  assert.equal(env.GOOGLE_API_KEY, 'selected-key');
  assert.equal(env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX, '1');
  assert.equal(env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME, 'GEMINI_API_KEY');
});

test('redactSecrets removes key material from persisted logs', () => {
  const redacted = redactSecrets(
    'request failed for key-a and selected-key',
    ['key-a', 'selected-key', 'x'],
  );

  assert.equal(redacted, 'request failed for [REDACTED_SECRET] and [REDACTED_SECRET]');
});
