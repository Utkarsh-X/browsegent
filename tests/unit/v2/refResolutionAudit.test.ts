import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRefResolutionAudit } from '../../../src/v2/runtime/RefResolutionAudit';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_submit',
    generationId: 1,
    targetId: 'target_submit',
    selectorCandidates: ['#submit'],
    role: 'button',
    name: 'Submit',
    text: 'Submit',
    tagName: 'button',
    nthRoleName: 1,
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
    ...overrides,
  };
}

function makeObservation(refs: V2Ref[]): BrowserObservation {
  return buildBrowserObservation({
    observationId: 'obs_audit',
    sessionId: 'session_audit',
    generationId: 1,
    url: 'https://example.test',
    title: 'Audit Fixture',
    timestamp: 1,
    durationMs: 1,
    refs,
    warnings: [],
  });
}

test('buildRefResolutionAudit explains ambiguous same role/name candidates', () => {
  const observation = makeObservation([
    makeRef({ refId: 'ref_submit_1', targetId: 'target_1', nthRoleName: 1 }),
    makeRef({ refId: 'ref_submit_2', targetId: 'target_2', nthRoleName: 2 }),
  ]);

  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit_1',
    actionKind: 'click',
    failureCode: 'ambiguous_ref_resolution',
    diagnostics: { candidateCount: 2 },
  });

  assert.equal(audit.version, 'ref_resolution_audit.v1');
  assert.equal(audit.targetRef, 'ref_submit_1');
  assert.equal(audit.summary.sameRoleNameCandidates, 2);
  assert.equal(audit.summary.reason, 'ambiguous_same_role_name');
  assert.equal(audit.candidates.length, 2);
  assert.equal(audit.candidates[0].refId, 'ref_submit_1');
});

test('buildRefResolutionAudit explains missing target refs', () => {
  const observation = makeObservation([makeRef({ refId: 'ref_other', name: 'Other', text: 'Other' })]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_missing',
    actionKind: 'click',
    failureCode: 'stale_ref',
  });

  assert.equal(audit.summary.reason, 'target_ref_not_in_observation');
  assert.equal(audit.target, undefined);
  assert.equal(audit.candidates.length, 0);
});

test('buildRefResolutionAudit records weakened target state', () => {
  const observation = makeObservation([
    makeRef({ state: 'weakened', continuityConfidence: 0.55, invalidationReason: 'soft_identity_match_requires_verification' }),
  ]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'low_confidence_ref',
  });

  assert.equal(audit.summary.reason, 'target_ref_weakened');
  assert.equal(audit.target?.state, 'weakened');
  assert.equal(audit.target?.continuityConfidence, 0.55);
});

test('buildRefResolutionAudit preserves tied candidate resolver reason', () => {
  const observation = makeObservation([makeRef()]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'ambiguous_ref_resolution',
    diagnostics: {
      reason: 'tied_candidates',
      candidateCount: 5,
      topScore: 130,
    },
  });

  assert.equal(audit.summary.reason, 'resolver_tied_candidates');
  assert.equal(audit.summary.candidateCount, 5);
});

test('buildRefResolutionAudit does not include every same-role element as a candidate', () => {
  const observation = makeObservation([
    makeRef(),
    makeRef({ refId: 'ref_other', targetId: 'target_other', name: 'Other', text: 'Other', nthRoleName: 2 }),
  ]);
  const audit = buildRefResolutionAudit({
    observation,
    targetRef: 'ref_submit',
    actionKind: 'click',
    failureCode: 'timeout',
  });

  assert.deepEqual(audit.candidates.map(candidate => candidate.refId), ['ref_submit']);
});

