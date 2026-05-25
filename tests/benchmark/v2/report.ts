import type { BenchmarkPartition, BenchmarkPartitionSummary, BenchmarkReport, ScoredBenchmarkResult } from './types';

export interface BuildBenchmarkReportInput {
  runId: string;
  adapterId: string;
  startedAt: string;
  completedAt: string;
  model?: string;
  results: ScoredBenchmarkResult[];
}

export function buildBenchmarkReport(input: BuildBenchmarkReportInput): BenchmarkReport {
  const totalRuns = input.results.length;
  const passedRuns = input.results.filter(result => result.passed).length;
  const traceCompleteRuns = input.results.filter(result => result.trace.ok).length;

  return {
    runId: input.runId,
    adapterId: input.adapterId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    model: input.model,
    summary: {
      totalRuns,
      passedRuns,
      failedRuns: totalRuns - passedRuns,
      passRate: ratio(passedRuns, totalRuns),
      traceCompleteRate: ratio(traceCompleteRuns, totalRuns),
      avgPlannerCalls: average(input.results.map(result => result.metrics.plannerCalls)),
      avgToolExecutions: average(input.results.map(result => result.metrics.toolExecutions)),
      avgDurationMs: average(input.results.map(result => result.metrics.durationMs)),
      failureTypes: countFailureTypes(input.results),
      partitions: {
        dev: summarizePartition(input.results, 'dev'),
        holdout: summarizePartition(input.results, 'holdout'),
      },
    },
    results: input.results,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function countFailureTypes(results: ScoredBenchmarkResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (!result.passed) {
      const key = result.failureType ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

function summarizePartition(
  results: ScoredBenchmarkResult[],
  partition: BenchmarkPartition,
): BenchmarkPartitionSummary {
  const partitionResults = results.filter(result => result.partition === partition);
  const totalRuns = partitionResults.length;
  const passedRuns = partitionResults.filter(result => result.passed).length;
  const traceCompleteRuns = partitionResults.filter(result => result.trace.ok).length;

  return {
    totalRuns,
    passedRuns,
    failedRuns: totalRuns - passedRuns,
    passRate: ratio(passedRuns, totalRuns),
    traceCompleteRate: ratio(traceCompleteRuns, totalRuns),
  };
}
