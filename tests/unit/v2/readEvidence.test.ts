import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoundedReadEvidenceText } from '../../../src/v2/harness/ReadEvidence';
import type { V2Ref } from '../../../src/v2/runtime/types';

function ref(overrides: Partial<V2Ref>): V2Ref {
  return {
    refId: 'target',
    generationId: 1,
    targetId: 'target-id',
    selectorCandidates: [],
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('bounded read evidence keeps a tiny target first and adds local same-frame text', () => {
  const target = ref({ refId: 'marker', name: 'results', box: { x: 100, y: 100, width: 1, height: 1 } });
  const result = buildBoundedReadEvidenceText(target, [
    target,
    ref({ refId: 'repo', name: 'resource-watch/resource-watch', box: { x: 120, y: 105, width: 200, height: 20 } }),
    ref({ refId: 'stars', name: '73 stars', box: { x: 120, y: 180, width: 40, height: 20 } }),
  ]);

  assert.match(result, /^results resource-watch\/resource-watch 73 stars$/);
});

test('bounded read evidence excludes hidden, stale, and cross-frame neighbors', () => {
  const target = ref({ refId: 'marker', frameId: 'main', name: 'results', box: { x: 100, y: 100, width: 1, height: 1 } });
  const result = buildBoundedReadEvidenceText(target, [
    target,
    ref({ refId: 'hidden', name: 'hidden result', visibility: 'hidden', box: { x: 110, y: 110, width: 40, height: 20 } }),
    ref({ refId: 'stale', name: 'stale result', state: 'stale', box: { x: 110, y: 120, width: 40, height: 20 } }),
    ref({ refId: 'frame', frameId: 'child', name: 'child result', box: { x: 110, y: 130, width: 40, height: 20 } }),
    ref({ refId: 'same', frameId: 'main', name: 'same-frame result', box: { x: 110, y: 140, width: 40, height: 20 } }),
  ]);

  assert.equal(result, 'results same-frame result');
});

test('bounded read evidence leaves rich targets unchanged', () => {
  const target = ref({ refId: 'button', role: 'button', name: 'Submit', box: { x: 100, y: 100, width: 1, height: 1 } });
  const result = buildBoundedReadEvidenceText(target, [
    target,
    ref({ refId: 'neighbor', name: 'Do not include', box: { x: 100, y: 110, width: 40, height: 20 } }),
  ]);

  assert.equal(result, 'Submit');
});

test('bounded read evidence prefers an accessible name over a generic visible label', () => {
  const target = ref({
    refId: 'button',
    role: 'button',
    name: 'Open Item 1',
    text: 'Open',
  });

  assert.equal(buildBoundedReadEvidenceText(target, [target]), 'Open Item 1');
});

test('bounded read evidence obeys item and character caps', () => {
  const target = ref({ refId: 'marker', name: 'results', box: { x: 100, y: 100, width: 1, height: 1 } });
  const neighbors = Array.from({ length: 5 }, (_, index) => ref({
    refId: `n${index}`,
    name: `result-${index}-with-long-text`,
    box: { x: 110, y: 110 + index * 10, width: 40, height: 20 },
  }));

  const result = buildBoundedReadEvidenceText(target, [target, ...neighbors], {
    maxNearbyRefs: 2,
    maxCharacters: 25,
  });

  assert.ok(result.length <= 25);
  assert.match(result, /^results result-0/);
  assert.match(result, /\.\.\.$/);
  assert.doesNotMatch(result, /result-2/);
});
