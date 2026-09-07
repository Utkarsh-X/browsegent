import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerWorkingSetSelector } from '../../../../src/v2/planner/PlannerWorkingSetSelector';
import type { PlannerWorkingSetSelectorInput } from '../../../../src/v2/planner/PlannerWorkingSetSelector';

function baseInput(): PlannerWorkingSetSelectorInput {
  return {
    goal: 'find the cheapest option',
    projection: {
      projectionId: 'p', observationId: 'o', generationId: 2,
      url: 'https://x', title: 'X',
      interactions: [
        { refId: 'v2ref_1', targetId: 't1', kind: 'button', name: 'Buy', visibility: 'visible', actionability: 'ready', state: 'live', continuityConfidence: 1, score: 100 },
        { refId: 'v2ref_2', targetId: 't2', kind: 'link', name: 'Docs', visibility: 'visible', actionability: 'ready', state: 'live', continuityConfidence: 1, score: 10 },
        { refId: 'v2ref_3', targetId: 't3', kind: 'link', name: 'About', visibility: 'visible', actionability: 'ready', state: 'live', continuityConfidence: 1, score: 5 },
      ],
      readables: [], navigation: [], regions: [],
      stats: { interactionCount: 3, readableCount: 0, navigationCount: 0, regionCount: 0 },
      lang: 'en',
    },
  } as unknown as PlannerWorkingSetSelectorInput;
}

test('H4 carry: previously-rendered alive refs join additively with the carried reason', () => {
  const selector = new PlannerWorkingSetSelector({ maxPrimaryRefs: 1, maxSecondaryRefs: 1 });
  const input = baseInput();
  input.previousRenderedRefs = [
    { refId: 'v2ref_9', targetId: 't3' },  // alive under a new refId
    { refId: 'v2ref_8', targetId: 'tDead' }, // dead: must NOT appear
  ];
  const selection = selector.select(input);
  const allRefs = [...selection.workingSet.primaryRefs, ...selection.workingSet.secondaryRefs].map(r => r.refId);
  assert.ok(allRefs.includes('v2ref_3'), 'carried ref joins under its CURRENT refId');
  assert.ok(!allRefs.includes('v2ref_9'), 'the dead old refId never renders');
  assert.ok(!allRefs.includes('v2ref_8'), 'dead targetId never joins');
  const carried = selection.workingSet.secondaryRefs.find(r => r.refId === 'v2ref_3');
  assert.ok(carried?.reasons.includes('carried'), 'carried refs carry the carried reason');
  // additive invariant: the no-carry selection is a subset of the carry selection
  const plain = new PlannerWorkingSetSelector({ maxPrimaryRefs: 1, maxSecondaryRefs: 1 }).select(baseInput());
  const plainIds = new Set([...plain.workingSet.primaryRefs, ...plain.workingSet.secondaryRefs].map(r => r.refId));
  for (const id of plainIds) assert.ok(allRefs.includes(id), `displacement detected: ${id} lost`);
});

test('H4 carry off-path: no previousRenderedRefs means identical selection', () => {
  const selector = new PlannerWorkingSetSelector();
  const a = selector.select(baseInput());
  const b = selector.select({ ...baseInput(), previousRenderedRefs: undefined });
  assert.deepEqual(
    [...a.workingSet.primaryRefs, ...a.workingSet.secondaryRefs].map(r => r.refId),
    [...b.workingSet.primaryRefs, ...b.workingSet.secondaryRefs].map(r => r.refId),
  );
});
