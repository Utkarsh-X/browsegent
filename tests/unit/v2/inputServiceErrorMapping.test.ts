import test from 'node:test';
import assert from 'node:assert/strict';

import { InputService } from '../../../src/v2/substrate/InputService';
import type { V2Ref } from '../../../src/v2';

function makeRef(): V2Ref {
  return {
    refId: 'ref_hidden_button',
    generationId: 1,
    targetId: 'target_hidden_button',
    selectorCandidates: ['#hidden-button'],
    role: 'button',
    name: 'Hidden',
    text: 'Hidden',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
  };
}

test('InputService maps Playwright timeout with not visible details to target_hidden', async () => {
  const locator = {
    scrollIntoViewIfNeeded: async () => undefined,
    evaluate: async (_fn: unknown, input?: unknown) => input ? { score: 100, identityKey: 'hidden-button' } : false,
    click: async () => {
      throw new Error('Timeout 1500ms exceeded. element is not visible');
    },
  };
  const page = {
    locator: () => ({
      count: async () => 1,
      nth: () => locator,
    }),
  };

  await assert.rejects(
    () => new InputService().click(makeRef(), page as never),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'target_hidden');
      return true;
    },
  );
});

test('InputService maps non-editable fill failure to target_not_editable', async () => {
  const locator = {
    scrollIntoViewIfNeeded: async () => undefined,
    evaluate: async (_fn: unknown, input?: unknown) => input ? { score: 100, identityKey: 'non-editable' } : '',
    fill: async () => {
      throw new Error('Element is not an <input>, <textarea>, <select> or [contenteditable] and does not have a role allowing [aria-readonly]');
    },
  };
  const page = {
    locator: () => ({
      count: async () => 1,
      nth: () => locator,
    }),
  };

  await assert.rejects(
    () => new InputService().type(makeRef(), 'climate change data visualization', page as never),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'target_not_editable');
      return true;
    },
  );
});

test('InputService keeps pointer interception classified as target_blocked', async () => {
  const locator = {
    scrollIntoViewIfNeeded: async () => undefined,
    evaluate: async (_fn: unknown, input?: unknown) => input ? { score: 100, identityKey: 'blocked-button' } : false,
    click: async () => {
      throw new Error('subtree intercepts pointer events and target will not receive pointer events');
    },
  };
  const page = {
    locator: () => ({
      count: async () => 1,
      nth: () => locator,
    }),
  };

  await assert.rejects(
    () => new InputService().click(makeRef(), page as never),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, 'target_blocked');
      return true;
    },
  );
});
