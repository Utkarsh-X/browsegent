import test from 'node:test';
import assert from 'node:assert/strict';

import { mapProseEntries } from '../../../src/v2/substrate/ObservationService';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';
import { buildBoundedReadEvidenceText } from '../../../src/v2/harness/ReadEvidence';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import { PlannerRepresentationCompiler } from '../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../src/v2/planner/prc/PromptLayoutEngine';
import type { BrowserObservation, V2Ref } from '../../../src/v2/runtime/types';
import type { PlannerInput } from '../../../src/v2/planner/types';

const PROSE_ENTRIES = [
  { anchorIndexes: [0], text: 'Geomagnetic field strength for Oslo, Norway: 51.5 uT total intensity, 3 deg 35 E declination.' },
  { anchorIndexes: [], text: 'You can delete or delay a submission until it is announced by contacting the moderators.' },
];

function makeRef(index: number, overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: `ref_1_${index + 1}`,
    generationId: 1,
    targetId: `target_${index}`,
    selectorCandidates: [`#el${index}`],
    role: 'link',
    name: `Link ${index}`,
    text: `Link ${index}`,
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('mapProseEntries assigns ids, maps anchor indexes, dedupes, and caps the budget', () => {
  const refs = [makeRef(0), makeRef(1)];
  const entries = [
    ...PROSE_ENTRIES,
    { anchorIndexes: [0], text: 'Geomagnetic field strength for Oslo, Norway: 51.5 uT total intensity, 3 deg 35 E declination.' },
    { anchorIndexes: [], text: 'x'.repeat(500) },
  ];
  const prose = mapProseEntries(entries as never, refs);

  assert.equal(prose.length, 3, 'duplicate entry dropped, all others kept');
  assert.equal(prose[0].proseId, 'prose_1');
  assert.deepEqual(prose[0].anchorRefIds, ['ref_1_1'], 'anchor index maps to capture-ordered refId');
  assert.ok(prose[0].chars <= 300);
  const total = prose.reduce((sum, entry) => sum + entry.chars, 0);
  assert.ok(total <= 2500, 'total prose budget respected');
});

test('serializer includes gated prose for extract/verify modes on prose-poor pages', () => {
  const refs = [makeRef(0, { name: 'Show gaussUnits', text: 'Show gaussUnits' })];
  const observation = buildBrowserObservation({
    observationId: 'obs_prose',
    sessionId: 's',
    generationId: 1,
    url: 'https://x.test/wolfram',
    title: 't',
    timestamp: 1,
    durationMs: 5,
    refs,
    prose: mapProseEntries(PROSE_ENTRIES as never, refs),
    warnings: [],
  });
  const projection = new ProjectionService().project(observation);

  for (const goal of ['What is the field strength in Oslo?', 'Find the submission status on this page']) {
    const selection = new PlannerWorkingSetSelector().select({ goal, projection });
    assert.ok(selection.current.prose?.length, `prose reaches the planner in mode for goal: ${goal}`);
    assert.ok(selection.current.prose[0].text.includes('51.5 uT'), 'the pod value is present');
  }

  const actSelection = new PlannerWorkingSetSelector().select({ goal: 'Submit the order form now', projection });
  assert.equal(actSelection.current.prose, undefined, 'act-mode pages pay zero prose bytes');
});

test('prose is withheld on prose-rich pages even in extract mode', () => {
  const refs = Array.from({ length: 30 }, (_, index) =>
    makeRef(index, { name: `Result row ${index} with a long descriptive accessible name for the measured gate`, text: 'x'.repeat(120) }));
  const observation = buildBrowserObservation({
    observationId: 'obs_rich', sessionId: 's', generationId: 1, url: 'https://x.test/list', title: 't',
    timestamp: 1, durationMs: 5, refs,
    prose: mapProseEntries(PROSE_ENTRIES as never, refs), warnings: [],
  });
  const projection = new ProjectionService().project(observation);
  const selection = new PlannerWorkingSetSelector().select({ goal: 'What is the answer?', projection });
  assert.equal(selection.current.prose, undefined, 'prose-rich pages skip the prose pass');
});

test('lean render emits the bounded Page Text group', () => {
  const input = {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_prose',
    goal: 'What is the field strength?',
    current: {
      projectionId: 'p', observationId: 'o', generationId: 1,
      page: { url: 'https://x', title: 'x' },
      refs: { ref_1_1: { refId: 'ref_1_1', kind: 'link', name: 'Show gaussUnits', visibility: 'visible', actionability: 'ready', confidence: 1, score: 100 } },
      interactions: [{ refId: 'ref_1_1', rank: 1 }],
      readables: [], navigation: [], regions: [],
      prose: [{ proseId: 'prose_1', anchorRefIds: ['ref_1_1'], text: 'Geomagnetic field strength: 51.5 uT total.' }],
      warnings: [], stats: { interactionCount: 1, readableCount: 0, navigationCount: 0, regionCount: 0 },
    },
    workingSet: {
      deltaRefs: { appeared: [], changed: [] },
      mode: 'extract', modeReason: 'fixture',
      primaryRefs: [], secondaryRefs: [], readableEvidence: [], navigationRefs: [],
      actionSurface: { clickableRefs: [], typeableRefs: [], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 0, omittedCount: 0, topRefs: [] },
      failedRefs: [], quarantinedActions: [], regionSummaries: [],
      omitted: { observedRefCount: 1, selectedRefCount: 1, droppedRefCount: 0, droppedByReason: {} },
    },
    uncertainty: { level: 'low', signals: [] },
  } as unknown as PlannerInput;

  const rendered = new PromptLayoutEngine().render(new PlannerRepresentationCompiler().compile(input), { leanPlane: true });
  assert.ok(rendered.includes('Page Text (bounded)'), 'prose group rendered');
  assert.ok(rendered.includes('[prose_1] ("anchor: ref_1_1")'), 'prose id and anchor rendered');
  assert.ok(rendered.includes('51.5 uT'), 'the value text is visible to the planner');
});

test('reads of an anchored ref include the captured section prose', () => {
  const target = makeRef(0, { name: 'Show gaussUnits', text: 'Show gaussUnits' });
  const prose = mapProseEntries(PROSE_ENTRIES.slice(0, 1) as never, [target]);
  const text = buildBoundedReadEvidenceText(target, [target], undefined, prose);
  assert.ok(text.includes('51.5 uT'), 'anchored prose joins the read window');
});
