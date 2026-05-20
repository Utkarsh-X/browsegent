import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowseGent } from '../../../src/BrowseGent';
import { getRuntimeConfig } from '../../../src/config/runtime';
import { V1CompatibilityAdapter } from '../../../src/v2/adapter/V1CompatibilityAdapter';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function seedRequiredEnv(): void {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
}

test.afterEach(() => {
  restoreEnv();
});

test('V1CompatibilityAdapter uses v1 path by default', async () => {
  seedRequiredEnv();
  delete process.env.BROWSEGENT_V2_RUNTIME;
  const runtime = getRuntimeConfig();
  const calls: string[] = [];
  const adapter = V1CompatibilityAdapter.create({
    runtimeMode: runtime.v2.runtimeMode,
    runV1: async input => {
      calls.push(`v1:${input.url}:${input.goal}`);
      return { path: 'v1' };
    },
    extractV1: async () => ({ path: 'v1-extract' }),
    runV2Diagnostic: async () => ({ path: 'v2' }),
    extractV2Diagnostic: async () => ({ path: 'v2-extract' }),
    runV2Agent: async () => ({ path: 'v2-agent' }),
    extractV2Agent: async () => ({ path: 'v2-agent-extract' }),
  });

  const result = await adapter.run({ url: 'https://example.test', goal: 'Read page' });

  assert.deepEqual(result, { path: 'v1' });
  assert.equal(runtime.v2.runtimeMode, 'off');
  assert.deepEqual(calls, ['v1:https://example.test:Read page']);
});

test('V1CompatibilityAdapter enables v2 diagnostic path only when configured', async () => {
  seedRequiredEnv();
  process.env.BROWSEGENT_V2_RUNTIME = 'mvr';
  const runtime = getRuntimeConfig();
  const calls: string[] = [];
  const adapter = V1CompatibilityAdapter.create({
    runtimeMode: runtime.v2.runtimeMode,
    runV1: async () => ({ path: 'v1' }),
    extractV1: async () => ({ path: 'v1-extract' }),
    runV2Diagnostic: async input => {
      calls.push(`v2:${input.url}:${input.goal}`);
      return { path: 'v2' };
    },
    extractV2Diagnostic: async () => ({ path: 'v2-extract' }),
    runV2Agent: async () => ({ path: 'v2-agent' }),
    extractV2Agent: async () => ({ path: 'v2-agent-extract' }),
  });

  const result = await adapter.run({ url: 'https://example.test', goal: 'Read page' });

  assert.deepEqual(result, { path: 'v2' });
  assert.equal(runtime.v2.runtimeMode, 'mvr');
  assert.deepEqual(calls, ['v2:https://example.test:Read page']);
});

test('V1CompatibilityAdapter preserves extract path selection shape', async () => {
  seedRequiredEnv();
  process.env.BROWSEGENT_V2_RUNTIME = 'mvr';
  const runtime = getRuntimeConfig();
  const adapter = V1CompatibilityAdapter.create({
    runtimeMode: runtime.v2.runtimeMode,
    runV1: async () => ({ path: 'v1' }),
    extractV1: async () => ({ path: 'v1-extract' }),
    runV2Diagnostic: async () => ({ path: 'v2' }),
    extractV2Diagnostic: async input => ({
      path: 'v2-extract',
      schema: input.schemaDescription,
      hasParser: input.parseResult !== undefined,
    }),
    runV2Agent: async () => ({ path: 'v2-agent' }),
    extractV2Agent: async input => ({
      path: 'v2-agent-extract',
      schema: input.schemaDescription,
      hasParser: input.parseResult !== undefined,
    }),
  });

  const result = await adapter.extract({
    url: 'https://example.test',
    instruction: 'Extract visible title',
    schemaDescription: '{ "title": string }',
    parseResult: (raw: unknown) => raw,
  });

  assert.deepEqual(result, {
    path: 'v2-extract',
    schema: '{ "title": string }',
    hasParser: true,
  });
});

test('V1CompatibilityAdapter routes explicit agent mode to full v2 agent path', async () => {
  seedRequiredEnv();
  process.env.BROWSEGENT_V2_RUNTIME = 'agent';
  const runtime = getRuntimeConfig();
  const calls: string[] = [];
  const adapter = V1CompatibilityAdapter.create({
    runtimeMode: runtime.v2.runtimeMode,
    runV1: async () => ({ path: 'v1' }),
    extractV1: async () => ({ path: 'v1-extract' }),
    runV2Diagnostic: async () => ({ path: 'v2-diagnostic' }),
    extractV2Diagnostic: async () => ({ path: 'v2-diagnostic-extract' }),
    runV2Agent: async input => {
      calls.push(`agent:${input.url}:${input.goal}`);
      return { path: 'v2-agent' };
    },
    extractV2Agent: async input => ({
      path: 'v2-agent-extract',
      schema: input.schemaDescription,
    }),
  });

  const runResult = await adapter.run({ url: 'https://example.test', goal: 'Read page' });
  const extractResult = await adapter.extract({
    url: 'https://example.test',
    instruction: 'Extract title',
    schemaDescription: '{ "title": string }',
  });

  assert.equal(runtime.v2.runtimeMode, 'agent');
  assert.deepEqual(runResult, { path: 'v2-agent' });
  assert.deepEqual(extractResult, { path: 'v2-agent-extract', schema: '{ "title": string }' });
  assert.deepEqual(calls, ['agent:https://example.test:Read page']);
});

test('BrowseGent public API keeps run, extract, and close methods available', () => {
  seedRequiredEnv();
  process.env.BROWSEGENT_V2_RUNTIME = 'off';
  const bg = new BrowseGent({ headless: true, warmup: false, pageWaitMs: 0 });

  assert.equal(typeof bg.run, 'function');
  assert.equal(typeof bg.extract, 'function');
  assert.equal(typeof bg.close, 'function');
});
