import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BenchmarkReport } from './types';

export interface BenchmarkComparison {
  generatedAt: string;
  reports: BenchmarkComparisonRow[];
}

export interface BenchmarkComparisonRow {
  adapterId: string;
  runId: string;
  model?: string;
  totalRuns: number;
  passRate: number;
  strictScore: number;
  manualCorrectedScore?: number;
  partialCreditRate?: number;
  rawAutoScore?: number;
  manualReviewCount?: number;
  scoringMode: 'local_validation' | 'webvoyager_strict';
  traceArtifactCompleteRate: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  failureTypes: Record<string, number>;
  qualitativeWeaknesses: string[];
  diagnostics?: BenchmarkComparisonDiagnostics;
}

export interface WebVoyagerEvaluationSummary {
  totalRuns: number;
  rawAutoScore: number;
  strictScore: number;
  manualReviewCount: number;
  manualCorrectedScore?: number;
  partialCreditRate?: number;
}

export interface BenchmarkComparisonDiagnostics {
  maxPlannerInputBytes: number;
  maxProjectionBytes: number;
  maxReadableProjectionBytes: number;
  maxInteractionProjectionBytes: number;
  maxObservationBytes: number;
  totalRepeatedActions: number;
  totalInvalidActions: number;
  maxProjectionMultiSectionRefs: number;
  maxWorkingSetObservedRefs: number;
  maxWorkingSetSelectedRefs: number;
  maxWorkingSetDroppedRefs: number;
  warningCount: number;
}

export interface BuildBenchmarkComparisonOptions {
  webVoyagerSummaries?: ReadonlyMap<string, WebVoyagerEvaluationSummary>;
}

export function buildBenchmarkComparison(
  reports: BenchmarkReport[],
  options: BuildBenchmarkComparisonOptions = {},
): BenchmarkComparison {
  return {
    generatedAt: new Date().toISOString(),
    reports: reports.map(report => {
      const webVoyagerSummary = options.webVoyagerSummaries?.get(report.runId);
      return {
        adapterId: report.adapterId,
        runId: report.runId,
        model: report.model,
        totalRuns: report.summary.totalRuns,
        passRate: report.summary.passRate,
        strictScore: webVoyagerSummary?.strictScore ?? report.summary.passRate,
        manualCorrectedScore: webVoyagerSummary?.manualCorrectedScore ?? 0,
        partialCreditRate: webVoyagerSummary?.partialCreditRate ?? 0,
        rawAutoScore: webVoyagerSummary?.rawAutoScore,
        manualReviewCount: webVoyagerSummary?.manualReviewCount,
        scoringMode: webVoyagerSummary ? 'webvoyager_strict' : 'local_validation',
        traceArtifactCompleteRate: report.summary.traceCompleteRate,
        avgDurationMs: report.summary.avgDurationMs,
        totalInputTokens: sumMetric(report, 'inputTokens'),
        totalOutputTokens: sumMetric(report, 'outputTokens'),
        failureTypes: report.summary.failureTypes,
        qualitativeWeaknesses: Object.keys(report.summary.failureTypes).sort(),
        diagnostics: report.summary.diagnostics ? {
          maxPlannerInputBytes: report.summary.diagnostics.maxPlannerInputBytes,
          maxProjectionBytes: report.summary.diagnostics.maxProjectionBytes,
          maxReadableProjectionBytes: report.summary.diagnostics.maxReadableProjectionBytes,
          maxInteractionProjectionBytes: report.summary.diagnostics.maxInteractionProjectionBytes,
          maxObservationBytes: report.summary.diagnostics.maxObservationBytes,
          totalRepeatedActions: report.summary.diagnostics.totalRepeatedActions,
          totalInvalidActions: report.summary.diagnostics.totalInvalidActions,
          maxProjectionMultiSectionRefs: report.summary.diagnostics.maxProjectionMultiSectionRefs,
          maxWorkingSetObservedRefs: report.summary.diagnostics.maxWorkingSetObservedRefs,
          maxWorkingSetSelectedRefs: report.summary.diagnostics.maxWorkingSetSelectedRefs,
          maxWorkingSetDroppedRefs: report.summary.diagnostics.maxWorkingSetDroppedRefs,
          warningCount: report.summary.diagnostics.warningCount,
        } : undefined,
      };
    }),
  };
}

