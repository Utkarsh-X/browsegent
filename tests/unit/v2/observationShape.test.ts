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

test('resolveBackendNodeIds returns empty identities when CDP bridge is unavailable', async () => {
  const { resolveBackendNodeIds } = await import('../../../src/v2/substrate/ObservationService');
  const page = {
    evaluate: async () => undefined,
  };

  const identities = await resolveBackendNodeIds(page as never, 3, async () => {
    throw new Error('CDP unavailable');
  });

  assert.deepEqual(identities, [{}, {}, {}]);
});

test('resolveBackendNodeIds recovers from querySelectorAll protocol error and succeeds on retry', async () => {
  const { resolveBackendNodeIds } = await import('../../../src/v2/substrate/ObservationService');
  const page = {
    evaluate: async () => undefined,
  };

  let callCount = 0;
  const mockBridge = {
    send: async (method: string, params?: any) => {
      if (method === 'DOM.getDocument') {
        return { root: { nodeId: 42 } };
      }
      if (method === 'DOM.querySelectorAll') {
        callCount++;
        if (callCount === 1) {
          throw new Error('Protocol error (DOM.querySelectorAll): Could not find node with given id');
        }
        return { nodeIds: [100, 101] };
      }
      if (method === 'DOM.describeNode') {
        return {
          node: {
            backendNodeId: params.nodeId,
            attributes: ['data-browsegent-v2-marker', `browsegent-v2-marker-${params.nodeId === 100 ? 0 : 1}`],
          },
        };
      }
      return {};
    },
    dispose: async () => {},
  };

  const identities = await resolveBackendNodeIds(page as never, 2, async () => mockBridge as any);

  assert.equal(callCount, 2); // Verifies retry was triggered and executed
  assert.deepEqual(identities, [
    { backendNodeId: 100, frameId: undefined },
    { backendNodeId: 101, frameId: undefined },
  ]);
});

test('resolveBackendNodeIds returns empty identities on persistent querySelectorAll failure without crashing', async () => {
  const { resolveBackendNodeIds } = await import('../../../src/v2/substrate/ObservationService');
  const page = {
    evaluate: async () => undefined,
  };

  let callCount = 0;
  const mockBridge = {
    send: async (method: string, params?: any) => {
      if (method === 'DOM.getDocument') {
        return { root: { nodeId: 42 } };
      }
      if (method === 'DOM.querySelectorAll') {
        callCount++;
        throw new Error('Protocol error (DOM.querySelectorAll): Could not find node with given id');
      }
      return {};
    },
    dispose: async () => {},
  };

  const identities = await resolveBackendNodeIds(page as never, 3, async () => mockBridge as any);

  assert.equal(callCount, 2); // Verifies retry was triggered and failed
  assert.deepEqual(identities, [{}, {}, {}]);
});
