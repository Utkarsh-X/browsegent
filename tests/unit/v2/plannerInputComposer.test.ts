import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { PlannerInputComposer } from '../../../src/v2/planner/PlannerInputComposer';
import { LineageCompressor } from '../../../src/v2/planner/LineageCompressor';
import { ProjectionService } from '../../../src/v2/brain1/ProjectionService';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, TransitionEvidence, V2Ref, V2ToolResult } from '../../../src/v2';
import type { FailureEvidence } from '../../../src/v2/runtime/FailureClassifier';
import type { TraceJsonValue, TraceManifest, TraceStep } from '../../../src/v2/trace/types';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_primary',
    generationId: 1,
    targetId: 'target_primary',
    backendNodeId: 222,
    selectorCandidates: ['#primary', 'button:nth-of-type(1)'],
    role: 'button',
    name: 'Primary',
    text: 'Primary',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(overrides: {
  observationId: string;
  refs?: V2Ref[];
  warnings?: BrowserObservation['warnings'];
  generationId?: number;
  url?: string;
}): BrowserObservation {
  const generationId = overrides.generationId ?? 1;
  return buildBrowserObservation({
    observationId: overrides.observationId,
    sessionId: 'session_planner',
    generationId,
    url: overrides.url ?? 'https://example.test/app',
    title: 'Planner Fixture',
    timestamp: generationId,
    durationMs: 2,
    refs: overrides.refs ?? [makeRef({ generationId })],
    warnings: overrides.warnings ?? [],
  });
}

function makeTransition(): {
  before: BrowserObservation;
  after: BrowserObservation;
  evidence: TransitionEvidence;
  graph: ContinuityGraph;
} {
  const before = makeObservation({
    observationId: 'obs_plan_before',
    refs: [
      makeRef(),
      makeRef({
        refId: 'ref_secondary',
        targetId: 'target_secondary',
        selectorCandidates: ['#secondary'],
        name: 'Secondary',
        text: 'Secondary',
      }),
    ],
  });
  const after = makeObservation({
    observationId: 'obs_plan_after',
    refs: [
      makeRef(),
      makeRef({
        refId: 'ref_secondary',
        targetId: 'target_secondary',
        selectorCandidates: ['#secondary'],
        name: 'Secondary',
        text: 'Secondary',
        state: 'weakened',
        continuityConfidence: 0.55,
        invalidationReason: 'soft_identity_match_requires_verification',
      }),
    ],
    warnings: [
      {
        code: 'low_confidence_ref',
        severity: 'warning',
        message: 'A ref has low continuity confidence.',
      },
    ],
  });
  const evidence = new ContinuityInterpreter().interpret(before, after);
  const graph = new ContinuityGraph();

  graph.applyObservation(before);
  graph.applyObservation(after);
  graph.applyTransition(evidence);

  return { before, after, evidence, graph };
}

function makeTraceManifest(steps: TraceStep[]): TraceManifest {
  return {
    runId: 'run_planner_lineage',
    runtimeMode: 'mvr',
    startTime: 100,
    steps,
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: 'trace.json' },
      observations: [],
      transitions: [],
      graph: [],
      planner: [],
      screenshots: [],
    },
  };
}

