import assert from 'node:assert/strict';
import test from 'node:test';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import { buildV2PlannerUserMessage } from '../../../../src/v2/planner/PlannerPrompt';
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

test('PromptLayoutEngine exposes generic combobox protocol metadata in JSON and compact PRC', () => {
  const comboInput: PlannerInput = {
    ...input,
    current: {
      ...input.current,
      refs: {
        ...input.current.refs,
        r2: {
          ...input.current.refs.r2,
          role: 'combobox',
          value: 'Par',
          placeholder: 'Where are you going?',
          ariaAutocomplete: 'list',
          ariaHasPopup: 'listbox',
        },
      },
    },
  };
  const ir = new PlannerRepresentationCompiler().compile(comboInput);
  const engine = new PromptLayoutEngine();

  const expanded = engine.render(ir);
  assert.match(expanded, /aria-autocomplete="list"/);
  assert.match(expanded, /aria-haspopup="listbox"/);
  assert.match(expanded, /value="Par"/);
  assert.match(expanded, /placeholder="Where are you going\?"/);

  const compact = engine.render(ir, { compactDataPlane: true, prcTierOmitted: true });
  assert.match(compact, /ac=list/);
  assert.match(compact, /popup=listbox/);
  assert.match(compact, /value="Par"/);
  assert.match(compact, /ph="Where are you going\?"/);
});

