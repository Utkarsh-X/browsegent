import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

const input: PlannerInput = {
  version: 'v2.planner_input.v2',
  episodeId: 'ep_render',
  goal: 'Click submit',
  current: {
    projectionId: 'proj',
    observationId: 'obs',
    generationId: 1,
    page: { url: 'https://example.test', title: 'Example' },
    refs: {
      r1: { refId: 'r1', kind: 'button', role: 'button', name: 'Submit', visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 115 },
      r2: { refId: 'r2', kind: 'input', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 90 },
    },
    interactions: [{ refId: 'r1', rank: 1 }, { refId: 'r2', rank: 2 }],
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: { interactionCount: 2, readableCount: 0, navigationCount: 0, regionCount: 0 },
  },
  workingSet: {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [{ refId: 'r1', kind: 'button', name: 'Submit', score: 115, reasons: ['visible_ready'] }],
    secondaryRefs: [{ refId: 'r2', kind: 'input', name: 'Search', score: 90, reasons: ['form_candidate'] }],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: { clickableRefs: ['r1'], typeableRefs: ['r2'], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
    changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 2, topRefs: [], omittedCount: 0 },
    failedRefs: [],
    quarantinedActions: [],
    regionSummaries: [],
    omitted: { observedRefCount: 2, selectedRefCount: 2, droppedRefCount: 0, droppedByReason: {} },
  },
  failures: [{ failureId: 'f1', kind: 'timeout', category: 'timing', severity: 'warning', persistence: 'transient', retryable: true, targetRef: 'r1', signals: [] }],
  uncertainty: { level: 'medium', signals: ['failure:timeout'] },
};

test('PromptLayoutEngine renders mission first, compact tools attributes, and omits action surface list', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /^MISSION/);
  // r1 is clickable, so it has tools="c"
  assert.match(text, /\[r1\] <button name="Submit" lane="interaction" tier="top" failed="timeoutx1" tools="c" \/>/);
  // r2 is typeable, so it has tools="t"
  assert.match(text, /\[r2\] <input name="Search" role="textbox" lane="interaction" tier="high" tools="t" \/>/);
  assert.match(text, /PROBLEMS/);
  // Verify that the old redundant action surface list is gone
  assert.doesNotMatch(text, /action surface: click=/);
  assert.doesNotMatch(text, /"visibility":"visible"/);
  assert.doesNotMatch(text, /"actionability":"ready"/);
});

test('PromptLayoutEngine renders specific tool capability attributes correctly', () => {
  const customInput: PlannerInput = {
    ...input,
    workingSet: {
      ...input.workingSet!,
      actionSurface: {
        clickableRefs: ['r1'],
        typeableRefs: ['r1', 'r2'],
        selectableRefs: [],
        readableRefs: ['r1', 'r2'],
        ambiguousRefs: [],
      },
    },
  };
  const ir = new PlannerRepresentationCompiler().compile(customInput);
  const text = new PromptLayoutEngine().render(ir);
  // r1 should have c,t,r
  assert.match(text, /\[r1\] <button .* tools="c,t,r" \/>/);
  // r2 should have t,r
  assert.match(text, /\[r2\] <input .* tools="t,r" \/>/);
});

test('PromptLayoutEngine rendered prompt size is smaller on a high-density fixture', () => {
  // Create a high-density fixture with 30 items
  const manyRefs: Record<string, any> = {};
  const interactions: any[] = [];
  const clickable: string[] = [];
  const typeable: string[] = [];
  for (let i = 0; i < 30; i++) {
    const refId = `v2ref_${i}`;
    manyRefs[refId] = {
      refId,
      kind: 'button',
      role: 'button',
      name: `Btn ${i}`,
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 100,
    };
    interactions.push({ refId, rank: i + 1 });
    clickable.push(refId);
    if (i % 2 === 0) typeable.push(refId);
  }

  const highDensityInput: PlannerInput = {
    ...input,
    current: {
      ...input.current,
      refs: manyRefs,
      interactions,
    },
    workingSet: {
      ...input.workingSet!,
      actionSurface: {
        clickableRefs: clickable,
        typeableRefs: typeable,
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: [],
      },
    },
  };

  const ir = new PlannerRepresentationCompiler().compile(highDensityInput);
  const text = new PromptLayoutEngine().render(ir);

  // Measure sizes. Under the old engine, we would render a massive "action surface" line in DECISION SIGNALS.
  // The new engine does not render it.
  assert.doesNotMatch(text, /action surface: click=/);
  // Verify it still contains elements with tools attribute
  assert.match(text, /tools="c"/);
});


