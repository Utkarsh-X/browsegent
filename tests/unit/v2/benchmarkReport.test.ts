import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBenchmarkReport } from '../../benchmark/v2/report';
import type { ScoredBenchmarkResult } from '../../benchmark/v2/types';

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

test('buildBenchmarkReport aggregates pass, trace, failure, and cost-neutral metrics', () => {
  const report = buildBenchmarkReport({
    runId: 'bench_unit',
    adapterId: 'browsegent',
    startedAt: '2026-05-24T00:00:00.000Z',
    completedAt: '2026-05-24T00:00:01.000Z',
    model: 'gemini/gemini-3.1-flash-lite-preview',
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
