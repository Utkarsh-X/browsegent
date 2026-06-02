import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { collectBenchmarkDiagnostics } from '../../benchmark/v2/diagnostics';
import { buildBenchmarkReport } from '../../benchmark/v2/report';
import type { ScoredBenchmarkResult } from '../../benchmark/v2/types';

test('collectBenchmarkDiagnostics summarizes trace payload sizes and action markers', async () => {
  const runRoot = await mkdtemp(join(tmpdir(), 'browsegent-trace-diagnostics-'));
  const observationPath = join(runRoot, 'observations', 'obs_1.json');
  const plannerInputPath = join(runRoot, 'planner', 'episode_1-input.json');
  const plannerOutputPath = join(runRoot, 'planner', 'episode_1-output.json');
  const failurePath = join(runRoot, 'failures', 'failure_1.json');
  const tracePath = join(runRoot, 'trace.json');

  await mkdir(join(runRoot, 'observations'), { recursive: true });
  await mkdir(join(runRoot, 'planner'), { recursive: true });
  await mkdir(join(runRoot, 'failures'), { recursive: true });
  await writeFile(observationPath, JSON.stringify({ refs: [{ refId: 'ref_a' }] }), 'utf8');
  const plannerCurrent = {
    interactions: [
      { refId: 'ref_a', text: 'Click me' },
      { refId: 'ref_shared', text: 'Shared link' },
    ],
    readables: [
      { refId: 'ref_b', text: 'Readable page evidence repeated here' },
      { refId: 'ref_shared', text: 'Shared link' },
    ],
    navigation: [
      { refId: 'ref_nav', text: 'Home' },
      { refId: 'ref_shared', text: 'Shared link' },
    ],
    regions: [{ regionId: 'region_1', refIds: ['ref_a', 'ref_b'] }],
  };
  await writeFile(plannerInputPath, JSON.stringify({
    goal: 'Find evidence',
    current: plannerCurrent,
    workingSet: {
      primaryRefs: [{ refId: 'ref_a', reasons: ['visible_ready'] }],
      secondaryRefs: [],
      readableEvidence: [],
      navigationRefs: [],
      changedRefs: [],
      failedRefs: [],
      regionSummaries: [],
      omitted: {
        observedRefCount: 10,
        selectedRefCount: 1,
        droppedRefCount: 9,
        droppedByReason: { hidden_low_value: 9 },
      },
    },
    workingSetDiagnostics: {
      observedRefCount: 10,
      selectedRefCount: 1,
      droppedRefCount: 9,
      selectedByReason: { visible_ready: 1 },
      droppedByReason: { hidden_low_value: 9 },
      maxPrimaryRefs: 32,
      maxSecondaryRefs: 48,
      maxReadableEvidence: 48,
      maxNavigationRefs: 24,
      maxRegionSummaries: 12,
    },
    lineage: { totalSteps: 2, steps: [{ kind: 'click', targetRef: 'ref_a' }] },
    uncertainty: { level: 'medium', signals: ['signal_a'] },
  }), 'utf8');
  await writeFile(plannerOutputPath, JSON.stringify({ steps: [{ tool: 'click' }] }), 'utf8');
  await writeFile(failurePath, JSON.stringify({ kind: 'target_blocked' }), 'utf8');
  await writeFile(tracePath, JSON.stringify({
    runId: 'run_diagnostics',
    runtimeMode: 'agent',
    startTime: 123,
    steps: [
      actionStep('click', 'completed', 'ref_a'),
      actionStep('click', 'failed', 'ref_a', 'target_blocked'),
      actionStep('click', 'failed', 'ref_a', 'target_not_found'),
      actionStep('type', 'completed', 'ref_b'),
    ],
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: tracePath },
      observations: [{ kind: 'observation', id: 'obs_1', path: observationPath }],
      transitions: [],
      graph: [],
      planner: [
        { kind: 'planner_input', id: 'episode_1-input', path: plannerInputPath },
        { kind: 'planner_output', id: 'episode_1-output', path: plannerOutputPath },
      ],
      failures: [{ kind: 'failure', id: 'failure_1', path: failurePath }],
      screenshots: [],
    },
  }), 'utf8');

  const diagnostics = await collectBenchmarkDiagnostics({
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: false,
    value: '',
    tracePath,
    metrics: { plannerCalls: 3, toolExecutions: 4, durationMs: 100 },
  });

  assert.equal(diagnostics.payloads.traceBytes, (await readFile(tracePath)).byteLength);
  assert.equal(diagnostics.payloads.observations.count, 1);
  assert.equal(diagnostics.payloads.plannerInputs.count, 1);
  assert.equal(diagnostics.payloads.plannerInputSections.current.maxBytes, jsonBytes(plannerCurrent));
  assert.equal(diagnostics.payloads.plannerInputSections.currentInteractions.maxBytes, jsonBytes(plannerCurrent.interactions));
  assert.equal(diagnostics.payloads.plannerInputSections.currentReadables.maxBytes, jsonBytes(plannerCurrent.readables));
  assert.equal(diagnostics.projectionOverlap.maxMultiSectionRefCount, 1);
  assert.equal(diagnostics.projectionOverlap.maxInteractionReadableOverlap, 1);
  assert.equal(diagnostics.projectionOverlap.maxInteractionNavigationOverlap, 1);
  assert.equal(diagnostics.projectionOverlap.maxReadableNavigationOverlap, 1);
  assert.equal(diagnostics.payloads.plannerInputSections.lineage.count, 1);
  assert.equal(diagnostics.payloads.plannerOutputs.count, 1);
  assert.equal(diagnostics.payloads.failures.count, 1);
  assert.equal(diagnostics.actions.stepCount, 4);
  assert.equal(diagnostics.actions.failedStepCount, 2);
  assert.equal(diagnostics.actions.repeatedActionCount, 2);
  assert.equal(diagnostics.actions.invalidActionCount, 2);
  assert.equal(diagnostics.workingSet.maxObservedRefs, 10);
  assert.equal(diagnostics.workingSet.maxSelectedRefs, 1);
  assert.equal(diagnostics.workingSet.maxDroppedRefs, 9);
  assert.equal(diagnostics.workingSet.selectedByReason.visible_ready, 1);
  assert.equal(diagnostics.workingSet.droppedByReason.hidden_low_value, 9);
  assert.deepEqual(diagnostics.warnings, []);
});

