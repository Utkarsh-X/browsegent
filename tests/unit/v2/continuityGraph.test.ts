import test from 'node:test';
import assert from 'node:assert/strict';

import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_primary',
    generationId: 1,
    targetId: 'target_primary',
    selectorCandidates: ['#primary'],
    role: 'button',
    name: 'Primary',
    text: 'Primary',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    regionId: 'region_main',
    ...overrides,
  };
}

function makeObservation(overrides: {
  observationId: string;
  generationId?: number;
  url?: string;
  refs?: V2Ref[];
}): BrowserObservation {
  const generationId = overrides.generationId ?? 1;
  return buildBrowserObservation({
    observationId: overrides.observationId,
    sessionId: 'session_graph',
    generationId,
    url: overrides.url ?? 'https://example.test/app',
    title: 'Graph Fixture',
    timestamp: generationId,
    durationMs: 1,
    refs: overrides.refs ?? [makeRef({ generationId })],
    warnings: [],
  });
}

test('ContinuityGraph preserves unaffected ref-to-region relationships after local changes', () => {
  const graph = new ContinuityGraph();
  const interpreter = new ContinuityInterpreter();
  const before = makeObservation({
    observationId: 'obs_graph_before',
    refs: [
      makeRef({ refId: 'ref_primary', targetId: 'target_primary', regionId: 'region_main' }),
      makeRef({
        refId: 'ref_secondary',
        targetId: 'target_secondary',
        selectorCandidates: ['#secondary'],
        name: 'Secondary',
        text: 'Secondary',
        regionId: 'region_main',
      }),
    ],
  });
  const after = makeObservation({
    observationId: 'obs_graph_after',
    refs: [
      makeRef({ refId: 'ref_primary', targetId: 'target_primary', regionId: 'region_main' }),
      makeRef({
        refId: 'ref_secondary',
        targetId: 'target_secondary',
        selectorCandidates: ['#secondary'],
        name: 'Secondary',
        text: 'Secondary',
        regionId: 'region_main',
      }),
      makeRef({
        refId: 'ref_modal_close',
        targetId: 'target_modal_close',
        selectorCandidates: ['#modal-close'],
        name: 'Close',
        text: 'Close',
        regionId: 'region_modal',
      }),
    ],
  });

  graph.applyObservation(before);
  const evidence = interpreter.interpret(before, after);
  graph.applyObservation(after);
  graph.applyTransition(evidence);
  const snapshot = graph.snapshot();

  const primary = snapshot.refs.find(ref => ref.refId === 'ref_primary');
  const secondary = snapshot.refs.find(ref => ref.refId === 'ref_secondary');
  const mainRegion = snapshot.regions.find(region => region.regionId === 'region_main');

  assert.equal(evidence.transitionClass, 'structural_local');
  assert.equal(primary?.regionId, 'region_main');
  assert.equal(secondary?.regionId, 'region_main');
  assert.deepEqual(mainRegion?.refIds, ['ref_primary', 'ref_secondary']);
  assert.equal(snapshot.transitions[snapshot.transitions.length - 1]?.transitionClass, 'structural_local');
});

test('ContinuityGraph keeps disappeared refs as stale topology evidence', () => {
  const graph = new ContinuityGraph();
  const interpreter = new ContinuityInterpreter();
  const before = makeObservation({
    observationId: 'obs_disappear_before',
    refs: [
      makeRef({ refId: 'ref_primary', targetId: 'target_primary' }),
      makeRef({
        refId: 'ref_removed',
        targetId: 'target_removed',
        selectorCandidates: ['#removed'],
        name: 'Removed',
        text: 'Removed',
      }),
    ],
  });
  const after = makeObservation({
    observationId: 'obs_disappear_after',
    refs: [makeRef({ refId: 'ref_primary', targetId: 'target_primary' })],
  });

  graph.applyObservation(before);
  const evidence = interpreter.interpret(before, after);
  graph.applyObservation(after);
  graph.applyTransition(evidence);
  const snapshot = graph.snapshot();
  const removed = snapshot.refs.find(ref => ref.refId === 'ref_removed');

  assert.deepEqual(evidence.refChanges.disappeared, ['ref_removed']);
  assert.equal(removed?.present, false);
  assert.equal(removed?.state, 'stale');
  assert.equal(removed?.lastSeenObservationId, 'obs_disappear_before');
});

test('ContinuityGraph bounds transition history after repeated transitions', () => {
  const graph = new ContinuityGraph({ maxTransitions: 3 });
  const interpreter = new ContinuityInterpreter();

  for (let index = 0; index < 5; index += 1) {
    const before = makeObservation({
      observationId: `obs_${index}_before`,
      refs: [makeRef({ text: `Before ${index}` })],
    });
    const after = makeObservation({
      observationId: `obs_${index}_after`,
      refs: [makeRef({ text: `After ${index}` })],
    });

    graph.applyObservation(before);
    graph.applyObservation(after);
    graph.applyTransition(interpreter.interpret(before, after));
  }

  const snapshot = graph.snapshot();

  assert.equal(snapshot.transitions.length, 3);
  assert.deepEqual(
    snapshot.transitions.map(transition => transition.transitionId),
    [
      'transition_obs_2_before_obs_2_after',
      'transition_obs_3_before_obs_3_after',
      'transition_obs_4_before_obs_4_after',
    ],
  );
  assert.equal(snapshot.stats.transitionCount, 3);
});

test('ContinuityGraph snapshots are deterministic JSON replay artifacts', () => {
  const graph = new ContinuityGraph();
  const observation = makeObservation({
    observationId: 'obs_serializable',
    refs: [
      makeRef({ refId: 'ref_b', targetId: 'target_b', regionId: 'region_main' }),
      makeRef({ refId: 'ref_a', targetId: 'target_a', regionId: 'region_main' }),
    ],
  });

  graph.applyObservation(observation);
  const snapshot = graph.snapshot();
  const roundTripped = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

  assert.equal(roundTripped.snapshotId, 'graph_obs_serializable_0');
  assert.deepEqual(roundTripped.refs.map(ref => ref.refId), ['ref_a', 'ref_b']);
  assert.deepEqual(roundTripped.regions[0].refIds, ['ref_a', 'ref_b']);
});
