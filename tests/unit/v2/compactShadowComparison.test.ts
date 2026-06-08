import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCompactShadow } from '../../../src/v2/planner/CompactShadowComparison';
import type { PlannerOutput } from '../../../src/v2/planner/types';
import type { CompactShadowPlannerResult } from '../../../src/v2/planner/CompactShadowPlanner';

test('episode is ineligible', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'click', ref: 'ref_1' }],
    },
    rawOutput: { plan: [{ tool: 'click', ref: 'ref_1' }] },
    rawText: '{}',
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 50,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    false // eligible is false
  );

  assert.equal(comparison.agreement, 'episode_ineligible');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('shadow result is provider error', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'provider_error',
    error: 'API rate limit exceeded',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 10,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'shadow_provider_error');
  assert.equal(comparison.shadowOutputKind, 'provider_error');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('shadow result is invalid output', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'invalid_output',
    rawText: 'some bad string',
    errors: ['Failed to parse json'],
    inputTokens: 10,
    outputTokens: 5,
    durationMs: 20,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'shadow_invalid');
  assert.equal(comparison.shadowOutputKind, 'invalid');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('both done', () => {
  const productionOutput: PlannerOutput = {
    done: true,
    val: 'production done val',
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      done: true,
      val: 'shadow done val',
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'not_applicable',
    true
  );

  assert.equal(comparison.agreement, 'both_done');
  assert.equal(comparison.productionOutputKind, 'done');
  assert.equal(comparison.shadowOutputKind, 'done');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('both escalate', () => {
  const productionOutput: PlannerOutput = {
    escalate: 'captcha',
    reason: 'blocked by captcha',
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      escalate: 'user_needed',
      reason: 'needs user input',
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'not_applicable',
    true
  );

  assert.equal(comparison.agreement, 'both_escalate');
  assert.equal(comparison.productionOutputKind, 'escalate');
  assert.equal(comparison.shadowOutputKind, 'escalate');
});

test('production done with shadow action (plan)', () => {
  const productionOutput: PlannerOutput = {
    done: true,
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'click', ref: 'ref_1' }],
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'not_applicable',
    true
  );

  assert.equal(comparison.agreement, 'production_done_shadow_action');
  assert.equal(comparison.productionOutputKind, 'done');
  assert.equal(comparison.shadowOutputKind, 'plan');
  assert.deepEqual(comparison.shadowFirstStep, { tool: 'click', ref: 'ref_1' });
});

test('production action (plan) with shadow done', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      done: true,
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'production_action_shadow_done');
  assert.equal(comparison.productionOutputKind, 'plan');
  assert.equal(comparison.shadowOutputKind, 'done');
  assert.deepEqual(comparison.productionFirstStep, { tool: 'click', ref: 'ref_1' });
});

test('production escalate with shadow action (plan)', () => {
  const productionOutput: PlannerOutput = {
    escalate: 'captcha',
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'click', ref: 'ref_1' }],
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'not_applicable',
    true
  );

  assert.equal(comparison.agreement, 'production_escalate_shadow_action');
  assert.equal(comparison.productionOutputKind, 'escalate');
  assert.equal(comparison.shadowOutputKind, 'plan');
});

test('production action (plan) with shadow escalate', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      escalate: 'user_needed',
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'production_action_shadow_escalate');
  assert.equal(comparison.productionOutputKind, 'plan');
  assert.equal(comparison.shadowOutputKind, 'escalate');
});

test('same tool and same ref (exact first action)', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'click', ref: 'ref_1' }],
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  // Case A: productionFirstStepExecution succeeded -> countsTowardSuccessfulProductionAgreement is true
  const comparisonSucceeded = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );
  assert.equal(comparisonSucceeded.agreement, 'exact_first_action');
  assert.equal(comparisonSucceeded.countsTowardSuccessfulProductionAgreement, true);

  // Case B: productionFirstStepExecution failed -> countsTowardSuccessfulProductionAgreement is false
  const comparisonFailed = compareCompactShadow(
    productionOutput,
    shadowResult,
    'failed',
    true
  );
  assert.equal(comparisonFailed.agreement, 'exact_first_action');
  assert.equal(comparisonFailed.countsTowardSuccessfulProductionAgreement, false);
});

test('same tool and different ref', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'click', ref: 'ref_2' }],
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'same_tool_different_ref');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('different tool', () => {
  const productionOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_1' }],
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      plan: [{ tool: 'type', ref: 'ref_1', value: 'hello' }],
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'succeeded',
    true
  );

  assert.equal(comparison.agreement, 'different_tool');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});

test('other combination fallback (done vs escalate)', () => {
  const productionOutput: PlannerOutput = {
    done: true,
  };
  const shadowResult: CompactShadowPlannerResult = {
    status: 'valid',
    output: {
      escalate: 'captcha',
    },
    rawOutput: {},
    rawText: '',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const comparison = compareCompactShadow(
    productionOutput,
    shadowResult,
    'not_applicable',
    true
  );

  assert.equal(comparison.agreement, 'different_tool');
  assert.equal(comparison.countsTowardSuccessfulProductionAgreement, false);
});