test('collectBenchmarkDiagnostics returns warning-only diagnostics when trace cannot be read', async () => {
  const diagnostics = await collectBenchmarkDiagnostics({
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: false,
    value: '',
    tracePath: join(tmpdir(), 'missing-trace.json'),
    metrics: { plannerCalls: 0, toolExecutions: 0, durationMs: 1 },
  });

  assert.equal(diagnostics.actions.stepCount, 0);
  assert.equal(diagnostics.payloads.traceBytes, 0);
  assert.match(diagnostics.warnings[0], /^diagnostics_unavailable:/);
});

test('collectBenchmarkDiagnostics handles canonical refs with lightweight projection views', async () => {
  const runRoot = await mkdtemp(join(tmpdir(), 'browsegent-canonical-diagnostics-'));
  const plannerInputPath = join(runRoot, 'planner', 'episode_1-input.json');
  const tracePath = join(runRoot, 'trace.json');

  await mkdir(join(runRoot, 'planner'), { recursive: true });
  const plannerCurrent = {
    refs: {
      ref_shared: {
        refId: 'ref_shared',
        kind: 'link',
        role: 'link',
        name: 'Docs',
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        confidence: 1,
        score: 10,
      },
    },
    interactions: [{ refId: 'ref_shared', rank: 1 }],
    readables: [{ refId: 'ref_shared', rank: 1 }],
    navigation: [{ refId: 'ref_shared', rank: 1 }],
    regions: [],
  };
  await writeFile(plannerInputPath, JSON.stringify({
    goal: 'Open docs',
    current: plannerCurrent,
  }), 'utf8');
  await writeFile(tracePath, JSON.stringify({
    runId: 'run_canonical_diagnostics',
    runtimeMode: 'agent',
    startTime: 123,
    steps: [],
    artifacts: {
      trace: { kind: 'trace', id: 'trace', path: tracePath },
      observations: [],
      transitions: [],
      graph: [],
      planner: [{ kind: 'planner_input', id: 'episode_1-input', path: plannerInputPath }],
      failures: [],
      screenshots: [],
    },
  }), 'utf8');

  const diagnostics = await collectBenchmarkDiagnostics({
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: false,
    value: '',
    tracePath,
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 100 },
  });

  assert.equal(diagnostics.payloads.plannerInputSections.current.maxBytes, jsonBytes(plannerCurrent));
  assert.equal(diagnostics.payloads.plannerInputSections.currentInteractions.maxBytes, jsonBytes(plannerCurrent.interactions));
  assert.equal(diagnostics.payloads.plannerInputSections.currentReadables.maxBytes, jsonBytes(plannerCurrent.readables));
  assert.equal(diagnostics.projectionOverlap.maxMultiSectionRefCount, 1);
  assert.equal(diagnostics.projectionOverlap.maxInteractionReadableOverlap, 1);
  assert.equal(diagnostics.projectionOverlap.maxInteractionNavigationOverlap, 1);
  assert.equal(diagnostics.projectionOverlap.maxReadableNavigationOverlap, 1);
  assert.deepEqual(diagnostics.warnings, []);
});

