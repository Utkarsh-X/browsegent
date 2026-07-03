import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyHitResult } from '../../../src/v2/substrate/semanticHitTest';

test('classifyHitResult returns clear_target when hit is null', () => {
  const result = classifyHitResult({
    hit: null,
    targetElement: 'target-id',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '1',
  });
  assert.equal(result!.outcome, 'clear_target');
});

test('classifyHitResult returns clear_target when hit equals target', () => {
  const result = classifyHitResult({
    hit: 'target-id',
    targetElement: 'target-id',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '1',
  });
  assert.equal(result!.outcome, 'clear_target');
});
