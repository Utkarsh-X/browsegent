import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
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

test('runBenchmark treats external adapter artifact presence as trace completeness', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-external-artifact-unit');
  await rm(outputRoot, { recursive: true, force: true });
  const artifactPath = join(outputRoot, 'artifact');

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'browser-use-local',
    traceMode: 'external_artifact',
    run: async (task, options) => {
      await mkdir(artifactPath, { recursive: true });
      return {
        adapterId: 'browser-use-local',
        taskId: task.taskId,
        attempt: options.attempt,
        success: true,
        value: 'external visible answer',
        artifactPath,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };

  const summary = await runBenchmark({
    runId: 'benchmark_external_artifact_unit',
    outputRoot,
    adapter: fakeAdapter,
    tasks: [benchmarkTask('external_visible', 'dev')],
    repeat: 1,
  });

  assert.equal(summary.summary.totalRuns, 1);
  assert.equal(summary.summary.traceCompleteRate, 1);
  assert.equal(summary.results[0].trace.ok, true);
});

test('runBenchmark rewrites local fixture file URLs to localhost for adapter runs', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-fixture-server-unit');
  await rm(outputRoot, { recursive: true, force: true });
  const seenUrls: string[] = [];

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => {
      seenUrls.push(task.url);
      return {
        adapterId: 'fake',
        taskId: task.taskId,
        attempt: options.attempt,
        success: true,
        value: 'Static controls visible',
        tracePath: undefined,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };

  await runBenchmark({
    runId: 'benchmark_fixture_server_unit',
    outputRoot,
    adapter: fakeAdapter,
    count: 1,
    partition: 'dev',
    repeat: 1,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.match(seenUrls[0], /^http:\/\/127\.0\.0\.1:\d+\/static-controls\.html$/);
});

test('runBenchmark records request pacing metadata and forwards interval to adapters', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-rate-limit-unit');
  await rm(outputRoot, { recursive: true, force: true });
  const seenIntervals: Array<number | undefined> = [];
  const env: NodeJS.ProcessEnv = {};

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => {
      seenIntervals.push(options.requestMinIntervalMs);
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

  const report = await runBenchmark({
    runId: 'benchmark_rate_limit_unit',
    outputRoot,
    adapter: fakeAdapter,
    tasks: [benchmarkTask('paced_visible', 'dev')],
    repeat: 1,
    env,
    requestRpm: 12,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.deepEqual(seenIntervals, [5000]);
  assert.equal(env.BROWSEGENT_GEMINI_MIN_INTERVAL_MS, '5000');
  assert.deepEqual(report.runMetadata?.rateLimit, {
    mode: 'paced',
    requestRpm: 12,
    minIntervalMs: 5000,
  });
});

test('runBenchmark rotates Gemini keys per task attempt and records secret-safe assignments', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-key-rotation-unit');
  await rm(outputRoot, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = {
    GEMINI_API_KEY: 'key-a',
    GOOGLE_API_KEY: 'key-a',
    GEMINI_API_KEY_2: 'key-b',
    GEMINI_API_KEY_3: 'key-c',
  };
  const seenKeys: string[] = [];
  const seenIndexes: string[] = [];

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task) => {
      seenKeys.push(env.GEMINI_API_KEY ?? '');
      seenIndexes.push(env.BROWSEGENT_ACTIVE_GEMINI_KEY_INDEX ?? '');
      return {
        adapterId: 'fake',
        taskId: task.taskId,
        attempt: 1,
        success: true,
        value: `${task.taskId} visible`,
        tracePath: undefined,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };

  const report = await runBenchmark({
    runId: 'benchmark_key_rotation_unit',
    outputRoot,
    adapter: fakeAdapter,
    tasks: [
      benchmarkTask('task_one', 'dev'),
      benchmarkTask('task_two', 'dev'),
      benchmarkTask('task_three', 'dev'),
    ],
    repeat: 1,
    env,
    geminiKeyIndex: 2,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.deepEqual(seenKeys, ['key-b', 'key-c', 'key-a']);
  assert.deepEqual(seenIndexes, ['2', '3', '1']);
  assert.deepEqual(report.runMetadata?.geminiKeyPool?.assignments, [
    { taskId: 'task_one', attempt: 1, keyIndex: 2, selectedEnvName: 'GEMINI_API_KEY_2' },
    { taskId: 'task_two', attempt: 1, keyIndex: 3, selectedEnvName: 'GEMINI_API_KEY_3' },
    { taskId: 'task_three', attempt: 1, keyIndex: 1, selectedEnvName: 'GEMINI_API_KEY' },
  ]);
  assert.equal(report.runMetadata?.geminiKeyPool?.keyCount, 3);
  assert.equal(report.runMetadata?.geminiKeyPool?.configuredKeyCount, 4);
  assert.equal(report.runMetadata?.geminiKeyPool?.uniqueKeyCount, 3);
  assert.equal(report.runMetadata?.geminiKeyPool?.duplicateKeyCount, 1);
  assert.doesNotMatch(JSON.stringify(report.runMetadata), /key-a|key-b|key-c/);
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
