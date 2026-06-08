import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareEfficiency,
  summarizeEfficiency,
  renderEfficiencyComparisonMarkdown,
  buildPlannerInputBreakdown,
  renderPlannerBreakdownMarkdown,
  summarizeRefFailures,
  renderRefFailuresMarkdown,
  renderInitialInterpretation,
  RefFailureSummary,
  PlannerInputSectionBreakdown,
  renderCompactViewAuditMarkdown,
  CompactViewAuditSummary,
} from '../../benchmark/v2/efficiency_audit';
import type { BenchmarkReport } from '../../benchmark/v2/types';

test('summarizeEfficiency totals token and step metrics', () => {
  const summary = summarizeEfficiency(reportFixture('browsegent', [
    { taskId: 'a', inputTokens: 10, outputTokens: 2, plannerCalls: 1, toolExecutions: 2, durationMs: 100 },
    { taskId: 'b', inputTokens: 30, outputTokens: 3, plannerCalls: 2, toolExecutions: 3, durationMs: 200 },
  ]));

  assert.equal(summary.totalInputTokens, 40);
  assert.equal(summary.totalOutputTokens, 5);
  assert.equal(summary.totalPlannerCalls, 3);
  assert.equal(summary.totalToolExecutions, 5);
  assert.equal(summary.totalDurationMs, 300);
  assert.equal(summary.perTask.length, 2);
  assert.deepEqual(summary.perTask[0], {
    taskId: 'a',
    inputTokens: 10,
    outputTokens: 2,
    plannerCalls: 1,
    toolExecutions: 2,
    durationMs: 100,
    passed: true,
  });
  assert.deepEqual(summary.perTask[1], {
    taskId: 'b',
    inputTokens: 30,
    outputTokens: 3,
    plannerCalls: 2,
    toolExecutions: 3,
    durationMs: 200,
    passed: true,
  });
});

test('compareEfficiency reports left over right ratios', () => {
  const left = summarizeEfficiency(reportFixture('browsegent', [
    { taskId: 'a', inputTokens: 100, outputTokens: 10, plannerCalls: 10, toolExecutions: 20, durationMs: 1000 },
  ]));
  const right = summarizeEfficiency(reportFixture('browser-use-local', [
    { taskId: 'a', inputTokens: 50, outputTokens: 20, plannerCalls: 5, toolExecutions: 10, durationMs: 2000 },
  ]));

  const comparison = compareEfficiency(left, right);
  assert.equal(comparison.ratios.inputTokens, 2);
  assert.equal(comparison.ratios.outputTokens, 0.5);
  assert.equal(comparison.ratios.plannerCalls, 2);
  assert.equal(comparison.ratios.toolExecutions, 2);
  assert.equal(comparison.ratios.durationMs, 0.5);
});

