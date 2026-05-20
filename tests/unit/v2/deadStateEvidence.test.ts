import test from 'node:test';
import assert from 'node:assert/strict';

import { DeadStateDetector } from '../../../src/v2/runtime/DeadStateDetector';
import { FailureClassifier } from '../../../src/v2/runtime/FailureClassifier';
import { UncertaintySignals } from '../../../src/v2/runtime/UncertaintySignals';
import { PlannerInputComposer } from '../../../src/v2/planner/PlannerInputComposer';
import type { OperationalProjection, ProjectionItem } from '../../../src/v2/brain1/projectionTypes';

function makeItem(overrides: Partial<ProjectionItem> = {}): ProjectionItem {
  return {
    refId: 'ref_item',
    kind: 'button',
    role: 'button',
    name: 'Action',
    text: 'Action',
    visibility: 'visible',
    actionability: 'ready',
    state: 'live',
    continuityConfidence: 1,
    score: 80,
    ...overrides,
  };
}

function makeProjection(overrides: Partial<OperationalProjection> = {}): OperationalProjection {
  const interactions = overrides.interactions ?? [makeItem()];
  return {
    projectionId: 'projection_dead_state',
    observationId: 'obs_dead_state',
    generationId: 1,
    url: 'https://example.test',
    title: 'Dead State Fixture',
    interactions,
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    focus: interactions[0] ? { refId: interactions[0].refId, reason: 'highest_operational_score' } : undefined,
    stats: {
      interactionCount: interactions.length,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
    ...overrides,
  };
}

test('DeadStateDetector waits for bounded local mechanisms before emitting dead-state evidence', () => {
  const projection = makeProjection({
    interactions: [],
    focus: undefined,
    stats: {
      interactionCount: 0,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
  });
  const detector = new DeadStateDetector();

  const beforeExhausted = detector.assess({
    projection,
    localMechanismsExhausted: false,
  });
  const afterExhausted = detector.assess({
    projection,
    localMechanismsExhausted: true,
  });

  assert.equal(beforeExhausted.deadState, false);
  assert.equal(afterExhausted.deadState, true);
  assert.ok(afterExhausted.evidence?.reasons.includes('empty_interactions'));
  assert.doesNotMatch(JSON.stringify(afterExhausted), /impossible|task failed|try another/i);
});

test('UncertaintySignals derives high uncertainty from blocked target and empty projection evidence', () => {
  const projection = makeProjection({
    interactions: [],
    focus: undefined,
    stats: {
      interactionCount: 0,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
  });
  const failure = new FailureClassifier().classify({
    success: false,
    kind: 'click',
    targetRef: 'ref_blocked',
    error: {
      code: 'target_blocked',
      message: 'Target center point is covered by another element.',
      retryable: false,
    },
    traceStepId: 'step_blocked',
  });

  const uncertainty = new UncertaintySignals().fromRuntimeState({
    projection,
    failures: [failure],
  });

  assert.equal(uncertainty.level, 'high');
  assert.ok(uncertainty.signals.includes('empty_interactions'));
  assert.ok(uncertainty.signals.includes('failure:target_blocked'));
});

test('PlannerInputComposer carries failure and dead-state evidence compactly', () => {
  const projection = makeProjection({
    interactions: [],
    focus: undefined,
    stats: {
      interactionCount: 0,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
  });
  const failure = new FailureClassifier().classify(undefined, {
    observationId: 'obs_empty',
    projection,
  });
  const deadState = new DeadStateDetector().assess({
    projection,
    failures: [failure],
    localMechanismsExhausted: true,
  }).evidence;
  assert.ok(deadState);

  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_failure',
    goal: 'Inspect visible state',
    projection,
    failureEvidence: [failure],
    deadStateEvidence: deadState,
    runtimeUncertainty: new UncertaintySignals().fromRuntimeState({
      projection,
      failures: [failure],
      deadStateEvidence: deadState,
    }),
  });
  const json = JSON.stringify(input);

  assert.equal(input.failures?.[0].kind, 'empty_projection');
  assert.equal(input.deadState?.deadState, true);
  assert.equal(input.uncertainty.level, 'high');
  assert.doesNotMatch(json, /selectorCandidates|backendNodeId|impossible|try another/i);
});
