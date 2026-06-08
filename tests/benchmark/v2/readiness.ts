import type { BenchmarkPartition, BenchmarkReport } from './types';

export type MvrReadinessStatus = 'ready' | 'not_ready';

export interface MvrReadinessCheck {
  id: string;
  passed: boolean;
  actual: string;
  required: string;
}

export interface MvrReadinessReport {
  generatedAt: string;
  sourceRunId: string;
  adapterId: string;
  model?: string;
  status: MvrReadinessStatus;
  summary: {
    uniqueTaskCount: number;
    devTaskCount: number;
    holdoutTaskCount: number;
    totalRuns: number;
    passRate: number;
    traceCompleteRate: number;
    failureTypes: Record<string, number>;
  };
  checks: MvrReadinessCheck[];
  recommendations: string[];
}

export interface MvrReadinessThresholds {
  minTasks: number;
  maxTasks: number;
  minHoldoutTasks: number;
  minPassRate: number;
  requiredTraceCompleteRate: number;
}

const DEFAULT_THRESHOLDS: MvrReadinessThresholds = {
  minTasks: 20,
  maxTasks: 30,
  minHoldoutTasks: 6,
  minPassRate: 0.9,
  requiredTraceCompleteRate: 1,
};

export function buildMvrReadinessReport(
  report: BenchmarkReport,
  thresholds: MvrReadinessThresholds = DEFAULT_THRESHOLDS,
  generatedAt = new Date().toISOString(),
): MvrReadinessReport {
  const uniqueTaskCount = new Set(report.results.map(result => result.taskId)).size;
  const devTaskCount = countUniqueTasksByPartition(report, 'dev');
  const holdoutTaskCount = countUniqueTasksByPartition(report, 'holdout');
  const failedResults = report.results.filter(result => !result.passed);
  const classifiedFailureCount = failedResults.filter(result => result.failureType && result.failureType !== 'unknown').length;
  const checks: MvrReadinessCheck[] = [
    {
      id: 'task_count_20_to_30',
      passed: uniqueTaskCount >= thresholds.minTasks && uniqueTaskCount <= thresholds.maxTasks,
      actual: String(uniqueTaskCount),
      required: `${thresholds.minTasks}-${thresholds.maxTasks} unique tasks`,
    },
    {
      id: 'dev_and_holdout_present',
      passed: devTaskCount > 0 && holdoutTaskCount >= thresholds.minHoldoutTasks,
      actual: `dev=${devTaskCount}, holdout=${holdoutTaskCount}`,
      required: `dev>0 and holdout>=${thresholds.minHoldoutTasks}`,
    },
    {
      id: 'pass_rate_at_least_90',
      passed: report.summary.passRate >= thresholds.minPassRate,
      actual: formatPercent(report.summary.passRate),
      required: `>=${formatPercent(thresholds.minPassRate)}`,
    },
    {
      id: 'trace_completeness_100',
      passed: report.summary.traceCompleteRate >= thresholds.requiredTraceCompleteRate,
      actual: formatPercent(report.summary.traceCompleteRate),
      required: formatPercent(thresholds.requiredTraceCompleteRate),
    },
    {
      id: 'failure_classification_present',
      passed: failedResults.length === classifiedFailureCount,
      actual: `${classifiedFailureCount}/${failedResults.length} failed runs classified`,
      required: 'all failed runs classified',
    },
  ];

  return {
    generatedAt,
    sourceRunId: report.runId,
    adapterId: report.adapterId,
    model: report.model,
    status: checks.every(check => check.passed) ? 'ready' : 'not_ready',
    summary: {
      uniqueTaskCount,
      devTaskCount,
      holdoutTaskCount,
      totalRuns: report.summary.totalRuns,
      passRate: report.summary.passRate,
      traceCompleteRate: report.summary.traceCompleteRate,
      failureTypes: report.summary.failureTypes,
    },
    checks,
    recommendations: buildRecommendations(checks),
  };
}

export function renderMvrReadinessMarkdown(report: MvrReadinessReport): string {
  return [
    '# BrowseGent v2 MVR Readiness',
    '',
    `Status: ${report.status}`,
    `Source run: ${report.sourceRunId}`,
    `Adapter: ${report.adapterId}`,
    `Model: ${report.model ?? 'default'}`,
    `Unique tasks: ${report.summary.uniqueTaskCount}`,
    `Pass rate: ${formatPercent(report.summary.passRate)}`,
    `Trace complete rate: ${formatPercent(report.summary.traceCompleteRate)}`,
    '',
    '## Checks',
    '',
    ...report.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.id}: ${check.actual} (required ${check.required})`),
    '',
    '## Failure Types',
    '',
    ...renderFailureTypes(report.summary.failureTypes),
    '',
    '## Recommendations',
    '',
    ...report.recommendations.map(recommendation => `- ${recommendation}`),
    '',
  ].join('\n');
}

function countUniqueTasksByPartition(report: BenchmarkReport, partition: BenchmarkPartition): number {
  return new Set(report.results
    .filter(result => result.partition === partition)
    .map(result => result.taskId)).size;
}

function buildRecommendations(checks: MvrReadinessCheck[]): string[] {
  const failed = checks.filter(check => !check.passed);
  if (failed.length === 0) {
    return ['Proceed to competitor adapter comparison on the same task protocol.'];
  }

  return failed.map(check => {
    if (check.id === 'task_count_20_to_30') return 'Run the full 20-30 task local suite before competitor comparison.';
    if (check.id === 'dev_and_holdout_present') return 'Keep dev and holdout partitions represented in the baseline run.';
    if (check.id === 'pass_rate_at_least_90') return 'Inspect failed traces and fix generic failure classes before broad comparison.';
    if (check.id === 'trace_completeness_100') return 'Fix trace replay gaps before using pass rate as credible evidence.';
    if (check.id === 'failure_classification_present') return 'Classify every failed run before deciding whether to fix runtime, planner I/O, or fixture assumptions.';
    return `Resolve readiness check ${check.id}.`;
  });
}

function renderFailureTypes(failureTypes: Record<string, number>): string[] {
  const entries = Object.entries(failureTypes);
  if (entries.length === 0) return ['- none'];
  return entries.map(([type, count]) => `- ${type}: ${count}`);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
