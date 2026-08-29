import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderWebVoyagerEvaluationMarkdown, runWebVoyagerLite } from '../../benchmark/webvoyager/run_webvoyager_lite';
import type { BenchmarkAdapter } from '../../benchmark/v2/types';
import type { WebVoyagerVerdict, WebVoyagerEvaluationSummary } from '../../benchmark/webvoyager/types';

test('renderWebVoyagerEvaluationMarkdown includes all score columns', () => {
  const evaluation = {
    summary: {
      totalRuns: 1,
      internalPassRate: 1,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCreditRate: 0,
      environmentAdjustedStrictScore: 0,
      environmentAdjustedManualScore: 0,
      manualReviewCount: 1,
      environmentBlockedCount: 0,
      impossibleTaskCount: 0,
    } satisfies WebVoyagerEvaluationSummary,
    verdicts: [{
      taskId: 'webvoyager_GitHub__0',
      internalPassed: true,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentAdjustedEligible: true,
      environmentStatus: 'normal' as const,
      referenceMatchType: 'mismatch' as const,
      needsManualReview: true,
      reasons: ['reference_mismatch'],
    }] satisfies WebVoyagerVerdict[],
    tasks: [],
  };

  const md = renderWebVoyagerEvaluationMarkdown(evaluation);
  assert.match(md, /Internal pass rate:/);
  assert.match(md, /Strict score:/);
  assert.match(md, /Manual-corrected score:/);
  assert.match(md, /Partial-credit score:/);
  assert.match(md, /Environment-adjusted strict score:/);
  assert.match(md, /Manual review count:/);
  assert.match(md, /Ref Match/);
  assert.match(md, /mismatch/);
});

test('renderWebVoyagerEvaluationMarkdown shows manual verdict in reasons', () => {
  const evaluation = {
    summary: {
      totalRuns: 1,
      internalPassRate: 1,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCreditRate: 0,
      environmentAdjustedStrictScore: 0,
      environmentAdjustedManualScore: 0,
      manualReviewCount: 0,
      environmentBlockedCount: 0,
      impossibleTaskCount: 0,
    } satisfies WebVoyagerEvaluationSummary,
    verdicts: [{
      taskId: 'webvoyager_GitHub__0',
      internalPassed: true,
      rawAutoScore: 0,
      strictScore: 0,
      manualCorrectedScore: 0,
      partialCredit: 0,
      environmentAdjustedEligible: true,
      environmentStatus: 'normal' as const,
      referenceMatchType: 'mismatch' as const,
      needsManualReview: false,
      manualVerdict: 'fail' as const,
      reasons: ['reference_mismatch', 'manual_fail'],
    }] satisfies WebVoyagerVerdict[],
    tasks: [],
  };

  const md = renderWebVoyagerEvaluationMarkdown(evaluation);
  assert.match(md, /manual_fail/);
});

async function writeWebVoyagerFixtureSource(): Promise<string> {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'webvoyager-source-'));
  await mkdir(join(sourceRoot, 'data'), { recursive: true });
  await writeFile(
    join(sourceRoot, 'data', 'WebVoyager_data.jsonl'),
    `${JSON.stringify({ web_name: 'GitHub', id: 'GitHub__0', ques: 'What is the top repository?', web: 'https://github.com' })}\n`,
    'utf8',
  );
  await writeFile(
    join(sourceRoot, 'data', 'reference_answer.json'),
    `${JSON.stringify({ GitHub: [{ id: 0, type: 'text', ans: 'answer' }] })}\n`,
    'utf8',
  );
  return sourceRoot;
}

function recordingBenchmarkAdapter(seenOptions: unknown[]): BenchmarkAdapter {
  return {
    adapterId: 'fake',
    run: async (task, options) => {
      seenOptions.push(options);
      return {
        adapterId: 'fake',
        taskId: task.taskId,
        attempt: options.attempt,
        success: true,
        value: 'answer',
        tracePath: undefined,
        metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
      };
    },
  };
}

test('runWebVoyagerLite forwards planner serialization and working set options to the benchmark runner', async () => {
  const sourceRoot = await writeWebVoyagerFixtureSource();
  const outputRoot = await mkdtemp(join(tmpdir(), 'webvoyager-output-'));
  const seenOptions: unknown[] = [];
  try {
    const plannerSerialization = { mode: 'prc' as const, prcTierOmitted: true, compactDataPlane: false };
    const { benchmark } = await runWebVoyagerLite({
      sourceRoot,
      runId: 'webvoyager_lite_forwarding_unit',
      outputRoot,
      adapter: recordingBenchmarkAdapter(seenOptions),
      taskIds: ['GitHub__0'],
      traceAudit: async () => ({ ok: true, errors: [] }),
      plannerSerialization,
      workingSetOptions: { readablePhraseBonus: 60 },
    });

    assert.equal(benchmark.summary.totalRuns, 1);
    const adapterOptions = seenOptions[0] as Record<string, unknown>;
    assert.equal(adapterOptions.runId, 'webvoyager_lite_forwarding_unit');
    assert.equal(adapterOptions.attempt, 1);
    assert.equal(adapterOptions.plannerMode, undefined);
    assert.deepEqual(adapterOptions.plannerSerialization, plannerSerialization);
    assert.deepEqual(adapterOptions.workingSetOptions, { readablePhraseBonus: 60 });
    assert.deepEqual(benchmark.runMetadata?.plannerSerialization, plannerSerialization);
    assert.deepEqual(benchmark.runMetadata?.workingSetOptions, { readablePhraseBonus: 60 });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('runWebVoyagerLite keeps planner options undefined when no planner configuration is passed', async () => {
  const sourceRoot = await writeWebVoyagerFixtureSource();
  const outputRoot = await mkdtemp(join(tmpdir(), 'webvoyager-output-'));
  const seenOptions: unknown[] = [];
  try {
    const { benchmark } = await runWebVoyagerLite({
      sourceRoot,
      runId: 'webvoyager_lite_default_unit',
      outputRoot,
      adapter: recordingBenchmarkAdapter(seenOptions),
      taskIds: ['GitHub__0'],
      traceAudit: async () => ({ ok: true, errors: [] }),
    });

    const adapterOptions = seenOptions[0] as {
      plannerMode?: unknown;
      plannerSerialization?: unknown;
      workingSetOptions?: unknown;
    };
    assert.equal(adapterOptions.plannerSerialization, undefined);
    assert.equal(adapterOptions.workingSetOptions, undefined);
    assert.equal(benchmark.runMetadata?.plannerSerialization, undefined);
    assert.equal('workingSetOptions' in (benchmark.runMetadata ?? {}), false);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
