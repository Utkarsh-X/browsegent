import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMvrReadinessReport, renderMvrReadinessMarkdown } from '../../benchmark/v2/readiness';
import type { BenchmarkReport, ScoredBenchmarkResult } from '../../benchmark/v2/types';

function result(overrides: Partial<ScoredBenchmarkResult>): ScoredBenchmarkResult {
  return {
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: true,
    passed: true,
    partition: 'dev',
    value: 'ok',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 10 },
    validation: { passed: true, reasons: [], preview: 'ok' },
    trace: { ok: true, errors: [] },
    failureType: undefined,
    failureReason: undefined,
    ...overrides,
  };
}

function report(results: ScoredBenchmarkResult[]): BenchmarkReport {
  return {
    runId: 'benchmark_ready',
    adapterId: 'browsegent',
    startedAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    model: 'gemini/gemini-3.1-flash-lite',
    summary: {
      totalRuns: results.length,
      passedRuns: results.filter(candidate => candidate.passed).length,
      failedRuns: results.filter(candidate => !candidate.passed).length,
      passRate: results.filter(candidate => candidate.passed).length / results.length,
      traceCompleteRate: results.filter(candidate => candidate.trace.ok).length / results.length,
      avgPlannerCalls: 1,
      avgToolExecutions: 1,
      avgDurationMs: 10,
      failureTypes: {},
      partitions: {
        dev: { totalRuns: 16, passedRuns: 16, failedRuns: 0, passRate: 1, traceCompleteRate: 1 },
        holdout: { totalRuns: 8, passedRuns: 8, failedRuns: 0, passRate: 1, traceCompleteRate: 1 },
      },
    },
    results,
  };
}

test('buildMvrReadinessReport marks a 20+ task trace-complete high-pass run as ready', () => {
  const results = Array.from({ length: 24 }, (_, index) => result({
    taskId: `task_${index + 1}`,
    partition: index < 16 ? 'dev' : 'holdout',
  }));

  const readiness = buildMvrReadinessReport(report(results));

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.sourceRunId, 'benchmark_ready');
  assert.equal(readiness.model, 'gemini/gemini-3.1-flash-lite');
  assert.equal(readiness.checks.every(check => check.passed), true);
});

test('buildMvrReadinessReport marks weak runs as not ready with actionable checks', () => {
  const results = [
    result({ taskId: 'task_1', partition: 'dev' }),
    result({
      taskId: 'task_2',
      partition: 'dev',
      passed: false,
      success: false,
      trace: { ok: false, errors: ['missing_trace_path'] },
      failureType: 'trace_error',
    }),
  ];

  const readiness = buildMvrReadinessReport(report(results));

  assert.equal(readiness.status, 'not_ready');
  assert.deepEqual(readiness.checks.filter(check => !check.passed).map(check => check.id), [
    'task_count_20_to_30',
    'dev_and_holdout_present',
    'pass_rate_at_least_90',
    'trace_completeness_100',
  ]);
});

test('renderMvrReadinessMarkdown summarizes status, checks, and next actions', () => {
  const results = Array.from({ length: 24 }, (_, index) => result({
    taskId: `task_${index + 1}`,
    partition: index < 16 ? 'dev' : 'holdout',
  }));

  const markdown = renderMvrReadinessMarkdown(buildMvrReadinessReport(report(results)));

  assert.match(markdown, /# BrowseGent v2 MVR Readiness/);
  assert.match(markdown, /Status: ready/);
  assert.match(markdown, /task_count_20_to_30/);
  assert.match(markdown, /trace_completeness_100/);
});
