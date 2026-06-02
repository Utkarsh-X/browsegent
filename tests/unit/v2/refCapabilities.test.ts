import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveRefCapabilities } from '../../../src/v2/runtime/refCapabilities';
import type { V2Ref } from '../../../src/v2/runtime/types';

function makeRef(overrides: Partial<V2Ref>): V2Ref {
  return {
    refId: 'ref_test',
    generationId: 1,
    targetId: 'target_test',
    selectorCandidates: ['#test'],
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('deriveRefCapabilities treats search inputs and searchable comboboxes as typeable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'input',
    inputType: 'search',
    role: 'combobox',
    ariaAutocomplete: 'list',
  })), {
    clickable: true,
    typeable: true,
    selectable: false,
    readable: true,
  });
});

test('deriveRefCapabilities treats submit inputs as clickable and not typeable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'input',
    inputType: 'submit',
    role: 'button',
    name: 'Search',
  })), {
    clickable: true,
    typeable: false,
    selectable: false,
    readable: true,
  });
});

test('deriveRefCapabilities treats native select controls as selectable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'select',
    role: 'combobox',
  })), {
    clickable: true,
    typeable: false,
    selectable: true,
    readable: true,
  });
});

test('deriveRefCapabilities treats contenteditable as typeable', () => {
  assert.equal(deriveRefCapabilities(makeRef({
    tagName: 'div',
    role: 'textbox',
    isContentEditable: true,
    editableKind: 'contenteditable',
  })).typeable, true);
});
