import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref, V2ToolResult } from '../../../src/v2';
import type { FailureEvidence } from '../../../src/v2/runtime/FailureClassifier';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_submit',
    generationId: 1,
    targetId: 'target_submit',
    selectorCandidates: ['#submit'],
    role: 'button',
    name: 'Submit',
    text: 'Submit',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return buildBrowserObservation({
    observationId: 'obs_1',
    sessionId: 'session_trace',
    generationId: 1,
    url: 'https://example.test/form',
    title: 'Trace Fixture',
    timestamp: 1000,
    durationMs: 12,
    refs: [makeRef()],
    warnings: [],
    ...overrides,
  });
}

function makeToolResult(stepId: string, overrides: Partial<V2ToolResult> = {}): V2ToolResult {
  return {
    success: true,
    kind: 'click',
    targetRef: 'ref_submit',
    value: { clicked: true },
    traceStepId: stepId,
    ...overrides,
  };
}

async function freshTraceDir(name: string): Promise<string> {
  const root = join(process.cwd(), 'logs', 'v2-unit-traces', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test('TraceStore records observations and action lifecycle into replayable artifacts', async () => {
  const traceDir = await freshTraceDir('lifecycle');
  const store = new TraceStore({
    runId: 'run_trace_lifecycle',
    runtimeMode: 'mvr',
    traceDir,
    startTime: 1234,
  });

  const observation = makeObservation();
  const observationArtifact = store.recordObservation(observation);
  const stepId = store.recordActionStart({
    kind: 'click',
    targetRef: 'ref_submit',
    beforeObservationId: observation.observationId,
    timestamp: 1235,
  });
  const result = makeToolResult(stepId, {
    evidence: {
      beforeObservationId: 'obs_1',
      afterObservationId: 'obs_2',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: [],
        disappeared: [],
        weakened: [],
        preserved: ['ref_submit'],
      },
      notes: ['modal opened'],
    },
  });

  store.recordActionEnd(stepId, result, {
    afterObservationId: 'obs_2',
    timestamp: 1240,
  });

  const manifest = await store.flush();

  assert.equal(observationArtifact.kind, 'observation');
  assert.equal(manifest.runId, 'run_trace_lifecycle');
  assert.equal(manifest.runtimeMode, 'mvr');
  assert.equal(manifest.startTime, 1234);
  assert.equal(manifest.steps.length, 1);
  assert.equal(manifest.steps[0].stepId, stepId);
  assert.equal(manifest.steps[0].status, 'completed');
  assert.equal(manifest.steps[0].beforeObservationId, 'obs_1');
  assert.equal(manifest.steps[0].afterObservationId, 'obs_2');
  assert.equal(manifest.artifacts.observations.length, 1);
  assert.match(manifest.artifacts.trace.path, /trace\.json$/);

  const observationJson = JSON.parse(await readFile(join(traceDir, 'run_trace_lifecycle', 'observations', 'obs_1.json'), 'utf8'));
  assert.equal(observationJson.observationId, 'obs_1');
  assert.equal(observationJson.refs[0].refId, 'ref_submit');

  const traceJson = JSON.parse(await readFile(join(traceDir, 'run_trace_lifecycle', 'trace.json'), 'utf8'));
  assert.equal(traceJson.steps[0].result.success, true);
  assert.equal(traceJson.steps[0].result.evidence.transitionClass, 'structural_local');
});

test('TraceStore remains passive and does not mutate observations or tool results', async () => {
  const traceDir = await freshTraceDir('passive');
  const store = new TraceStore({
    runId: 'run_trace_passive',
    runtimeMode: 'mvr',
    traceDir,
    startTime: 2222,
  });
  const observation = makeObservation();
  const result = makeToolResult('step_1');
  const originalObservation = JSON.stringify(observation);
  const originalResult = JSON.stringify(result);

  store.recordObservation(observation);
  const stepId = store.recordActionStart({ kind: 'click', targetRef: 'ref_submit' });
  store.recordActionEnd(stepId, result);
  await store.flush();

  assert.equal(JSON.stringify(observation), originalObservation);
  assert.equal(JSON.stringify(result), originalResult);
});

test('TraceStore writes transition and graph replay artifacts passively', async () => {
  const traceDir = await freshTraceDir('continuity');
  const store = new TraceStore({
    runId: 'run_trace_continuity',
    runtimeMode: 'mvr',
    traceDir,
    startTime: 3333,
  });
  const before = makeObservation({ observationId: 'obs_t_before' });
  const after = makeObservation({
    observationId: 'obs_t_after',
    refs: [
      makeRef(),
      makeRef({
        refId: 'ref_modal_close',
        targetId: 'target_modal_close',
        selectorCandidates: ['#modal-close'],
        name: 'Close',
        text: 'Close',
      }),
    ],
  });
  const graph = new ContinuityGraph();
  const evidence = new ContinuityInterpreter().interpret(before, after);

  graph.applyObservation(before);
  graph.applyObservation(after);
  graph.applyTransition(evidence);
  const transitionArtifact = store.recordTransition(evidence);
  const graphArtifact = store.recordGraphSnapshot(graph.snapshot());
  const manifest = await store.flush();

  assert.equal(transitionArtifact.kind, 'transition');
  assert.equal(graphArtifact.kind, 'graph');
  assert.equal(manifest.artifacts.transitions.length, 1);
  assert.equal(manifest.artifacts.graph.length, 1);

  const transitionJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_continuity', 'transitions', 'transition_obs_t_before_obs_t_after.json'),
    'utf8',
  ));
  const graphJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_continuity', 'graph', 'graph_obs_t_after_1.json'),
    'utf8',
  ));

  assert.equal(transitionJson.transitionClass, 'structural_local');
  assert.equal(graphJson.transitions[0].transitionId, 'transition_obs_t_before_obs_t_after');
});