test('PlannerInputComposer excludes raw graph topology, CDP ids, and selector candidates', () => {
  const { after, evidence, graph } = makeTransition();
  const projection = new ProjectionService().project(after, graph.snapshot());
  const result: V2ToolResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_primary',
    evidence,
    traceStepId: 'step_1',
  };

  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_sanitized',
    goal: 'Inspect visible controls',
    projection,
    graphSnapshot: graph.snapshot(),
    transitionEvidence: evidence,
    lastResult: result,
  });
  const json = JSON.stringify(input);

  assert.equal(input.episodeId, 'episode_sanitized');
  assert.equal(input.current.projectionId, projection.projectionId);
  assert.equal(input.continuity?.snapshotId, graph.snapshot().snapshotId);
  assert.doesNotMatch(json, /backendNodeId/);
  assert.doesNotMatch(json, /selectorCandidates/);
  assert.doesNotMatch(json, /#primary/);
  assert.doesNotMatch(json, /target_primary/);
  assert.doesNotMatch(json, /refs":\[/);
  assert.doesNotMatch(json, /transitions":\[/);
});

test('PlannerInputComposer emits canonical refs with lightweight ranked projection views', () => {
  const observation = makeObservation({
    observationId: 'obs_canonical_projection',
    refs: [
      makeRef({
        refId: 'ref_link',
        targetId: 'target_link',
        selectorCandidates: ['a[href="/docs"]'],
        role: 'link',
        name: 'Docs',
        text: 'Docs',
      }),
      makeRef({
        refId: 'ref_button',
        targetId: 'target_button',
        selectorCandidates: ['#submit'],
        role: 'button',
        name: 'Submit',
        text: 'Submit form',
      }),
    ],
  });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_canonical_projection',
    goal: 'Open docs',
    projection,
  });

  assert.equal(input.current.refs.ref_link.name, 'Docs');
  assert.equal(input.current.refs.ref_link.text, undefined);
  assert.deepEqual(input.current.navigation, [{ refId: 'ref_link', rank: 1 }]);
  assert.equal('name' in input.current.interactions[0], false);
  assert.equal('text' in input.current.readables[0], false);
  assert.equal('role' in input.current.navigation[0], false);
});

test('PlannerInputComposer preserves generic combobox metadata in selected refs', () => {
  const observation = makeObservation({
    observationId: 'obs_combobox_metadata',
    refs: [makeRef({
      refId: 'ref_destination',
      targetId: 'target_destination',
      role: 'combobox',
      name: 'Destination',
      text: 'Destination',
      value: 'Paris',
      placeholder: 'Where are you going?',
      ariaAutocomplete: 'list',
      ariaHasPopup: 'listbox',
      capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
    })],
  });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_combobox_metadata',
    goal: 'Search for a destination',
    projection,
  });

  const ref = input.current.refs.ref_destination;
  assert.ok(ref);
  assert.equal(ref.ariaAutocomplete, 'list');
  assert.equal(ref.ariaHasPopup, 'listbox');
  assert.equal(ref.value, 'Paris');
  assert.equal(ref.placeholder, 'Where are you going?');
});

test('PlannerInputComposer keeps only current interaction refs actionable in evidence snapshots', () => {
  const observation = makeObservation({
    observationId: 'obs_evidence_ref_scope',
    refs: [
      makeRef({
        refId: 'ref_result',
        role: 'link',
        name: 'owner/repository',
        text: 'owner/repository',
      }),
      makeRef({
        refId: 'ref_distractor',
        role: 'button',
        name: 'Account menu',
        text: 'Account menu',
      }),
    ],
  });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_evidence_ref_scope',
    goal: 'Find the repository with the most stars',
    projection,
    evidenceSnapshot: {
      activeSort: { dimension: 'stars', direction: 'desc', source: 'url_query' },
      cards: [{
        position: 0,
        entity: 'owner/repository',
        provenRank: 1,
        metrics: { stars: 73 },
        refIds: ['ref_result', 'ref_historical'],
      }],
    },
    workingSetOptions: { maxPrimaryRefs: 1, maxSecondaryRefs: 0 },
  });

  assert.deepEqual(input.evidenceSnapshot?.cards[0]?.refIds, ['ref_result']);
  assert.ok(input.current.refs.ref_result);
  assert.equal(input.current.refs.ref_historical, undefined);
  assert.ok(input.workingSet?.actionSurface.clickableRefs.includes('ref_result'));
});

