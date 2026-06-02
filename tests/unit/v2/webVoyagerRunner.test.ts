import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runWebVoyagerLite } from '../../benchmark/webvoyager/run_webvoyager_lite';
import type { BenchmarkAdapter } from '../../benchmark/v2/types';
import type { WebVoyagerBenchmarkTask } from '../../benchmark/webvoyager/types';

test('runWebVoyagerLite loads selected tasks and writes evaluation artifacts', async () => {
  const root = join(process.cwd(), 'logs', 'webvoyager-runner-unit-source');
  const outputRoot = join(process.cwd(), 'logs', 'webvoyager-runner-unit-output');
  await rm(root, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data', 'WebVoyager_data.jsonl'), `${JSON.stringify({
    web_name: 'GitHub',
    id: 'GitHub--0',
    ques: 'Find repo answer',
    web: 'https://github.com',
  })}\n`, 'utf8');
  await writeFile(join(root, 'data', 'reference_answer.json'), JSON.stringify({
    GitHub: [{ id: 'GitHub--0', type: 'string', ans: 'repo answer' }],
  }), 'utf8');

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => ({
      adapterId: 'fake',
      taskId: task.taskId,
      attempt: options.attempt,
      success: true,
      value: 'repo answer',
      metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
    }),
  };

  const result = await runWebVoyagerLite({
    sourceRoot: root,
    outputRoot,
    runId: 'webvoyager_unit',
    adapter: fakeAdapter,
    taskIds: ['GitHub--0'],
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.equal(result.benchmark.summary.totalRuns, 1);
  assert.equal(result.evaluation.summary.strictScore, 1);

  const evaluation = JSON.parse(await readFile(join(outputRoot, 'webvoyager_unit', 'webvoyager_evaluation.json'), 'utf8'));
  assert.equal(evaluation.summary.strictScore, 1);
});

test('runWebVoyagerLite can run the fixed mvr5 slice without taking the first five planned tasks', async () => {
  const root = join(process.cwd(), 'logs', 'webvoyager-runner-mvr5-source');
  const outputRoot = join(process.cwd(), 'logs', 'webvoyager-runner-mvr5-output');
  await rm(root, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(root, 'data'), { recursive: true });

  const sourceTasks = [
    ['Allrecipes--3', 'Allrecipes'],
    ['ArXiv--0', 'ArXiv'],
    ['GitHub--0', 'GitHub'],
    ['Google Map--10', 'Google Map'],
    ['Wolfram Alpha--0', 'Wolfram Alpha'],
  ] as const;
  await writeFile(join(root, 'data', 'WebVoyager_data.jsonl'), sourceTasks.map(([id, webName]) => JSON.stringify({
    web_name: webName,
    id,
    ques: `Answer ${id}`,
    web: `https://example.test/${encodeURIComponent(id)}`,
  })).join('\n'), 'utf8');
  await writeFile(join(root, 'data', 'reference_answer.json'), JSON.stringify(Object.fromEntries(
    sourceTasks.map(([id, webName]) => [webName, [{ id, type: 'string', ans: id }]]),
  )), 'utf8');

  const seenTaskIds: string[] = [];
  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => {
      const webVoyagerTask = task as WebVoyagerBenchmarkTask;
      seenTaskIds.push(webVoyagerTask.webVoyager.id);
      return {
        adapterId: 'fake',
        taskId: task.taskId,
        attempt: options.attempt,
        success: true,
        value: webVoyagerTask.webVoyager.id,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };

  const result = await runWebVoyagerLite({
    sourceRoot: root,
    outputRoot,
    runId: 'webvoyager_mvr5_unit',
    adapter: fakeAdapter,
    taskSlice: 'mvr5',
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.deepEqual(seenTaskIds, [
    'Allrecipes--3',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
  assert.equal(result.benchmark.summary.totalRuns, 5);
  assert.equal(result.evaluation.summary.strictScore, 1);
});
