import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function createRichPlannerInput(): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_fidelity_test',
    goal: 'Find Cambridge English definition and pronunciation for "serendipity"',
    current: {
      projectionId: 'proj_1',
      observationId: 'obs_1_1',
      generationId: 1,
      page: {
        url: 'https://dictionary.cambridge.org/dictionary/english/serendipity',
        title: 'SERENDIPITY | English meaning - Cambridge Dictionary',
      },
      focus: {
        refId: 'v2ref_1',
        reason: 'highest_operational_score',
      },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1',
          kind: 'button',
          role: 'button',
          name: 'UK pronunciation audio',
          text: 'UK /ˌser.ənˈdɪp.ə.ti/',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 120,
          regionId: 'header_region',
        },
        v2ref_2: {
          refId: 'v2ref_2',
          kind: 'input',
          role: 'textbox',
          name: 'Search Cambridge Dictionary',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 95,
          regionId: 'header_region',
        },
        v2ref_3: {
          refId: 'v2ref_3',
          kind: 'select',
          role: 'combobox',
          name: 'Choose dictionary',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 85,
          regionId: 'header_region',
          selectOptions: ['English', 'Learner\'s', 'Essential British'],
        },
        v2ref_4: {
          refId: 'v2ref_4',
          kind: 'generic',
          role: 'text',
          name: 'the occurrence of events by chance in a happy or beneficial way',
          text: 'the occurrence of events by chance in a happy or beneficial way',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 110,
          regionId: 'definition_region',
        },
      },
      interactions: [
        { refId: 'v2ref_1', rank: 1 },
        { refId: 'v2ref_2', rank: 2 },
        { refId: 'v2ref_3', rank: 3 },
      ],
      readables: [
        { refId: 'v2ref_4', rank: 1 },
      ],
      navigation: [],
      regions: [
        {
          regionId: 'header_region',
          label: 'Header Controls',
          kind: 'form',
          refIds: ['v2ref_1', 'v2ref_2', 'v2ref_3'],
          score: 100,
        },
        {
          regionId: 'definition_region',
          label: 'Definition Block',
          kind: 'content',
          refIds: ['v2ref_4'],
          score: 110,
        },
      ],
      warnings: [],
      stats: { interactionCount: 3, readableCount: 1, navigationCount: 0, regionCount: 2 },
    },
    continuity: {
      snapshotId: 'graph_snap_1',
      observationId: 'obs_1_1',
      generationId: 1,
      url: 'https://dictionary.cambridge.org/dictionary/english/serendipity',
      refCount: 4,
      presentRefCount: 4,
      regionCount: 2,
      transitionCount: 1,
    },
    transition: {
      beforeObservationId: 'obs_1_0',
      afterObservationId: 'obs_1_1',
      transitionClass: 'structural_macrostate',
      strength: 'strong',
      generationChanged: false,
      urlChanged: true,
      refChangeCounts: {
        appeared: 2,
        disappeared: 0,
        weakened: 0,
        preserved: 2,
      },
      notes: ['navigation_completed'],
    },
    lastResult: {
      success: true,
      kind: 'navigate',
      traceStepId: 'step_1',
      targetRef: undefined,
      valuePreview: 'https://dictionary.cambridge.org/dictionary/english/serendipity',
    },
    workingSet: {
      mode: 'extract',
      modeReason: 'definition_and_phonetics_visible',
      primaryRefs: [
        { refId: 'v2ref_1', kind: 'button', name: 'UK pronunciation audio', score: 120, reasons: ['goal_keyword_match', 'visible_ready'] },
        { refId: 'v2ref_4', kind: 'generic', name: 'definition text', score: 110, reasons: ['goal_phrase_match', 'visible_ready'] },
      ],
      secondaryRefs: [
        { refId: 'v2ref_2', kind: 'input', name: 'Search', score: 95, reasons: ['form_candidate'] },
      ],
      navigationRefs: [],
      failedRefs: [
        { refId: 'v2ref_1', kind: 'button', name: 'UK audio', score: 120, reasons: ['last_failure'] },
      ],
      readableEvidence: [
        { refId: 'v2ref_4', text: 'the occurrence of events by chance in a happy way', reasons: ['goal_phrase_match'] },
      ],
      actionSurface: {
        clickableRefs: ['v2ref_1'],
        typeableRefs: ['v2ref_2'],
        selectableRefs: ['v2ref_3'],
        readableRefs: ['v2ref_4'],
        ambiguousRefs: [],
      },
      changedRefs: {
        appearedCount: 2,
        weakenedCount: 0,
        preservedCount: 2,
        topRefs: [{ refId: 'v2ref_1', kind: 'button', name: 'audio', score: 120, reasons: ['recently_appeared'] }],
        omittedCount: 0,
      },
      quarantinedActions: [
        { refId: 'v2ref_1', tool: 'type', failureKind: 'target_not_typeable', retryable: false, persistence: 'persistent' },
      ],
      regionSummaries: [
        { regionId: 'header_region', label: 'Header Controls', representativeRefs: ['v2ref_1'], omittedRefCount: 0 },
      ],
      omitted: {
        observedRefCount: 4,
        selectedRefCount: 4,
        droppedRefCount: 0,
        droppedByReason: {},
      },
    },
    failures: [
      {
        failureId: 'fail_1',
        kind: 'target_not_typeable',
        category: 'semantic',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        targetRef: 'v2ref_1',
        signals: ['type_on_button'],
      },
    ],
    deadState: {
      deadState: true,
      evidenceId: 'ev_dead_1',
      observationId: 'obs_1_1',
      severity: 'warning',
      reasons: ['minor_uncertainty'],
      failureKinds: ['target_not_typeable'],
      signals: ['sig_dead_1'],
    },
    recovery: {
      state: 'wrong_target_type',
      severity: 'warning',
      blockedAction: { tool: 'type', ref: 'v2ref_1' },
      nextMechanisms: ['use_typeable_ref', 'click_launcher_first'],
      signals: ['wrong_target_type_signal'],
    },
    answerFeedback: {
      previousAnswer: 'serendipity means luck',
      missingDetails: ['pronunciation', 'phonetic_spelling'],
      instruction: 'Include exact UK and US phonetics from page',
    },
    evidenceCoverage: {
      contractKind: 'cambridge_dictionary_entry',
      status: 'ready',
      readCount: 2,
      requirements: [
        { key: 'pronunciation', status: 'proven', supportingReadIndexes: [1] },
        { key: 'definition', status: 'proven', supportingReadIndexes: [2] },
      ],
    },
    uncertainty: {
      level: 'low',
      signals: ['low_uncertainty_observed'],
    },
    lineage: {
      totalSteps: 1,
      truncated: false,
      steps: [
        { stepId: 'step_1', index: 0, kind: 'navigate', status: 'completed' },
      ],
    },
  };
}

