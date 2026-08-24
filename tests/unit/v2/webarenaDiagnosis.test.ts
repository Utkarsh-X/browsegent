import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRun, diagnose, summarizeDiagnoses } from '../../../tests/benchmark/v2/webarena/diagnosis';
import type { DiagnosisInput } from '../../../tests/benchmark/v2/webarena/diagnosis';

function baseInput(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    site: 'shopping',
    internalSuccess: false,
    failureReason: 'planner gave up',
    plannerCalls: 12,
    toolExecutions: 20,
    durationMs: 120000,
    ...overrides,
  };
}

test('score of 1 classifies as passed regardless of internal belief', () => {
  const result = classifyRun(baseInput({ internalSuccess: false, score: 1 }));
  assert.equal(result.failureClass, 'passed');
  assert.equal(result.winnable, true);
});

test('confident-but-wrong answer classifies as grounding', () => {
  const result = classifyRun(baseInput({ internalSuccess: true, score: 0 }));
  assert.equal(result.failureClass, 'grounding');
  assert.equal(result.winnable, true);
});

test('internal success with no evaluator verdict is unscored, never a pass', () => {
  const result = classifyRun(baseInput({ internalSuccess: true }));
  assert.equal(result.failureClass, 'evaluator_side');
  assert.equal(result.winnable, false);
});

test('environment failures are unwinnable even when the agent also erred', () => {
  const result = classifyRun(baseInput({ failureReason: 'page.goto: net::ERR_CONNECTION_REFUSED at http://x' }));
  assert.equal(result.failureClass, 'environment_block');
  assert.equal(result.winnable, false);
});

test('evaluator errors outrank agent-side attribution', () => {
  const result = classifyRun(baseInput({ evaluatorError: 'official_evaluator_timeout:120000ms' }));
  assert.equal(result.failureClass, 'evaluator_side');
});

test('provider rate limiting classifies as recoverable', () => {
  const result = classifyRun(baseInput({ failureReason: 'provider_retry_exhausted after 429 responses' }));
  assert.equal(result.failureClass, 'recovery');
  assert.equal(result.winnable, true);
});

test('step-budget exhaustion is an agent-side budget miss', () => {
  const result = classifyRun(baseInput({ failureReason: 'max steps reached before completion' }));
  assert.equal(result.failureClass, 'budget');
});

test('unclassified agent failure defaults to planner_strategy', () => {
  const result = classifyRun(baseInput({}));
  assert.equal(result.failureClass, 'planner_strategy');
});

test('summary aggregates attribution matrix, winnable split, and medians', () => {
  const records = [
    diagnose('t1', baseInput({ site: 'shopping', internalSuccess: true, score: 1, plannerCalls: 4, toolExecutions: 6, durationMs: 10000 })),
    diagnose('t2', baseInput({ site: 'shopping', internalSuccess: true, score: 0, plannerCalls: 9, toolExecutions: 14, durationMs: 20000 })),
    diagnose('t3', baseInput({ site: 'reddit', internalSuccess: true })),
    diagnose('t4', baseInput({ site: 'gitlab', failureReason: 'net::ERR_NAME_NOT_RESOLVED' })),
  ];
  const summary = summarizeDiagnoses(records);

  assert.equal(summary.total, 4);
  assert.equal(summary.byClass.passed, 1);
  assert.equal(summary.byClass.grounding, 1);
  assert.equal(summary.byClass.evaluator_side, 1);
  assert.equal(summary.byClass.environment_block, 1);
  assert.deepEqual(summary.attributionMatrix.shopping, { passed: 1, grounding: 1 });
  assert.equal(summary.winnable.attempted, 2);
  assert.equal(summary.winnable.passed, 1);
  assert.equal(summary.winnable.passRate, 0.5);
  assert.equal(summary.unwinnable.count, 2);
  assert.deepEqual(summary.unscored, ['t3', 't4']);
  assert.equal(summary.efficiency.passedMedianPlannerCalls, 4);
  assert.equal(summary.efficiency.passedMedianDurationMs, 10000);
});
