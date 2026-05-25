import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runBenchmark } from '../../benchmark/v2/run_benchmark';
import type { BenchmarkAdapter } from '../../benchmark/v2/types';

test('runBenchmark writes report and scored results with a fake adapter', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => ({
      adapterId: 'fake',
      taskId: task.taskId,
      attempt: options.attempt,
      success: true,
      value: 'Fixture page is visible',
      tracePath: undefined,
      metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
    }),
  };

  const summary = await runBenchmark({
    runId: 'benchmark_unit',
    outputRoot,
    adapter: fakeAdapter,
    tasks: [{
      taskId: 'static_visible',
      category: 'local_fixture',
      difficulty: 'extraction',
      partition: 'dev',
      url: 'file:///fixture.html',
      goal: 'Report visible page',
      validation: { requireAny: ['visible'] },
    }],
    repeat: 1,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.equal(summary.summary.totalRuns, 1);
  assert.equal(summary.summary.passedRuns, 1);

  const report = JSON.parse(await readFile(join(outputRoot, 'benchmark_unit', 'report.json'), 'utf8'));
  assert.equal(report.runId, 'benchmark_unit');
  assert.equal(report.results[0].passed, true);

  const readiness = JSON.parse(await readFile(join(outputRoot, 'benchmark_unit', 'readiness.json'), 'utf8'));
  assert.equal(readiness.sourceRunId, 'benchmark_unit');
  assert.equal(typeof readiness.status, 'string');
});

test('runBenchmark filters tasks by benchmark partition before applying count', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-partition-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const seenTaskIds: string[] = [];
  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => {
      seenTaskIds.push(task.taskId);
      return {
        adapterId: 'fake',
        taskId: task.taskId,
        attempt: options.attempt,
        success: true,
        value: `${task.taskId} visible`,
        tracePath: undefined,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };

  await runBenchmark({
    runId: 'benchmark_partition_unit',
    outputRoot,
    adapter: fakeAdapter,
    partition: 'holdout',
    count: 1,
    tasks: [
      benchmarkTask('dev_one', 'dev'),
      benchmarkTask('holdout_one', 'holdout'),
      benchmarkTask('holdout_two', 'holdout'),
    ],
    repeat: 1,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.deepEqual(seenTaskIds, ['holdout_one']);
});

function benchmarkTask(taskId: string, partition: 'dev' | 'holdout') {
  return {
    taskId,
    category: 'local_fixture',
    difficulty: 'extraction' as const,
    partition,
    url: 'file:///fixture.html',
    goal: `Report ${taskId}`,
    validation: { requireAny: [taskId] },
  };
}