export function renderBenchmarkComparisonMarkdown(comparison: BenchmarkComparison): string {
  const lines = [
    '# Benchmark Comparison',
    '',
    `Generated: ${comparison.generatedAt}`,
    '',
    '| Adapter | Run | Runs | Harness Pass | Strict Score | Manual Corrected | Partial Credit | Scoring | Trace/Artifact | Avg Duration | Tokens | Max Planner Input | Max Projection | Max Observation | Working Set | Multi-section Refs | Repeated/Invalid | Failure Types |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const report of comparison.reports) {
    lines.push([
      report.adapterId,
      report.runId,
      String(report.totalRuns),
      percent(report.passRate),
      percent(report.strictScore),
      percent(report.manualCorrectedScore ?? 0),
      percent(report.partialCreditRate ?? 0),
      report.scoringMode,
      percent(report.traceArtifactCompleteRate),
      `${Math.round(report.avgDurationMs)}ms`,
      `${report.totalInputTokens}/${report.totalOutputTokens}`,
      formatBytes(report.diagnostics?.maxPlannerInputBytes),
      formatBytes(report.diagnostics?.maxProjectionBytes),
      formatBytes(report.diagnostics?.maxObservationBytes),
      `${report.diagnostics?.maxWorkingSetSelectedRefs ?? 0}/${report.diagnostics?.maxWorkingSetObservedRefs ?? 0}`,
      String(report.diagnostics?.maxProjectionMultiSectionRefs ?? 0),
      `${report.diagnostics?.totalRepeatedActions ?? 0}/${report.diagnostics?.totalInvalidActions ?? 0}`,
      renderFailureTypes(report.failureTypes),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push(
    '',
    'Adapter Pass is the harness-level validation result. Strict Score uses adjacent WebVoyager evaluation artifacts when present; otherwise it falls back to local validation.',
    '',
  );
  return lines.join('\n');
}

export async function writeBenchmarkComparison(reportPaths: string[], outputPath: string): Promise<BenchmarkComparison> {
  const loadedReports = await Promise.all(reportPaths.map(loadBenchmarkReportForComparison));
  const reports = loadedReports.map(loaded => loaded.report);
  const webVoyagerSummaries = new Map(
    loadedReports
      .filter((loaded): loaded is LoadedBenchmarkReport & { webVoyagerSummary: WebVoyagerEvaluationSummary } => Boolean(loaded.webVoyagerSummary))
      .map(loaded => [loaded.report.runId, loaded.webVoyagerSummary]),
  );
  const comparison = buildBenchmarkComparison(reports, { webVoyagerSummaries });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  await writeFile(replaceExtension(outputPath, '.md'), renderBenchmarkComparisonMarkdown(comparison), 'utf8');
  return comparison;
}

interface LoadedBenchmarkReport {
  report: BenchmarkReport;
  webVoyagerSummary?: WebVoyagerEvaluationSummary;
}

async function loadBenchmarkReportForComparison(reportPath: string): Promise<LoadedBenchmarkReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport;
  return {
    report,
    webVoyagerSummary: await readAdjacentWebVoyagerSummary(reportPath),
  };
}

async function readAdjacentWebVoyagerSummary(reportPath: string): Promise<WebVoyagerEvaluationSummary | undefined> {
  try {
    const evaluationPath = join(dirname(reportPath), 'webvoyager_evaluation.json');
    const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8')) as { summary?: Partial<WebVoyagerEvaluationSummary> };
    const summary = evaluation.summary;
    if (
      typeof summary?.totalRuns !== 'number'
      || typeof summary.rawAutoScore !== 'number'
      || typeof summary.strictScore !== 'number'
      || typeof summary.manualReviewCount !== 'number'
    ) {
      return undefined;
    }
    return {
      totalRuns: summary.totalRuns,
      rawAutoScore: summary.rawAutoScore,
      strictScore: summary.strictScore,
      manualReviewCount: summary.manualReviewCount,
      manualCorrectedScore: summary.manualCorrectedScore,
      partialCreditRate: summary.partialCreditRate,
    };
  } catch {
    return undefined;
  }
}

function sumMetric(report: BenchmarkReport, metric: 'inputTokens' | 'outputTokens'): number {
  return report.results.reduce((sum, result) => sum + (result.metrics[metric] ?? 0), 0);
}

function renderFailureTypes(failureTypes: Record<string, number>): string {
  const entries = Object.entries(failureTypes).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'none';
  return entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? '0 B' : `${value} B`;
}

function replaceExtension(path: string, extension: string): string {
  return join(dirname(path), `${path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'comparison'}${extension}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--out');
  const outputPath = outputIndex === -1
    ? join(process.cwd(), 'logs', 'v2-benchmark', `comparison_${Date.now()}.json`)
    : args[outputIndex + 1];
  const reportPaths = args.filter((arg, index) => arg !== '--out' && index !== outputIndex + 1);

  writeBenchmarkComparison(reportPaths, outputPath)
    .then(comparison => {
      console.log(JSON.stringify(comparison.reports, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