test('PlannerInputComposer includes transition summary and uncertainty signals', () => {
  const { after, evidence, graph } = makeTransition();
  const projection = new ProjectionService().project(after, graph.snapshot());
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_evidence',
    goal: 'Inspect visible controls',
    projection,
    graphSnapshot: graph.snapshot(),
    transitionEvidence: evidence,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_secondary',
      error: {
        code: 'low_confidence_ref',
        message: 'Ref continuity confidence is below the execution threshold.',
        retryable: false,
      },
      traceStepId: 'step_2',
    },
  });

  assert.equal(input.transition?.transitionClass, 'structural_local');
  assert.equal(input.transition?.refChangeCounts.weakened, 1);
  assert.equal(input.lastResult?.error?.code, 'low_confidence_ref');
  assert.equal(input.uncertainty.level, 'medium');
  assert.ok(input.uncertainty.signals.includes('weakened_refs:1'));
  assert.ok(input.uncertainty.signals.includes('last_error:low_confidence_ref'));
  assert.ok(input.uncertainty.signals.includes('runtime_warning:low_confidence_ref'));
});

test('PlannerInputComposer previews object-valued tool results for replanning', () => {
  const observation = makeObservation({ observationId: 'obs_value_preview' });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_value_preview',
    goal: 'Report entered name',
    projection,
    lastResult: {
      success: true,
      kind: 'get',
      targetRef: 'ref_name',
      value: { text: 'Name', value: 'Ada Lovelace' },
      traceStepId: 'step_get_name',
    },
  });

  assert.equal(input.lastResult?.valuePreview, 'Ada Lovelace Name');
});

test('PlannerInputComposer preserves richer previews for explicit read results without expanding ref lanes', () => {
  const observation = makeObservation({ observationId: 'obs_long_read_preview' });
  const projection = new ProjectionService().project(observation);
  const lateMarker = 'LATE-READ-EVIDENCE-9173';
  const longReadText = `${'read evidence '.repeat(70)}${lateMarker}`;
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_long_read_preview',
    goal: 'Report the late evidence marker',
    projection,
    lastResult: {
      success: true,
      kind: 'get',
      targetRef: 'ref_article',
      value: { text: longReadText },
      traceStepId: 'step_get_article',
    },
  });

  assert.match(input.lastResult?.valuePreview ?? '', new RegExp(lateMarker));
  assert.equal(input.current.refs.ref_primary.name, 'Primary');
  assert.equal(input.current.refs.ref_primary.text, undefined);
});

test('PlannerInputComposer previews successful mutation target facts for replanning', () => {
  const observation = makeObservation({ observationId: 'obs_mutation_preview' });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_mutation_preview',
    goal: 'Find and open the archive link',
    projection,
    lastResult: {
      success: true,
      kind: 'click',
      targetRef: 'ref_archive',
      target: {
        refId: 'ref_archive',
        role: 'link',
        name: 'Archive link',
        text: 'Archive link',
      },
      traceStepId: 'step_click_archive',
    },
  });

  assert.equal(input.lastResult?.valuePreview, 'Archive link link');
});

test('PlannerInputComposer includes compact recovery state from runtime signals', () => {
  const observation = makeObservation({ observationId: 'obs_recovery_state' });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_recovery_state',
    goal: 'Search for docs',
    projection,
    lastResult: {
      success: false,
      kind: 'type',
      targetRef: 'ref_primary',
      error: {
        code: 'target_not_editable',
        message: 'Target was not editable.',
        retryable: false,
      },
      traceStepId: 'step_type_wrong_target',
    },
    runtimeUncertainty: {
      level: 'medium',
      signals: ['failure:target_not_editable'],
    },
  });

  assert.equal(input.recovery?.state, 'wrong_target_type');
  assert.equal(input.recovery?.blockedAction?.ref, 'ref_primary');
  assert.ok(input.recovery?.nextMechanisms.includes('choose_typeable_ref'));
});

