import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompactShadowInput } from '../../../src/v2/planner/CompactShadowInput';
import type { CompactPlannerView } from '../../../src/v2/planner/CompactPlannerView';
import type { PlannerOutput } from '../../../src/v2/planner/types';

test('buildCompactShadowInput maps action and read indexes in order', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test goal',
    actions: [
      { id: 1, refId: 'ref_btn', label: 'Button', tools: ['clickable'] },
      { id: 2, refId: 'ref_input', label: 'Input', tools: ['typeable'] },
    ],
    reads: [
      { id: 1, refId: 'ref_read1', text: 'Some text' },
      { id: 2, refId: 'ref_read2', text: 'More text' },
    ],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  const result = buildCompactShadowInput(view);
  const { input, indexToRef, refToIndex } = result;

  assert.equal(input.version, 'compact_shadow_input.v1');
  assert.equal(input.goal, 'test goal');

  // Verify action indexes are a1, a2
  assert.equal(input.actions.length, 2);
  assert.equal(input.actions[0].index, 'a1');
  assert.equal(input.actions[1].index, 'a2');
  assert.equal(input.actions[0].label, 'Button');

  // Verify read indexes are r1, r2
  assert.equal(input.reads.length, 2);
  assert.equal(input.reads[0].index, 'r1');
  assert.equal(input.reads[1].index, 'r2');
  assert.equal(input.reads[0].text, 'Some text');

  // Verify tool mappings
  assert.deepEqual(input.actions[0].tools, ['click']);
  assert.deepEqual(input.actions[1].tools, ['type']);
  
  // Verify reads tools
  assert.deepEqual(input.reads[0].tools, ['get', 'inspect_region']);
  assert.deepEqual(input.reads[1].tools, ['get', 'inspect_region']);

  // Verify indexes mapping
  assert.equal(indexToRef['a1'], 'ref_btn');
  assert.equal(indexToRef['a2'], 'ref_input');
  assert.equal(indexToRef['r1'], 'ref_read1');
  assert.equal(indexToRef['r2'], 'ref_read2');

  assert.equal(refToIndex['ref_btn'], 'a1');
  assert.equal(refToIndex['ref_input'], 'a2');
  assert.equal(refToIndex['ref_read1'], 'r1');
  assert.equal(refToIndex['ref_read2'], 'r2');
});

test('if a ref appears in actions and reads, keep action index and do not duplicate in reads', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [
      { id: 1, refId: 'ref_shared', label: 'Shared element', tools: ['clickable', 'readable'] },
    ],
    reads: [
      { id: 1, refId: 'ref_shared', text: 'Shared element text' },
      { id: 2, refId: 'ref_unique_read', text: 'Unique read' },
    ],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  const result = buildCompactShadowInput(view);
  const { input, indexToRef, refToIndex } = result;

  // actions should have ref_shared as a1
  assert.equal(input.actions.length, 1);
  assert.equal(input.actions[0].index, 'a1');
  assert.equal(indexToRef['a1'], 'ref_shared');

  // reads should NOT have ref_shared because it's already in actions.
  // It should only have ref_unique_read as r1
  assert.equal(input.reads.length, 1);
  assert.equal(input.reads[0].index, 'r1');
  assert.equal(indexToRef['r1'], 'ref_unique_read');

  // refToIndex should map the shared ref to 'a1' (action index)
  assert.equal(refToIndex['ref_shared'], 'a1');
  assert.equal(refToIndex['ref_unique_read'], 'r1');
});

test('tool mapping covers clickable -> click, typeable -> type, selectable -> select, readable -> get, sorted and deduped', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [
      { id: 1, refId: 'ref_1', label: 'El 1', tools: ['clickable', 'typeable', 'clickable'] },
      { id: 2, refId: 'ref_2', label: 'El 2', tools: ['selectable', 'readable'] },
      { id: 3, refId: 'ref_3', label: 'El 3', tools: ['unknown_tool'] },
    ],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  const { input } = buildCompactShadowInput(view);
  assert.deepEqual(input.actions[0].tools, ['click', 'type']); // sorted, deduped
  assert.deepEqual(input.actions[1].tools, ['get', 'select']); // sorted, deduped
  assert.equal(input.actions.length, 2); // unknown tools are not exposed as action indexes
});

