import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_BENCHMARK_TASKS } from '../../benchmark/v2/local_tasks';
import { scoreBenchmarkResult } from '../../benchmark/v2/scoring';
import type { BenchmarkPartition } from '../../benchmark/v2/types';

test('LOCAL_BENCHMARK_TASKS covers MVR fixtures with dev and holdout partitions', () => {
  const taskIds = new Set(LOCAL_BENCHMARK_TASKS.map(task => task.taskId));
  const partitions = countBy(LOCAL_BENCHMARK_TASKS.map(task => task.partition));
  const difficulties = new Set(LOCAL_BENCHMARK_TASKS.map(task => task.difficulty));
  const fixtureNames = new Set(
    LOCAL_BENCHMARK_TASKS.map(task => decodeURIComponent(task.url).match(/\/([^/]+\.html)$/)?.[1] ?? ''),
  );

  assert.equal(taskIds.size, LOCAL_BENCHMARK_TASKS.length, 'task ids must be unique');
  assert.ok(LOCAL_BENCHMARK_TASKS.length >= 20, 'local suite should have at least 20 tasks');
  assert.ok(LOCAL_BENCHMARK_TASKS.length <= 30, 'local suite should stay lightweight');
  assert.ok((partitions.dev ?? 0) >= 12, 'dev partition should be large enough for tuning');
  assert.ok((partitions.holdout ?? 0) >= 6, 'holdout partition should protect against overfitting');

  for (const partition of ['dev', 'holdout'] satisfies BenchmarkPartition[]) {
    assert.ok(partitions[partition] > 0, `${partition} partition must be represented`);
  }

  for (const difficulty of ['extraction', 'navigation', 'interaction', 'recovery', 'adversarial'] as const) {
    assert.ok(difficulties.has(difficulty), `missing difficulty ${difficulty}`);
  }

  for (const fixture of [
    'static-controls.html',
    'modal-transition.html',
    'spa-route-transition.html',
    'blocked-overlay.html',
    'delayed-load.html',
    'layout-shift.html',
    'repeated-controls.html',
    'virtualized-list.html',
    'captcha-wall.html',
  ]) {
    assert.ok(fixtureNames.has(fixture), `missing fixture ${fixture}`);
  }

  for (const task of LOCAL_BENCHMARK_TASKS) {
    assert.match(task.url, /^file:\/\//);
    assert.ok(task.goal.length >= 12, `goal too short for ${task.taskId}`);
    assert.ok(task.validation.requireAny?.length || task.validation.requireAll?.length, `weak validation for ${task.taskId}`);
  }
});

test('LOCAL_BENCHMARK_TASKS validation accepts direct label evidence for simple controls', () => {
  const formSendTask = LOCAL_BENCHMARK_TASKS.find(task => task.taskId === 'form_send_action');
  assert.ok(formSendTask);

  const scored = scoreBenchmarkResult(formSendTask, {
    adapterId: 'fake',
    taskId: formSendTask.taskId,
    attempt: 1,
    success: true,
    value: 'Send',
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 1 },
  }, { ok: true, errors: [] });

  assert.equal(scored.validation.passed, true);
});

test('LOCAL_BENCHMARK_TASKS validation accepts any newly visible shifted virtualized item', () => {
  const shiftedTask = LOCAL_BENCHMARK_TASKS.find(task => task.taskId === 'virtualized_shift_window');
  assert.ok(shiftedTask);

  const scored = scoreBenchmarkResult(shiftedTask, {
    adapterId: 'fake',
    taskId: shiftedTask.taskId,
    attempt: 1,
    success: true,
    value: 'Open Item 12',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 1 },
  }, { ok: true, errors: [] });

  assert.equal(scored.validation.passed, true);
});

test('LOCAL_BENCHMARK_TASKS validation accepts any updated random rerender version', () => {
  const task = LOCAL_BENCHMARK_TASKS.find(candidate => candidate.taskId === 'random_rerender_panel');
  assert.ok(task);

  const scored = scoreBenchmarkResult(task, {
    adapterId: 'fixture',
    taskId: task.taskId,
    attempt: 1,
    success: true,
    value: 'Open panel version 4',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 1 },
  }, { ok: true, errors: [] });

  assert.equal(scored.validation.passed, true);
});

function countBy(values: BenchmarkPartition[]): Record<BenchmarkPartition, number> {
  return values.reduce<Record<BenchmarkPartition, number>>((counts, value) => {
    counts[value] += 1;
    return counts;
  }, { dev: 0, holdout: 0 });
}
