import type {
  BenchmarkDiagnosticsSummary,
  BenchmarkPartition,
  BenchmarkPartitionSummary,
  BenchmarkReport,
  BenchmarkRunMetadata,
  ScoredBenchmarkResult,
} from './types';

export interface BuildBenchmarkReportInput {
  runId: string;
  adapterId: string;
  startedAt: string;
  completedAt: string;
  model?: string;
  runMetadata?: BenchmarkRunMetadata;
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
    runMetadata: input.runMetadata,
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
      diagnostics: summarizeDiagnostics(input.results),
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

function summarizeDiagnostics(results: ScoredBenchmarkResult[]): BenchmarkDiagnosticsSummary {
  return {
    maxTraceBytes: max(results.map(result => result.diagnostics?.payloads.traceBytes ?? 0)),
    maxPlannerInputBytes: max(results.map(result => result.diagnostics?.payloads.plannerInputs.maxBytes ?? 0)),
    maxProjectionBytes: max(results.map(result => result.diagnostics?.payloads.plannerInputSections.current.maxBytes ?? 0)),
    maxReadableProjectionBytes: max(results.map(result => result.diagnostics?.payloads.plannerInputSections.currentReadables.maxBytes ?? 0)),
    maxInteractionProjectionBytes: max(results.map(result => result.diagnostics?.payloads.plannerInputSections.currentInteractions.maxBytes ?? 0)),
    maxObservationBytes: max(results.map(result => result.diagnostics?.payloads.observations.maxBytes ?? 0)),
    totalFailedSteps: sum(results.map(result => result.diagnostics?.actions.failedStepCount ?? 0)),
    totalRepeatedActions: sum(results.map(result => result.diagnostics?.actions.repeatedActionCount ?? 0)),
    totalInvalidActions: sum(results.map(result => result.diagnostics?.actions.invalidActionCount ?? 0)),
    maxProjectionMultiSectionRefs: max(results.map(result => result.diagnostics?.projectionOverlap.maxMultiSectionRefCount ?? 0)),
    maxProjectionInteractionReadableOverlap: max(results.map(result => result.diagnostics?.projectionOverlap.maxInteractionReadableOverlap ?? 0)),
    maxWorkingSetObservedRefs: max(results.map(result => result.diagnostics?.workingSet.maxObservedRefs ?? 0)),
    maxWorkingSetSelectedRefs: max(results.map(result => result.diagnostics?.workingSet.maxSelectedRefs ?? 0)),
    maxWorkingSetDroppedRefs: max(results.map(result => result.diagnostics?.workingSet.maxDroppedRefs ?? 0)),
    warningCount: sum(results.map(result => result.diagnostics?.warnings.length ?? 0)),
  };
}

function max(values: number[]): number {
  return values.reduce((current, value) => Math.max(current, value), 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