test('PlannerInputComposer promotes repeated same-blocker evidence into persistent recovery', () => {
  const observation = makeObservation({ observationId: 'obs_persistent_blocker' });
  const projection = new ProjectionService().project(observation);
  const blocker = {
    blockerDescription: 'div#consent-overlay',
    blockerTagName: 'div',
    hitTestOutcome: 'hard_blocker',
    blockerIsFixedOrSticky: true,
  };
  const failureEvidence: FailureEvidence[] = [
    {
      failureId: 'failure_ref_a',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target was blocked.',
      source: 'test',
      observationId: 'obs_persistent_blocker_1',
      generationId: 1,
      url: 'https://example.test/app',
      targetRef: 'ref_a',
      signals: ['error:target_blocked'],
      diagnostics: blocker,
    },
    {
      failureId: 'failure_ref_b',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target was blocked.',
      source: 'test',
      observationId: 'obs_persistent_blocker_2',
      generationId: 1,
      url: 'https://example.test/app',
      targetRef: 'ref_b',
      signals: ['error:target_blocked'],
      diagnostics: blocker,
    },
  ];
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_persistent_blocker',
    goal: 'Submit the form',
    projection,
    failureEvidence,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_b',
      error: { code: 'target_blocked', message: 'Target was blocked.', retryable: false, diagnostics: blocker },
      traceStepId: 'step_blocked_b',
    },
  });

  assert.equal(input.recovery?.state, 'persistent_target_blocker');
  assert.equal(input.recovery?.blockedAction?.ref, 'ref_b');
  assert.ok(input.recovery?.nextMechanisms.includes('find_dismiss_or_close_control'));
});

test('LineageCompressor keeps bounded recent execution lineage without raw result payloads', () => {
  const manifest = makeTraceManifest([
    makeTraceStep('step_1', 'click', 'completed', 'ref_a'),
    makeTraceStep('step_2', 'type', 'completed', 'ref_b'),
    makeTraceStep('step_3', 'click', 'failed', 'ref_c', 'target_blocked'),
  ]);
  const lineage = new LineageCompressor().compress(manifest, { maxSteps: 2 });
  const json = JSON.stringify(lineage);

  assert.equal(lineage.totalSteps, 3);
  assert.equal(lineage.truncated, true);
  assert.deepEqual(lineage.steps.map(step => step.stepId), ['step_2', 'step_3']);
  assert.equal(lineage.steps[1].errorCode, 'target_blocked');
  assert.doesNotMatch(json, /backendNodeId/);
  assert.doesNotMatch(json, /playwright/);
  assert.doesNotMatch(json, /cdp/i);
});

test('PlannerInputComposer accepts bounded live action lineage for the next planner call', () => {
  const { after, graph } = makeTransition();
  const projection = new ProjectionService().project(after, graph.snapshot());
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_live_lineage',
    goal: 'Continue the task',
    projection,
    graphSnapshot: graph.snapshot(),
    trace: [
      makeTraceStep('step_live_1', 'click', 'completed', 'ref_primary'),
      makeTraceStep('step_live_2', 'type', 'failed', 'ref_secondary', 'input_not_applied'),
    ],
  });

  assert.equal(input.lineage?.totalSteps, 2);
  assert.deepEqual(input.lineage?.steps.map(step => step.stepId), ['step_live_1', 'step_live_2']);
  assert.equal(input.lineage?.steps[1].errorCode, 'input_not_applied');
});

test('TraceStore writes planner input and output replay artifacts passively', async () => {
  const traceDir = await freshTraceDir('planner');
  const store = new TraceStore({
    runId: 'run_trace_planner',
    runtimeMode: 'mvr',
    traceDir,
    startTime: 4444,
  });
  const { after, evidence, graph } = makeTransition();
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_trace',
    goal: 'Inspect visible controls',
    projection: new ProjectionService().project(after, graph.snapshot()),
    graphSnapshot: graph.snapshot(),
    transitionEvidence: evidence,
  });
  const output = {
    plan: [{ tool: 'click', ref: 'ref_primary' }],
    confidence: 'high',
  };

  const inputArtifact = store.recordPlannerInput(input.episodeId, input);
  const outputArtifact = store.recordPlannerOutput(input.episodeId, output);
  const manifest = await store.flush();

  assert.equal(inputArtifact.kind, 'planner_input');
  assert.equal(outputArtifact.kind, 'planner_output');
  assert.equal(manifest.artifacts.planner.length, 2);

  const inputJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_planner', 'planner', 'episode_trace-input.json'),
    'utf8',
  ));
  const outputJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_planner', 'planner', 'episode_trace-output.json'),
    'utf8',
  ));

  assert.equal(inputJson.episodeId, 'episode_trace');
  assert.equal(outputJson.plan[0].ref, 'ref_primary');
});

