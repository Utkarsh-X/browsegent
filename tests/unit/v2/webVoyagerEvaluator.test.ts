import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from '../../benchmark/webvoyager/evaluator';
import type { WebVoyagerBenchmarkTask } from '../../benchmark/webvoyager/types';
import type { ScoredBenchmarkResult } from '../../benchmark/v2/types';

test('evaluateWebVoyagerResult gives strict success only when benchmark passed and reference matches', () => {
  const verdict = evaluateWebVoyagerResult(task('GitHub--0', '42 stars'), result({
    passed: true,
    value: 'The repository has 42 stars.',
  }));

  assert.equal(verdict.rawAutoScore, 1);
  assert.equal(verdict.strictScore, 1);
  assert.equal(verdict.needsManualReview, false);
});

test('evaluateWebVoyagerResult marks missing reference as manual review and strict failure', () => {
  const webTask = task('GitHub--0', undefined);
  const verdict = evaluateWebVoyagerResult(webTask, result({ passed: true, value: 'answer' }));

  assert.equal(verdict.rawAutoScore, 0);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.needsManualReview, true);
});

test('evaluateWebVoyagerResult does not request manual review for already failed runs', () => {
  const verdict = evaluateWebVoyagerResult(task('GitHub--0', '42 stars'), result({
    passed: false,
    success: false,
    value: '',
    failureType: 'environment_block',
  }));

  assert.equal(verdict.rawAutoScore, 0);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.needsManualReview, false);
  assert.deepEqual(verdict.reasons, ['benchmark_result_failed']);
});

test('summarizeWebVoyagerEvaluation aggregates strict score and manual review count', () => {
  const summary = summarizeWebVoyagerEvaluation([
    { taskId: 'a', rawAutoScore: 1, strictScore: 1, needsManualReview: false, reasons: [] },
    { taskId: 'b', rawAutoScore: 0, strictScore: 0, needsManualReview: true, reasons: ['missing_reference'] },
  ]);

  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.strictScore, 0.5);
  assert.equal(summary.manualReviewCount, 1);
});

function task(id: string, answer: string | undefined): WebVoyagerBenchmarkTask {
  return {
    taskId: 'webvoyager_GitHub__0',
    category: 'webvoyager',
    difficulty: 'navigation',
    partition: 'holdout',
    url: 'https://github.com',
    goal: 'Find answer',
    validation: { minLength: 2 },
    webVoyager: {
      id,
      webName: 'GitHub',
      originalQuestion: 'Find answer',
      normalizedQuestion: 'Find answer',
      normalized: false,
      referenceAnswer: answer
        ? { id, webName: 'GitHub', type: 'string', answer }
        : undefined,
    },
  };
}

function result(overrides: Partial<ScoredBenchmarkResult>): ScoredBenchmarkResult {
  return {
    adapterId: 'browsegent',
    taskId: 'webvoyager_GitHub__0',
    attempt: 1,
    success: true,
    passed: true,
    value: 'ok',
    partition: 'holdout',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 10 },
    validation: { passed: true, reasons: [], preview: 'ok' },
    trace: { ok: true, errors: [] },
    ...overrides,
  };
}
