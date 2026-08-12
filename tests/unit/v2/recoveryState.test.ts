import test from 'node:test';
import assert from 'node:assert/strict';

import { RecoveryStateBuilder } from '../../../src/v2/runtime/RecoveryState';
import type { FailureEvidence } from '../../../src/v2/runtime/FailureClassifier';

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

test('RecoveryStateBuilder treats repeated no-progress tool use as a strategy pivot', () => {
  const recovery = new RecoveryStateBuilder().build({
    failures: [],
    uncertaintySignals: ['repeated_no_progress_kind:press:3'],
  });

  assert.equal(recovery?.state, 'same_action_loop');
  assert.equal(recovery?.blockedAction?.tool, 'press');
  assert.equal(recovery?.blockedAction?.ref, undefined);
  assert.ok(recovery?.nextMechanisms.includes('choose_alternative_ref'));
});

test('RecoveryStateBuilder aggregates the same blocker across distinct refs within one page epoch', () => {
  const blocker = {
    blockerDescription: 'div#consent-overlay',
    blockerTagName: 'div',
    hitTestOutcome: 'hard_blocker',
    blockerIsFixedOrSticky: true,
  };
  const failures: FailureEvidence[] = [
    {
      failureId: 'failure_target_blocked_ref_a',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'blocked',
      source: 'test',
      observationId: 'obs_1_2',
      targetRef: 'ref_a',
      signals: ['error:target_blocked'],
      diagnostics: blocker,
      generationId: 1,
      url: 'https://example.test/form',
    },
    {
      failureId: 'failure_target_blocked_ref_b',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'blocked',
      source: 'test',
      observationId: 'obs_1_4',
      targetRef: 'ref_b',
      signals: ['error:target_blocked'],
      diagnostics: blocker,
      generationId: 1,
      url: 'https://example.test/form',
    },
  ];
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_b',
      error: { code: 'target_blocked', message: 'blocked', retryable: false, diagnostics: blocker },
      traceStepId: 'step_b',
    },
    failures,
    uncertaintySignals: [],
  });

  assert.equal(recovery?.state, 'persistent_target_blocker');
  assert.equal(recovery?.blockedAction?.ref, 'ref_b');
  assert.ok(recovery?.nextMechanisms.includes('find_dismiss_or_close_control'));
});

test('RecoveryStateBuilder does not aggregate blockers across page epochs', () => {
  const blocker = {
    blockerDescription: 'div#consent-overlay',
    blockerTagName: 'div',
    hitTestOutcome: 'hard_blocker',
    blockerIsFixedOrSticky: true,
  };
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_b',
      error: { code: 'target_blocked', message: 'blocked', retryable: false, diagnostics: blocker },
      traceStepId: 'step_b',
    },
    failures: [
      {
        failureId: 'failure_target_blocked_ref_a',
        kind: 'target_blocked',
        category: 'target',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        message: 'blocked',
        source: 'test',
        targetRef: 'ref_a',
        signals: ['error:target_blocked'],
        diagnostics: blocker,
        generationId: 1,
        url: 'https://example.test/old-page',
      },
      {
        failureId: 'failure_target_blocked_ref_b',
        kind: 'target_blocked',
        category: 'target',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        message: 'blocked',
        source: 'test',
        targetRef: 'ref_b',
        signals: ['error:target_blocked'],
        diagnostics: blocker,
        generationId: 2,
        url: 'https://example.test/new-page',
      },
    ],
    uncertaintySignals: [],
  });

  assert.equal(recovery?.state, 'wrong_target_type');
});

test('RecoveryStateBuilder does not aggregate different blockers in one page epoch', () => {
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_b',
      error: {
        code: 'target_blocked',
        message: 'blocked',
        retryable: false,
        diagnostics: { blockerDescription: 'div#other-overlay', blockerTagName: 'div', hitTestOutcome: 'hard_blocker' },
      },
      traceStepId: 'step_b',
    },
    failures: [
      {
        failureId: 'failure_target_blocked_ref_a',
        kind: 'target_blocked',
        category: 'target',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        message: 'blocked',
        source: 'test',
        targetRef: 'ref_a',
        signals: ['error:target_blocked'],
        diagnostics: { blockerDescription: 'div#consent-overlay', blockerTagName: 'div', hitTestOutcome: 'hard_blocker' },
        generationId: 1,
        url: 'https://example.test/form',
      },
      {
        failureId: 'failure_target_blocked_ref_b',
        kind: 'target_blocked',
        category: 'target',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        message: 'blocked',
        source: 'test',
        targetRef: 'ref_b',
        signals: ['error:target_blocked'],
        diagnostics: { blockerDescription: 'div#other-overlay', blockerTagName: 'div', hitTestOutcome: 'hard_blocker' },
        generationId: 1,
        url: 'https://example.test/form',
      },
    ],
    uncertaintySignals: [],
  });

  assert.equal(recovery?.state, 'wrong_target_type');
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
