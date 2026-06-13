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
      assert.equal(Array.isArray(err.diagnostics?.topCandidates), true);
      return true;
    },
  );
});

test('RefResolver does not award ordinal identity to unrelated same-role candidates', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async () => ({
          score: 120,
          identityKey: `button|${index}|candidate`,
          diagnostics: {
            nameMatched: false,
            textMatched: false,
          },
        }),
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['button'],
      nthRoleName: 1,
    }), fakePage),
    (error: unknown) => {
      const candidate = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(candidate.code, 'ambiguous_ref_resolution');
      assert.equal(candidate.diagnostics?.reason, 'tied_candidates');
      return true;
    },
  );
});

test('RefResolver accepts a single verified candidate even when a broad selector overflows', async () => {
  const resolver = new RefResolver();
  const verifiedLocator = {
    evaluate: async () => ({
      score: 130,
      identityKey: 'input|126|20|1060|32|',
      diagnostics: {
        tagName: 'input',
        role: 'combobox',
        nameMatched: false,
        textMatched: false,
      },
    }),
  };
  const fakePage = {
    locator: () => ({
      count: async () => 6,
      nth: (index: number) => {
        if (index === 0) return verifiedLocator;
        return {
          evaluate: async () => ({
            score: 80,
            identityKey: `weak_${index}`,
          }),
        };
      },
    }),
  } as never;

  const result = await resolver.resolve(makeRef({
    selectorCandidates: ['input'],
    role: 'combobox',
    name: 'Search',
  }), fakePage);

  assert.equal(result.locator, verifiedLocator);
  assert.equal(result.resolution, 'unique_selector');
  assert.equal(result.diagnostics?.reason, 'resolved_unique_top_candidate');
  assert.equal(result.diagnostics?.candidateCount, 1);
  assert.equal(result.diagnostics?.topScore, 130);
});

test('RefResolver rejects a single overflow candidate with only weak visibility evidence', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 6,
      nth: (index: number) => ({
        evaluate: async () => {
          if (index === 0) {
            return {
              score: 100,
              identityKey: 'input|126|20|1060|32|',
              diagnostics: {
                tagName: 'input',
                role: 'textbox',
                nameMatched: false,
                textMatched: false,
              },
            };
          }
          return {
            score: 80,
            identityKey: `weak_${index}`,
          };
        },
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['input'],
      role: 'combobox',
      name: 'Search',
    }), fakePage),
    (error: unknown) => {
      const err = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(err.code, 'ambiguous_ref_resolution');
      assert.equal(err.diagnostics?.reason, 'overflow_weak_selectors');
      assert.equal(err.diagnostics?.candidateCount, 1);
      assert.equal(err.diagnostics?.topScore, 100);
      return true;
    },
  );
});
