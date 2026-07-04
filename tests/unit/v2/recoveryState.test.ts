import test from 'node:test';
import assert from 'node:assert/strict';

import { RecoveryStateBuilder } from '../../../src/v2/runtime/RecoveryState';

test('RecoveryStateBuilder detects wrong target type for non-editable type failures', () => {
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'type',
      targetRef: 'ref_search_button',
      error: { code: 'target_not_editable', message: 'not editable', retryable: false },
      traceStepId: 'step_1',
    },
    failures: [],
    uncertaintySignals: [],
  });

  assert.equal(recovery?.state, 'wrong_target_type');
  assert.equal(recovery?.blockedAction?.tool, 'type');
  assert.equal(recovery?.blockedAction?.ref, 'ref_search_button');
  assert.ok(recovery?.nextMechanisms.includes('choose_typeable_ref'));
});

test('RecoveryStateBuilder detects repeated search-page read loops', () => {
  const recovery = new RecoveryStateBuilder().build({
    failures: [],
    uncertaintySignals: ['repeated_value_preview:search_page:global:3'],
  });

  assert.equal(recovery?.state, 'zero_result_read_loop');
  assert.ok(recovery?.nextMechanisms.includes('try_different_evidence_action'));
});

test('RecoveryStateBuilder detects repeated no-progress mutations', () => {
  const recovery = new RecoveryStateBuilder().build({
    failures: [],
    uncertaintySignals: ['repeated_no_progress_transition:click:ref_submit:2'],
  });

  assert.equal(recovery?.state, 'same_action_loop');
  assert.ok(recovery?.nextMechanisms.includes('avoid_repeating_blocked_action'));
});

test('RecoveryStateBuilder returns undefined when no recovery signal is present', () => {
  const recovery = new RecoveryStateBuilder().build({
    failures: [],
    uncertaintySignals: ['weakened_refs:1'],
  });

  assert.equal(recovery, undefined);
});

test('RecoveryStateBuilder blocks persistent target failure as same action pair', () => {
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_bad',
      error: { code: 'target_blocked', message: 'Blocked.', retryable: false },
      traceStepId: 'step_bad',
    },
    failures: [{
      failureId: 'failure_target_blocked_ref_bad',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target blocked.',
      source: 'test',
      targetRef: 'ref_bad',
      signals: ['error:target_blocked'],
    }],
  });

  assert.equal(recovery?.state, 'wrong_target_type');
  assert.equal(recovery?.blockedAction?.tool, 'click');
  assert.equal(recovery?.blockedAction?.ref, 'ref_bad');
  assert.ok(recovery?.nextMechanisms.includes('choose_alternative_ref'));
  assert.ok(recovery?.nextMechanisms.includes('use_readable_evidence_if_goal_is_answerable'));
});

test('RecoveryStateBuilder returns repeated_read_same_value for non-empty repeated get reads', () => {
  const builder = new RecoveryStateBuilder();
  const result = builder.build({
    uncertaintySignals: ['repeated_value_preview:get:v2ref_308:3'],
  });
  assert.ok(result);
  assert.equal(result.state, 'repeated_read_same_value');
  assert.equal(result.severity, 'warning');
  assert.ok(result.blockedAction);
  assert.equal(result.blockedAction.tool, 'get');
  assert.equal(result.blockedAction.ref, 'v2ref_308');
  assert.ok(result.nextMechanisms.includes('finalize_with_collected_evidence'));
});

test('RecoveryStateBuilder returns repeated_read_same_value for inspect_region repeats', () => {
  const builder = new RecoveryStateBuilder();
  const result = builder.build({
    uncertaintySignals: ['repeated_value_preview:inspect_region:v2ref_42:2'],
  });
  assert.ok(result);
  assert.equal(result.state, 'repeated_read_same_value');
  assert.equal(result.severity, 'warning');
  assert.ok(result.blockedAction);
  assert.equal(result.blockedAction.tool, 'inspect_region');
  assert.equal(result.blockedAction.ref, 'v2ref_42');
  assert.ok(result.nextMechanisms.includes('try_different_ref'));
});

test('RecoveryStateBuilder returns zero_result_read_loop for search_page repeats', () => {
  const builder = new RecoveryStateBuilder();
  const result = builder.build({
    uncertaintySignals: ['repeated_value_preview:search_page:global:3'],
  });
  assert.ok(result);
  assert.equal(result.state, 'zero_result_read_loop');
  assert.ok(result.nextMechanisms.includes('try_different_evidence_action'));
});
