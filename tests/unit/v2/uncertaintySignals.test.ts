import test from 'node:test';
import assert from 'node:assert/strict';

import { UncertaintySignals } from '../../../src/v2/runtime/UncertaintySignals';
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
