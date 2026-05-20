import test from 'node:test';
import assert from 'node:assert/strict';

import { RefService } from '../../../src/v2/runtime/RefService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'incoming_1',
    generationId: 1,
    targetId: 'target_save',
    selectorCandidates: ['#save-button'],
    role: 'button',
    name: 'Save',
    text: 'Save',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(refs: V2Ref[], generationId = 1): BrowserObservation {
  return buildBrowserObservation({
    observationId: `obs_${generationId}`,
    sessionId: 'session_ref',
    generationId,
    url: 'https://example.test',
    title: 'Ref test',
    timestamp: generationId,
    durationMs: 1,
    refs,
    warnings: [],
  });
}

test('RefService preserves stable refs across unchanged observations', () => {
  const service = new RefService();
  const first = service.assign(makeObservation([makeRef({ refId: 'incoming_a' })], 1));
  const second = service.assign(makeObservation([makeRef({ refId: 'incoming_b', generationId: 2 })], 2));

  assert.equal(second.refs[0].refId, first.refs[0].refId);
  assert.equal(second.refs[0].state, 'live');
  assert.equal(second.refs[0].continuityConfidence, 1);
});

test('RefService weakens a single soft match instead of silently treating it as hard identity', () => {
  const service = new RefService();
  const first = service.assign(makeObservation([makeRef({ refId: 'incoming_a' })], 1));
  const second = service.assign(makeObservation([
    makeRef({
      refId: 'incoming_b',
      generationId: 2,
      targetId: 'target_rerendered_save',
      selectorCandidates: ['button.save-action'],
    }),
  ], 2));

  assert.equal(second.refs[0].refId, first.refs[0].refId);
  assert.equal(second.refs[0].state, 'weakened');
  assert.ok(second.refs[0].continuityConfidence < 1);
});

test('RefService does not resurrect ambiguous soft matches', () => {
  const service = new RefService();
  const first = service.assign(makeObservation([
    makeRef({ refId: 'incoming_a', targetId: 'target_1', selectorCandidates: ['#save-one'] }),
    makeRef({ refId: 'incoming_b', targetId: 'target_2', selectorCandidates: ['#save-two'] }),
  ], 1));
  const second = service.assign(makeObservation([
    makeRef({
      refId: 'incoming_c',
      generationId: 2,
      targetId: 'target_3',
      selectorCandidates: ['button.save-action'],
    }),
  ], 2));

  assert.notEqual(second.refs[0].refId, first.refs[0].refId);
  assert.notEqual(second.refs[0].refId, first.refs[1].refId);
  assert.equal(second.refs[0].state, 'live');
});

test('RefService compare reports preserved, appeared, and disappeared refs', () => {
  const service = new RefService();
  const before = service.assign(makeObservation([
    makeRef({ refId: 'incoming_a', targetId: 'target_save', selectorCandidates: ['#save-button'] }),
    makeRef({ refId: 'incoming_b', targetId: 'target_cancel', selectorCandidates: ['#cancel-button'], name: 'Cancel', text: 'Cancel' }),
  ], 1));
  const after = service.assign(makeObservation([
    makeRef({ refId: 'incoming_c', generationId: 2, targetId: 'target_save', selectorCandidates: ['#save-button'] }),
    makeRef({ refId: 'incoming_d', generationId: 2, targetId: 'target_delete', selectorCandidates: ['#delete-button'], name: 'Delete', text: 'Delete' }),
  ], 2));

  const comparison = service.compare(before, after);

  assert.deepEqual(comparison.preserved, [before.refs[0].refId]);
  assert.deepEqual(comparison.disappeared, [before.refs[1].refId]);
  assert.deepEqual(comparison.appeared, [after.refs[1].refId]);
  assert.deepEqual(comparison.weakened, []);
});

test('RefService resolve rejects missing refs without selector guessing', () => {
  const service = new RefService();
  const observation = service.assign(makeObservation([makeRef()], 1));
  const resolved = service.resolve('missing_ref', observation);

  assert.equal(resolved.state, 'invalid');
  assert.equal(resolved.ref, undefined);
  assert.equal(resolved.confidence, 0);
});