test('PlannerInputComposer emits bounded working set instead of full projection refs', () => {
  const refs = Array.from({ length: 80 }, (_, index) => makeRef({
    refId: `ref_hidden_${index}`,
    targetId: `target_hidden_${index}`,
    role: undefined,
    name: undefined,
    text: undefined,
    visibility: 'hidden',
    actionability: 'blocked',
  }));
  refs.push(makeRef({
    refId: 'ref_search',
    targetId: 'target_search',
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    visibility: 'visible',
    actionability: 'ready',
  }));

  const projection = new ProjectionService().project(makeObservation({
    observationId: 'obs_bounded_working_set',
    refs,
  }));

  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_bounded_working_set',
    goal: 'Search for docs',
    projection,
  });

  assert.equal(input.version, 'v2.planner_input.v2');
  assert.ok(input.workingSet);
  assert.ok(input.workingSetDiagnostics);
  assert.equal(Object.keys(input.current.refs).includes('ref_search'), true);
  assert.equal(Object.keys(input.current.refs).some(refId => refId.startsWith('ref_hidden_')), false);
  assert.equal(input.workingSetDiagnostics.observedRefCount, 81);
  assert.equal(input.workingSetDiagnostics.selectedRefCount, 1);
  assert.ok((input.workingSetDiagnostics.droppedByReason.hidden_low_value ?? 0) >= 80);
});

function makeTraceStep(
  stepId: string,
  kind: string,
  status: TraceStep['status'],
  targetRef: string,
  errorCode?: string,
): TraceStep {
  const result: Record<string, TraceJsonValue> = {
    success: errorCode === undefined,
    kind,
    targetRef,
    traceStepId: stepId,
    evidence: {
      beforeObservationId: `${stepId}_before`,
      afterObservationId: `${stepId}_after`,
      transitionClass: errorCode === undefined ? 'structural_local' : 'microstate',
      strength: errorCode === undefined ? 'moderate' : 'none',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: [],
        disappeared: [],
        weakened: [],
        preserved: [targetRef],
      },
      notes: [],
    },
    backendNodeId: 123,
    runtimePath: ['playwright'],
    cdp: { method: 'DOM.describeNode' },
  };

  if (errorCode !== undefined) {
    result.error = {
      code: errorCode,
      message: 'Blocked at center point.',
      retryable: false,
    };
  }

  return {
    stepId,
    index: Number(stepId.replace('step_', '')) - 1,
    kind,
    status,
    startedAt: 1000,
    endedAt: 1010,
    targetRef,
    beforeObservationId: `${stepId}_before`,
    afterObservationId: `${stepId}_after`,
    warnings: [],
    result,
  };
}

async function freshTraceDir(name: string): Promise<string> {
  const root = join(process.cwd(), 'logs', 'v2-unit-traces', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test('PlannerInputComposer passes repeated no-progress uncertainty into working set quarantine', () => {
  const observation = makeObservation({
    observationId: 'obs_no_progress_quarantine',
    refs: [
      makeRef({
        refId: 'ref_compute',
        targetId: 'target_compute',
        selectorCandidates: ['#compute'],
        role: 'button',
        name: 'Compute',
        text: 'Compute',
      }),
      makeRef({
        refId: 'ref_input',
        targetId: 'target_input',
        selectorCandidates: ['#input'],
        role: 'textbox',
        name: 'Expression',
        text: 'Expression',
      }),
    ],
  });
  const projection = new ProjectionService().project(observation);

  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_no_progress_quarantine',
    goal: 'Calculate derivative',
    projection,
    runtimeUncertainty: {
      level: 'medium',
      signals: ['repeated_no_progress_transition:click:ref_compute:3'],
    },
  });

  assert.ok(input.workingSet);
  assert.ok(input.workingSet.quarantinedActions.some(action =>
    action.refId === 'ref_compute'
    && action.tool === 'click'
    && action.failureKind === 'no_progress_loop'
  ));
  assert.equal(input.workingSet.actionSurface.clickableRefs.includes('ref_compute'), false);
  assert.ok(input.workingSet.actionSurface.typeableRefs.includes('ref_input'));
});

