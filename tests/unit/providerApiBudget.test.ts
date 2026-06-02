import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ProviderBudgetExceededError,
  ProviderUsageTracker,
  assertProviderInputWithinBudget,
  estimateProviderInputTokens,
  readActiveGeminiKeyMetadata,
} from '../../src/providers/apiBudget';

test('assertProviderInputWithinBudget blocks oversized Gemini prompts without exposing prompt text', () => {
  const inputTokens = estimateProviderInputTokens('system prompt with private details', 'user prompt with private details');

  assert.throws(
    () => assertProviderInputWithinBudget({
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      inputTokens,
      env: { BROWSEGENT_GEMINI_MAX_INPUT_TOKENS: '1' },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderBudgetExceededError);
      assert.equal(error.code, 'API_BUDGET_EXCEEDED');
      assert.equal(error.provider, 'gemini');
      assert.equal(error.model, 'gemini-3.1-flash-lite');
      assert.equal(error.maxInputTokens, 1);
      assert.equal(error.inputTokens, inputTokens);
      assert.doesNotMatch(error.message, /private details/);
      return true;
    },
  );
});

test('assertProviderInputWithinBudget is disabled unless a positive provider budget is configured', () => {
  const inputTokens = estimateProviderInputTokens('system prompt', 'user prompt');

  assert.doesNotThrow(() => assertProviderInputWithinBudget({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    inputTokens,
    env: {},
  }));

  assert.doesNotThrow(() => assertProviderInputWithinBudget({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    inputTokens,
    env: { BROWSEGENT_GEMINI_MAX_INPUT_TOKENS: String(inputTokens) },
  }));
});

test('readActiveGeminiKeyMetadata returns key identity metadata without key material', () => {
  const metadata = readActiveGeminiKeyMetadata({
    GEMINI_API_KEY: 'secret-current-value',
    BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX: '7',
    BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME: 'GEMINI_API_KEY_7',
  });

  assert.deepEqual(metadata, {
    keyIndex: 7,
    envName: 'GEMINI_API_KEY_7',
  });
  assert.doesNotMatch(JSON.stringify(metadata), /secret-current-value/);
});

test('ProviderUsageTracker aggregates calls and keeps only secret-safe metadata', () => {
  const tracker = new ProviderUsageTracker();

  tracker.record({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    status: 'success',
    inputTokens: 10,
    outputTokens: 2,
    durationMs: 50,
    keyIndex: 3,
    keyEnvName: 'GEMINI_API_KEY_3',
  });
  tracker.record({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    status: 'blocked',
    failureType: 'budget_exceeded',
    inputTokens: 20,
    outputTokens: 0,
    durationMs: 1,
    keyIndex: 3,
    keyEnvName: 'GEMINI_API_KEY_3',
  });

  const snapshot = tracker.snapshot();

  assert.equal(snapshot.totalCalls, 2);
  assert.equal(snapshot.totalInputTokens, 30);
  assert.equal(snapshot.totalOutputTokens, 2);
  assert.equal(snapshot.byProvider.gemini?.calls, 2);
  assert.equal(snapshot.byStatus.success, 1);
  assert.equal(snapshot.byStatus.blocked, 1);
  assert.deepEqual(snapshot.records.map(record => record.keyIndex), [3, 3]);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret/i);
});
