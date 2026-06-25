import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function makeInput(): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'ep_prc_1',
    goal: 'Search quantum computing',
    current: {
      projectionId: 'proj_1',
      observationId: 'obs_1',
      generationId: 1,
      page: { url: 'https://example.test', title: 'Example' },
      focus: { refId: 'v2ref_1', reason: 'highest_operational_score' },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1',
          kind: 'input',
          role: 'textbox',
          name: 'Search term',
          text: 'Search term',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 115,
          selectOptions: undefined,
        },
        v2ref_2: {
          refId: 'v2ref_2',
          kind: 'select',
          role: 'combobox',
          name: 'Field',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 115,
          selectOptions: ['All fields', 'Title', 'Author', 'Abstract'],
        },
        v2ref_3: {
          refId: 'v2ref_3',
          kind: 'button',
          role: 'button',
          name: 'Search',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 90,
        },
      },
      interactions: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }, { refId: 'v2ref_3', rank: 3 }],
      readables: [],
      navigation: [],
      regions: [{ regionId: 'region_form_1', kind: 'form', label: 'Search Form', refIds: ['v2ref_1', 'v2ref_2', 'v2ref_3'], score: 115 }],
      warnings: [],
      stats: { interactionCount: 3, readableCount: 0, navigationCount: 0, regionCount: 1 },
    },
    workingSet: {
      mode: 'act',
      modeReason: 'initial',
      primaryRefs: [{ refId: 'v2ref_1', kind: 'input', name: 'Search term', score: 115, reasons: ['goal_keyword_match', 'visible_ready'] }],
      secondaryRefs: [{ refId: 'v2ref_2', kind: 'select', name: 'Field', score: 115, reasons: ['form_candidate'] }],
      readableEvidence: [],
      navigationRefs: [],
      actionSurface: { clickableRefs: ['v2ref_3'], typeableRefs: ['v2ref_1'], selectableRefs: ['v2ref_2'], readableRefs: [], ambiguousRefs: [] },
      changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 3, topRefs: [], omittedCount: 0 },
      failedRefs: [],
      quarantinedActions: [],
      regionSummaries: [{ regionId: 'region_form_1', label: 'Search Form', representativeRefs: ['v2ref_1', 'v2ref_2', 'v2ref_3'], omittedRefCount: 0 }],
      omitted: { observedRefCount: 3, selectedRefCount: 3, droppedRefCount: 0, droppedByReason: {} },
    },
    uncertainty: { level: 'none', signals: [] },
  };
}

test('PRC compiler resolves lane rank entries through current.refs', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const elements = ir.surface.groups.flatMap(group => group.elements);
  assert.equal(elements.length, 3);
  assert.equal(elements.find(el => el.refId === 'v2ref_1')?.name, 'Search term');
  assert.equal(elements.find(el => el.refId === 'v2ref_1')?.lane, 'interaction');
});

test('PRC compiler preserves selectOptions as full array', () => {
  const ir = new PlannerRepresentationCompiler().compile(makeInput());
  const select = ir.surface.groups.flatMap(group => group.elements).find(el => el.refId === 'v2ref_2');
  assert.deepEqual(select?.selectOptions, ['All fields', 'Title', 'Author', 'Abstract']);
});
