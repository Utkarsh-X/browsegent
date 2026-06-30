import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveRefCapabilities } from '../../../src/v2/runtime/refCapabilities';
import { toProjectionItem } from '../../../src/v2/brain1/rankOperationalItems';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { PlannerRepresentationCompiler } from '../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import type { V2Ref } from '../../../src/v2/runtime/types';

// Helper to construct a mock ref
function makeRef(overrides: Partial<V2Ref>): V2Ref {
  return {
    refId: 'ref_mock_id',
    generationId: 1,
    targetId: 'target_mock_id',
    tagName: 'li',
    role: 'menuitemradio',
    name: 'Most stars',
    text: 'Most stars',
    nthRoleName: 1,
    state: 'live',
    visibility: 'visible',
    actionability: 'ready',
    capabilities: { clickable: false, typeable: false, selectable: false, readable: false },
    selectorCandidates: [],
    continuityConfidence: 1,
    ...overrides,
  };
}

test('deriveRefCapabilities whitelists menuitemradio and menuitemcheckbox as clickable', () => {
  const capRadio = deriveRefCapabilities(makeRef({ role: 'menuitemradio' }));
  assert.equal(capRadio.clickable, true);
  assert.equal(capRadio.readable, true);

  const capCheckbox = deriveRefCapabilities(makeRef({ role: 'menuitemcheckbox' }));
  assert.equal(capCheckbox.clickable, true);
  assert.equal(capCheckbox.readable, true);
});

test('toProjectionItem maps menuitemradio and menuitemcheckbox to button kind', () => {
  const kindRadio = toProjectionItem(makeRef({ role: 'menuitemradio' })).kind;
  assert.equal(kindRadio, 'button');

  const kindCheckbox = toProjectionItem(makeRef({ role: 'menuitemcheckbox' })).kind;
  assert.equal(kindCheckbox, 'button');
});

test('PlannerWorkingSetSelector includes menuitemradio and menuitemcheckbox in the actionSurface', () => {
  const refRadio = makeRef({
    refId: 'ref_radio',
    role: 'menuitemradio',
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
  });
  const refCheckbox = makeRef({
    refId: 'ref_checkbox',
    role: 'menuitemcheckbox',
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
  });
  
  // A generic hidden ref that should be pruned (not flood working set)
  const refHidden = makeRef({
    refId: 'ref_hidden',
    role: 'generic',
    visibility: 'hidden',
    capabilities: { clickable: false, typeable: false, selectable: false, readable: false },
  });

  const projection = new ProjectionService().project({
    observationId: 'obs_1',
    sessionId: 'session_1',
    generationId: 1,
    url: 'https://example.test',
    title: 'Test',
    timestamp: Date.now(),
    refs: [refRadio, refCheckbox, refHidden],
    warnings: [],
    stats: {
      refCount: 3,
      visibleRefCount: 2,
      durationMs: 10,
    },
  });

  const selector = new PlannerWorkingSetSelector({ maxPrimaryRefs: 6, maxSecondaryRefs: 6 });
  const selection = selector.select({
    goal: 'Select most stars',
    projection,
  });

  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_radio'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_checkbox'));
  assert.ok(!selection.workingSet.actionSurface.clickableRefs.includes('ref_hidden'));
});

test('PlannerRepresentationCompiler compiles menuitemradio and menuitemcheckbox with tools shorthand', () => {
  const refRadio = makeRef({
    refId: 'ref_mock_id',
    role: 'menuitemradio',
    capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
  });

  const projection = new ProjectionService().project({
    observationId: 'obs_1',
    sessionId: 'session_1',
    generationId: 1,
    url: 'https://example.test',
    title: 'Test',
    timestamp: Date.now(),
    refs: [refRadio],
    warnings: [],
    stats: {
      refCount: 1,
      visibleRefCount: 1,
      durationMs: 10,
    },
  });

  const selector = new PlannerWorkingSetSelector({ maxPrimaryRefs: 6, maxSecondaryRefs: 6 });
  const selection = selector.select({
    goal: 'Select most stars',
    projection,
  });

  const compiler = new PlannerRepresentationCompiler();
  const ir = compiler.compile({
    version: 'v2.planner_input.v2',
    episodeId: 'ep_mock_id',
    goal: 'Select most stars',
    current: selection.current,
    workingSet: selection.workingSet,
    uncertainty: { level: 'none', signals: [] },
  });

  const allElements = [
    ...ir.surface.groups.flatMap(g => g.elements),
    ...ir.surface.remainder,
  ];
  const radioIR = allElements.find(el => el.refId === 'ref_mock_id');
  assert.ok(radioIR);
  assert.ok(radioIR.tools?.includes('c'));
  assert.ok(radioIR.tools?.includes('r'));
});
