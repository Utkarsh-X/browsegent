import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { serializeProjection } from '../../../src/v2/brain1/serializeProjection';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref } from '../../../src/v2';
import type { ContinuityGraphSnapshot } from '../../../src/v2/graph/types';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_1',
    generationId: 1,
    targetId: 'target_1',
    selectorCandidates: ['#primary'],
    role: 'button',
    name: 'Primary action',
    text: 'Primary action',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(refs: V2Ref[]): BrowserObservation {
  return buildBrowserObservation({
    observationId: 'obs_projection',
    sessionId: 'session_projection',
    generationId: 1,
    url: 'https://example.test',
    title: 'Projection Fixture',
    timestamp: 1,
    durationMs: 5,
    refs,
    warnings: [],
  });
}

test('ProjectionService exposes ready controls in the interaction view', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_ready', name: 'Ready button', actionability: 'ready', visibility: 'visible' }),
    makeRef({ refId: 'ref_disabled', name: 'Disabled button', actionability: 'disabled', visibility: 'visible' }),
  ]));

  assert.deepEqual(projection.interactions.map(item => item.refId), ['ref_ready', 'ref_disabled']);
  assert.equal(projection.interactions[0].actionability, 'ready');
  assert.ok(projection.interactions[0].score > projection.interactions[1].score);
});

test('ProjectionService exposes text-bearing refs in a compact readable view', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_headline', role: 'link', name: 'Read docs', text: 'Read the full documentation' }),
    makeRef({ refId: 'ref_blank', role: 'button', name: undefined, text: undefined }),
  ]));

  assert.deepEqual(projection.readables.map(item => item.refId), ['ref_headline']);
  assert.equal(projection.readables[0].text, 'Read the full documentation');
});

test('ProjectionService forms shallow repeated regions without semantic domain labels', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_alpha', targetId: 'target_alpha', selectorCandidates: ['[data-testid="open-alpha"]'], name: 'Open' }),
    makeRef({ refId: 'ref_beta', targetId: 'target_beta', selectorCandidates: ['[data-testid="open-beta"]'], name: 'Open' }),
    makeRef({ refId: 'ref_gamma', targetId: 'target_gamma', selectorCandidates: ['[data-testid="open-gamma"]'], name: 'Open' }),
  ]));

  assert.equal(projection.regions.length, 1);
  assert.equal(projection.regions[0].kind, 'repeated_list');
  assert.deepEqual(projection.regions[0].refIds, ['ref_alpha', 'ref_beta', 'ref_gamma']);
  assert.equal(projection.regions[0].label, 'Repeated button controls');
});

test('ProjectionService exposes route-changing controls in navigation view without strategy', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_docs', role: 'link', name: 'Docs', selectorCandidates: ['a[href="/docs"]'] }),
    makeRef({ refId: 'ref_button', role: 'button', name: 'Open' }),
  ]));

  assert.deepEqual(projection.navigation.map(item => item.refId), ['ref_docs']);
  assert.equal(projection.navigation[0].role, 'link');
});

test('serializeProjection excludes backend node ids and selector candidates', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({
      refId: 'ref_secret',
      backendNodeId: 123,
      selectorCandidates: ['#secret', 'button:nth-of-type(1)'],
      name: 'Secret button',
    }),
  ]));

  const serialized = serializeProjection(projection);
  const json = JSON.stringify(serialized);

  assert.match(json, /Secret button/);
  assert.doesNotMatch(json, /backendNodeId/);
  assert.doesNotMatch(json, /selectorCandidates/);
  assert.doesNotMatch(json, /#secret/);
});

test('ProjectionService accepts graph context without interpreting transition history', () => {
  const graphSnapshot: ContinuityGraphSnapshot = {
    snapshotId: 'graph_projection_0',
    observationId: 'obs_projection',
    generationId: 1,
    url: 'https://example.test',
    refs: [],
    regions: [],
    transitions: [
      {
        transitionId: 'transition_before_after',
        beforeObservationId: 'before',
        afterObservationId: 'after',
        transitionClass: 'structural_local',
        strength: 'moderate',
        generationChanged: false,
        urlChanged: false,
        refChanges: {
          appeared: [],
          disappeared: [],
          weakened: [],
          preserved: ['ref_ready'],
        },
        notes: [],
      },
    ],
    stats: {
      refCount: 0,
      presentRefCount: 0,
      regionCount: 0,
      transitionCount: 1,
      maxTransitions: 20,
    },
  };

  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_ready', name: 'Ready button' }),
  ]), graphSnapshot);
  const serialized = JSON.stringify(serializeProjection(projection));

  assert.equal(projection.focus?.refId, 'ref_ready');
  assert.doesNotMatch(serialized, /transition_before_after/);
});
