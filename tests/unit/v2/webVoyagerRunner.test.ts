import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWebVoyagerEvaluationMarkdown } from '../../benchmark/webvoyager/run_webvoyager_lite';
import type { WebVoyagerVerdict, WebVoyagerEvaluationSummary } from '../../benchmark/webvoyager/types';

test('renderWebVoyagerEvaluationMarkdown includes all score columns', () => {
  const evaluation = {
    summary: {
      totalRuns: 1,
      internalPassRate: 1,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCreditRate: 0,
      environmentAdjustedStrictScore: 0,
      environmentAdjustedManualScore: 0,
      manualReviewCount: 1,
      environmentBlockedCount: 0,
      impossibleTaskCount: 0,
    } satisfies WebVoyagerEvaluationSummary,
    verdicts: [{
      taskId: 'webvoyager_GitHub__0',
      internalPassed: true,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentAdjustedEligible: true,
      environmentStatus: 'normal' as const,
      referenceMatchType: 'mismatch' as const,
      needsManualReview: true,
      reasons: ['reference_mismatch'],
    }] satisfies WebVoyagerVerdict[],
    tasks: [],
  };

  const md = renderWebVoyagerEvaluationMarkdown(evaluation);
  assert.match(md, /Internal pass rate:/);
  assert.match(md, /Strict score:/);
  assert.match(md, /Manual-corrected score:/);
  assert.match(md, /Partial-credit score:/);
  assert.match(md, /Environment-adjusted strict score:/);
  assert.match(md, /Manual review count:/);
  assert.match(md, /Ref Match/);
  assert.match(md, /mismatch/);
});

test('renderWebVoyagerEvaluationMarkdown shows manual verdict in reasons', () => {
  const evaluation = {
    summary: {
      totalRuns: 1,
      internalPassRate: 1,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCreditRate: 0,
      environmentAdjustedStrictScore: 0,
      environmentAdjustedManualScore: 0,
      manualReviewCount: 0,
      environmentBlockedCount: 0,
      impossibleTaskCount: 0,
    } satisfies WebVoyagerEvaluationSummary,
    verdicts: [{
      taskId: 'webvoyager_GitHub__0',
      internalPassed: true,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentAdjustedEligible: true,
      environmentStatus: 'normal' as const,
      referenceMatchType: 'mismatch' as const,
      needsManualReview: false,
      manualVerdict: 'fail' as const,
      reasons: ['reference_mismatch', 'manual_fail'],
    }] satisfies WebVoyagerVerdict[],
    tasks: [],
  };

  const md = renderWebVoyagerEvaluationMarkdown(evaluation);
  assert.match(md, /manual_fail/);
});
