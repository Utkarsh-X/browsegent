import test from 'node:test';
import assert from 'node:assert/strict';

import type { V2AgentLoopResult } from '../../../src/v2';

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
  process.env.BROWSEGENT_V2_RUNTIME = 'agent';
  process.env.BROWSEGENT_V2_HEADED = 'false';
}

function makeAgentResult(overrides: Partial<V2AgentLoopResult> = {}): V2AgentLoopResult {
  return {
    success: true,
    value: 'agent value',
    steps: 2,
    tracePath: 'logs/v2-runs/public-agent/trace.json',
    metrics: {
      plannerCalls: 2,
      inputTokens: 11,
      outputTokens: 7,
      plannerDurationMs: 13,
      toolExecutions: 1,
    },
    ...overrides,
  };
}

function markInitialized(bg: unknown): void {
  const mutable = bg as { initialized: boolean; page: object };
  mutable.initialized = true;
  mutable.page = {};
}

test.afterEach(() => {
  restoreEnv();
});

test('BrowseGent.run routes explicit agent mode through the v2 agent loop factory', async () => {
  seedRequiredEnv();
  const factoryModule = require('../../../src/v2/agent/createV2AgentLoop') as {
    v2AgentLoopFactory: {
      create: (input: { headed: boolean; traceDir: string }) => { run(input: unknown): Promise<V2AgentLoopResult> };
    };
  };
  const originalFactory = factoryModule.v2AgentLoopFactory.create;
  const calls: unknown[] = [];
  factoryModule.v2AgentLoopFactory.create = (input) => {
    calls.push(input);
    return {
      run: async runInput => {
        calls.push(runInput);
        return makeAgentResult({ value: 'public agent done' });
      },
    };
  };

  try {
    const { BrowseGent } = await import('../../../src/BrowseGent');
    const bg = new BrowseGent({ headless: true, warmup: false, maxSteps: 4, pageWaitMs: 0 });
    markInitialized(bg);

    const result = await bg.run('https://example.test/public', 'Read with v2');

    assert.equal(result.success, true);
    assert.equal(result.value, 'public agent done');
    assert.equal(result.metrics.llmCallCount, 2);
    assert.equal(result.metrics.inputTokens, 11);
    assert.equal(result.metrics.outputTokens, 7);
    assert.equal(result.metrics.totalSteps, 2);
    assert.deepEqual(calls[0], { headed: false, traceDir: 'logs/v2-runs' });
    assert.deepEqual(calls[1], {
      url: 'https://example.test/public',
      goal: 'Read with v2',
      maxSteps: 4,
      model: 'gemini/gemini-3.1-flash-lite-preview',
    });
  } finally {
    factoryModule.v2AgentLoopFactory.create = originalFactory;
  }
});

test('BrowseGent.extract parses v2 agent done value and applies parseResult', async () => {
  seedRequiredEnv();
  const factoryModule = require('../../../src/v2/agent/createV2AgentLoop') as {
    v2AgentLoopFactory: {
      create: (input: { headed: boolean; traceDir: string }) => { run(input: unknown): Promise<V2AgentLoopResult> };
    };
  };
  const originalFactory = factoryModule.v2AgentLoopFactory.create;
  factoryModule.v2AgentLoopFactory.create = () => ({
    run: async () => makeAgentResult({ value: '{"title":"Runtime fixture"}' }),
  });

  try {
    const { BrowseGent } = await import('../../../src/BrowseGent');
    const bg = new BrowseGent({ headless: true, warmup: false, maxSteps: 3, pageWaitMs: 0 });
    markInitialized(bg);

    const result = await bg.extract(
      'https://example.test/extract',
      'Extract title',
      '{ "title": string }',
      (raw: unknown) => (raw as { title: string }).title.toUpperCase(),
    );

    assert.equal(result.success, true);
    assert.equal(result.data, 'RUNTIME FIXTURE');
    assert.equal(result.rawJson, '{"title":"Runtime fixture"}');
  } finally {
    factoryModule.v2AgentLoopFactory.create = originalFactory;
  }
});

test('BrowseGent.extract reports explicit v2 agent JSON parse failure', async () => {
  seedRequiredEnv();
  const factoryModule = require('../../../src/v2/agent/createV2AgentLoop') as {
    v2AgentLoopFactory: {
      create: (input: { headed: boolean; traceDir: string }) => { run(input: unknown): Promise<V2AgentLoopResult> };
    };
  };
  const originalFactory = factoryModule.v2AgentLoopFactory.create;
  factoryModule.v2AgentLoopFactory.create = () => ({
    run: async () => makeAgentResult({ value: 'not json' }),
  });

  try {
    const { BrowseGent } = await import('../../../src/BrowseGent');
    const bg = new BrowseGent({ headless: true, warmup: false, maxSteps: 3, pageWaitMs: 0 });
    markInitialized(bg);

    const result = await bg.extract('https://example.test/extract', 'Extract title', '{ "title": string }');

    assert.equal(result.success, false);
    assert.equal(result.data, null);
    assert.equal(result.rawJson, 'not json');
    assert.match(result.failureReason ?? '', /JSON parse failed/);
  } finally {
    factoryModule.v2AgentLoopFactory.create = originalFactory;
  }
});
