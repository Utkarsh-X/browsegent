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

test('ObservationService.capture succeeds on first attempt (no retry, waitForLoadState not called)', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let waitForLoadStateCalled = false;
  let evaluateCallCount = 0;

  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => 'Example Title',
    evaluate: async (script: any) => {
      evaluateCallCount++;
      return [] as any[];
    },
    waitForLoadState: async (state: string) => {
      waitForLoadStateCalled = true;
    },
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  const result = await service.capture({
    page: mockPage as any,
    sessionId: 'session_123',
    generationId: 1,
  });

  assert.equal(result.url, 'https://example.com');
  assert.equal(result.title, 'Example Title');
  assert.equal(waitForLoadStateCalled, false);
  assert.equal(evaluateCallCount, 2); // 1 for capture, 1 for cleanupBackendMarkers
});

test('ObservationService.capture retries one empty navigation capture when readiness retry is enabled', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let waitForLoadStateCalled = false;
  let evaluateCallCount = 0;
  let titleCallCount = 0;

  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => {
      titleCallCount += 1;
      return titleCallCount === 1 ? '' : 'Loaded Title';
    },
    evaluate: async () => {
      evaluateCallCount += 1;
      if (evaluateCallCount === 1) {
        return [] as any[];
      }
      if (evaluateCallCount === 2) {
        return [{ targetId: 'target_1', selectorCandidates: ['#search'] }] as any[];
      }
      return undefined;
    },
    waitForLoadState: async (state: string) => {
      if (state === 'domcontentloaded') {
        waitForLoadStateCalled = true;
      }
    },
    waitForTimeout: async () => undefined,
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  const result = await service.capture({
    page: mockPage as any,
    sessionId: 'session_123',
    generationId: 1,
    retryEmptyNavigationCapture: true,
  });

  assert.equal(waitForLoadStateCalled, true);
  assert.equal(evaluateCallCount, 3); // empty capture, retry capture, marker cleanup
  assert.equal(result.title, 'Loaded Title');
  assert.equal(result.refs.length, 1);
});

test('ObservationService.capture throws Execution context was destroyed on first attempt -> retries once after waitForLoadState -> succeeds on second attempt', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let waitForLoadStateCalled = false;
  let evaluateCallCount = 0;

  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => 'Example Title',
    evaluate: async (script: any) => {
      evaluateCallCount++;
      if (evaluateCallCount === 1) {
        throw new Error('Execution context was destroyed, details here...');
      }
      if (evaluateCallCount === 2) {
        return [{ targetId: 'target_1', selectorCandidates: ['#btn'] }] as any[];
      }
      return undefined; // for cleanupBackendMarkers
    },
    waitForLoadState: async (state: string) => {
      if (state === 'domcontentloaded') {
        waitForLoadStateCalled = true;
      }
    },
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  const result = await service.capture({
    page: mockPage as any,
    sessionId: 'session_123',
    generationId: 1,
  });

  assert.equal(result.url, 'https://example.com');
  assert.equal(result.title, 'Example Title');
  assert.equal(waitForLoadStateCalled, true);
  assert.equal(evaluateCallCount, 3); // 1st try (fails), 2nd try (succeeds), 3rd try (cleanupBackendMarkers)
  assert.equal(result.refs.length, 1);
});

test('ObservationService.capture throws a non-navigation error -> throws immediately without retrying or calling waitForLoadState', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let waitForLoadStateCalled = false;
  let evaluateCallCount = 0;

  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => 'Example Title',
    evaluate: async (script: any) => {
      evaluateCallCount++;
      throw new Error('Some standard evaluation error');
    },
    waitForLoadState: async (state: string) => {
      waitForLoadStateCalled = true;
    },
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  await assert.rejects(
    async () => {
      await service.capture({
        page: mockPage as any,
        sessionId: 'session_123',
        generationId: 1,
      });
    },
    (err: any) => {
      assert.equal(err.message, 'Some standard evaluation error');
      return true;
    }
  );

  assert.equal(waitForLoadStateCalled, false);
  assert.equal(evaluateCallCount, 1);
});

test('ObservationService.capture fails on both attempts with navigation race errors -> throws the second error', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let waitForLoadStateCalled = false;
  let evaluateCallCount = 0;

  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => 'Example Title',
    evaluate: async (script: any) => {
      evaluateCallCount++;
      if (evaluateCallCount === 1) {
        throw new Error('first error: execution context destroyed');
      } else {
        throw new Error('second error: target closed');
      }
    },
    waitForLoadState: async (state: string) => {
      if (state === 'domcontentloaded') {
        waitForLoadStateCalled = true;
      }
    },
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  await assert.rejects(
    async () => {
      await service.capture({
        page: mockPage as any,
        sessionId: 'session_123',
        generationId: 1,
      });
    },
    (err: any) => {
      assert.equal(err.message, 'second error: target closed');
      return true;
    }
  );

  assert.equal(waitForLoadStateCalled, true);
  assert.equal(evaluateCallCount, 2);
});

test('ObservationService.capture keeps polling through a navigation race inside the bounded wait and recovers', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let evaluateCallCount = 0;
  const mockPage = {
    url: async () => 'https://example.com',
    title: async () => 'Loaded Title',
    evaluate: async () => {
      evaluateCallCount += 1;
      if (evaluateCallCount === 1) {
        return [] as any[]; // initial empty capture triggers the bounded wait
      }
      if (evaluateCallCount === 2) {
        // A navigation commits under the poll while waiting for content.
        throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
      }
      if (evaluateCallCount === 3) {
        return [{ targetId: 'target_1', selectorCandidates: ['#btn'] }] as any[];
      }
      return undefined; // cleanupBackendMarkers
    },
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  const result = await service.capture({
    page: mockPage as any,
    sessionId: 'session_123',
    generationId: 1,
    retryEmptyNavigationCapture: true,
  });

  assert.equal(result.refs.length, 1);
  assert.equal(result.title, 'Loaded Title');
  assert.equal(evaluateCallCount, 4); // empty, race (survived), refs, cleanup
});

test('ObservationService.capture waits out a titled interactive-free shell and recovers when refs hydrate', async () => {
  const { ObservationService } = await import('../../../src/v2/substrate/ObservationService');

  let evaluateCallCount = 0;
  const mockPage = {
    url: async () => 'https://example.com/results',
    // Titled shell with body text and zero interactive elements: the exact
    // mid-transition shape that previously bypassed the bounded wait.
    title: async () => 'Results shell title',
    evaluate: async () => {
      evaluateCallCount += 1;
      if (evaluateCallCount === 1) {
        return [] as any[];
      }
      if (evaluateCallCount === 2) {
        return [] as any[];
      }
      if (evaluateCallCount === 3) {
        return [{ targetId: 'target_9', selectorCandidates: ['#row'] }] as any[];
      }
      return undefined;
    },
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP not supported in mock');
      },
    }),
  };

  const service = new ObservationService();
  const result = await service.capture({
    page: mockPage as any,
    sessionId: 'session_123',
    generationId: 1,
    retryEmptyNavigationCapture: true,
  });

  assert.equal(result.refs.length, 1);
  assert.equal(evaluateCallCount, 4); // empty, empty (waited), refs, cleanup
});
