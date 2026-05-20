import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_1',
    generationId: 1,
    targetId: 'target_1',
    selectorCandidates: ['#submit'],
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('buildBrowserObservation produces deterministic stats and required shape', () => {
  const observation = buildBrowserObservation({
    observationId: 'obs_1',
    sessionId: 'session_1',
    generationId: 7,
    url: 'https://example.test/page',
    title: 'Example',
    timestamp: 123,
    durationMs: 12,
    refs: [
      makeRef({ refId: 'ref_visible', visibility: 'visible' }),
      makeRef({ refId: 'ref_hidden', visibility: 'hidden' }),
      makeRef({ refId: 'ref_offscreen', visibility: 'offscreen' }),
    ],
    warnings: [],
  });

  assert.equal(observation.observationId, 'obs_1');
  assert.equal(observation.sessionId, 'session_1');
  assert.equal(observation.generationId, 7);
  assert.equal(observation.stats.refCount, 3);
  assert.equal(observation.stats.visibleRefCount, 1);
  assert.equal(observation.stats.durationMs, 12);
});
