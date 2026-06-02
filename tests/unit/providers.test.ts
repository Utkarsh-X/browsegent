import test from 'node:test';
import assert from 'node:assert/strict';

import { callProvider, detectProvider, formatGeminiQuotaError, normalizeProviderModel } from '../../src/providers';
import { getProviderUsageSnapshot, resetProviderUsageTracker } from '../../src/providers/apiBudget';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetProviderUsageTracker();
});

test('normalizeProviderModel preserves native Gemini names and strips provider namespaces', () => {
  assert.equal(normalizeProviderModel('gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeProviderModel('google/gemini/gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeProviderModel('cerebras/qwen-3-235b-a22b-instruct-2507'), 'qwen-3-235b-a22b-instruct-2507');
  assert.equal(normalizeProviderModel('ollama/qwen3.5:4b'), 'qwen3.5:4b');
  assert.equal(normalizeProviderModel('openai/gpt-4o'), 'gpt-4o');
});

test('detectProvider keeps Gemini models on the Gemini transport', () => {
  assert.equal(detectProvider('gemini-2.5-flash'), 'gemini');
  assert.equal(detectProvider('google/gemini/gemini-2.5-flash'), 'gemini');
  assert.equal(detectProvider('cerebras/qwen-3-235b-a22b-instruct-2507'), 'cerebras');
  assert.equal(detectProvider('ollama/qwen3.5:4b'), 'ollama');
});

test('formatGeminiQuotaError does not expose API key material', () => {
  const error = formatGeminiQuotaError();

  assert.match(error.message, /API_QUOTA_EXCEEDED/);
  assert.doesNotMatch(error.message, /Key \.\.\./);
  assert.doesNotMatch(error.message, /AIza/);
});

test('callProvider blocks oversized Gemini prompts before network and records budget failure', async () => {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called');
  }) as typeof fetch;
  process.env.GEMINI_API_KEY = 'secret-current-value';
  process.env.BROWSEGENT_GEMINI_MAX_INPUT_TOKENS = '1';
  process.env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX = '7';
  process.env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME = 'GEMINI_API_KEY_7';

  await assert.rejects(
    () => callProvider('system prompt with enough words', 'user prompt with enough words', 'gemini/gemini-3.1-flash-lite'),
    /API_BUDGET_EXCEEDED/,
  );

  const usage = getProviderUsageSnapshot();
  assert.equal(fetchCalls, 0);
  assert.equal(usage.totalCalls, 1);
  assert.equal(usage.records[0].status, 'blocked');
  assert.equal(usage.records[0].failureType, 'budget_exceeded');
  assert.equal(usage.records[0].keyIndex, 7);
  assert.equal(usage.records[0].keyEnvName, 'GEMINI_API_KEY_7');
  assert.doesNotMatch(JSON.stringify(usage), /secret-current-value/);
});

test('callProvider records successful Gemini usage from response metadata', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"done":true}' }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  process.env.GEMINI_API_KEY = 'secret-current-value';
  process.env.BROWSEGENT_GEMINI_MAX_INPUT_TOKENS = '100000';
  process.env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX = '2';
  process.env.BROWSEGENT_ACTIVE_GEMINI_KEY_ENV_NAME = 'GEMINI_API_KEY_2';

  const result = await callProvider('system', 'user', 'gemini/gemini-3.1-flash-lite');

  const usage = getProviderUsageSnapshot();
  assert.equal(result.inputTokens, 11);
  assert.equal(result.outputTokens, 4);
  assert.equal(usage.totalCalls, 1);
  assert.equal(usage.totalInputTokens, 11);
  assert.equal(usage.totalOutputTokens, 4);
  assert.equal(usage.records[0].status, 'success');
  assert.equal(usage.records[0].keyIndex, 2);
  assert.doesNotMatch(JSON.stringify(usage), /secret-current-value/);
});

test('callProvider lets callers override the Gemini response schema', async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"done":true,"val":"ok"}' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  process.env.GEMINI_API_KEY = 'secret-current-value';
  process.env.BROWSEGENT_GEMINI_MAX_INPUT_TOKENS = '100000';

  await callProvider('system', 'user', 'gemini/gemini-3.1-flash-lite', {
    responseSchema: {
      type: 'object',
      properties: { done: { type: 'boolean' } },
    },
  });

  const config = requestBody?.generationConfig as { responseJsonSchema?: unknown };
  assert.deepEqual(config.responseJsonSchema, {
    type: 'object',
    properties: { done: { type: 'boolean' } },
  });
});
