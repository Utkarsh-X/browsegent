import test from 'node:test';
import assert from 'node:assert/strict';

import { RefResolver } from '../../../src/v2/substrate/RefResolver';
import type { V2Ref } from '../../../src/v2/runtime/types';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_test',
    generationId: 1,
    targetId: 'target_test',
    selectorCandidates: ['#does-not-exist'],
    role: 'button',
    name: 'Test',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('RefResolver stale_ref error includes candidateCount diagnostic', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 0,
      nth: () => ({ evaluate: async () => ({ score: 0, identityKey: 'k' }) }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({ selectorCandidates: ['#missing'] }), fakePage),
    (error: unknown) => {
      const err = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(err.code, 'stale_ref');
      assert.equal(err.diagnostics?.candidateCount, 0);
      assert.equal(err.diagnostics?.reason, 'no_verified_candidates');
      return true;
    },
  );
});

test('RefResolver ambiguous_ref_resolution error includes tied candidate diagnostic', async () => {
  const resolver = new RefResolver();
  const evaluateCall = { callCount: 0 };
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async () => {
          evaluateCall.callCount++;
          return { score: 120, identityKey: `key_${index}` };
        },
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({ selectorCandidates: ['div.item'] }), fakePage),
    (error: unknown) => {
      const err = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(err.code, 'ambiguous_ref_resolution');
      assert.equal(err.diagnostics?.candidateCount, 2);
      assert.equal(err.diagnostics?.reason, 'tied_candidates');
      return true;
    },
  );
});
