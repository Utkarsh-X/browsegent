import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClickErrorFromVerdict } from '../../../src/v2/substrate/InputService';
import type { HitTestVerdict } from '../../../src/v2/substrate/semanticHitTest';

test('buildClickErrorFromVerdict produces enriched error for hard_blocker', () => {
  const verdict: HitTestVerdict = {
    outcome: 'hard_blocker',
    blocker: {
      description: 'div#cookie-banner',
      tagName: 'div',
      id: 'cookie-banner',
      classList: ['overlay'],
      isFixedOrSticky: true,
      coversFullViewport: false,
      isTransparent: false,
      isNativeDialog: false,
    },
  };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error!.code, 'target_blocked');
  assert.equal(error!.retryable, true); // fixed/sticky + not full viewport → retryable
  assert.ok(error!.message.includes('div#cookie-banner'));
  assert.ok(error!.message.includes('Submit'));
  assert.equal(error!.diagnostics?.blockerDescription, 'div#cookie-banner');
  assert.equal(error!.diagnostics?.blockerIsFixedOrSticky, true);
});

test('buildClickErrorFromVerdict produces non-retryable error for full-viewport modal', () => {
  const verdict: HitTestVerdict = {
    outcome: 'hard_blocker',
    blocker: {
      description: 'div.modal-backdrop',
      tagName: 'div',
      classList: ['modal-backdrop'],
      isFixedOrSticky: true,
      coversFullViewport: true,
      isTransparent: false,
      isNativeDialog: false,
    },
  };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error!.retryable, false); // full viewport → non-retryable
});

test('buildClickErrorFromVerdict produces target_hidden for zero_size_or_hidden', () => {
  const verdict: HitTestVerdict = {
    outcome: 'zero_size_or_hidden',
    detail: 'Element has display:none',
  };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error!.code, 'target_hidden');
  assert.equal(error!.retryable, false);
  assert.ok(error!.message.includes('display:none'));
});

test('buildClickErrorFromVerdict returns undefined for clear_target', () => {
  const verdict: HitTestVerdict = { outcome: 'clear_target' };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error, undefined);
});

test('buildClickErrorFromVerdict returns undefined for semantic_relation', () => {
  const verdict: HitTestVerdict = { outcome: 'semantic_relation', relation: 'descendant' };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error, undefined);
});

test('buildClickErrorFromVerdict returns undefined for soft_ambiguity', () => {
  const verdict: HitTestVerdict = { outcome: 'soft_ambiguity', reason: 'opacity:0' };
  const error = buildClickErrorFromVerdict(verdict, 'Submit', 'button');
  assert.equal(error, undefined);
});
