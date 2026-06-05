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
