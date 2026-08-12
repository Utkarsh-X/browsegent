import test from 'node:test';
import assert from 'node:assert/strict';

import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { TransitionService } from '../../../src/v2/runtime/TransitionService';
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
    box: { x: 20, y: 100, width: 120, height: 32 },
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(overrides: {
  observationId: string;
  generationId?: number;
  url?: string;
  refs?: V2Ref[];
  timestamp?: number;
}): BrowserObservation {
  const generationId = overrides.generationId ?? 1;
  return buildBrowserObservation({
    observationId: overrides.observationId,
    sessionId: 'session_brain2',
    generationId,
    url: overrides.url ?? 'https://example.test/app',
    title: 'Brain2 Fixture',
    timestamp: overrides.timestamp ?? generationId,
    durationMs: 2,
    refs: overrides.refs ?? [makeRef({ generationId })],
    warnings: [],
  });
}

test('ContinuityInterpreter classifies scroll-like geometry movement as microstate', () => {
  const before = makeObservation({ observationId: 'obs_scroll_before' });
  const after = makeObservation({
    observationId: 'obs_scroll_after',
    refs: [
      makeRef({
        box: { x: 20, y: 24, width: 120, height: 32 },
      }),
    ],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'microstate');
  assert.equal(evidence.strength, 'weak');
  assert.deepEqual(evidence.refChanges.appeared, []);
  assert.deepEqual(evidence.refChanges.disappeared, []);
  assert.deepEqual(evidence.refChanges.preserved, ['ref_primary']);
  assert.ok(evidence.notes.includes('box_changed:ref_primary'));
});

test('ContinuityInterpreter classifies modal appearance as structural local', () => {
  const before = makeObservation({ observationId: 'obs_modal_before' });
  const after = makeObservation({
    observationId: 'obs_modal_after',
    refs: [
      makeRef(),
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

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'structural_local');
  assert.equal(evidence.strength, 'moderate');
  assert.deepEqual(evidence.refChanges.appeared, ['ref_modal_close']);
  assert.deepEqual(evidence.refChanges.preserved, ['ref_primary']);
  assert.ok(evidence.notes.includes('refs_appeared:1'));
});

test('ContinuityInterpreter classifies SPA route changes as structural macrostate', () => {
  const before = makeObservation({
    observationId: 'obs_route_before',
    url: 'https://example.test/app#/home',
    generationId: 1,
  });
  const after = makeObservation({
    observationId: 'obs_route_after',
    url: 'https://example.test/app#/settings',
    generationId: 2,
    refs: [makeRef({ generationId: 2 })],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'structural_macrostate');
  assert.equal(evidence.strength, 'strong');
  assert.equal(evidence.urlChanged, true);
  assert.equal(evidence.generationChanged, true);
  assert.ok(evidence.notes.includes('url_changed'));
});

test('ContinuityInterpreter classifies same-url generation replacement as hard reset', () => {
  const before = makeObservation({
    observationId: 'obs_reload_before',
    generationId: 1,
  });
  const after = makeObservation({
    observationId: 'obs_reload_after',
    generationId: 2,
    refs: [
      makeRef({
        refId: 'ref_reloaded',
        generationId: 2,
        targetId: 'target_reloaded',
        selectorCandidates: ['#primary'],
      }),
    ],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'hard_reset');
  assert.equal(evidence.strength, 'strong');
  assert.equal(evidence.urlChanged, false);
  assert.equal(evidence.generationChanged, true);
  assert.deepEqual(evidence.refChanges.disappeared, ['ref_primary']);
  assert.deepEqual(evidence.refChanges.appeared, ['ref_reloaded']);
});

test('ContinuityInterpreter emits no progress strength when only observation metadata changes', () => {
  const before = makeObservation({
    observationId: 'obs_same_before',
    timestamp: 10,
  });
  const after = makeObservation({
    observationId: 'obs_same_after',
    timestamp: 20,
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'microstate');
  assert.equal(evidence.strength, 'none');
  assert.deepEqual(evidence.notes, []);
});

test('ContinuityInterpreter ignores ref-id churn when stable target identity is preserved', () => {
  const before = makeObservation({ observationId: 'obs_rebind_before' });
  const after = makeObservation({
    observationId: 'obs_rebind_after',
    refs: [makeRef({ refId: 'ref_rebound', selectorCandidates: ['[data-target="primary"]'] })],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'microstate');
  assert.equal(evidence.strength, 'none');
  assert.deepEqual(evidence.refChanges.appeared, []);
  assert.deepEqual(evidence.refChanges.disappeared, []);
  assert.deepEqual(evidence.refChanges.preserved, ['ref_rebound']);
  assert.deepEqual(evidence.notes, []);
});

test('ContinuityInterpreter treats ref-id continuity as fallback when target ids regenerate', () => {
  const before = makeObservation({ observationId: 'obs_target_reseed_before' });
  const after = makeObservation({
    observationId: 'obs_target_reseed_after',
    refs: [makeRef({ targetId: 'target_reseeded' })],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'microstate');
  assert.equal(evidence.strength, 'none');
  assert.deepEqual(evidence.refChanges.appeared, []);
  assert.deepEqual(evidence.refChanges.disappeared, []);
});

test('TransitionService uses semantic continuity instead of treating ref-id churn as progress', () => {
  const before = makeObservation({ observationId: 'obs_service_before' });
  const after = makeObservation({
    observationId: 'obs_service_after',
    refs: [makeRef({ refId: 'ref_rebound', selectorCandidates: ['[data-target="primary"]'] })],
  });

  const evidence = new TransitionService().compare(before, after);

  assert.equal(evidence.transitionClass, 'microstate');
  assert.equal(evidence.strength, 'none');
});

test('ContinuityInterpreter preserves real semantic changes across ref-id churn', () => {
  const before = makeObservation({ observationId: 'obs_change_before' });
  const after = makeObservation({
    observationId: 'obs_change_after',
    refs: [
      makeRef({
        refId: 'ref_rebound',
        selectorCandidates: ['[data-target="primary"]'],
        text: 'Expanded primary',
      }),
    ],
  });

  const evidence = new ContinuityInterpreter().interpret(before, after);

  assert.equal(evidence.transitionClass, 'structural_local');
  assert.equal(evidence.strength, 'moderate');
  assert.deepEqual(evidence.refChanges.appeared, []);
  assert.deepEqual(evidence.refChanges.disappeared, []);
  assert.deepEqual(evidence.refChanges.preserved, ['ref_rebound']);
  assert.ok(evidence.notes.includes('ref_changed:ref_rebound'));
});

test('ContinuityInterpreter reports weakened only on a real state transition', () => {
  const before = makeObservation({ observationId: 'obs_weaken_before' });
  const weakened = makeObservation({
    observationId: 'obs_weaken_after',
    refs: [makeRef({ state: 'weakened' })],
  });
  const stillWeakened = makeObservation({
    observationId: 'obs_still_weakened',
    refs: [makeRef({ state: 'weakened' })],
  });

  assert.deepEqual(
    new ContinuityInterpreter().interpret(before, weakened).refChanges.weakened,
    ['ref_primary'],
  );
  assert.deepEqual(
    new ContinuityInterpreter().interpret(weakened, stillWeakened).refChanges.weakened,
    [],
  );
});
