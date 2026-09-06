import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import type { PlannerInput } from '../../../../src/v2/planner/types';

// PlannerRepresentationCompiler is not yet implemented (Task 2).
// These tests are expected to fail with MODULE_NOT_FOUND until Task 2 is complete.

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
      deltaRefs: { appeared: [], changed: [] },
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

test('PRC compiler keeps selected refs visible when collapsing large regions', () => {
  const input = makeInput();
  const refs = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => {
      const refId = `v2ref_${index + 1}`;
      return [refId, {
        refId,
        kind: 'link',
        role: 'link',
        name: `Region item ${index + 1}`,
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        confidence: 1,
        score: index === 9 ? 115 : 80,
      }];
    }),
  ) as PlannerInput['current']['refs'];

  input.current.refs = refs;
  input.current.interactions = Object.keys(refs).map((refId, index) => ({ refId, rank: index + 1 }));
  input.current.regions = [{
    regionId: 'region_large',
    kind: 'repeated_list',
    label: 'Large Region',
    refIds: Object.keys(refs),
    score: 80,
  }];
  input.workingSet!.primaryRefs = [{
    refId: 'v2ref_10',
    kind: 'link',
    name: 'Region item 10',
    score: 115,
    reasons: ['goal_keyword_match'],
  }];

  const ir = new PlannerRepresentationCompiler().compile(input);
  const visibleRefIds = ir.surface.groups.flatMap(group => group.elements.map(element => element.refId));

  assert.ok(visibleRefIds.includes('v2ref_10'), 'selected primary ref must remain visible in collapsed region');
});

test('PRC compiler compiles tools attribute for interaction lane ref which is only readable', () => {
  const input = makeInput();
  // v2ref_1 is in interactions lane (from makeInput), but actionSurface says it's only readable
  input.workingSet!.actionSurface = {
    clickableRefs: [],
    typeableRefs: [],
    selectableRefs: [],
    readableRefs: ['v2ref_1'],
    ambiguousRefs: [],
  };

  const ir = new PlannerRepresentationCompiler().compile(input);
  const el = ir.surface.groups.flatMap(group => group.elements).find(e => e.refId === 'v2ref_1');
  assert.equal(el?.lane, 'interaction');
  assert.deepEqual(el?.tools, ['r']);
});

test('PRC compiler compiles tools attribute based on actionSurface compatibility options', () => {
  const input = makeInput();
  input.workingSet!.actionSurface = {
    clickableRefs: ['v2ref_1'],
    typeableRefs: ['v2ref_1'],
    selectableRefs: [],
    readableRefs: ['v2ref_1'],
    ambiguousRefs: ['v2ref_1'],
  };

  const ir = new PlannerRepresentationCompiler().compile(input);
  const el = ir.surface.groups.flatMap(group => group.elements).find(e => e.refId === 'v2ref_1');
  assert.deepEqual(el?.tools, ['c', 't', 'r', 'a']);
});

test('PRC compiler preserves working-set evidence, changes, quarantine, and regions', () => {
  const input = makeInput();
  input.workingSet!.readableEvidence = [{
    refId: 'v2ref_1',
    text: 'readable sentinel',
    reasons: ['answer_candidate'],
  }];
  input.workingSet!.changedRefs = {
    appearedCount: 1,
    weakenedCount: 2,
    preservedCount: 3,
    topRefs: [input.workingSet!.primaryRefs[0]],
    omittedCount: 4,
  };
  input.workingSet!.quarantinedActions = [{
    refId: 'v2ref_2',
    tool: 'get',
    failureKind: 'same_value',
    retryable: false,
    persistence: 'persistent',
  }];

  const ir = new PlannerRepresentationCompiler().compile(input);
  assert.deepEqual(ir.workingSet?.readableEvidence, input.workingSet!.readableEvidence);
  assert.deepEqual(ir.workingSet?.changedRefs, input.workingSet!.changedRefs);
  assert.deepEqual(ir.workingSet?.quarantinedActions, input.workingSet!.quarantinedActions);
  assert.deepEqual(ir.workingSet?.regionSummaries, input.workingSet!.regionSummaries);
});


test('PRC compiler stable order (O1): region members, groups, and remainder sort by numeric refId', () => {
  const input = makeInput();
  // Insertion order deliberately differs from refNum order everywhere.
  input.current.refs = {
    v2ref_9: {
      refId: 'v2ref_9', kind: 'link', role: 'link', name: 'Znav late',
      visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 10,
    },
    v2ref_5: {
      refId: 'v2ref_5', kind: 'button', role: 'button', name: 'Mid readable',
      visibility: 'visible', actionability: 'ready', state: 'live', confidence: 1, score: 10,
    },
    v2ref_3: input.current.refs['v2ref_3']!,
    v2ref_1: input.current.refs['v2ref_1']!,
    v2ref_2: input.current.refs['v2ref_2']!,
  };
  input.current.interactions = [...input.current.interactions].reverse();
  input.current.readables = [{ refId: 'v2ref_5', rank: 1 }];
  input.current.navigation = [{ refId: 'v2ref_9', rank: 1 }];
  input.current.regions = [
    { regionId: 'region_nav_1', kind: 'navigation', label: 'Nav Region', refIds: ['v2ref_9'], score: 10 },
    { ...input.current.regions[0]!, refIds: ['v2ref_3', 'v2ref_1', 'v2ref_2'] },
  ];
  input.current.stats = { interactionCount: 3, readableCount: 1, navigationCount: 1, regionCount: 2 };

  const on = new PlannerRepresentationCompiler().compile(input, { stableOrder: true });

  // Region members render in refNum order, not the listed (3,1,2) order.
  const formGroup = on.surface.groups.find(g => g.regionId === 'region_form_1')!;
  assert.deepEqual(formGroup.elements.map(e => e.refId), ['v2ref_1', 'v2ref_2', 'v2ref_3']);
  // Groups sort by their min member refNum (form=1 before nav=9 despite listing order).
  assert.deepEqual(on.surface.groups.map(g => g.regionId), ['region_form_1', 'region_nav_1']);
  // Remainder sorts by refNum (v2ref_5 before the later-numbered v2ref_9... nav ref is grouped,
  // so remainder holds only ungrouped refs; v2ref_5 stays first regardless of insertion order).
  assert.equal(on.surface.remainder.some(e => e.refId === 'v2ref_5'), true);

  // Off-path: default compile keeps the current insertion-order behavior (region listed first
  // stays first; region members keep listed order).
  const off = new PlannerRepresentationCompiler().compile(input);
  assert.deepEqual(off.surface.groups.map(g => g.regionId), ['region_nav_1', 'region_form_1']);
  const offForm = off.surface.groups.find(g => g.regionId === 'region_form_1')!;
  assert.deepEqual(offForm.elements.map(e => e.refId), ['v2ref_3', 'v2ref_1', 'v2ref_2']);
});