test('PlannerInputComposer carries compact task evidence coverage without raw read text', () => {
  const observation = makeObservation({ observationId: 'obs_coverage' });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_coverage',
    goal: 'Give the pronunciation and definition',
    projection,
    evidenceCoverage: {
      contractKind: 'description',
      status: 'incomplete',
      readCount: 1,
      requirements: [{ key: 'definition', status: 'missing', supportingReadIndexes: [] }],
    },
  });

  assert.deepEqual(input.evidenceCoverage, {
    contractKind: 'description',
    status: 'incomplete',
    readCount: 1,
    requirements: [{ key: 'definition', status: 'missing', supportingReadIndexes: [] }],
  });
  assert.equal(JSON.stringify(input).includes('raw read text'), false);
});

test('PlannerInputComposer applies working-set options per call without changing the shared default', () => {
  const observation = makeObservation({
    observationId: 'obs_working_set_options',
    refs: [
      makeRef({ refId: 'ref_primary', name: 'Primary', text: 'Primary' }),
      makeRef({ refId: 'ref_secondary', targetId: 'target_secondary', name: 'Secondary', text: 'Secondary' }),
    ],
  });
  const projection = new ProjectionService().project(observation);
  const composer = new PlannerInputComposer();

  const defaultInput = composer.compose({
    episodeId: 'episode_working_set_default',
    goal: 'Inspect controls',
    projection,
  });
  const boundedInput = composer.compose({
    episodeId: 'episode_working_set_bounded',
    goal: 'Inspect controls',
    projection,
    workingSetOptions: { maxPrimaryRefs: 1, maxSecondaryRefs: 0 },
  });

  assert.equal(defaultInput.workingSetDiagnostics?.selectedRefCount, 2);
  assert.equal(boundedInput.workingSetDiagnostics?.selectedRefCount, 1);
});

test('LineageCompressor populates bounded value for type, select, navigate, and press', () => {
  const compressor = new LineageCompressor();
  const stepType: TraceStep = {
    stepId: 'step_type',
    index: 0,
    kind: 'type',
    status: 'completed',
    startedAt: 1000,
    input: { text: '  Paris  ' },
    warnings: [],
  };
  const stepSelect: TraceStep = {
    stepId: 'step_select',
    index: 1,
    kind: 'select',
    status: 'completed',
    startedAt: 1001,
    input: { value: '2' },
    warnings: [],
  };
  const stepNav: TraceStep = {
    stepId: 'step_nav',
    index: 2,
    kind: 'navigate',
    status: 'completed',
    startedAt: 1002,
    input: { url: 'https://example.test/' + 'a'.repeat(200) },
    warnings: [],
  };
  const stepPress: TraceStep = {
    stepId: 'step_press',
    index: 3,
    kind: 'press',
    status: 'completed',
    startedAt: 1003,
    input: { key: 'Enter' },
    warnings: [],
  };
  const stepClick: TraceStep = {
    stepId: 'step_click',
    index: 4,
    kind: 'click',
    status: 'completed',
    startedAt: 1004,
    warnings: [],
  };

  const lineage = compressor.compress([stepType, stepSelect, stepNav, stepPress, stepClick]);
  assert.equal(lineage.steps[0].value, 'Paris');
  assert.equal(lineage.steps[1].value, '2');
  assert.equal(lineage.steps[2].value?.length, 120);
  assert.equal(lineage.steps[3].value, 'Enter');
  assert.equal(lineage.steps[4].value, undefined);
});

