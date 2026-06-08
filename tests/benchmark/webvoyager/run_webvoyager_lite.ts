import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createBenchmarkAdapter, readBenchmarkAdapterId } from '../v2/adapter_factory';
import { runBenchmark, type RunBenchmarkOptions } from '../v2/run_benchmark';
import type { BenchmarkAdapter, BenchmarkReport, BenchmarkTraceScore } from '../v2/types';
import { buildWebVoyagerTaskArtifactSummary } from './artifacts';
import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from './evaluator';
import { loadWebVoyagerManualAudit } from './manual_audit';
import { loadWebVoyagerSource } from './source_loader';
import { resolveWebVoyagerTaskIds, selectWebVoyagerLiteTasks, toBenchmarkTasks, type WebVoyagerTaskSlice } from './task_selection';
import type { WebVoyagerBenchmarkTask, WebVoyagerVerdict } from './types';

export interface RunWebVoyagerLiteOptions {
  sourceRoot: string;
  runId?: string;
  outputRoot?: string;
  adapter?: BenchmarkAdapter;
  taskIds?: readonly string[];
  taskSlice?: WebVoyagerTaskSlice;
  count?: number;
  model?: string;
  requestRpm?: number;
  requestMinIntervalMs?: number;
  geminiKeyIndex?: number;
  headed?: boolean;
  traceAudit?: RunBenchmarkOptions['traceAudit'];
  manualAuditPath?: string;
  plannerMode?: 'current' | 'compact_enforced';
}

export interface WebVoyagerLiteRunResult {
  benchmark: BenchmarkReport;
  evaluation: {
    summary: ReturnType<typeof summarizeWebVoyagerEvaluation>;
    verdicts: WebVoyagerVerdict[];
    tasks: Array<WebVoyagerBenchmarkTask['webVoyager']>;
  };
}

