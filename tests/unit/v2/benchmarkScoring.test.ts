import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreBenchmarkResult } from '../../benchmark/v2/scoring';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'fixture_static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  partition: 'dev',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: {
    minLength: 3,
    requireAny: ['answer', '\\$9'],
    forbid: ['error', 'captcha'],
  },
};

test('scoreBenchmarkResult passes when value and trace audit pass', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: true,
    value: 'answer is $9',
    tracePath: 'logs/trace.json',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 25 },
  }, { ok: true, errors: [] });

  assert.equal(scored.passed, true);
  assert.equal(scored.validation.passed, true);
  assert.equal(scored.trace.ok, true);
});

test('scoreBenchmarkResult records validation and trace failures', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: true,
    value: 'captcha blocked',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 25 },
  }, { ok: false, errors: ['missing_trace_path'] });

  assert.equal(scored.passed, false);
  assert.equal(scored.validation.passed, false);
  assert.match(scored.validation.reasons.join('\n'), /forbid/);
  assert.equal(scored.trace.ok, false);
  assert.deepEqual(scored.trace.errors, ['missing_trace_path']);
});

test('scoreBenchmarkResult classifies planner client failures before output validation', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: false,
    value: '',
    failureReason: 'planner_client_error:Planner output invalid after retry',
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 25 },
  }, { ok: true, errors: [] });

  assert.equal(scored.passed, false);
  assert.equal(scored.failureType, 'planning_error');
});

test('scoreBenchmarkResult classifies provider quota failures separately from planning errors', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: false,
    value: '',
    failureReason: 'planner_client_error:API_QUOTA_EXCEEDED: Gemini key hit rate limit.',
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 25 },
  }, { ok: false, errors: ['missing_planner_output_artifacts'] });

  assert.equal(scored.passed, false);
  assert.equal(scored.failureType, 'rate_limited');
});

test('scoreBenchmarkResult passes expected environment-block failures when trace is complete', () => {
  const expectedBlockTask: BenchmarkTask = {
    ...task,
    taskId: 'captcha_wall',
    difficulty: 'adversarial',
    expectedFailureType: 'environment_block',
  };
  const scored = scoreBenchmarkResult(expectedBlockTask, {
    adapterId: 'browsegent',
    taskId: expectedBlockTask.taskId,
    attempt: 1,
    success: false,
    value: '',
    failureReason: 'planner_escalated:captcha',
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 25 },
  }, { ok: true, errors: [] });

  assert.equal(scored.passed, true);
  assert.equal(scored.failureType, 'environment_block');
});