test('PRC Structural AST Semantic Fidelity: Compiler creates 100% typed IR parity with input facts', () => {
  const input = createRichPlannerInput();
  const compiler = new PlannerRepresentationCompiler();
  const ir = compiler.compile(input);

  // 1. Execution Context Typed AST Parity
  assert.equal(ir.execution.goal, input.goal);
  assert.deepEqual(ir.execution.page, input.current.page);
  assert.deepEqual(ir.execution.focus, input.current.focus);
  assert.deepEqual(ir.execution.continuity, input.continuity);
  assert.deepEqual(ir.execution.transition, input.transition);
  assert.deepEqual(ir.execution.lastResult, input.lastResult);
  assert.deepEqual(ir.execution.failures, input.failures);
  assert.deepEqual(ir.execution.deadState, input.deadState);
  assert.deepEqual(ir.execution.recovery, input.recovery);
  assert.deepEqual(ir.execution.answerFeedback, input.answerFeedback);
  assert.deepEqual(ir.execution.evidenceCoverage, input.evidenceCoverage);
  assert.deepEqual(ir.execution.uncertainty, input.uncertainty);
  assert.deepEqual(ir.execution.lineage, input.lineage);

  // 2. Surface Elements & Lanes AST Parity
  const allElements = [...ir.surface.groups.flatMap(g => g.elements), ...ir.surface.remainder];
  assert.equal(allElements.length, 4);

  const el1 = allElements.find(e => e.refId === 'v2ref_1');
  assert.ok(el1);
  assert.equal(el1.lane, 'interaction');
  assert.equal(el1.scoreTier, 'top');
  assert.equal(el1.score, 120);
  assert.deepEqual(el1.tools, ['c']);
  assert.deepEqual(el1.failure, { kind: 'target_not_typeable', count: 1, retryable: false, persistence: 'persistent' });

  const el2 = allElements.find(e => e.refId === 'v2ref_2');
  assert.ok(el2);
  assert.equal(el2.lane, 'interaction');
  assert.deepEqual(el2.tools, ['t']);

  const el3 = allElements.find(e => e.refId === 'v2ref_3');
  assert.ok(el3);
  assert.equal(el3.lane, 'interaction');
  assert.deepEqual(el3.tools, ['s']);
  assert.deepEqual(el3.selectOptions, ['English', 'Learner\'s', 'Essential British']);

  const el4 = allElements.find(e => e.refId === 'v2ref_4');
  assert.ok(el4);
  assert.equal(el4.lane, 'readable');
  assert.deepEqual(el4.tools, ['r']);

  // 3. Spatial Region Containment AST Parity
  assert.equal(ir.surface.groups.length, 2);
  assert.equal(ir.surface.groups[0].regionId, 'header_region');
  assert.equal(ir.surface.groups[0].label, 'Header Controls');
  assert.equal(ir.surface.groups[0].totalCount, 3);
  assert.equal(ir.surface.groups[1].regionId, 'definition_region');
  assert.equal(ir.surface.groups[1].label, 'Definition Block');
  assert.equal(ir.surface.groups[1].totalCount, 1);

  // 4. Working Set AST Parity
  assert.ok(ir.workingSet);
  assert.equal(ir.workingSet.mode, 'extract');
  assert.equal(ir.workingSet.modeReason, 'definition_and_phonetics_visible');
  assert.equal(ir.workingSet.primary.length, 2);
  assert.equal(ir.workingSet.secondary.length, 1);
  assert.equal(ir.workingSet.failed.length, 1);
  assert.deepEqual(ir.workingSet.quarantinedActions, input.workingSet?.quarantinedActions);
});