export async function runWebVoyagerLite(options: RunWebVoyagerLiteOptions): Promise<WebVoyagerLiteRunResult> {
  const runId = options.runId ?? `webvoyager_lite_${Date.now()}`;
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'webvoyager-lite');
  const runRoot = join(outputRoot, runId);
  const source = await loadWebVoyagerSource(options.sourceRoot);
  const taskIds = options.taskIds ?? resolveWebVoyagerTaskIds(options.taskSlice);
  const selectedSourceTasks = selectWebVoyagerLiteTasks(
    source.tasks,
    taskIds,
  ).slice(0, options.count);
  const tasks = toBenchmarkTasks(selectedSourceTasks, source.references);

  const benchmark = await runBenchmark({
    runId,
    outputRoot,
    adapter: options.adapter,
    tasks,
    model: options.model,
    requestRpm: options.requestRpm,
    requestMinIntervalMs: options.requestMinIntervalMs,
    geminiKeyIndex: options.geminiKeyIndex,
    headed: options.headed,
    traceAudit: options.traceAudit,
    plannerMode: options.plannerMode,
  });

  const byTaskId = new Map(tasks.map(task => [task.taskId, task]));
  const manualAudit = await loadWebVoyagerManualAudit(options.manualAuditPath);
  const verdicts = benchmark.results.map(result => evaluateWebVoyagerResult(
    byTaskId.get(result.taskId)!,
    result,
    manualAudit.get(result.taskId),
  ));
  const evaluation = {
    summary: summarizeWebVoyagerEvaluation(verdicts),
    verdicts,
    tasks: tasks.map(task => task.webVoyager),
  };

  await mkdir(runRoot, { recursive: true });
  await writeFile(join(runRoot, 'webvoyager_evaluation.json'), `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  await writeFile(join(runRoot, 'webvoyager_evaluation.md'), renderWebVoyagerEvaluationMarkdown(evaluation), 'utf8');

  const artifactSummaries = benchmark.results.map(result => buildWebVoyagerTaskArtifactSummary(byTaskId.get(result.taskId)!, result));
  await writeFile(join(runRoot, 'webvoyager_artifacts.json'), `${JSON.stringify(artifactSummaries, null, 2)}\n`, 'utf8');

  return { benchmark, evaluation };
}

export function renderWebVoyagerEvaluationMarkdown(evaluation: WebVoyagerLiteRunResult['evaluation']): string {
  return [
    '# WebVoyager-lite Evaluation',
    '',
    `Runs: ${evaluation.summary.totalRuns}`,
    `Internal pass rate: ${(evaluation.summary.internalPassRate * 100).toFixed(1)}%`,
    `Strict score: ${(evaluation.summary.strictScore * 100).toFixed(1)}%`,
    `Manual-corrected score: ${(evaluation.summary.manualCorrectedScore * 100).toFixed(1)}%`,
    `Partial-credit score: ${(evaluation.summary.partialCreditRate * 100).toFixed(1)}%`,
    `Environment-adjusted strict score: ${(evaluation.summary.environmentAdjustedStrictScore * 100).toFixed(1)}%`,
    `Environment-adjusted manual score: ${(evaluation.summary.environmentAdjustedManualScore * 100).toFixed(1)}%`,
    `Manual review count: ${evaluation.summary.manualReviewCount}`,
    `Environment blocked count: ${evaluation.summary.environmentBlockedCount}`,
    `Impossible task count: ${evaluation.summary.impossibleTaskCount}`,
    '',
    '| Task | Internal | Strict | Manual | Partial | Env | Ref Match | Review | Reasons |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...evaluation.verdicts.map(verdict => [
      verdict.taskId,
      verdict.internalPassed ? 1 : 0,
      verdict.strictScore,
      verdict.manualCorrectedScore,
      verdict.partialCredit,
      verdict.environmentStatus,
      verdict.referenceMatchType,
      verdict.needsManualReview ? 'yes' : 'no',
      verdict.reasons.join(', ') || 'none',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
  ].join('\n');
}

if (require.main === module) {
  runWebVoyagerLite(readCliOptions())
    .then(result => {
      console.log(JSON.stringify(result.evaluation.summary, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

function readCliOptions(): RunWebVoyagerLiteOptions {
  const sourceRoot = readFlag('--source-root') ?? process.env.WEBVOYAGER_SOURCE_ROOT;
  if (!sourceRoot) {
    throw new Error('Provide --source-root or WEBVOYAGER_SOURCE_ROOT pointing to the external WebVoyager clone.');
  }

  const model = readModelArg();
  const adapterId = readBenchmarkAdapterId(readFlag('--adapter'));
  const keyIndexArg = readFlag('--key-index');
  const requestRpmArg = readFlag('--request-rpm');
  const requestMinIntervalArg = readFlag('--request-min-interval-ms');
  const countArg = readFlag('--count');
  const taskIdsArg = readFlag('--task-ids');
  const taskIds = taskIdsArg ? taskIdsArg.split(',') : undefined;
  const taskSlice = readTaskSliceArg();
  const manualAuditPath = readFlag('--manual-audit');
  const plannerModeArg = readFlag('--planner-mode');
  let plannerMode: 'current' | 'compact_enforced' = 'current';
  if (plannerModeArg === 'current' || plannerModeArg === 'compact_enforced') {
    plannerMode = plannerModeArg;
  } else if (plannerModeArg !== undefined) {
    throw new Error(`Unsupported --planner-mode "${plannerModeArg}". Use current or compact_enforced.`);
  }

  return {
    sourceRoot,
    adapter: createBenchmarkAdapter(adapterId, { env: process.env }),
    model,
    count: countArg ? Number(countArg) : undefined,
    geminiKeyIndex: keyIndexArg ? Number(keyIndexArg) : undefined,
    requestRpm: requestRpmArg ? Number(requestRpmArg) : undefined,
    requestMinIntervalMs: requestMinIntervalArg ? Number(requestMinIntervalArg) : undefined,
    taskIds,
    taskSlice,
    manualAuditPath,
    plannerMode,
  };
}

function readModelArg(): string | undefined {
  const scriptIndex = process.argv.findIndex(arg => arg.endsWith('run_webvoyager_lite.ts'));
  const args = process.argv.slice(scriptIndex === -1 ? 2 : scriptIndex + 1);
  return args.find(arg => !arg.startsWith('--') && !isFlagValue(args, arg));
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readTaskSliceArg(): WebVoyagerTaskSlice | undefined {
  const value = readFlag('--slice');
  if (value === undefined || value === 'balanced30' || value === 'mvr5' || value === 'mvr5-stable') {
    return value;
  }
  throw new Error(`Unsupported WebVoyager slice "${value}". Use balanced30, mvr5, or mvr5-stable.`);
}

function isFlagValue(args: string[], value: string): boolean {
  const index = args.indexOf(value);
  return index > 0 && args[index - 1]?.startsWith('--') === true;
}
