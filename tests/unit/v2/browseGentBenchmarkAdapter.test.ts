import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowseGentBenchmarkAdapter } from '../../benchmark/v2/adapters/BrowseGentAdapter';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  partition: 'dev',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: { minLength: 2 },
};

test('BrowseGentBenchmarkAdapter maps benchmark tasks to public task API calls', async () => {
  const calls: unknown[] = [];
  const adapter = new BrowseGentBenchmarkAdapter({
    clientFactory: () => ({
      run: async (goal: string, options: unknown) => {
        calls.push({ goal, options });
        return {
          success: true,
          value: 'answer',
          tracePath: 'logs/v2-runs/trace.json',
          warnings: [],
          metrics: {
            plannerCalls: 2,
            inputTokens: 10,
            outputTokens: 5,
            plannerDurationMs: 20,
            toolExecutions: 1,
          },
        };
      },
    }),
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite-preview',
    maxSteps: 4,
    traceDir: 'logs/bench',
    headed: false,
  });

  assert.equal(result.adapterId, 'browsegent');
  assert.equal(result.taskId, 'static_read');
  assert.equal(result.success, true);
  assert.equal(result.value, 'answer');
  assert.equal(result.tracePath, 'logs/v2-runs/trace.json');
  assert.equal(result.metrics.plannerCalls, 2);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.deepEqual(calls[0], {
    goal: 'Read answer',
    options: {
      url: 'file:///fixture.html',
      model: 'gemini/gemini-3.1-flash-lite-preview',
      maxSteps: 4,
      browser: { headless: true },
      trace: { dir: 'logs/bench', runId: 'bench_unit_static_read_a1' },
      output: 'text',
    },
  });
});
