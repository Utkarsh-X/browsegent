import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function makeInput(): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'ep_pm_1',
    goal: 'Search quantum computing',
    current: {
      projectionId: 'proj_1',
      observationId: 'obs_7',
      generationId: 2,
      page: { url: 'https://example.test/list', title: 'List' },
      focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1', kind: 'input', role: 'textbox', name: 'Search term',
          visibility: 'offscreen', actionability: 'ready', state: 'weakened', confidence: 0.55, score: 115,
        },
        v2ref_2: {
          refId: 'v2ref_2', kind: 'button', role: 'button', name: 'Search',
          visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 90,
        },
      },
      interactions: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: 2, readableCount: 0, navigationCount: 0, regionCount: 0 },
    },
    workingSet: {
      deltaRefs: { appeared: [], changed: [] },
      mode: 'act',
      modeReason: 'initial',
      primaryRefs: [{ refId: 'v2ref_1', kind: 'input', name: 'Search term', score: 115, reasons: ['goal_keyword_match'] }],
      secondaryRefs: [],
      readableEvidence: [],
      navigationRefs: [],
      actionSurface: { clickableRefs: ['v2ref_2'], typeableRefs: ['v2ref_1'], selectableRefs: [], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 1, weakenedCount: 1, preservedCount: 1, topRefs: [{ refId: 'v2ref_1', name: 'Search term' }], omittedCount: 0 },
      failedRefs: [],
      quarantinedActions: [],
      regionSummaries: [],
      omitted: { observedRefCount: 2, selectedRefCount: 2, droppedRefCount: 0, droppedByReason: {} },
    },
    uncertainty: { level: 'none', signals: [] },
    continuity: { observationId: 'obs_7', generationId: 2, presentRefCount: 2 },
    lastResult: { kind: 'click', success: true },
    transition: { transitionClass: 'structural_local', urlChanged: false, refChangeCounts: { appeared: 1, disappeared: 0, weakened: 1, preserved: 1 } },
  } as unknown as PlannerInput;
}

test('pageModel L1: observation/focus lines move after PLANNER SURFACE', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const off = new PromptLayoutEngine().render(ir, { leanPlane: true });
  const on = new PromptLayoutEngine().render(ir, { leanPlane: true, pageModel: true });

  assert.equal(off.indexOf('observation: obs_7') < off.indexOf('PLANNER SURFACE'), true, 'off-path: observation precedes surface');
  assert.equal(on.indexOf('observation: obs_7') > on.indexOf('PLANNER SURFACE'), true, 'L1: observation follows surface');
  assert.equal(on.indexOf('page: "List"') < on.indexOf('PLANNER SURFACE'), true, 'L1: page line stays in the head');
  assert.equal(on.indexOf('focus: v2ref_1') > on.indexOf('PLANNER SURFACE'), true, 'L1: focus line moves to the tail');
  assert.ok(on.indexOf('RECENT EVENTS') > on.indexOf('focus: v2ref_1'), 'tail sits before RECENT EVENTS');
});

test('pageModel C3: continuity markers leave element lines into a CONTINUITY header', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const on = new PromptLayoutEngine().render(ir, { leanPlane: true, pageModel: true });
  assert.ok(on.includes('CONTINUITY: weakened=1 refs carried from before the last action; changed=0'), 'header carries the counts');
  const surfaceBlock = on.slice(on.indexOf('PLANNER SURFACE'), on.indexOf('CONTINUITY'));
  assert.ok(!surfaceBlock.includes('state=state=weakened'), 'state=weakened marker absent from lines');
  assert.ok(!surfaceBlock.includes('confidence=0.55'), 'confidence marker absent from lines');
  assert.ok(surfaceBlock.includes('visibility=offscreen'), 'element facts (visibility) stay on the line');
});

test('pageModel off-path: byte-identical to the legacy lean render', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const legacy = new PromptLayoutEngine().render(ir, { leanPlane: true });
  const flagOff = new PromptLayoutEngine().render(ir, { leanPlane: true, pageModel: false });
  assert.equal(flagOff, legacy);
  assert.notEqual(new PromptLayoutEngine().render(ir, { leanPlane: true, pageModel: true }), legacy);
});
