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

test('classifyHitResult returns descendant when hit is descendant of target', () => {
  const result = classifyHitResult({
    hit: 'span-inside-button',
    targetElement: 'button-id',
    hitIsDescendantOfTarget: true,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '1',
  });
  assert.deepEqual(result, { outcome: 'semantic_relation', relation: 'descendant' });
});

test('classifyHitResult returns ancestor when target is descendant of hit', () => {
  const result = classifyHitResult({
    hit: 'parent-div',
    targetElement: 'child-button',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: true,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '1',
  });
  assert.deepEqual(result, { outcome: 'semantic_relation', relation: 'ancestor' });
});

test('classifyHitResult returns label_control when hit label controls target', () => {
  const result = classifyHitResult({
    hit: 'label-span',
    targetElement: 'checkbox-input',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: true,
    targetLabelContainsHit: false,
    hitOpacity: '1',
  });
  assert.deepEqual(result, { outcome: 'semantic_relation', relation: 'label_control' });
});

test('classifyHitResult returns label_control when target label contains hit', () => {
  const result = classifyHitResult({
    hit: 'nested-input',
    targetElement: 'wrapping-label',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: true,
    hitOpacity: '1',
  });
  assert.deepEqual(result, { outcome: 'semantic_relation', relation: 'label_control' });
});

test('classifyHitResult returns soft_ambiguity_transparent_blocker for opacity:0 blocker', () => {
  const result = classifyHitResult({
    hit: 'transparent-overlay',
    targetElement: 'button-behind',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '0',
  });
  assert.equal(result?.outcome, 'soft_ambiguity_transparent_blocker');
});

test('classifyHitResult returns null for unrelated opaque element', () => {
  const result = classifyHitResult({
    hit: 'cookie-banner',
    targetElement: 'submit-button',
    hitIsDescendantOfTarget: false,
    targetIsDescendantOfHit: false,
    hitLabelControlsTarget: false,
    targetLabelContainsHit: false,
    hitOpacity: '0.8',
  });
  assert.equal(result, null);
});
