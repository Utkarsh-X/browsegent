import test from 'node:test';
import assert from 'node:assert/strict';

import type { V2AgentLoopResult } from '../../../src/v2';

function makeLoopResult(overrides: Partial<V2AgentLoopResult> = {}): V2AgentLoopResult {
  return {
    success: true,
    value: 'done',
    steps: 1,
    tracePath: 'logs/v2-runs/run/trace.json',
    metrics: {
      plannerCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
      plannerDurationMs: 7,
      toolExecutions: 1,
    },
    ...overrides,
  };
}

test('v2 public API exports task-first option and result contracts', async () => {
  const v2 = await import('../../../src/v2');

  assert.equal(typeof v2.BrowserAgentRunner, 'function');
});

test('BrowserAgentRunner maps task-first input into a v2 agent loop run', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const calls: unknown[] = [];
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 6,
    defaultModel: 'gemini/gemini-3.1-flash-lite-preview',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: input => {
      calls.push(input);
      return {
        run: async runInput => {
          calls.push(runInput);
          return makeLoopResult({ value: 'first price is $9' });
        },
      };
    },
  });

  const result = await runner.run('Find the first price', {
    url: 'https://example.test/products',
    maxSteps: 3,
    model: 'gemini/gemini-3.1-flash-lite-preview',
    browser: { headless: true, viewport: { width: 1000, height: 700 } },
    trace: { dir: 'logs/bench', runId: 'public_api_unit' },
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'first price is $9');
  assert.equal(result.tracePath, 'logs/v2-runs/run/trace.json');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(calls[0], {
    headed: false,
    traceDir: 'logs/bench',
    runId: 'public_api_unit',
    viewport: { width: 1000, height: 700 },
  });
  assert.deepEqual(calls[1], {
    url: 'https://example.test/products',
    goal: 'Find the first price',
    maxSteps: 3,
    model: 'gemini/gemini-3.1-flash-lite-preview',
  });
});

test('BrowserAgentRunner reports unsupported browser options as warnings', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite-preview',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult(),
    }),
  });

  const result = await runner.run('Read page', {
    url: 'https://example.test',
    browser: { cdpUrl: 'http://127.0.0.1:9222', profileDir: '.profile' },
    trace: false,
  });

  assert.equal(result.success, true);
  assert.match(result.warnings.join('\n'), /cdpUrl/);
  assert.match(result.warnings.join('\n'), /profileDir/);
  assert.match(result.warnings.join('\n'), /trace=false/);
});

test('BrowserAgentRunner parses JSON output mode and fails honestly on invalid JSON', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite-preview',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult({ value: '{"price":"$9"}' }),
    }),
  });

  const jsonResult = await runner.run('Extract price', {
    url: 'https://example.test',
    output: { type: 'json', schemaDescription: '{ "price": string }' },
  });

  assert.equal(jsonResult.success, true);
  assert.deepEqual(jsonResult.data, { price: '$9' });

  const failingRunner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite-preview',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult({ value: 'not json' }),
    }),
  });

  const textResult = await failingRunner.run('Extract price', {
    url: 'https://example.test',
    output: { type: 'json' },
  });

  assert.equal(textResult.success, false);
  assert.match(textResult.failureReason ?? '', /output_json_parse_failed/);
});
