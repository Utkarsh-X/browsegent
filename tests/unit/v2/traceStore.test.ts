import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, V2Ref, V2ToolResult } from '../../../src/v2';

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
