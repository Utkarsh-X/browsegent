import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBenchmarkReport } from '../../benchmark/v2/report';
import type { BenchmarkDiagnostics, ScoredBenchmarkResult } from '../../benchmark/v2/types';

function result(overrides: Partial<ScoredBenchmarkResult>): ScoredBenchmarkResult {
  return {
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: true,
    passed: true,
    value: 'ok',
    partition: 'dev',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 10 },
    validation: { passed: true, reasons: [], preview: 'ok' },
    trace: { ok: true, errors: [] },
    failureType: undefined,
    failureReason: undefined,
    ...overrides,
  };
}

function diagnostics(workingSet: BenchmarkDiagnostics['workingSet']): BenchmarkDiagnostics {
  const payload = { count: 0, totalBytes: 0, maxBytes: 0 };

  return {
    payloads: {
      traceBytes: 0,
      observations: payload,
      plannerInputs: payload,
      plannerInputSections: {
        goal: payload,
        current: payload,
        currentInteractions: payload,
        currentReadables: payload,
        currentNavigation: payload,
        currentRegions: payload,
        continuity: payload,
        transition: payload,
        lineage: payload,
        failures: payload,
        deadState: payload,
        uncertainty: payload,
      },
      plannerOutputs: payload,
      failures: payload,
    },
    actions: { stepCount: 0, failedStepCount: 0, repeatedActionCount: 0, invalidActionCount: 0 },
    projectionOverlap: {
      maxMultiSectionRefCount: 0,
      maxInteractionReadableOverlap: 0,
      maxInteractionNavigationOverlap: 0,
      maxReadableNavigationOverlap: 0,
    },
    workingSet,
    warnings: [],
  };
}

test('buildBenchmarkReport aggregates pass, trace, failure, and cost-neutral metrics', () => {
  const report = buildBenchmarkReport({
    runId: 'bench_unit',
    adapterId: 'browsegent',
    startedAt: '2026-05-24T00:00:00.000Z',
    completedAt: '2026-05-24T00:00:01.000Z',
    model: 'gemini/gemini-3.1-flash-lite',
    results: [
      result({ taskId: 'a', passed: true, metrics: { plannerCalls: 1, toolExecutions: 2, durationMs: 10 } }),
      result({
        taskId: 'b',
        partition: 'holdout',
        success: false,
        passed: false,
        failureType: 'action_error',
        failureReason: 'target_blocked',
        trace: { ok: false, errors: ['missing_mutation_evidence'] },
        metrics: { plannerCalls: 2, toolExecutions: 3, durationMs: 30 },
      }),
    ],
  });

  assert.equal(report.summary.totalRuns, 2);
  assert.equal(report.summary.passedRuns, 1);
  assert.equal(report.summary.passRate, 0.5);
  assert.equal(report.summary.traceCompleteRate, 0.5);
  assert.equal(report.summary.avgPlannerCalls, 1.5);
  assert.equal(report.summary.avgToolExecutions, 2.5);
  assert.equal(report.summary.avgDurationMs, 20);
  assert.equal(report.summary.failureTypes.action_error, 1);
  assert.equal(report.summary.partitions.dev.totalRuns, 1);
  assert.equal(report.summary.partitions.dev.passRate, 1);
  assert.equal(report.summary.partitions.holdout.totalRuns, 1);
  assert.equal(report.summary.partitions.holdout.passRate, 0);
});

test('buildBenchmarkReport aggregates planner working-set diagnostics', () => {
  const report = buildBenchmarkReport({
    runId: 'bench_working_set',
    adapterId: 'browsegent',
    startedAt: '2026-05-24T00:00:00.000Z',
    completedAt: '2026-05-24T00:00:01.000Z',
    results: [
      result({
        diagnostics: diagnostics({
          maxObservedRefs: 80,
          maxSelectedRefs: 20,
          maxDroppedRefs: 60,
          selectedByReason: { visible_ready: 20 },
          droppedByReason: { hidden_low_value: 60 },
        }),
      }),
    ],
  });

  assert.equal(report.summary.diagnostics?.maxWorkingSetObservedRefs, 80);
  assert.equal(report.summary.diagnostics?.maxWorkingSetSelectedRefs, 20);
  assert.equal(report.summary.diagnostics?.maxWorkingSetDroppedRefs, 60);
});