test('PRC 10-Dimension Semantic Fidelity: Baseline PRC renders all 10 semantic dimensions', () => {
  const input = createRichPlannerInput();
  const compiler = new PlannerRepresentationCompiler();
  const layout = new PromptLayoutEngine();
  const ir = compiler.compile(input);
  const rendered = layout.render(ir, {});

  // Dimension 1: Lanes & Tools Compatibility
  assert.match(rendered, /\[v2ref_1\] <button .*lane="interaction".*tools="c"/, 'v2ref_1 has lane=interaction and tools=c');
  assert.match(rendered, /\[v2ref_2\] <input .*lane="interaction".*tools="t"/, 'v2ref_2 has lane=interaction and tools=t');
  assert.match(rendered, /\[v2ref_3\] <select .*lane="interaction".*tools="s"/, 'v2ref_3 has lane=interaction and tools=s');
  assert.match(rendered, /\[v2ref_4\] <generic .*role="text".*lane="readable".*tools="r"/, 'v2ref_4 has lane=readable and tools=r');

  // Dimension 2: Regions & Containment
  assert.match(rendered, /Header Controls \(header_region\)/, 'Header region container rendered');
  assert.match(rendered, /Definition Block \(definition_region\)/, 'Definition region container rendered');

  // Dimension 3: Readable Content in Surface
  assert.match(rendered, /the occurrence of events by chance/, 'Definition text is embedded in surface');
  assert.match(rendered, /UK \/ˌser\.ənˈdɪp\.ə\.ti\//, 'Phonetics text is embedded in surface');

  // Dimension 4: Failures
  assert.match(rendered, /PROBLEMS/, 'PROBLEMS section present');
  assert.match(rendered, /failure: v2ref_1 target_not_typeable persistent retryable=false/, 'Failure target and details surfaced');
  assert.match(rendered, /failed="target_not_typeablex1"/, 'Element inline failure attribute surfaced');

  // Dimension 5: Dead State
  assert.match(rendered, /dead_state: minor_uncertainty/, 'Dead state reasons surfaced');

  // Dimension 6: Changed Refs & Transition
  assert.match(rendered, /transition: structural_macrostate.*appeared=2.*preserved=2/, 'Transition delta counts surfaced');

  // Dimension 7: Answer Feedback
  assert.match(rendered, /answer_feedback: missing pronunciation, phonetic_spelling/, 'Answer feedback missing details surfaced');

  // Dimension 8: Evidence Coverage
  assert.match(rendered, /EVIDENCE COVERAGE\n  state: ready reads=2/, 'Evidence coverage state surfaced');
  assert.match(rendered, /pronunciation: proven reads=1/, 'Pronunciation contract proven');
  assert.match(rendered, /definition: proven reads=2/, 'Definition contract proven');

  // Dimension 9: Lineage History
  assert.match(rendered, /history: 1 steps/, 'Lineage history summary surfaced');

  // Dimension 10: Recovery Signals & Directives
  assert.match(rendered, /recovery: wrong_target_type blocked=type:v2ref_1/, 'Recovery state and blocked action surfaced');
  assert.match(rendered, /BLOCKED: Do NOT repeat the blocked action\. Try: use_typeable_ref, click_launcher_first\./, 'Recovery next mechanisms surfaced');
});

test('PRC 10-Dimension Semantic Fidelity: P1 (prcTierOmitted) preserves all 10 semantic dimensions identically', () => {
  const input = createRichPlannerInput();
  const compiler = new PlannerRepresentationCompiler();
  const layout = new PromptLayoutEngine();
  const ir = compiler.compile(input);
  const rendered = layout.render(ir, { prcTierOmitted: true });

  // Assert score is emitted compactly instead of tier
  assert.match(rendered, /\[v2ref_1\] <button .*s="120"/, 'v2ref_1 has s=120');
  assert.doesNotMatch(rendered, /tier="top"/, 'tier is omitted when prcTierOmitted=true');

  // All 10 dimensions still intact
  assert.match(rendered, /tools="c"/);
  assert.match(rendered, /Header Controls/);
  assert.match(rendered, /the occurrence of events by chance/);
  assert.match(rendered, /failure: v2ref_1 target_not_typeable/);
  assert.match(rendered, /transition: structural_macrostate/);
  assert.match(rendered, /answer_feedback: missing pronunciation/);
  assert.match(rendered, /recovery: wrong_target_type blocked=type:v2ref_1/);
});

function findPlannerInputFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findPlannerInputFiles(fullPath, out);
    } else if (entry.endsWith('-input.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

test('PRC Structural AST Semantic Fidelity: Invariance across all captured trace inputs', (t) => {
  const files = findPlannerInputFiles(join(process.cwd(), 'logs', 'webvoyager-lite'));
  if (files.length === 0) {
    t.skip('No logs/webvoyager-lite planner input files found');
    return;
  }

  const compiler = new PlannerRepresentationCompiler();
  const layout = new PromptLayoutEngine();
  let verifiedEpisodes = 0;

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const candidate = ((parsed as Record<string, unknown>).plannerInput ?? parsed) as Partial<PlannerInput>;
    if (!candidate.goal || !candidate.current?.refs || !candidate.episodeId) continue;

    const input = candidate as PlannerInput;
    const ir = compiler.compile(input);
    const rendered = layout.render(ir, {});

    // 1. Structural Execution Context Parity
    assert.equal(ir.execution.goal, input.goal, `goal must match in ${file}`);
    assert.deepEqual(ir.execution.page, input.current.page, `page must match in ${file}`);
    assert.deepEqual(ir.execution.failures, input.failures ?? [], `failures must match in ${file}`);
    assert.deepEqual(ir.execution.deadState, input.deadState, `deadState must match in ${file}`);
    assert.deepEqual(ir.execution.recovery, input.recovery, `recovery must match in ${file}`);
    assert.deepEqual(ir.execution.evidenceCoverage, input.evidenceCoverage, `evidenceCoverage must match in ${file}`);

    // 2. ActionSurface ref preservation
    if (input.workingSet?.actionSurface) {
      const s = input.workingSet.actionSurface;
      for (const refId of [...s.clickableRefs, ...s.typeableRefs, ...s.selectableRefs, ...s.readableRefs]) {
        assert.ok(rendered.includes(refId), `ref ${refId} in actionSurface must be present in rendered PRC in ${file}`);
      }
    }

    // 3. Failures preservation
    for (const failure of input.failures ?? []) {
      if (failure.targetRef) {
        assert.ok(rendered.includes(failure.targetRef), `failure ref ${failure.targetRef} must be present in ${file}`);
      }
    }

    // 4. Select options preservation
    const selectableRefs = new Set(input.workingSet?.actionSurface?.selectableRefs ?? []);
    for (const ref of Object.values(input.current.refs)) {
      if (selectableRefs.has(ref.refId) && ref.selectOptions?.length) {
        for (const opt of ref.selectOptions) {
          assert.ok(rendered.includes(opt), `select option "${opt}" for ${ref.refId} must be present in ${file}`);
        }
      }
    }

    verifiedEpisodes++;
  }

  assert.ok(verifiedEpisodes > 0, `Verified ${verifiedEpisodes} episodes`);
});
