import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { ContinuityGraphSnapshot } from '../../../src/v2/graph/types';
import type { BrowserObservation, V2Ref } from '../../../src/v2';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_1',
    generationId: 1,
    targetId: 'target_1',
    selectorCandidates: ['#candidate'],
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
    observationId: 'obs_working_set',
    sessionId: 'session_working_set',
    generationId: 1,
    url: 'https://example.test',
    title: 'Working Set Fixture',
    timestamp: 1,
    durationMs: 5,
    refs,
    warnings: [],
  });
}

test('PlannerWorkingSetSelector keeps visible actionable refs and drops low-value hidden generics', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit order', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_hidden_generic', role: undefined, name: undefined, text: undefined, visibility: 'hidden', actionability: 'blocked' }),
    makeRef({ refId: 'ref_offscreen_generic', role: undefined, name: 'Decorative', text: 'Decorative', visibility: 'offscreen', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({
    maxPrimaryRefs: 4,
    maxSecondaryRefs: 4,
    maxReadableEvidence: 4,
    maxNavigationRefs: 4,
    maxRegionSummaries: 4,
  }).select({
    goal: 'Submit the order',
    projection,
  });

  assert.deepEqual(selection.selectedRefIds.sort(), ['ref_search', 'ref_submit']);
  assert.ok(selection.workingSet.primaryRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.workingSet.primaryRefs.some(ref => ref.reasons.includes('visible_ready')));
  assert.equal(selection.current.refs.ref_hidden_generic, undefined);
  assert.equal(selection.current.refs.ref_offscreen_generic, undefined);
  assert.equal(selection.diagnostics.observedRefCount, 4);
  assert.equal(selection.diagnostics.selectedRefCount, 2);
  assert.equal(selection.diagnostics.droppedRefCount, 2);
  assert.ok((selection.diagnostics.droppedByReason.hidden_low_value ?? 0) >= 1);
  assert.ok((selection.diagnostics.droppedByReason.offscreen_low_value ?? 0) >= 1);
});

test('PlannerWorkingSetSelector promotes goal-matching refs over generic visible controls', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_docs', role: 'link', name: 'Documentation', text: 'Documentation', visibility: 'visible' }),
    makeRef({ refId: 'ref_pricing', role: 'link', name: 'Pricing', text: 'Pricing', visibility: 'visible' }),
    makeRef({ refId: 'ref_menu', role: 'button', name: 'Menu', text: 'Menu', visibility: 'visible' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 2, maxSecondaryRefs: 0 }).select({
    goal: 'Open the documentation',
    projection,
  });

  assert.equal(selection.workingSet.primaryRefs[0].refId, 'ref_docs');
  assert.ok(selection.workingSet.primaryRefs[0].reasons.includes('goal_keyword_match'));
  assert.ok(selection.workingSet.primaryRefs[0].score > (selection.current.refs.ref_docs.score ?? 0));
});

test('PlannerWorkingSetSelector bounds dense repeated regions and reports omitted counts', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_open_1', role: 'button', name: 'Open', targetId: 'target_1', selectorCandidates: ['[data-testid="open-1"]'] }),
    makeRef({ refId: 'ref_open_2', role: 'button', name: 'Open', targetId: 'target_2', selectorCandidates: ['[data-testid="open-2"]'] }),
    makeRef({ refId: 'ref_open_3', role: 'button', name: 'Open', targetId: 'target_3', selectorCandidates: ['[data-testid="open-3"]'] }),
    makeRef({ refId: 'ref_open_4', role: 'button', name: 'Open', targetId: 'target_4', selectorCandidates: ['[data-testid="open-4"]'] }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 0, maxRegionSummaries: 1 }).select({
    goal: 'Open an item',
    projection,
  });

  assert.equal(selection.workingSet.regionSummaries.length, 1);
  assert.deepEqual(selection.workingSet.regionSummaries[0].representativeRefs, ['ref_open_1', 'ref_open_2', 'ref_open_3']);
  assert.equal(selection.workingSet.regionSummaries[0].omittedRefCount, 1);
});

test('PlannerWorkingSetSelector keeps recently appeared refs from transition evidence', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_old', role: 'button', name: 'Old action', visibility: 'visible' }),
    makeRef({ refId: 'ref_new', role: 'button', name: 'New result action', visibility: 'offscreen' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Continue after the page changed',
    projection,
    transitionEvidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_new'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_old'],
      },
      notes: [],
    },
  });

  const newRef = [...selection.workingSet.primaryRefs, ...selection.workingSet.secondaryRefs].find(ref => ref.refId === 'ref_new');
  assert.ok(newRef);
  assert.ok(newRef.reasons.includes('recently_appeared'));
});

