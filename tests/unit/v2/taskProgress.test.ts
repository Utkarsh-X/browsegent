import assert from 'node:assert/strict';
import test from 'node:test';

import { PlannerInputComposer } from '../../../src/v2/planner/PlannerInputComposer';
import { buildV2PlannerSystemPrompt, buildV2PlannerUserMessage } from '../../../src/v2/planner/PlannerPrompt';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref>): V2Ref {
  return {
    refId: 'ref_default',
    generationId: 1,
    targetId: 'target_default',
    backendNodeId: 1,
    selectorCandidates: ['#default'],
    role: 'button',
    name: 'Default',
    text: 'Default',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeProjection(refs: V2Ref[]) {
  const observation = buildBrowserObservation({
    observationId: 'obs_task_progress',
    sessionId: 'session_task_progress',
    generationId: 1,
    url: 'https://example.test/search',
    title: 'Search',
    timestamp: 1,
    durationMs: 1,
    refs,
    warnings: [],
  });
  return new ProjectionService().project(observation);
}

const bookingGoal = 'Find a hotel in Paris for February 14-21, 2024 for 2 adults with free cancellation.';

test('PlannerInputComposer exposes bounded progress for explicit operational constraints', () => {
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_task_progress',
    goal: bookingGoal,
    projection: makeProjection([
      makeRef({ refId: 'ref_destination', role: 'combobox', name: 'Destination', value: 'Paris', text: 'Paris' }),
      makeRef({ refId: 'ref_dates', role: 'textbox', name: 'Dates', value: 'February 14-21, 2024', text: 'February 14-21, 2024' }),
      makeRef({ refId: 'ref_guests', role: 'button', name: 'Guests', text: '2 adults' }),
      makeRef({ refId: 'ref_cancel', role: 'checkbox', name: 'Free cancellation', text: 'Free cancellation' }),
    ]),
  });

  assert.deepEqual(input.taskProgress, {
    status: 'incomplete',
    items: [
      { key: 'destination', requested: 'Paris', status: 'applied', evidence: ['ref_destination'] },
      { key: 'date_range', requested: 'February 14-21, 2024', status: 'applied', evidence: ['ref_dates'] },
      { key: 'traveler_count', requested: '2 adults', status: 'observed', evidence: ['ref_guests'] },
      { key: 'filter:free_cancellation', requested: 'free cancellation', status: 'observed', evidence: ['ref_cancel'] },
    ],
  });
});

test('task progress retains a successful requested value from bounded action history', () => {
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_task_progress_history',
    goal: bookingGoal,
    projection: makeProjection([]),
    trace: [{
      stepId: 'step_destination',
      index: 0,
      kind: 'type',
      status: 'completed',
      startedAt: 1,
      endedAt: 2,
      targetRef: 'ref_destination',
      input: { text: 'Paris' },
      warnings: [],
      result: { success: true, kind: 'type', targetRef: 'ref_destination' },
    }],
  });

  assert.deepEqual(input.taskProgress?.items.find(item => item.key === 'destination'), {
    key: 'destination',
    requested: 'Paris',
    status: 'applied',
    evidence: ['step_destination'],
  });
});

test('current contradictory control state overrides older successful action history', () => {
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_task_progress_conflict',
    goal: bookingGoal,
    projection: makeProjection([
      makeRef({ refId: 'ref_destination', role: 'combobox', name: 'Destination', value: 'New Delhi', text: 'New Delhi' }),
    ]),
    trace: [{
      stepId: 'step_old_destination',
      index: 0,
      kind: 'type',
      status: 'completed',
      startedAt: 1,
      endedAt: 2,
      targetRef: 'ref_destination',
      input: { text: 'Paris' },
      warnings: [],
      result: { success: true, kind: 'type', targetRef: 'ref_destination' },
    }],
  });

  assert.deepEqual(input.taskProgress?.items.find(item => item.key === 'destination'), {
    key: 'destination',
    requested: 'Paris',
    status: 'conflicting',
    evidence: ['ref_destination'],
  });
});

test('task progress does not treat unrelated readable text as an applied control state', () => {
  const projection = makeProjection([
    makeRef({ refId: 'ref_article', role: undefined, name: 'Paris hotel guide', text: 'Paris hotel guide' }),
  ]);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_task_progress_unrelated',
    goal: bookingGoal,
    projection,
  });

  assert.equal(input.taskProgress?.status, 'incomplete');
  assert.equal(input.taskProgress?.items.find(item => item.key === 'destination')?.status, 'pending');
  assert.equal(input.taskProgress?.items.some(item => item.status === 'applied'), false);
});

test('PRC carries task progress without turning it into a completion gate', () => {
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_task_progress_prc',
    goal: bookingGoal,
    projection: makeProjection([
      makeRef({ refId: 'ref_destination', role: 'combobox', name: 'Destination', value: 'Paris', text: 'Paris' }),
    ]),
  });
  const message = buildV2PlannerUserMessage(input, {
    mode: 'prc',
    prcTierOmitted: true,
    compactDataPlane: true,
  });

  assert.match(message, /PROGRESS: state=incomplete/);
  assert.match(message, /destination:applied/);
  assert.match(buildV2PlannerSystemPrompt({ compactDataPlane: true }), /advisory summary of explicit operational constraints/);
  assert.doesNotMatch(buildV2PlannerSystemPrompt({ compactDataPlane: true }), /taskProgress.*return done/i);
});