test('P1 omits tier only when requested and preserves lane, remainder region, and refs', () => {
  const remainderInput: PlannerInput = {
    ...input,
    current: {
      ...input.current,
      refs: {
        ...input.current.refs,
        r3: {
          refId: 'r3',
          kind: 'generic',
          role: 'text',
          name: 'Remainder note',
          text: 'Remainder note',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 60,
          regionId: 'region_remainder',
        },
      },
      interactions: [...input.current.interactions, { refId: 'r3', rank: 3 }],
      regions: [],
      stats: { ...input.current.stats, interactionCount: 3, regionCount: 0 },
    },
  };

  const ir = new PlannerRepresentationCompiler().compile(remainderInput);
  const engine = new PromptLayoutEngine();
  const legacy = engine.render(ir);
  assert.equal(legacy, engine.render(ir, { prcTierOmitted: false }));
  assert.match(legacy, /\[r3\].*region="region_remainder"/);
  assert.match(legacy, /tier="/);
  assert.doesNotMatch(legacy, / s="/);

  const tierOmitted = engine.render(ir, { prcTierOmitted: true });
  assert.doesNotMatch(tierOmitted, /tier="/);
  assert.match(tierOmitted, /lane="/);
  assert.match(tierOmitted, /\[r3\].*region="region_remainder"/);
  assert.match(tierOmitted, /s="/);
  assert.equal((legacy.match(/\[r\d\]/g) ?? []).length, (tierOmitted.match(/\[r\d\]/g) ?? []).length);
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

test('PromptLayoutEngine renders enriched recovery with blockedAction and directive', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  // Inject a recovery state with blockedAction and nextMechanisms
  ir.execution.recovery = {
    state: 'repeated_read_same_value',
    severity: 'warning',
    blockedAction: { tool: 'get', ref: 'v2ref_308' },
    nextMechanisms: ['finalize_with_collected_evidence', 'try_different_ref'],
    signals: ['repeated_value_preview:get:v2ref_308:3'],
  };
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /recovery: repeated_read_same_value blocked=get:v2ref_308/);
  assert.match(text, /BLOCKED: Do NOT repeat the blocked action\. Try: finalize_with_collected_evidence, try_different_ref\./);
});

test('PromptLayoutEngine renders recovery without blockedAction when absent', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  ir.execution.recovery = {
    state: 'invalid_output_repeat',
    severity: 'critical',
    nextMechanisms: ['stop_dead_end_with_validation_evidence'],
    signals: ['invalid_output_repeat'],
  };
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /recovery: invalid_output_repeat/);
  assert.doesNotMatch(text, /blocked=/);
  assert.match(text, /BLOCKED: Do NOT repeat the blocked action\. Try: stop_dead_end_with_validation_evidence\./);
});

test('PromptLayoutEngine renders recovery with global ref as just tool name', () => {
  const ir = new PlannerRepresentationCompiler().compile(input);
  ir.execution.recovery = {
    state: 'zero_result_read_loop',
    severity: 'warning',
    blockedAction: { tool: 'search_page' },
    nextMechanisms: ['try_different_evidence_action'],
    signals: ['repeated_value_preview:search_page:global:3'],
  };
  const text = new PromptLayoutEngine().render(ir);
  assert.match(text, /recovery: zero_result_read_loop blocked=search_page:global/);
  assert.match(text, /BLOCKED: Do NOT/);
});

test('P3 compact data plane preserves control-plane evidence and action capabilities', () => {
  const denseRefs = Object.fromEntries(Array.from({ length: 60 }, (_, index) => {
    const refId = `dense-${index}`;
    return [refId, {
      refId,
      kind: 'button' as const,
      role: 'button',
      name: `Dense button ${index}`,
      visibility: 'visible' as const,
      actionability: 'ready' as const,
      state: 'live' as const,
      confidence: 1,
      score: 80,
    }];
  }));
  const compactInput: PlannerInput = {
    ...input,
    current: {
      ...input.current,
      refs: { ...input.current.refs, ...denseRefs },
      interactions: [
        ...input.current.interactions,
        ...Object.keys(denseRefs).map((refId, index) => ({ refId, rank: index + 3 })),
      ],
      stats: { ...input.current.stats, interactionCount: 32 },
    },
    failures: [
      ...(input.failures ?? []),
      {
        failureId: 'sentinel-failure',
        kind: 'sentinel_failure_kind',
        category: 'execution',
        severity: 'warning',
        persistence: 'persistent',
        retryable: false,
        targetRef: 'sentinel-failure-ref',
        signals: ['sentinel_failure_signal'],
      },
    ],
    deadState: {
      deadState: true,
      evidenceId: 'sentinel-dead-evidence',
      observationId: 'sentinel-dead-observation',
      severity: 'warning',
      reasons: ['sentinel_dead_reason'],
      failureKinds: ['sentinel_dead_failure'],
      signals: ['sentinel_dead_signal'],
    },
    answerFeedback: {
      previousAnswer: 'sentinel_previous_answer',
      missingDetails: ['sentinel_missing_detail'],
      instruction: 'sentinel_answer_instruction',
    },
    evidenceCoverage: {
      contractKind: 'sentinel_contract',
      status: 'incomplete',
      readCount: 17,
      requirements: [{
        key: 'concrete_basic_information',
        status: 'missing',
        supportingReadIndexes: [17, 18],
      }],
    },
    lineage: {
      totalSteps: 7,
      truncated: true,
      steps: [{
        stepId: 'sentinel-lineage-step',
        index: 6,
        kind: 'click',
        status: 'failed',
        targetRef: 'sentinel-lineage-ref',
        errorCode: 'sentinel-lineage-error',
      }],
    },
    workingSet: {
      ...input.workingSet!,
      actionSurface: {
        clickableRefs: ['r1', 'sentinel-unrendered-action-ref'],
        typeableRefs: ['r1'],
        selectableRefs: ['r1'],
        readableRefs: ['r1'],
        ambiguousRefs: ['r1'],
      },
      readableEvidence: [{
        refId: 'sentinel-readable-ref',
        text: 'sentinel_readable_text',
        reasons: ['answer_candidate'],
      }],
      changedRefs: {
        appearedCount: 23,
        weakenedCount: 4,
        preservedCount: 5,
        topRefs: [{
          refId: 'sentinel-changed-ref',
          kind: 'button',
          score: 90,
          reasons: ['recently_changed'],
        }],
        omittedCount: 2,
      },
      quarantinedActions: [{
        refId: 'sentinel-quarantine-ref',
        tool: 'sentinel-quarantine-tool',
        failureKind: 'sentinel-quarantine-failure',
        retryable: false,
        persistence: 'persistent',
      }],
      regionSummaries: [{
        regionId: 'sentinel-region',
        label: 'Sentinel region',
        representativeRefs: ['sentinel-region-ref'],
        omittedRefCount: 2,
      }],
    },
    recovery: {
      state: 'same_action_loop',
      severity: 'warning',
      blockedAction: { tool: 'click', ref: 'sentinel-blocked-ref' },
      nextMechanisms: ['sentinel_next_mechanism'],
      signals: ['sentinel_recovery_signal'],
    },
    lastResult: {
      success: false,
      kind: 'click',
      traceStepId: 'sentinel-last-step',
      targetRef: 'sentinel-last-ref',
      valuePreview: 'sentinel_last_value',
      error: { code: 'sentinel-last-error', retryable: false },
    },
    continuity: {
      snapshotId: 'sentinel-snapshot',
      observationId: 'sentinel-observation',
      generationId: 3,
      refCount: 2,
      presentRefCount: 2,
      regionCount: 1,
      transitionCount: 1,
    },
  };
  const ir = new PlannerRepresentationCompiler().compile(compactInput);
  const text = new PromptLayoutEngine().render(ir, {
    prcTierOmitted: true,
    compactDataPlane: true,
  });

  assert.match(text, /^S:/);
  assert.match(text, /LAST:/);
  assert.match(text, /EVIDENCE:.*@17,18/);
  assert.match(text, /tools="c,t,s,r,a"/);
  assert.doesNotMatch(text, /actions=c:r1/);
  assert.match(text, /actions=c:sentinel-unrendered-action-ref/);
  assert.match(text, /sentinel_failure_kind/);
  assert.match(text, /sentinel-quarantine-tool/);
  assert.match(text, /sentinel-changed-ref/);
  assert.match(text, /sentinel_readable_text/);
  assert.match(text, /sentinel_answer_instruction/);
  assert.match(text, /sentinel_dead_reason/);
  assert.match(text, /sentinel-lineage-error/);
  assert.match(text, /lineage=total=7/);
  assert.match(text, /sentinel-region/);

  const expanded = buildV2PlannerUserMessage(compactInput, {
    mode: 'prc',
    prcTierOmitted: true,
    compactDataPlane: false,
  });
  const compact = buildV2PlannerUserMessage(compactInput, {
    mode: 'prc',
    prcTierOmitted: true,
    compactDataPlane: true,
  });
  assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(expanded), 'compact PRC should reduce the rendered user payload');
});
