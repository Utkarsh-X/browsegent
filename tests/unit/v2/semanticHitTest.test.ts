import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyHitResult, buildBlockerDiagnostic } from '../../../src/v2/substrate/semanticHitTest';

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

test('buildBlockerDiagnostic produces description with id', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'div',
    id: 'cookie-banner',
    className: 'overlay modal',
    position: 'fixed',
    opacity: '1',
    isDialog: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 1280,
    blockerHeight: 720,
    anchorId: undefined,
    anchorTag: undefined,
  });
  assert.equal(diag.description, 'div#cookie-banner');
  assert.equal(diag.tagName, 'div');
  assert.equal(diag.id, 'cookie-banner');
  assert.equal(diag.isFixedOrSticky, true);
  assert.equal(diag.coversFullViewport, true);
  assert.equal(diag.isTransparent, false);
  assert.equal(diag.isNativeDialog, false);
});

test('buildBlockerDiagnostic produces description with classes when no id', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'span',
    id: '',
    className: 'close-btn icon',
    position: 'absolute',
    opacity: '1',
    isDialog: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 100,
    blockerHeight: 30,
    anchorId: 'app',
    anchorTag: 'div',
  });
  assert.equal(diag.description, 'span.close-btn.icon');
  assert.equal(diag.isFixedOrSticky, false);
  assert.equal(diag.coversFullViewport, false);
  assert.equal(diag.anchorDescription, 'div#app');
});

test('buildBlockerDiagnostic detects sticky position', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'header',
    id: 'top-bar',
    className: '',
    position: 'sticky',
    opacity: '1',
    isDialog: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 1280,
    blockerHeight: 60,
    anchorId: undefined,
    anchorTag: undefined,
  });
  assert.equal(diag.isFixedOrSticky, true);
  assert.equal(diag.coversFullViewport, false);
});

test('buildBlockerDiagnostic detects transparent blocker', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'div',
    id: 'overlay',
    className: '',
    position: 'absolute',
    opacity: '0',
    isDialog: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 1280,
    blockerHeight: 720,
    anchorId: undefined,
    anchorTag: undefined,
  });
  assert.equal(diag.isTransparent, true);
});

test('buildBlockerDiagnostic detects native dialog', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'dialog',
    id: 'confirm-modal',
    className: '',
    position: 'static',
    opacity: '1',
    isDialog: true,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 400,
    blockerHeight: 300,
    anchorId: undefined,
    anchorTag: undefined,
  });
  assert.equal(diag.isNativeDialog, true);
  assert.equal(diag.description, 'dialog#confirm-modal');
});

test('buildBlockerDiagnostic limits classList to 3 entries', () => {
  const diag = buildBlockerDiagnostic({
    tagName: 'div',
    id: '',
    className: 'a b c d e',
    position: 'static',
    opacity: '1',
    isDialog: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    blockerWidth: 100,
    blockerHeight: 100,
    anchorId: undefined,
    anchorTag: undefined,
  });
  assert.deepEqual(diag.classList, ['a', 'b', 'c']);
});
