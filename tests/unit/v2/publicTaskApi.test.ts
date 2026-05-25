import test from 'node:test';
import assert from 'node:assert/strict';

import type { V2AgentLoopResult } from '../../../src/v2';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function seedEnv(): void {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_V2_RUNTIME = 'agent';
  process.env.BROWSEGENT_V2_HEADED = 'false';
}

function makeAgentResult(): V2AgentLoopResult {
  return {
    success: true,
    value: 'task answer',
    steps: 1,
    tracePath: 'logs/v2-runs/task-api/trace.json',
    metrics: {
      plannerCalls: 1,
      inputTokens: 2,
      outputTokens: 3,
      plannerDurationMs: 4,
      toolExecutions: 1,
    },
  };
}

test.afterEach(() => {
  restoreEnv();
});

test('BrowseGent.run supports task-first options without requiring init', async () => {
  seedEnv();
  const factoryModule = require('../../../src/v2/agent/createV2AgentLoop') as {
    v2AgentLoopFactory: {
      create: (input: unknown) => { run(input: unknown): Promise<V2AgentLoopResult> };
    };
  };
  const originalFactory = factoryModule.v2AgentLoopFactory.create;
  const calls: unknown[] = [];
  factoryModule.v2AgentLoopFactory.create = input => {
    calls.push(input);
    return {
      run: async runInput => {
        calls.push(runInput);
        return makeAgentResult();
      },
    };
  };

  try {
    const { BrowseGent } = await import('../../../src/BrowseGent');
    const bg = new BrowseGent({ maxSteps: 9, warmup: false });
    const result = await bg.run('Read the visible answer', {
      url: 'https://example.test',
      maxSteps: 5,
      browser: { headless: true },
      trace: { dir: 'logs/public-task-api', runId: 'api_test' },
    });

    assert.equal(result.success, true);
    assert.equal(result.value, 'task answer');
    assert.equal(result.tracePath, 'logs/v2-runs/task-api/trace.json');
    assert.equal(result.metrics.plannerCalls, 1);
    assert.deepEqual(calls[0], {
      headed: false,
      traceDir: 'logs/public-task-api',
      runId: 'api_test',
      viewport: undefined,
    });
    assert.deepEqual(calls[1], {
      url: 'https://example.test',
      goal: 'Read the visible answer',
      maxSteps: 5,
      model: 'gemini/gemini-3.1-flash-lite-preview',
    });
  } finally {
    factoryModule.v2AgentLoopFactory.create = originalFactory;
  }
});