test('PlannerWorkingSetSelector keeps recently changed refs from graph snapshot evidence', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_old', role: 'button', name: 'Old action', visibility: 'visible' }),
    makeRef({
      refId: 'ref_graph_recent',
      targetId: 'target_graph_recent',
      selectorCandidates: ['[data-graph-recent]'],
      role: undefined,
      name: undefined,
      text: undefined,
      visibility: 'offscreen',
      actionability: 'unknown',
    }),
  ]));
  const graphSnapshot: ContinuityGraphSnapshot = {
    snapshotId: 'graph_obs_working_set_1',
    observationId: 'obs_working_set',
    generationId: 1,
    url: 'https://example.test',
    refs: [{
      refId: 'ref_graph_recent',
      targetId: 'target_graph_recent',
      generationId: 1,
      visibility: 'offscreen',
      actionability: 'unknown',
      state: 'live',
      continuityConfidence: 1,
      present: true,
      firstSeenObservationId: 'obs_working_set',
      lastSeenObservationId: 'obs_working_set',
      lastChangedTransitionId: 'transition_recent',
    }],
    regions: [],
    transitions: [{
      transitionId: 'transition_recent',
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_working_set',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_graph_recent'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_old'],
      },
      notes: [],
    }],
    stats: {
      refCount: 1,
      presentRefCount: 1,
      regionCount: 0,
      transitionCount: 1,
      maxTransitions: 20,
    },
  };

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Continue after the graph changed',
    projection,
    graphSnapshot,
  });

  const graphRef = [...selection.workingSet.primaryRefs, ...selection.workingSet.secondaryRefs]
    .find(ref => ref.refId === 'ref_graph_recent');
  assert.ok(graphRef);
  assert.ok(graphRef.reasons.includes('recently_appeared'));
  assert.ok(graphRef.reasons.includes('recently_changed'));
});

test('PlannerWorkingSetSelector keeps failed target refs with failure reasons for recovery', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible' }),
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Search', visibility: 'hidden', actionability: 'blocked' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Search for quantum computing',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_submit',
      error: { code: 'target_hidden', message: 'Target was hidden.', retryable: false },
      traceStepId: 'step_click_submit',
    },
    failureEvidence: [{
      failureId: 'failure_target_hidden_ref_submit',
      kind: 'target_hidden',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target ref is hidden at execution time.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_submit',
      signals: ['error:target_hidden'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.selectedRefIds.includes('ref_submit'));
  assert.equal(selection.workingSet.mode, 'recover');
});

test('PlannerWorkingSetSelector does not treat initial graph population as changed refs', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_a', role: 'button', name: 'Alpha', visibility: 'visible' }),
    makeRef({ refId: 'ref_b', role: 'button', name: 'Beta', visibility: 'visible' }),
  ]));
  const graphSnapshot: ContinuityGraphSnapshot = {
    snapshotId: 'graph_initial',
    observationId: 'obs_working_set',
    generationId: 1,
    url: 'https://example.test',
    refs: [
      {
        refId: 'ref_a',
        targetId: 'target_a',
        generationId: 1,
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        continuityConfidence: 1,
        present: true,
        firstSeenObservationId: 'obs_working_set',
        lastSeenObservationId: 'obs_working_set',
      },
      {
        refId: 'ref_b',
        targetId: 'target_b',
        generationId: 1,
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        continuityConfidence: 1,
        present: true,
        firstSeenObservationId: 'obs_working_set',
        lastSeenObservationId: 'obs_working_set',
      },
    ],
    regions: [],
    transitions: [],
    stats: {
      refCount: 2,
      presentRefCount: 2,
      regionCount: 0,
      transitionCount: 0,
      maxTransitions: 20,
    },
  };

  const selection = new PlannerWorkingSetSelector({ maxChangedRefs: 4 }).select({
    goal: 'Click alpha',
    projection,
    graphSnapshot,
  });

  assert.equal(selection.workingSet.changedRefs.appearedCount, 0);
  assert.equal(selection.workingSet.changedRefs.weakenedCount, 0);
  assert.equal(selection.workingSet.changedRefs.topRefs.length, 0);
});

test('PlannerWorkingSetSelector caps changed refs by failed and goal-relevant priority', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_failed', role: 'button', name: 'Retry submit', visibility: 'hidden', actionability: 'blocked' }),
    makeRef({ refId: 'ref_goal', role: 'button', name: 'Search result', visibility: 'offscreen' }),
    makeRef({ refId: 'ref_other_1', role: 'button', name: 'Other one', visibility: 'offscreen' }),
    makeRef({ refId: 'ref_other_2', role: 'button', name: 'Other two', visibility: 'offscreen' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxChangedRefs: 2, maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Open search result',
    projection,
    transitionEvidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_goal', 'ref_other_1', 'ref_other_2'],
        disappeared: [],
        weakened: ['ref_failed'],
        preserved: [],
      },
      notes: [],
    },
    failureEvidence: [{
      failureId: 'failure_target_blocked_ref_failed',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target was blocked.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_failed',
      signals: ['error:target_blocked'],
    }],
  });

  assert.deepEqual(selection.workingSet.changedRefs.topRefs.map(ref => ref.refId), ['ref_failed', 'ref_goal']);
  assert.equal(selection.workingSet.changedRefs.omittedCount, 2);
});