test('PlannerInputComposer sets goalProgress for parsing goals and guarantees byte-identical absence for non-parsing goals', () => {  const observation = makeObservation({ observationId: 'obs_gp' });
  const projection = new ProjectionService().project(observation);
  const composer = new PlannerInputComposer();

  // Parsing goal
  const parsingInput = composer.compose({
    episodeId: 'ep_gp_1',
    goal: 'Find a hotel in Paris for February 14-21, 2027',
    projection,
  });
  assert.ok(parsingInput.goalProgress);
  assert.equal(parsingInput.goalProgress.entries[0].key, 'destination');
  assert.equal(parsingInput.goalProgress.entries[0].state, 'NOT_SET');

  // Non-parsing goal
  const nonParsingInput = composer.compose({
    episodeId: 'ep_gp_2',
    goal: 'Click the submit button',
    projection,
  });
  // Must NOT have the goalProgress property on the object
  assert.equal('goalProgress' in nonParsingInput, false);
  assert.equal(Object.prototype.hasOwnProperty.call(nonParsingInput, 'goalProgress'), false);

  // Byte identity check against keys without goalProgress
  const expectedKeys = Object.keys(parsingInput).filter(k => k !== 'goalProgress');
  assert.deepEqual(Object.keys(nonParsingInput), expectedKeys);
});


const HORIZON_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function makeCalendarRef(
  refId: string,
  label: string,
  position: number,
  overrides: Partial<V2Ref> = {},
): V2Ref {
  return makeRef({
    refId,
    targetId: `target_${refId}`,
    role: 'checkbox',
    name: label,
    text: label,
    box: {
      x: 100 + (position % 30) * 40,
      y: 500 + Math.floor(position / 30) * 40,
      width: 40,
      height: 40,
    },
    ...overrides,
  });
}

function makeCalendarObservation(): BrowserObservation {
  const refs: V2Ref[] = [];
  let position = 0;
  for (const [monthIndex, monthCount] of [[8, 30], [9, 31]] as Array<[number, number]>) {
    for (let day = 1; day <= monthCount; day += 1) {
      refs.push(makeCalendarRef(`ref_cell_${monthIndex}_${day}`, `${day} ${HORIZON_MONTHS[monthIndex]} 2026`, position));
      position += 1;
    }
  }
  refs.push(makeRef({
    refId: 'ref_prev_month',
    targetId: 'target_prev_month',
    name: 'Previous month',
    text: 'Previous month',
    box: { x: 60, y: 505, width: 30, height: 30 },
  }));
  refs.push(makeRef({
    refId: 'ref_next_month',
    targetId: 'target_next_month',
    name: 'Next month',
    text: 'Next month',
    box: { x: 1240, y: 505, width: 30, height: 30 },
  }));
  // High-score filler competition: pushes the nav controls out of the top slice
  for (let index = 0; index < 40; index += 1) {
    refs.push(makeRef({
      refId: `ref_filler_${index}`,
      targetId: `target_filler_${index}`,
      name: `Operational control ${index}`,
      text: `Operational control ${index}`,
      box: { x: 1600, y: 800 + index * 20, width: 80, height: 20 },
    }));
  }

  return {
    ...makeObservation({ observationId: 'obs_horizon', refs }),
    lang: 'en',
  };
}

const HORIZON_GOAL = 'Find a hotel in Paris for February 14-21, 2027';
const HORIZON_TRACE: TraceStep[] = [{
  stepId: 'step_type_paris',
  index: 0,
  kind: 'type',
  status: 'completed',
  startedAt: 1000,
  warnings: [],
  targetRef: 'ref_destination',
  input: { text: 'Paris' },
  result: { success: true },
}];

test('PlannerInputComposer attaches a horizon when the focused dates target is outside the visible window', () => {
  const projection = new ProjectionService().project(makeCalendarObservation());
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_horizon',
    goal: HORIZON_GOAL,
    projection,
    trace: HORIZON_TRACE,
  });

  assert.ok(input.goalProgress);
  assert.equal(input.goalProgress.focus, 'dates');
  assert.ok(input.horizon);
  assert.deepEqual(input.horizon.visibleMonths, ['September 2026', 'October 2026']);
  assert.deepEqual(input.horizon.targetMonths, ['February 2027']);
  assert.ok(input.horizon.navControls.some(control => control.refId === 'ref_next_month'));
});

