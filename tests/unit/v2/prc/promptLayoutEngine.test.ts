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

test('PromptLayoutEngine renders mission first and compact element lines', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /^MISSION/);
  assert.match(text, /\[r1\] <button name="Submit" lane="interaction" tier="top" failed="timeoutx1" \/>/);
  assert.match(text, /PROBLEMS/);
  assert.match(text, /DECISION SIGNALS/);
  assert.match(text, /action surface: click=r1 type=r2 select= read=/);
  assert.doesNotMatch(text, /"visibility":"visible"/);
  assert.doesNotMatch(text, /"actionability":"ready"/);
});