test('renderEfficiencyComparisonMarkdown generates correct markdown comparison including handling Infinity', () => {
  const left = summarizeEfficiency(reportFixture('browsegent', [
    { taskId: 'a', inputTokens: 100, outputTokens: 10, plannerCalls: 10, toolExecutions: 20, durationMs: 1000 },
  ]));
  const right = summarizeEfficiency(reportFixture('browser-use-local', [
    { taskId: 'a', inputTokens: 50, outputTokens: 0, plannerCalls: 5, toolExecutions: 10, durationMs: 2000 },
  ]));

  const comparison = compareEfficiency(left, right);
  const markdown = renderEfficiencyComparisonMarkdown(comparison);

  // Assert expected output patterns
  assert.match(markdown, /# Efficiency Root-Cause Audit/);
  assert.match(markdown, /Left: browsegent \(browsegent_run\)/);
  assert.match(markdown, /Right: browser-use-local \(browser-use-local_run\)/);

  // Ratios:
  // inputTokens: 100 / 50 = 2.00x
  // outputTokens: 10 / 0 = Infinity (should print ∞)
  // plannerCalls: 10 / 5 = 2.00x
  // toolExecutions: 20 / 10 = 2.00x
  // durationMs: 1000 / 2000 = 0.50x
  assert.match(markdown, /\| Input tokens \| 100 \| 50 \| 2.00x \|/);
  assert.match(markdown, /\| Output tokens \| 10 \| 0 \| ∞ \|/);
  assert.match(markdown, /\| Planner calls \| 10 \| 5 \| 2.00x \|/);
  assert.match(markdown, /\| Tool executions \| 20 \| 10 \| 2.00x \|/);
  assert.match(markdown, /\| Duration ms \| 1000 \| 2000 \| 0.50x \|/);
});

test('buildPlannerInputBreakdown identifies duplicated current and working set size', () => {
  const breakdown = buildPlannerInputBreakdown('task', [
    {
      goal: 'goal',
      current: { refs: { r1: { text: 'one' }, r2: { text: 'two' } } },
      workingSet: { primaryRefs: [{ refId: 'r1' }], secondaryRefs: [{ refId: 'r2' }], readableEvidence: [{ refId: 'r1' }] },
    },
  ]);

  assert.equal(breakdown.plannerInputCount, 1);
  assert.equal(breakdown.maxRefCount, 2);
  assert.equal(breakdown.maxWorkingSetPrimaryRefs, 1);
  assert.equal(breakdown.maxWorkingSetSecondaryRefs, 1);
  assert.equal(breakdown.maxWorkingSetReadableEvidence, 1);
  assert.equal(breakdown.maxSections.goal, 6);
  assert.equal(breakdown.maxSections.failures, 0);
  assert.equal(breakdown.maxInputBytes, 191);
});

test('renderPlannerBreakdownMarkdown formats the section breakdown as markdown table', () => {
  const rows = [
    {
      taskId: 'task-1',
      plannerInputCount: 5,
      maxInputBytes: 1000,
      averageInputBytes: 500,
      maxSections: {},
      averageSections: {},
      maxRefCount: 3,
      maxWorkingSetPrimaryRefs: 2,
      maxWorkingSetSecondaryRefs: 1,
      maxWorkingSetReadableEvidence: 1,
    },
  ];

  const markdown = renderPlannerBreakdownMarkdown(rows);
  assert.match(markdown, /## BrowseGent Planner Input Section Breakdown/);
  assert.match(markdown, /\| Task \| Inputs \| Max Bytes \| Avg Bytes \| Max Refs \| Max Primary \| Max Secondary \| Max Readable Evidence \|/);
  assert.match(markdown, /\| task-1 \| 5 \| 1000 \| 500 \| 3 \| 2 \| 1 \| 1 \|/);
});

test('summarizeRefFailures groups failures by kind and target ref', () => {
  const summary = summarizeRefFailures('arxiv', [
    { kind: 'ambiguous_ref_resolution', targetRef: 'r1' },
    { kind: 'ambiguous_ref_resolution', targetRef: 'r1' },
    { kind: 'timeout' },
  ]);

  assert.equal(summary.totalFailures, 3);
  assert.equal(summary.byKind.ambiguous_ref_resolution, 2);
  assert.equal(summary.byKind.timeout, 1);
  assert.equal(summary.byTargetRef.r1, 2);
});

test('renderRefFailuresMarkdown formats the ref execution failure summaries as markdown table', () => {
  const summaries: RefFailureSummary[] = [
    {
      taskId: 'task-1',
      totalFailures: 3,
      byKind: { ambiguous_ref_resolution: 2, timeout: 1 },
      byTargetRef: { r1: 2 },
    },
    {
      taskId: 'task-2',
      totalFailures: 0,
      byKind: {},
      byTargetRef: {},
    },
  ];

  const markdown = renderRefFailuresMarkdown(summaries);
  assert.match(markdown, /## Ref Execution Failure Audit/);
  assert.match(markdown, /\| Task \| Total Failures \| Failure Kinds \| Repeated Target Refs \|/);
  assert.match(markdown, /\| task-1 \| 3 \| ambiguous_ref_resolution:2, timeout:1 \| r1:2 \|/);
  assert.match(markdown, /\| task-2 \| 0 \| none \| none \|/);
});

test('renderRefFailuresMarkdown formats and limits repeated target refs to top 5 sorted descending', () => {
  const summaries: RefFailureSummary[] = [
    {
      taskId: 'task-3',
      totalFailures: 7,
      byKind: { kindA: 7 },
      byTargetRef: {
        r1: 1,
        r2: 2,
        r3: 3,
        r4: 4,
        r5: 5,
        r6: 6,
      },
    },
  ];

  const markdown = renderRefFailuresMarkdown(summaries);
  // Top 5 should be: r6:6, r5:5, r4:4, r3:3, r2:2 (r1:1 should be omitted)
  assert.match(markdown, /r6:6, r5:5, r4:4, r3:3, r2:2/);
  assert.doesNotMatch(markdown, /r1:1/);
});

test('renderInitialInterpretation formats initial interpretation markdown correctly', () => {
  const comparison = {
    left: summarizeEfficiency(reportFixture('browsegent', [
      { taskId: 'task-a', inputTokens: 50, outputTokens: 5, plannerCalls: 2, toolExecutions: 2, durationMs: 100 },
      { taskId: 'task-b', inputTokens: 100, outputTokens: 10, plannerCalls: 3, toolExecutions: 3, durationMs: 200 },
    ])),
    right: summarizeEfficiency(reportFixture('browser-use-local', [
      { taskId: 'task-a', inputTokens: 25, outputTokens: 2, plannerCalls: 1, toolExecutions: 1, durationMs: 50 },
    ])),
    ratios: {
      inputTokens: 6,
      outputTokens: 7.5,
      plannerCalls: 5,
      toolExecutions: 5,
      durationMs: 6,
    },
  };

  const plannerBreakdowns: PlannerInputSectionBreakdown[] = [
    {
      taskId: 'task-a',
      plannerInputCount: 2,
      maxInputBytes: 200,
      averageInputBytes: 150,
      maxSections: {},
      averageSections: {},
      maxRefCount: 1,
      maxWorkingSetPrimaryRefs: 1,
      maxWorkingSetSecondaryRefs: 1,
      maxWorkingSetReadableEvidence: 1,
    },
  ];

  const refFailures: RefFailureSummary[] = [
    {
      taskId: 'task-a',
      totalFailures: 2,
      byKind: { timeout: 2 },
      byTargetRef: {},
    },
    {
      taskId: 'task-b',
      totalFailures: 5,
      byKind: { timeout: 5 },
      byTargetRef: {},
    },
  ];

  const markdown = renderInitialInterpretation(comparison, plannerBreakdowns, refFailures);
  
  assert.match(markdown, /## Initial Interpretation/);
  assert.match(markdown, /- Worst BrowseGent input-token task: task-b\./);
  assert.match(markdown, /- Worst BrowseGent ref-failure task: task-b \(5 failures\)\./);
  assert.match(markdown, /- Input-token ratio left\/right: 6\.00x\./);
  assert.match(markdown, /- Planner-call ratio left\/right: 5\.00x\./);
  assert.match(markdown, /This report is diagnostic only\. Do not change runtime behavior from this output without the decision gate\./);
});

test('renderCompactViewAuditMarkdown formats compact view audits as markdown table', () => {
  const summaries: CompactViewAuditSummary[] = [
    {
      taskId: 'task-1',
      plannerInputCount: 4,
      averageOriginalBytes: 1000,
      averageCompactBytes: 250,
      averageReductionRatio: 0.25,
      maxOriginalBytes: 2000,
      maxCompactBytes: 500,
    },
  ];

  const markdown = renderCompactViewAuditMarkdown(summaries);
  assert.match(markdown, /## Offline Compact Planner View Audit/);
  assert.match(markdown, /\| Task \| Inputs \| Avg Original Bytes \| Avg Compact Bytes \| Avg Compact\/Original \| Max Original \| Max Compact \|/);
  assert.match(markdown, /\| task-1 \| 4 \| 1000 \| 250 \| 25\.0% \| 2000 \| 500 \|/);
});

function reportFixture(adapterId: string, rows: Array<{
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
}>): BenchmarkReport {
  return {
    runId: `${adapterId}_run`,
    adapterId,
    startedAt: '2026-06-07T00:00:00.000Z',
    completedAt: '2026-06-07T00:00:01.000Z',
    summary: {
      totalRuns: rows.length,
      passedRuns: rows.length,
      failedRuns: 0,
      passRate: 1,
      traceCompleteRate: 1,
      avgPlannerCalls: 0,
      avgToolExecutions: 0,
      avgDurationMs: 0,
      failureTypes: {},
      partitions: {
        dev: { totalRuns: 0, passedRuns: 0, failedRuns: 0, passRate: 0, traceCompleteRate: 0 },
        holdout: { totalRuns: rows.length, passedRuns: rows.length, failedRuns: 0, passRate: 1, traceCompleteRate: 1 },
      },
    },
    results: rows.map(row => ({
      adapterId,
      taskId: row.taskId,
      attempt: 1,
      success: true,
      value: 'ok',
      metrics: {
        plannerCalls: row.plannerCalls,
        toolExecutions: row.toolExecutions,
        durationMs: row.durationMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
      partition: 'holdout',
      passed: true,
      validation: { passed: true, reasons: [], preview: 'ok' },
      trace: { ok: true, errors: [] },
    })),
  };
}
