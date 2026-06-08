import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAttemptWeakenedRefSelfHeal } from '../../../src/v2/runtime/RefSelfHealingPolicy';
import type { V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_query',
    generationId: 2,
    targetId: 'target_query',
    selectorCandidates: ['input[name="q"]'],
    role: 'textbox',
    name: 'Search',
    tagName: 'input',
    inputType: 'search',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 0.55,
    state: 'weakened',
    capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    invalidationReason: 'soft_identity_match_requires_verification',
    ...overrides,
  };
}

test('shouldAttemptWeakenedRefSelfHeal allows visible ready typeable weakened refs', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef());
  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'verified_runtime_resolution_required');
});

test('shouldAttemptWeakenedRefSelfHeal denies low-confidence weakened refs', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef({ continuityConfidence: 0.3 }));
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'continuity_confidence_too_low');
});

test('shouldAttemptWeakenedRefSelfHeal denies incompatible actions', () => {
  const decision = shouldAttemptWeakenedRefSelfHeal('type', makeRef({
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
  }));
  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'action_not_compatible');
});

test('shouldAttemptWeakenedRefSelfHeal denies hidden or blocked refs', () => {
  assert.equal(shouldAttemptWeakenedRefSelfHeal('click', makeRef({ visibility: 'hidden' })).allow, false);
  assert.equal(shouldAttemptWeakenedRefSelfHeal('click', makeRef({ actionability: 'blocked' })).allow, false);
});

test('shouldAttemptWeakenedRefSelfHeal denies snapshot-only read operations', () => {
  assert.deepEqual(
    shouldAttemptWeakenedRefSelfHeal('get', makeRef({
      capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    })),
    { allow: false, reason: 'read_path_not_browser_verified' },
  );
});

