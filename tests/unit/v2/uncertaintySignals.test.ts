import test from 'node:test';
import assert from 'node:assert/strict';

import { detectNavigationOscillation, UncertaintySignals } from '../../../src/v2/runtime/UncertaintySignals';
import type { TransitionEvidence, V2ToolResult } from '../../../src/v2/runtime/types';

function makeTransition(urlChanged: boolean): TransitionEvidence {
  return {
    beforeObservationId: 'before',
    afterObservationId: 'after',
    transitionClass: 'structural_local',
    strength: 'moderate',
    generationChanged: false,
    urlChanged,
    refChanges: { appeared: [], disappeared: [], weakened: [], preserved: [] },
    notes: [],
  };
}

test('no_op_navigation signal fires for a navigate that did not change the URL', () => {
  const lastResult: V2ToolResult = { success: true, kind: 'navigate', traceStepId: 's1' };
  const uncertainty = new UncertaintySignals().fromRuntimeState({
    transitionEvidence: makeTransition(false),
    lastResult,
  });
  assert.ok(uncertainty.signals.includes('no_op_navigation'));
});

test('no_op_navigation does not fire for real navigations or other tools', () => {
  const signals = new UncertaintySignals();
  const realNav = signals.fromRuntimeState({
    transitionEvidence: makeTransition(true),
    lastResult: { success: true, kind: 'navigate', traceStepId: 's1' },
  });
  assert.equal(realNav.signals.includes('no_op_navigation'), false);

  const click = signals.fromRuntimeState({
    transitionEvidence: makeTransition(false),
    lastResult: { success: true, kind: 'click', traceStepId: 's1' },
  });
  assert.equal(click.signals.includes('no_op_navigation'), false);
});

test('detectNavigationOscillation flags two-page alternation and same-URL reload loops', () => {
  assert.equal(detectNavigationOscillation(['a', 'b', 'a', 'b']), true);
  assert.equal(detectNavigationOscillation(['x', 'a', 'b', 'a', 'b']), true);
  assert.equal(detectNavigationOscillation(['p', 'q', 'p', 'q', 'p']), true);
  assert.equal(detectNavigationOscillation(['a', 'b', 'a', 'c']), false);
  assert.equal(detectNavigationOscillation(['a', 'a', 'b', 'a']), false);
  assert.equal(detectNavigationOscillation(['a', 'b', 'c']), false);
  assert.equal(detectNavigationOscillation([]), false);
});

test('click_no_navigation raises uncertainty to medium', () => {
  const signals = new UncertaintySignals().fromRuntimeState({
    extraSignals: ['click_no_navigation'],
  });
  assert.equal(signals.level, 'medium');
  assert.ok(signals.signals.includes('click_no_navigation'));
});
