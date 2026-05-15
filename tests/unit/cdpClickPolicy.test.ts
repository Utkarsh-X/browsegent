import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAttemptIdentitySelectorRecovery,
  resolveCdpOutcomePolicy,
  shouldRequireStableHashIdentityMatch,
  shouldAttemptCdpSelectorRecovery,
  shouldRetryCdpClickSameTarget,
} from '../../src/adapters/domAdapter';

test('resolveCdpOutcomePolicy maps hard failures to explicit throw semantics', () => {
  assert.deepEqual(resolveCdpOutcomePolicy('unsupported_frame'), {
    action: 'throw',
    errorCode: 'blocked',
    reason: 'unsupported_frame',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('ambiguous_recovery_required'), {
    action: 'throw',
    errorCode: 'blocked',
    reason: 'ambiguous_recovery_required',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('stale_target'), {
    action: 'throw',
    errorCode: 'not_found',
    reason: 'stale_target',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('occluded'), {
    action: 'throw',
    errorCode: 'not_interactable',
    reason: 'occluded',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('geometry_unavailable'), {
    action: 'throw',
    errorCode: 'not_interactable',
    reason: 'geometry_unavailable',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('timeout'), {
    action: 'throw',
    errorCode: 'timeout',
    reason: 'timeout',
  });
});

test('resolveCdpOutcomePolicy keeps soft CDP failures on fallback path', () => {
  assert.deepEqual(resolveCdpOutcomePolicy('cdp_unavailable'), {
    action: 'fallback',
    reason: 'cdp_unavailable',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('execution_error'), {
    action: 'fallback',
    reason: 'execution_error',
  });
  assert.deepEqual(resolveCdpOutcomePolicy('ok'), {
    action: 'return',
    reason: 'success',
  });
});

test('shouldRetryCdpClickSameTarget retries only transient geometry/timeout outcomes', () => {
  assert.equal(shouldRetryCdpClickSameTarget('geometry_unavailable'), true);
  assert.equal(shouldRetryCdpClickSameTarget('timeout'), true);
  assert.equal(shouldRetryCdpClickSameTarget('stale_target'), false);
  assert.equal(shouldRetryCdpClickSameTarget('execution_error'), false);
  assert.equal(shouldRetryCdpClickSameTarget('unsupported_frame'), false);
});

test('shouldAttemptCdpSelectorRecovery is limited to staged recovery outcomes', () => {
  assert.equal(shouldAttemptCdpSelectorRecovery('execution_error'), true);
  assert.equal(shouldAttemptCdpSelectorRecovery('geometry_unavailable'), true);
  assert.equal(shouldAttemptCdpSelectorRecovery('stale_target'), true);
  assert.equal(shouldAttemptCdpSelectorRecovery('timeout'), true);
  assert.equal(shouldAttemptCdpSelectorRecovery('occluded'), false);
  assert.equal(shouldAttemptCdpSelectorRecovery('unsupported_frame'), false);
  assert.equal(shouldAttemptCdpSelectorRecovery('ok'), false);
});

test('ambiguous selector recovery requires stable hash evidence', () => {
  assert.equal(canAttemptIdentitySelectorRecovery({ ambiguousSelector: true }), false);
  assert.equal(canAttemptIdentitySelectorRecovery({ ambiguousSelector: true, stableHash: '' }), false);
  assert.equal(canAttemptIdentitySelectorRecovery({ ambiguousSelector: true, stableHash: 'sh_abc123' }), true);
  assert.equal(canAttemptIdentitySelectorRecovery({ ambiguousSelector: false }), true);
});

test('stable hash requirement is enforced only for ambiguous selectors', () => {
  assert.equal(shouldRequireStableHashIdentityMatch({ ambiguousSelector: true, stableHash: 'sh_abc123' }), true);
  assert.equal(shouldRequireStableHashIdentityMatch({ ambiguousSelector: true }), false);
  assert.equal(shouldRequireStableHashIdentityMatch({ ambiguousSelector: false, stableHash: 'sh_abc123' }), false);
});
