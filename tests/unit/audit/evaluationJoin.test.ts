import test from 'node:test';
import assert from 'node:assert/strict';

import { joinBenchmarkEvaluation } from '../../../scripts/audit/evaluationJoin';

test('joinBenchmarkEvaluation classifies an internal completion rejected by the strict evaluator separately', () => {
  const joined = joinBenchmarkEvaluation([
    {
      taskId: 'webvoyager_Apple__10',
      success: true,
      passed: true,
      value: 'Current live-page answer',
    },
  ], [
    {
      taskId: 'webvoyager_Apple__10',
      internalPassed: true,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentStatus: 'normal',
      referenceMatchType: 'mismatch',
      needsManualReview: true,
      reasons: ['reference_mismatch'],
    },
  ]);

  assert.equal(joined[0].category, 'internal_complete_strict_reject');
  assert.equal(joined[0].strictPassed, false);
  assert.equal(joined[0].runtimePassed, true);
});

test('joinBenchmarkEvaluation prioritizes an environment block over runtime failure', () => {
  const joined = joinBenchmarkEvaluation([
    {
      taskId: 'webvoyager_Allrecipes__3',
      success: false,
      passed: false,
      failureReason: 'planner_escalated:captcha',
    },
  ], [
    {
      taskId: 'webvoyager_Allrecipes__3',
      internalPassed: false,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentStatus: 'environment_block',
      referenceMatchType: 'not_applicable',
      needsManualReview: true,
      reasons: ['environment_block'],
    },
  ]);

  assert.equal(joined[0].category, 'environment');
});

test('joinBenchmarkEvaluation reports a missing evaluator verdict instead of guessing strict success', () => {
  const joined = joinBenchmarkEvaluation([
    {
      taskId: 'webvoyager_missing',
      success: true,
      passed: true,
    },
  ], []);

  assert.equal(joined[0].category, 'evaluation_missing');
  assert.equal(joined[0].strictPassed, false);
});
