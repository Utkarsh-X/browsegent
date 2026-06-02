import test from 'node:test';
import assert from 'node:assert/strict';

import { createRefFingerprint, createSoftRefFingerprint } from '../../../src/v2/runtime/refFingerprint';
import type { V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'incoming_1',
    generationId: 1,
    targetId: 'target_save',
    selectorCandidates: ['#save-button', 'button:nth-of-type(1)'],
    role: 'button',
    name: 'Save',
    text: 'Save',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    box: { x: 10, y: 20, width: 80, height: 30 },
    ...overrides,
  };
}

test('createRefFingerprint is stable for identical operational identity and ignores geometry', () => {
  const first = createRefFingerprint(makeRef({ box: { x: 10, y: 20, width: 80, height: 30 } }));
  const second = createRefFingerprint(makeRef({ box: { x: 200, y: 400, width: 80, height: 30 } }));

  assert.equal(first, second);
});

test('createRefFingerprint changes when hard identity changes', () => {
  const first = createRefFingerprint(makeRef({ targetId: 'target_save' }));
  const second = createRefFingerprint(makeRef({ targetId: 'target_delete' }));

  assert.notEqual(first, second);
});

test('createSoftRefFingerprint groups equivalent controls without selector dependence', () => {
  const first = createSoftRefFingerprint(makeRef({ selectorCandidates: ['#save-button'], targetId: 'target_1' }));
  const second = createSoftRefFingerprint(makeRef({ selectorCandidates: ['button.save-action'], targetId: 'target_2' }));

  assert.equal(first, second);
});

test('createSoftRefFingerprint distinguishes text inputs from submit buttons with same label', () => {
  const textInput = makeRef({
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'search',
    editableKind: 'search',
  });
  const submitButton = makeRef({
    role: 'button',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'submit',
    editableKind: 'none',
  });

  assert.notEqual(createSoftRefFingerprint(textInput), createSoftRefFingerprint(submitButton));
});

test('createSoftRefFingerprint includes DOM input facts for same-role controls', () => {
  const searchInput = makeRef({
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'search',
    editableKind: 'search',
  });
  const textInput = makeRef({
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'text',
    editableKind: 'text',
  });

  assert.notEqual(createSoftRefFingerprint(searchInput), createSoftRefFingerprint(textInput));
});