test('buildCompactShadowInput excludes get-only action entries from action indexes', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'Read place details',
    actions: [
      { id: 1, refId: 'ref_readonly', label: 'Castle Mountains National Monument details', tools: ['readable'] },
      { id: 2, refId: 'ref_button', label: 'Search', tools: ['clickable'] },
    ],
    reads: [
      { id: 1, refId: 'ref_readonly', text: 'Castle Mountains National Monument 4.4 National reserve Open 24 hours' },
    ],
    lanes: {
      typeable: [],
      clickable: [{ id: 2, refId: 'ref_button', label: 'Search', tools: ['clickable'] }],
      selectable: [],
      readable: [{ id: 1, refId: 'ref_readonly', text: 'Castle Mountains National Monument 4.4 National reserve Open 24 hours' }],
    },
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  const { input, indexToRef, refToIndex } = buildCompactShadowInput(view);

  assert.deepEqual(input.actions.map(action => action.index), ['a1']);
  assert.equal(indexToRef.a1, 'ref_button');
  assert.equal(input.reads[0].index, 'r1');
  assert.equal(indexToRef.r1, 'ref_readonly');
  assert.equal(refToIndex.ref_readonly, 'r1');
});

test('eligibility: action episode is eligible when productionOutput.plan[0].ref exists in refToIndex', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [{ id: 1, refId: 'ref_target', label: 'Target', tools: ['clickable'] }],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };
  const prodOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_target' }],
    confidence: 'high',
  };

  const { eligibility } = buildCompactShadowInput(view, prodOutput);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.productionFirstRef, 'ref_target');
  assert.equal(eligibility.missingProductionFirstRef, undefined);
  assert.deepEqual(eligibility.productionPlanRefs, ['ref_target']);
  assert.deepEqual(eligibility.missingProductionPlanRefs, []);
  assert.equal(eligibility.productionFirstStepKind, 'ref_action');
});

test('eligibility: action episode is ineligible when productionOutput.plan[0].ref is missing from refToIndex', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [{ id: 1, refId: 'ref_target', label: 'Target', tools: ['clickable'] }],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };
  const prodOutput: PlannerOutput = {
    plan: [{ tool: 'click', ref: 'ref_missing' }],
    confidence: 'high',
  };

  const { eligibility } = buildCompactShadowInput(view, prodOutput);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.productionFirstRef, undefined);
  assert.equal(eligibility.missingProductionFirstRef, 'ref_missing');
  assert.deepEqual(eligibility.productionPlanRefs, ['ref_missing']);
  assert.deepEqual(eligibility.missingProductionPlanRefs, ['ref_missing']);
  assert.equal(eligibility.productionFirstStepKind, 'ref_action');
});

test('eligibility: done or escalate production output is eligible with no required first ref', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  // Case 1: done
  const prodOutputDone: PlannerOutput = {
    done: true,
    val: 'Finished',
  };
  const resDone = buildCompactShadowInput(view, prodOutputDone);
  assert.equal(resDone.eligibility.eligible, true);
  assert.equal(resDone.eligibility.productionFirstRef, undefined);
  assert.equal(resDone.eligibility.missingProductionFirstRef, undefined);
  assert.equal(resDone.eligibility.productionFirstStepKind, 'termination');

  // Case 2: escalate
  const prodOutputEscalate: PlannerOutput = {
    escalate: 'user_needed',
    reason: 'Cannot find button',
  };
  const resEscalate = buildCompactShadowInput(view, prodOutputEscalate);
  assert.equal(resEscalate.eligibility.eligible, true);
  assert.equal(resEscalate.eligibility.productionFirstRef, undefined);
  assert.equal(resEscalate.eligibility.missingProductionFirstRef, undefined);
  assert.equal(resEscalate.eligibility.productionFirstStepKind, 'termination');
});

test('eligibility: missing refs from later steps are recorded in missingProductionPlanRefs but do not block first-decision eligibility', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [{ id: 1, refId: 'ref_first', label: 'First', tools: ['clickable'] }],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };
  const prodOutput: PlannerOutput = {
    plan: [
      { tool: 'click', ref: 'ref_first' },
      { tool: 'type', ref: 'ref_later_missing', value: 'hello' },
    ],
  };

  const { eligibility } = buildCompactShadowInput(view, prodOutput);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.productionFirstRef, 'ref_first');
  assert.equal(eligibility.missingProductionFirstRef, undefined);
  assert.deepEqual(eligibility.productionPlanRefs, ['ref_first', 'ref_later_missing']);
  assert.deepEqual(eligibility.missingProductionPlanRefs, ['ref_later_missing']);
  assert.equal(eligibility.productionFirstStepKind, 'ref_action');
});

test('eligibility: action episode with ref-less first step (e.g. navigate) is eligible', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };
  const prodOutput: PlannerOutput = {
    plan: [{ tool: 'navigate', url: 'https://example.com' }],
    confidence: 'high',
  };

  const { eligibility } = buildCompactShadowInput(view, prodOutput);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.productionFirstRef, undefined);
  assert.equal(eligibility.missingProductionFirstRef, undefined);
  assert.equal(eligibility.productionFirstStepKind, 'no_ref_action');
});

test('eligibility: default empty / undefined production output plans', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'test',
    actions: [],
    reads: [],
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };
  const { eligibility } = buildCompactShadowInput(view);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.productionFirstStepKind, 'empty');
});
