import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompactPlannerView,
  measureCompactPlannerView,
  buildPlainInteractiveSnapshotBaseline,
  evaluateCompactPlannerCoverage,
} from '../../../src/v2/planner/CompactPlannerView';

test('buildCompactPlannerView keeps compact actions and readable evidence', () => {
  const input = {
    episodeId: 'episode_1',
    goal: 'Find the latest preprints',
    continuity: { url: 'https://arxiv.org/search/advanced' },
    current: {
      refs: {
        r1: { kind: 'input', role: 'textbox', name: 'Search term' },
        r2: { kind: 'button', role: 'button', name: 'Search' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [{ refId: 'r1', kind: 'input', name: 'Search term' }, { refId: 'r2', kind: 'button', name: 'Search' }],
      secondaryRefs: [],
      readableEvidence: [{ refId: 'r3', text: 'Quantum element-wise transforms arXiv:2606.06456' }],
      actionSurface: { typeableRefs: ['r1'], clickableRefs: ['r2'], readableRefs: ['r3'] },
    },
  };

  const view = buildCompactPlannerView(input as any);
  assert.equal(view.actions.length, 2);
  assert.equal(view.reads.length, 1);
  assert.equal(view.actions[0].tools.includes('typeable'), true);
  assert.equal(view.omitted.originalCurrentRefs, 2);
});

test('buildCompactPlannerView preserves visible typeable search inputs ahead of distractors', () => {
  const distractors = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `ref_distractor_${index}`,
      { refId: `ref_distractor_${index}`, kind: 'button', role: 'button', name: `Dictionary distractor ${index}` },
    ]),
  );
  const input = {
    episodeId: 'episode_cambridge_failure',
    goal: 'Look up the pronunciation and definition of sustainability',
    current: {
      refs: {
        ...distractors,
        ref_search: {
          refId: 'ref_search',
          kind: 'input',
          role: 'textbox',
          name: 'Search',
          tagName: 'input',
          inputType: 'text',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
        },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: Object.values(distractors).slice(0, 32),
      secondaryRefs: [
        ...Object.values(distractors).slice(32),
        { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search', score: 315, reasons: ['form_candidate', 'role_relevant_to_goal', 'visible_ready'] },
      ],
      readableEvidence: [],
      actionSurface: {
        clickableRefs: Object.keys(distractors),
        typeableRefs: ['ref_search'],
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: [],
      },
    },
  };

  const view = buildCompactPlannerView(input as any, { maxActions: 24 });

  assert.equal(view.lanes?.typeable.some(ref => ref.refId === 'ref_search'), true);
  assert.equal(view.actions.some(ref => ref.refId === 'ref_search'), true);
  assert.ok(view.actions.findIndex(ref => ref.refId === 'ref_search') < 8);
});

test('buildCompactPlannerView reserves typeable and selectable lanes when clickables are dense', () => {
  const clickableRefs = Array.from({ length: 30 }, (_, index) => ({
    refId: `ref_click_${index}`,
    kind: 'button',
    role: 'button',
    name: `Action ${index}`,
  }));
  const input = {
    episodeId: 'episode_dense_actions',
    goal: 'Compute the requested expression',
    current: {
      refs: Object.fromEntries([
        ...clickableRefs.map(ref => [ref.refId, ref]),
        ['ref_input', { refId: 'ref_input', kind: 'input', role: 'textbox', name: 'Expression input' }],
        ['ref_sort', { refId: 'ref_sort', kind: 'select', role: 'combobox', name: 'Sort results by' }],
      ]),
    },
    workingSet: {
      mode: 'act',
      primaryRefs: clickableRefs.slice(0, 24),
      secondaryRefs: [
        ...clickableRefs.slice(24),
        { refId: 'ref_input', kind: 'input', role: 'textbox', name: 'Expression input' },
        { refId: 'ref_sort', kind: 'select', role: 'combobox', name: 'Sort results by' },
      ],
      readableEvidence: [],
      actionSurface: {
        clickableRefs: [...clickableRefs.map(ref => ref.refId), 'ref_sort'],
        typeableRefs: ['ref_input'],
        selectableRefs: ['ref_sort'],
        readableRefs: [],
        ambiguousRefs: [],
      },
    },
  };

  const view = buildCompactPlannerView(input as any, { maxActions: 8 });

  assert.equal(view.actions.some(ref => ref.refId === 'ref_input'), true);
  assert.equal(view.actions.some(ref => ref.refId === 'ref_sort'), true);
  assert.ok(view.actions.findIndex(ref => ref.refId === 'ref_input') < 4);
});

test('measureCompactPlannerView reports compact/original ratio', () => {
  const input = {
    goal: 'x',
    current: { refs: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`r${index}`, { text: 'long text '.repeat(20) }])) },
    workingSet: { primaryRefs: [], secondaryRefs: [], readableEvidence: [], actionSurface: {} },
  };
  const view = buildCompactPlannerView(input as any);
  const stats = measureCompactPlannerView(input as any, view);
  assert.ok(stats.compactBytes < stats.originalBytes);
  assert.ok(stats.reductionRatio < 1);
});

