import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildBenchmarkComparison,
  renderBenchmarkComparisonMarkdown,
  writeBenchmarkComparison,
} from '../../benchmark/v2/compare_reports';
import type { BenchmarkReport } from '../../benchmark/v2/types';

test('buildBenchmarkComparison summarizes comparable benchmark evidence', () => {
  const comparison = buildBenchmarkComparison([
    report('browsegent', 1, 1, 100, {}),
    report('browser-use-local', 1, 0, 250, { validation_error: 1 }),
  ]);

  assert.equal(comparison.reports.length, 2);
  assert.equal(comparison.reports[0].adapterId, 'browsegent');
  assert.equal(comparison.reports[0].strictScore, 1);
  assert.equal(comparison.reports[0].scoringMode, 'local_validation');
  assert.equal(comparison.reports[0].traceArtifactCompleteRate, 1);
  assert.equal(comparison.reports[1].adapterId, 'browser-use-local');
  assert.equal(comparison.reports[1].strictScore, 0);
  assert.deepEqual(comparison.reports[1].qualitativeWeaknesses, ['validation_error']);
});

test('buildBenchmarkComparison uses WebVoyager strict score when evaluation summary exists', () => {
  const sourceReport = report('browsegent', 1, 1, 100, {});
  const comparison = buildBenchmarkComparison([sourceReport], {
    webVoyagerSummaries: new Map([
      [sourceReport.runId, {
        totalRuns: 1,
        rawAutoScore: 1,
        strictScore: 0,
        manualReviewCount: 1,
      }],
    ]),
  });

  assert.equal(comparison.reports[0].passRate, 1);
  assert.equal(comparison.reports[0].strictScore, 0);
  assert.equal(comparison.reports[0].rawAutoScore, 1);
  assert.equal(comparison.reports[0].manualReviewCount, 1);
  assert.equal(comparison.reports[0].scoringMode, 'webvoyager_strict');
});

test('buildBenchmarkComparison carries diagnostic evidence needed for root-cause comparison', () => {
  const sourceReport = report('browsegent', 1, 0, 100, { planning_error: 1 });
  sourceReport.summary.diagnostics = {
    maxTraceBytes: 1000,
    maxPlannerInputBytes: 800,
    maxProjectionBytes: 700,
    maxReadableProjectionBytes: 500,
    maxInteractionProjectionBytes: 200,
    maxObservationBytes: 600,
    totalFailedSteps: 2,
    totalRepeatedActions: 3,
    totalInvalidActions: 1,
    maxProjectionMultiSectionRefs: 4,
    maxProjectionInteractionReadableOverlap: 3,
    maxWorkingSetObservedRefs: 80,
    maxWorkingSetSelectedRefs: 20,
    maxWorkingSetDroppedRefs: 60,
    warningCount: 0,
  };

  const comparison = buildBenchmarkComparison([sourceReport]);

  assert.deepEqual(comparison.reports[0].diagnostics, {
    maxPlannerInputBytes: 800,
    maxProjectionBytes: 700,
    maxReadableProjectionBytes: 500,
    maxInteractionProjectionBytes: 200,
    maxObservationBytes: 600,
    totalRepeatedActions: 3,
    totalInvalidActions: 1,
    maxProjectionMultiSectionRefs: 4,
    maxWorkingSetObservedRefs: 80,
    maxWorkingSetSelectedRefs: 20,
    maxWorkingSetDroppedRefs: 60,
    warningCount: 0,
  });
});

test('renderBenchmarkComparisonMarkdown includes pass, strict, artifact, duration, and failure columns', () => {
  const markdown = renderBenchmarkComparisonMarkdown(buildBenchmarkComparison([
    report('browsegent', 1, 1, 100, {}),
    report('browser-use-local', 1, 0, 250, { validation_error: 1 }),
  ]));

  assert.match(markdown, /# Benchmark Comparison/);
  assert.match(markdown, /Adapter Pass/);
  assert.match(markdown, /Strict Score/);
  assert.match(markdown, /Scoring/);
  assert.match(markdown, /Trace\/Artifact/);
  assert.match(markdown, /Working Set/);
  assert.match(markdown, /validation_error/);
});

test('writeBenchmarkComparison reads adjacent WebVoyager evaluation artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'browsegent-comparison-'));
  const runRoot = join(root, 'run');
  const reportPath = join(runRoot, 'report.json');
  const outputPath = join(root, 'comparison.json');
  const sourceReport = report('browsegent', 1, 1, 100, {});

  await mkdir(runRoot, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(sourceReport)}\n`, 'utf8');
  await writeFile(join(runRoot, 'webvoyager_evaluation.json'), `${JSON.stringify({
    summary: {
      totalRuns: 1,
      rawAutoScore: 1,
      strictScore: 0,
      manualReviewCount: 1,
    },
    verdicts: [],
    tasks: [],
  })}\n`, 'utf8');

  const comparison = await writeBenchmarkComparison([reportPath], outputPath);
  const persisted = JSON.parse(await readFile(outputPath, 'utf8'));

  assert.equal(comparison.reports[0].strictScore, 0);
  assert.equal(comparison.reports[0].scoringMode, 'webvoyager_strict');
  assert.equal(persisted.reports[0].manualReviewCount, 1);
});

function report(
  adapterId: string,
  totalRuns: number,
  passedRuns: number,
  avgDurationMs: number,
  failureTypes: Record<string, number>,
): BenchmarkReport {
  return {
    runId: `${adapterId}_run`,
    adapterId,
    startedAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    model: 'gemini/gemini-3.1-flash-lite',
    summary: {
      totalRuns,
      passedRuns,
      failedRuns: totalRuns - passedRuns,
      passRate: totalRuns === 0 ? 0 : passedRuns / totalRuns,
      traceCompleteRate: 1,
      avgPlannerCalls: 1,
      avgToolExecutions: 1,
      avgDurationMs,
      failureTypes,
      partitions: {
        dev: { totalRuns, passedRuns, failedRuns: totalRuns - passedRuns, passRate: passedRuns / totalRuns, traceCompleteRate: 1 },
        holdout: { totalRuns: 0, passedRuns: 0, failedRuns: 0, passRate: 0, traceCompleteRate: 0 },
      },
    },
    results: [],
  };
}