test('buildBenchmarkReport aggregates diagnostic maxima and action markers', () => {
  const report = buildBenchmarkReport({
    runId: 'diagnostics_report',
    adapterId: 'browsegent',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:00:01.000Z',
    results: [
      scoredResult({
        diagnostics: {
          payloads: {
            traceBytes: 100,
            observations: { count: 1, totalBytes: 50, maxBytes: 50 },
            plannerInputs: { count: 1, totalBytes: 80, maxBytes: 80 },
            plannerInputSections: {
              goal: { count: 1, totalBytes: 10, maxBytes: 10 },
              current: { count: 1, totalBytes: 60, maxBytes: 60 },
              currentInteractions: { count: 1, totalBytes: 20, maxBytes: 20 },
              currentReadables: { count: 1, totalBytes: 30, maxBytes: 30 },
              currentNavigation: { count: 1, totalBytes: 5, maxBytes: 5 },
              currentRegions: { count: 1, totalBytes: 5, maxBytes: 5 },
              continuity: { count: 0, totalBytes: 0, maxBytes: 0 },
              transition: { count: 0, totalBytes: 0, maxBytes: 0 },
              lineage: { count: 1, totalBytes: 15, maxBytes: 15 },
              failures: { count: 0, totalBytes: 0, maxBytes: 0 },
              deadState: { count: 0, totalBytes: 0, maxBytes: 0 },
              uncertainty: { count: 1, totalBytes: 15, maxBytes: 15 },
            },
            plannerOutputs: { count: 1, totalBytes: 20, maxBytes: 20 },
            failures: { count: 0, totalBytes: 0, maxBytes: 0 },
          },
          actions: {
            stepCount: 3,
            failedStepCount: 1,
            repeatedActionCount: 1,
            invalidActionCount: 1,
          },
          projectionOverlap: {
            maxMultiSectionRefCount: 2,
            maxInteractionReadableOverlap: 2,
            maxInteractionNavigationOverlap: 1,
            maxReadableNavigationOverlap: 1,
          },
          workingSet: {
            maxObservedRefs: 10,
            maxSelectedRefs: 2,
            maxDroppedRefs: 8,
            selectedByReason: { visible_ready: 2 },
            droppedByReason: { hidden_low_value: 8 },
          },
          warnings: [],
        },
      }),
      scoredResult({
        diagnostics: {
          payloads: {
            traceBytes: 200,
            observations: { count: 2, totalBytes: 120, maxBytes: 70 },
            plannerInputs: { count: 1, totalBytes: 150, maxBytes: 150 },
            plannerInputSections: {
              goal: { count: 1, totalBytes: 15, maxBytes: 15 },
              current: { count: 1, totalBytes: 120, maxBytes: 120 },
              currentInteractions: { count: 1, totalBytes: 25, maxBytes: 25 },
              currentReadables: { count: 1, totalBytes: 80, maxBytes: 80 },
              currentNavigation: { count: 1, totalBytes: 10, maxBytes: 10 },
              currentRegions: { count: 1, totalBytes: 5, maxBytes: 5 },
              continuity: { count: 1, totalBytes: 15, maxBytes: 15 },
              transition: { count: 0, totalBytes: 0, maxBytes: 0 },
              lineage: { count: 1, totalBytes: 20, maxBytes: 20 },
              failures: { count: 1, totalBytes: 10, maxBytes: 10 },
              deadState: { count: 0, totalBytes: 0, maxBytes: 0 },
              uncertainty: { count: 1, totalBytes: 18, maxBytes: 18 },
            },
            plannerOutputs: { count: 1, totalBytes: 30, maxBytes: 30 },
            failures: { count: 1, totalBytes: 15, maxBytes: 15 },
          },
          actions: {
            stepCount: 4,
            failedStepCount: 2,
            repeatedActionCount: 2,
            invalidActionCount: 1,
          },
          projectionOverlap: {
            maxMultiSectionRefCount: 5,
            maxInteractionReadableOverlap: 4,
            maxInteractionNavigationOverlap: 3,
            maxReadableNavigationOverlap: 2,
          },
          workingSet: {
            maxObservedRefs: 20,
            maxSelectedRefs: 5,
            maxDroppedRefs: 15,
            selectedByReason: { visible_ready: 5 },
            droppedByReason: { hidden_low_value: 15 },
          },
          warnings: ['missing_artifact_size:one'],
        },
      }),
    ],
  });

  const diagnostics = report.summary.diagnostics;
  assert.ok(diagnostics);
  assert.equal(diagnostics.maxTraceBytes, 200);
  assert.equal(diagnostics.maxPlannerInputBytes, 150);
  assert.equal(diagnostics.maxProjectionBytes, 120);
  assert.equal(diagnostics.maxReadableProjectionBytes, 80);
  assert.equal(diagnostics.maxInteractionProjectionBytes, 25);
  assert.equal(diagnostics.maxObservationBytes, 70);
  assert.equal(diagnostics.totalFailedSteps, 3);
  assert.equal(diagnostics.totalRepeatedActions, 3);
  assert.equal(diagnostics.totalInvalidActions, 2);
  assert.equal(diagnostics.maxProjectionMultiSectionRefs, 5);
  assert.equal(diagnostics.maxProjectionInteractionReadableOverlap, 4);
  assert.equal(diagnostics.maxWorkingSetObservedRefs, 20);
  assert.equal(diagnostics.maxWorkingSetSelectedRefs, 5);
  assert.equal(diagnostics.maxWorkingSetDroppedRefs, 15);
  assert.equal(diagnostics.warningCount, 1);
});

function actionStep(
  kind: string,
  status: 'completed' | 'failed',
  targetRef: string,
  errorCode?: string,
) {
  return {
    stepId: `${kind}_${targetRef}_${status}_${errorCode ?? 'ok'}`,
    index: 0,
    kind,
    status,
    startedAt: 100,
    endedAt: 101,
    targetRef,
    input: { ref: targetRef },
    warnings: [],
    result: {
      success: status === 'completed',
      kind,
      targetRef,
      traceStepId: 'trace_step',
      error: errorCode ? { code: errorCode, message: errorCode, retryable: false } : undefined,
    },
  };
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function scoredResult(overrides: Partial<ScoredBenchmarkResult>): ScoredBenchmarkResult {
  return {
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: false,
    passed: false,
    value: '',
    partition: 'dev',
    failureType: 'planning_error',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 10 },
    validation: { passed: false, reasons: ['minLength:1'], preview: '' },
    trace: { ok: true, errors: [] },
    ...overrides,
  };
}