test('custom options, truncation, deduplication, and empty object safety', () => {
  // 1. Verify custom options (maxActions, maxReads) are respected.
  const inputWithOptions = {
    goal: 'Find the latest preprints',
    current: {
      refs: {
        r1: { kind: 'input', role: 'textbox', name: 'Search term' },
        r2: { kind: 'button', role: 'button', name: 'Search' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [
        { refId: 'r1', kind: 'input', name: 'Search term' },
        { refId: 'r2', kind: 'button', name: 'Search' },
      ],
      secondaryRefs: [],
      readableEvidence: [
        { refId: 'r3', text: 'Text 1' },
        { refId: 'r4', text: 'Text 2' },
      ],
      actionSurface: {
        typeableRefs: ['r1'],
        clickableRefs: ['r2'],
        readableRefs: ['r3', 'r4'],
      },
    },
  };

  const viewWithOptions = buildCompactPlannerView(inputWithOptions as any, { maxActions: 1, maxReads: 1 });
  assert.equal(viewWithOptions.actions.length, 1);
  assert.equal(viewWithOptions.reads.length, 1);

  // 2. Verify truncation of long action labels (>180 characters) and long read text (>220 characters).
  const longActionLabel = 'a'.repeat(200);
  const longReadText = 'r'.repeat(250);

  const inputWithLongText = {
    goal: 'Test truncation',
    current: {
      refs: {
        r1: { kind: 'input', role: 'textbox', name: longActionLabel },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [
        { refId: 'r1', kind: 'input', name: longActionLabel },
      ],
      secondaryRefs: [],
      readableEvidence: [
        { refId: 'r2', text: longReadText },
      ],
      actionSurface: {
        typeableRefs: ['r1'],
        readableRefs: ['r2'],
      },
    },
  };

  const viewWithLongText = buildCompactPlannerView(inputWithLongText as any);
  
  assert.ok(viewWithLongText.actions[0].label.length <= 180);
  assert.ok(viewWithLongText.actions[0].label.endsWith('...'));
  
  assert.ok(viewWithLongText.reads[0].text.length <= 220);
  assert.ok(viewWithLongText.reads[0].text.endsWith('...'));

  // 3. Verify deduplication of identical string elements in the label components.
  const inputWithDuplicates = {
    goal: 'Test deduplication',
    current: {
      refs: {
        r1: { kind: 'input', role: 'textbox', name: 'Duplicate Name', text: 'Duplicate Name' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [
        { refId: 'r1', kind: 'input', name: 'Duplicate Name', text: 'Duplicate Name' },
      ],
      secondaryRefs: [],
      readableEvidence: [],
      actionSurface: {
        typeableRefs: ['r1'],
      },
    },
  };

  const viewWithDuplicates = buildCompactPlannerView(inputWithDuplicates as any);
  assert.equal(viewWithDuplicates.actions[0].label, 'Duplicate Name');

  // 4. Verify calling buildCompactPlannerView with empty object `{}` is safe and doesn't throw.
  assert.doesNotThrow(() => {
    const emptyView = buildCompactPlannerView({});
    assert.equal(emptyView.goal, '');
    assert.equal(emptyView.actions.length, 0);
    assert.equal(emptyView.reads.length, 0);
  });
});

test('compact planner view exposes baseline and planned-ref coverage without mutating planner input', () => {
  const input = {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_coverage',
    goal: 'Click submit',
    current: {
      refs: {
        ref_submit: { kind: 'button', role: 'button', name: 'Submit', text: 'Submit' },
        ref_cancel: { kind: 'button', role: 'button', name: 'Cancel', text: 'Cancel' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [{ refId: 'ref_submit', kind: 'button', name: 'Submit' }],
      secondaryRefs: [{ refId: 'ref_cancel', kind: 'button', name: 'Cancel' }],
      readableEvidence: [{ refId: 'ref_result', text: 'Result: ready' }],
      actionSurface: {
        clickableRefs: ['ref_submit', 'ref_cancel'],
        readableRefs: ['ref_result'],
      },
    },
    continuity: {
      snapshotId: 'graph_obs_1_1',
      observationId: 'obs_1',
      generationId: 1,
      url: 'https://example.test/form',
      refCount: 3,
      presentRefCount: 3,
      regionCount: 1,
      transitionCount: 0,
    },
    uncertainty: { level: 'none', signals: [] },
  };
  const before = JSON.stringify(input);

  const view = buildCompactPlannerView(input as any);
  const baseline = buildPlainInteractiveSnapshotBaseline(input as any);
  const coverage = evaluateCompactPlannerCoverage(view, {
    plan: [{ tool: 'click', ref: 'ref_submit' }],
    confidence: 'high',
  } as any);

  assert.equal(JSON.stringify(input), before);
  assert.equal(view.episodeId, 'episode_coverage');
  assert.equal(view.observationEpoch?.observationId, 'obs_1');
  assert.equal(view.actions.length, 2);
  assert.equal(view.reads.length, 1);
  assert.equal(baseline.refs.length, 2);
  assert.equal(coverage.plannedRefs.length, 1);
  assert.equal(coverage.actionRefCoverage, 1);
  assert.deepEqual(coverage.missingPlannedActionRefs, []);
});