test('PlannerWorkingSetSelector emits action-compatible ref lanes', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_button', role: 'button', name: 'Submit', visibility: 'visible' }),
    makeRef({ refId: 'ref_link', role: 'link', name: 'Docs', visibility: 'visible' }),
    makeRef({ refId: 'ref_text', role: 'textbox', name: 'Search', visibility: 'visible' }),
    makeRef({ refId: 'ref_combo', role: 'combobox', name: 'Category', visibility: 'visible' }),
    makeRef({ refId: 'ref_generic', role: undefined, name: 'Status ready', text: 'Status ready', visibility: 'visible' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 8, maxSecondaryRefs: 8 }).select({
    goal: 'Search docs by category',
    projection,
  });

  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_button'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_link'));
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_text'));
  assert.ok(!selection.workingSet.actionSurface.typeableRefs.includes('ref_button'));
  assert.ok(selection.workingSet.actionSurface.selectableRefs.includes('ref_combo'));
  assert.ok(selection.workingSet.actionSurface.readableRefs.includes('ref_generic'));
  assert.equal(selection.workingSet.actionSurface.ambiguousRefs.includes('ref_generic'), false);
});

test('PlannerWorkingSetSelector builds action lanes from explicit capabilities over role guesses', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({
      refId: 'ref_search_combo',
      role: 'combobox',
      name: 'Search place',
      tagName: 'input',
      inputType: 'search',
      ariaAutocomplete: 'list',
      capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    }),
    makeRef({
      refId: 'ref_submit_input',
      role: 'button',
      name: 'Search',
      tagName: 'input',
      inputType: 'submit',
      capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
    }),
    makeRef({
      refId: 'ref_false_textbox',
      role: 'textbox',
      name: 'Read-only code',
      tagName: 'div',
      capabilities: { clickable: false, typeable: false, selectable: false, readable: true },
    }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 8, maxSecondaryRefs: 8 }).select({
    goal: 'Search place',
    projection,
  });

  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_search_combo'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_search_combo'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_submit_input'));
  assert.ok(!selection.workingSet.actionSurface.typeableRefs.includes('ref_submit_input'));
  assert.ok(!selection.workingSet.actionSurface.typeableRefs.includes('ref_false_textbox'));
});

test('PlannerWorkingSetSelector preserves failed refs as evidence without keeping same-tool target clickable', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_bad_button', role: 'button', name: 'Search', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Search for climate data',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_bad_button',
      error: { code: 'target_blocked', message: 'Target center point is blocked.', retryable: false },
      traceStepId: 'step_click_bad_button',
    },
    failureEvidence: [{
      failureId: 'failure_target_blocked_ref_bad_button',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target ref center point is blocked by another element.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_bad_button',
      signals: ['error:target_blocked'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_bad_button'));
  assert.equal(selection.current.refs.ref_bad_button?.name, 'Search');
  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_bad_button'), false);
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_search'));
});

test('PlannerWorkingSetSelector does not quarantine retryable transient failures', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Submit the form',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_submit',
      error: { code: 'timeout', message: 'Target was unstable.', retryable: true },
      traceStepId: 'step_click_submit',
    },
    failureEvidence: [{
      failureId: 'failure_timeout_ref_submit',
      kind: 'timeout',
      category: 'timing',
      severity: 'warning',
      persistence: 'transient',
      retryable: true,
      message: 'Timed out waiting for target.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_submit',
      signals: ['error:timeout'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_submit'));
});

test('PlannerWorkingSetSelector exposes readable generic refs as evidence without action compatibility', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({
      refId: 'ref_answer_row',
      role: 'row',
      name: 'Castle Mountains National Monument Barstow California',
      text: 'Castle Mountains National Monument Barstow California',
      visibility: 'visible',
      actionability: 'ready',
    }),
    makeRef({
      refId: 'ref_open',
      role: 'link',
      name: 'Castle Mountains National Monument',
      visibility: 'visible',
      actionability: 'ready',
    }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Find where Castle Mountains National Monument is located',
    projection,
  });

  assert.ok(selection.workingSet.readableEvidence.some(evidence => evidence.refId === 'ref_answer_row'));
  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_answer_row'), false);
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_open'));
});

test('PlannerWorkingSetSelector quarantines repeated no-progress action from matching action lane', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_compute', role: 'button', name: 'Compute', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_input', role: 'textbox', name: 'Expression', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Calculate derivative',
    projection,
    uncertaintySignals: ['repeated_no_progress_transition:click:ref_compute:3'],
  });

  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_compute'), false);
  assert.equal(selection.current.refs.ref_compute?.name, 'Compute');
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_input'));
  assert.ok(selection.workingSet.quarantinedActions.some(action =>
    action.refId === 'ref_compute'
    && action.tool === 'click'
    && action.failureKind === 'no_progress_loop'
  ));
});