test('TraceStore writes failure evidence as a replay artifact and manifest entry', async () => {
  const traceDir = await freshTraceDir('failure_evidence');
  const store = new TraceStore({
    runId: 'run_trace_failure',
    runtimeMode: 'agent',
    traceDir,
    startTime: 4444,
  });
  const failure: FailureEvidence = {
    failureId: 'failure_target_blocked_obs_1',
    kind: 'target_blocked',
    category: 'target',
    severity: 'warning',
    persistence: 'persistent',
    retryable: false,
    message: 'Target ref center point is blocked by another element.',
    source: 'v2_agent_loop',
    observationId: 'obs_1',
    targetRef: 'ref_submit',
    signals: ['error:target_blocked'],
  };

  const artifact = store.recordFailureEvidence(failure);
  const manifest = await store.flush();

  assert.equal(artifact.kind, 'failure');
  assert.equal(manifest.artifacts.failures?.length, 1);
  assert.equal(manifest.artifacts.failures?.[0].id, failure.failureId);

  const failureJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_failure', 'failures', 'failure_target_blocked_obs_1.json'),
    'utf8',
  ));
  const traceJson = JSON.parse(await readFile(join(traceDir, 'run_trace_failure', 'trace.json'), 'utf8'));

  assert.equal(failureJson.kind, 'target_blocked');
  assert.equal(failureJson.targetRef, 'ref_submit');
  assert.equal(traceJson.artifacts.failures[0].kind, 'failure');
});

test('TraceStore writes compact planner view artifacts and manifest entries', async () => {
  const traceDir = await freshTraceDir('compact_planner_view');
  const store = new TraceStore({
    runId: 'run_trace_compact_view',
    runtimeMode: 'agent',
    traceDir,
    startTime: 5555,
  });

  const payload = {
    version: 'compact_planner_telemetry.v1',
    episodeId: 'episode_1_obs_1',
    stats: {
      originalBytes: 1000,
      compactBytes: 250,
      baselineBytes: 300,
      reductionRatio: 0.25,
      baselineRatio: 0.3,
    },
    coverage: {
      plannedRefs: ['ref_submit'],
      plannedActionRefs: ['ref_submit'],
      plannedReadRefs: [],
      missingPlannedActionRefs: [],
      missingPlannedReadRefs: [],
      actionRefCoverage: 1,
      readRefCoverage: 1,
    },
    view: {
      version: 'compact_planner_view.v1',
      goal: 'Click submit',
      actions: [{ id: 1, refId: 'ref_submit', label: 'Submit', tools: ['clickable'] }],
      reads: [],
      omitted: {
        originalCurrentRefs: 1,
        originalPrimaryRefs: 1,
        originalSecondaryRefs: 0,
        originalReadableEvidence: 0,
      },
    },
  };

  const artifact = store.recordCompactPlannerView('episode_1_obs_1', payload);
  const manifest = await store.flush();

  assert.equal(artifact.kind, 'planner_compact_view');
  assert.equal(manifest.artifacts.compactPlannerViews?.length, 1);
  assert.equal(manifest.artifacts.compactPlannerViews?.[0].id, 'episode_1_obs_1-compact');

  const compactJson = JSON.parse(await readFile(
    join(traceDir, 'run_trace_compact_view', 'compact-planner', 'episode_1_obs_1-compact.json'),
    'utf8',
  ));
  const traceJson = JSON.parse(await readFile(join(traceDir, 'run_trace_compact_view', 'trace.json'), 'utf8'));

  assert.equal(compactJson.version, 'compact_planner_telemetry.v1');
  assert.equal(compactJson.stats.reductionRatio, 0.25);
  assert.equal(traceJson.artifacts.compactPlannerViews[0].kind, 'planner_compact_view');
});

test('TraceStore writes ref resolution audit artifacts and manifest entries', async () => {
  const traceDir = await freshTraceDir('ref_resolution_audit');
  const store = new TraceStore({
    runId: 'run_trace_ref_audit',
    runtimeMode: 'agent',
    traceDir,
    startTime: 6666,
  });

  const payload = {
    version: 'ref_resolution_audit.v1',
    auditId: 'audit_obs_1_ref_submit_click',
    observationId: 'obs_1',
    generationId: 1,
    url: 'https://example.test',
    actionKind: 'click',
    targetRef: 'ref_submit',
    summary: {
      reason: 'ambiguous_same_role_name',
      candidateCount: 2,
      sameRoleNameCandidates: 2,
      visibleReadyCandidates: 2,
    },
    candidates: [],
  };

  const artifact = store.recordRefResolutionAudit(payload.auditId, payload);
  const manifest = await store.flush();

  assert.equal(artifact.kind, 'ref_resolution_audit');
  assert.equal(manifest.artifacts.refResolutionAudits?.length, 1);
  assert.equal(manifest.artifacts.refResolutionAudits?.[0].id, payload.auditId);
});
