import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from '../../benchmark/webvoyager/evaluator';
import type { WebVoyagerBenchmarkTask, WebVoyagerEvaluationSummary } from '../../benchmark/webvoyager/types';
import type { ScoredBenchmarkResult } from '../../benchmark/v2/types';
import { parseWebVoyagerManualAudit } from '../../benchmark/webvoyager/manual_audit';
import { summarizeWebVoyagerRepeats } from '../../benchmark/webvoyager/repeat_summary';

test('evaluateWebVoyagerResult gives strict success only when benchmark passed and reference matches', () => {
  const verdict = evaluateWebVoyagerResult(task('GitHub--0', '42 stars'), result({
    passed: true,
    value: 'The repository has 42 stars.',
  }));

  assert.equal(verdict.internalPassed, true);
  assert.equal(verdict.rawAutoScore, 1);
  assert.equal(verdict.strictScore, 1);
  assert.equal(verdict.manualCorrectedScore, 1);
  assert.equal(verdict.partialCredit, 1);
  assert.equal(verdict.referenceMatchType, 'exact');
  assert.equal(verdict.needsManualReview, false);
});

test('evaluateWebVoyagerResult marks missing reference as manual review and strict failure', () => {
  const webTask = task('GitHub--0', undefined);
  const verdict = evaluateWebVoyagerResult(webTask, result({ passed: true, value: 'answer' }));

  assert.equal(verdict.internalPassed, true);
  assert.equal(verdict.rawAutoScore, 0);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.referenceMatchType, 'missing_reference');
  assert.equal(verdict.needsManualReview, true);
});

test('evaluateWebVoyagerResult flags environment-blocked failed runs for manual review', () => {
  const verdict = evaluateWebVoyagerResult(task('GitHub--0', '42 stars'), result({
    passed: false,
    success: false,
    value: '',
    failureType: 'environment_block',
  }));

  assert.equal(verdict.internalPassed, false);
  assert.equal(verdict.rawAutoScore, 0);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.environmentStatus, 'environment_block');
  assert.equal(verdict.environmentAdjustedEligible, false);
  assert.equal(verdict.needsManualReview, true);
  assert.deepEqual(verdict.reasons, ['benchmark_result_failed', 'reference_mismatch']);
});

test('summarizeWebVoyagerEvaluation aggregates strict score and manual review count', () => {
  const summary = summarizeWebVoyagerEvaluation([
    {
      taskId: 'a', internalPassed: true, rawAutoScore: 1, strictScore: 1,
      manualCorrectedScore: 1, partialCredit: 1, environmentAdjustedEligible: true,
      environmentStatus: 'normal', referenceMatchType: 'exact',
      needsManualReview: false, reasons: [],
    },
    {
      taskId: 'b', internalPassed: true, rawAutoScore: 0, strictScore: 0,
      manualCorrectedScore: 0, partialCredit: 0, environmentAdjustedEligible: true,
      environmentStatus: 'normal', referenceMatchType: 'missing_reference',
      needsManualReview: true, reasons: ['missing_reference'],
    },
  ]);

  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.strictScore, 0.5);
  assert.equal(summary.internalPassRate, 1);
  assert.equal(summary.manualReviewCount, 1);
  assert.equal(summary.environmentBlockedCount, 0);
});

test('parseWebVoyagerManualAudit returns entries keyed by task id', () => {
  const audit = parseWebVoyagerManualAudit({
    entries: [
      { taskId: 'webvoyager_GitHub__0', verdict: 'fail', reason: 'Selected wrong repository.' },
      { taskId: 'webvoyager_Google_Map__10', verdict: 'pass', reason: 'Answer matches manual evidence.' },
    ],
  });

  assert.equal(audit.get('webvoyager_GitHub__0')?.verdict, 'fail');
  assert.equal(audit.get('webvoyager_Google_Map__10')?.verdict, 'pass');
});

test('manual audit fail overrides internal pass', () => {
  const verdict = evaluateWebVoyagerResult(task('GitHub--0', '42 stars'), result({ passed: true, value: 'wrong answer' }), {
    taskId: 'webvoyager_GitHub__0',
    verdict: 'fail',
    reason: 'Wrong entity selected.',
  });

  assert.equal(verdict.internalPassed, true);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.manualCorrectedScore, 0);
  assert.equal(verdict.needsManualReview, false);
});

test('manual audit partial contributes half credit only to partial score', () => {
  const verdict = evaluateWebVoyagerResult(task('ArXiv--0', 'quantum computing paper'), result({ passed: true, value: 'advanced search page url' }), {
    taskId: 'webvoyager_ArXiv__0',
    verdict: 'partial',
    reason: 'Reached relevant page but did not return requested paper title.',
  });

  assert.equal(verdict.manualCorrectedScore, 0);
  assert.equal(verdict.partialCredit, 0.5);
});

test('summarizeWebVoyagerRepeats reports mean and standard deviation', () => {
  const summary = summarizeWebVoyagerRepeats([
    summaryFixture({ strictScore: 0.2, manualCorrectedScore: 0.4, environmentAdjustedManualScore: 0.5 }),
    summaryFixture({ strictScore: 0.6, manualCorrectedScore: 0.8, environmentAdjustedManualScore: 1.0 }),
  ]);

  assert.equal(summary.runs, 2);
  assert.equal(summary.strictMean, 0.4);
  assert.ok(summary.strictStdDev > 0);
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

function summaryFixture(overrides: Partial<WebVoyagerEvaluationSummary> = {}): WebVoyagerEvaluationSummary {
  return {
    totalRuns: 0,
    internalPassRate: 0,
    rawAutoScore: 0,
    strictScore: 0,
    manualCorrectedScore: 0,
    partialCreditRate: 0,
    environmentAdjustedStrictScore: 0,
    environmentAdjustedManualScore: 0,
    manualReviewCount: 0,
    environmentBlockedCount: 0,
    impossibleTaskCount: 0,
    ...overrides,
  };
}