test('PlannerInputComposer force-selects horizon nav controls into the working set', () => {
  const projection = new ProjectionService().project(makeCalendarObservation());
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_horizon_force',
    goal: HORIZON_GOAL,
    projection,
    trace: HORIZON_TRACE,
  });

  const workingSet = input.workingSet;
  assert.ok(workingSet);
  const laneRefs = [...workingSet.primaryRefs, ...workingSet.secondaryRefs];
  const nextRef = laneRefs.find(ref => ref.refId === 'ref_next_month');
  assert.ok(nextRef);
  assert.ok(nextRef.reasons.includes('horizon_control'));
  assert.ok(input.current.refs.ref_next_month);
  assert.ok(input.current.refs.ref_prev_month);
});

test('PlannerInputComposer omits horizon for non-date goals and non-calendar surfaces', () => {
  const composer = new PlannerInputComposer();
  const calendarProjection = new ProjectionService().project(makeCalendarObservation());
  const plainProjection = new ProjectionService().project(makeObservation({ observationId: 'obs_plain' }));

  const nonTravel = composer.compose({
    episodeId: 'episode_horizon_non_travel',
    goal: 'Find wireless noise-cancelling headphones under $50',
    projection: calendarProjection,
    trace: HORIZON_TRACE,
  });
  assert.equal('horizon' in nonTravel, false);

  const noWidget = composer.compose({
    episodeId: 'episode_horizon_no_widget',
    goal: HORIZON_GOAL,
    projection: plainProjection,
    trace: HORIZON_TRACE,
  });
  assert.equal('horizon' in noWidget, false);
  assert.equal('horizon' in composer.compose({
    episodeId: 'episode_horizon_non_parsing',
    goal: 'Click the submit button',
    projection: calendarProjection,
  }), false);
});

test('LineageCompressor carries the bounded target name for click evidence', () => {
  const manifest = makeTraceManifest([]);
  manifest.steps = [{
    stepId: 'step_click_day',
    index: 0,
    kind: 'click',
    status: 'completed',
    startedAt: 1000,
    warnings: [],
    targetRef: 'ref_day',
    result: {
      success: true,
      target: { refId: 'ref_day', name: 'Friday, 25 December 2026', text: '25', role: 'checkbox' },
    },
  } as unknown as TraceStep];

  const lineage = new LineageCompressor().compress(manifest, { maxSteps: 5 });
  assert.equal(lineage.steps[0].targetName, 'Friday, 25 December 2026');
});

test('PlannerInputComposer keeps dismissal controls prioritized while a blocker at the current URL is unresolved', () => {
  const blocker = {
    blockerDescription: 'div#promo-overlay',
    blockerTagName: 'div',
    hitTestOutcome: 'hard_blocker',
  };
  const dismissRef = makeRef({
    refId: 'ref_dismiss',
    targetId: 'target_dismiss',
    name: 'Dismiss sign in information.',
    text: 'Dismiss sign in information.',
  });
  const fillers = Array.from({ length: 40 }, (_, index) => makeRef({
    refId: `ref_comp_${index}`,
    targetId: `target_comp_${index}`,
    name: `Page control ${index}`,
    text: `Page control ${index}`,
  }));
  const observation = makeObservation({
    observationId: 'obs_unresolved_blocker',
    refs: [dismissRef, ...fillers],
  });
  const projection = new ProjectionService().project(observation);
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_unresolved_blocker',
    goal: 'Search for docs',
    projection,
    failureEvidence: [{
      failureId: 'failure_blocked',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target was blocked.',
      source: 'test',
      observationId: 'obs_blocked',
      generationId: 1,
      url: projection.url,
      targetRef: 'ref_search_input',
      signals: ['error:target_blocked'],
      diagnostics: blocker,
    }],
    // Last action succeeded (a navigation back to the same surface), but the
    // blocker was never dismissed.
    lastResult: {
      success: true,
      kind: 'navigate',
      traceStepId: 'step_navigate',
    },
  });

  const lanes = [...(input.workingSet?.primaryRefs ?? []), ...(input.workingSet?.secondaryRefs ?? [])];
  const dismiss = lanes.find(ref => ref.refId === 'ref_dismiss');
  assert.ok(dismiss);
  assert.ok(dismiss.reasons.includes('recovery_control'));
});
