import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';

import { createBenchmarkAdapter, readBenchmarkAdapterId } from '../v2/adapter_factory';
import { runBenchmark, type RunBenchmarkOptions } from '../v2/run_benchmark';
import type { BenchmarkAdapter, BenchmarkReport, BenchmarkTraceScore } from '../v2/types';
import { buildWebVoyagerTaskArtifactSummary } from './artifacts';
import { evaluateWebVoyagerResult, summarizeWebVoyagerEvaluation } from './evaluator';
import { collectFinalPageEvidence, judgeTaskResult } from './judge';
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
  plannerSerialization?: RunBenchmarkOptions['plannerSerialization'];
  /** Official-methodology LLM judge over internal-passed strict-0 tasks. */
  judgeEnabled?: boolean;
  judgeModel?: string;
  workingSetOptions?: RunBenchmarkOptions['workingSetOptions'];
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
    plannerSerialization: options.plannerSerialization,
    workingSetOptions: options.workingSetOptions,
  });

  const byTaskId = new Map(tasks.map(task => [task.taskId, task]));
  const manualAudit = await loadWebVoyagerManualAudit(options.manualAuditPath);
  const verdicts = benchmark.results.map(result => evaluateWebVoyagerResult(
    byTaskId.get(result.taskId)!,
    result,
    manualAudit.get(result.taskId),
  ));

  // Official-methodology judge: additive measurement over internal-passed
  // tasks whose strict score was zero — the cases where the string reference
  // matcher cannot validate live-varying results.
  const judgeEnabled = options.judgeEnabled === true;
  if (judgeEnabled) {
    const judgeModel = options.judgeModel;
    for (const verdict of verdicts) {
      if (verdict.internalPassed !== true || verdict.strictScore !== 0 || verdict.environmentStatus !== 'normal') continue;
      const result = benchmark.results.find(candidate => candidate.taskId === verdict.taskId);
      const tracePath = result?.tracePath;
      if (!tracePath) continue;
      const judgeOutcome = await judgeTaskResult({
        goal: byTaskId.get(verdict.taskId)?.goal ?? '',
        referenceHint: byTaskId.get(verdict.taskId)?.webVoyager.referenceAnswer?.answer as string | undefined,
        agentAnswer: result.value ?? '',
        finalUrl: readFinalPageUrl(tracePath),
        pageEvidence: collectFinalPageEvidence(tracePath, undefined, undefined, byTaskId.get(verdict.taskId)?.goal),
        judgeModel,
      });
      verdict.judgeVerdict = judgeOutcome.verdict;
      verdict.judgeReason = judgeOutcome.reason;
      verdict.judgeScore = judgeOutcome.verdict === 'SUCCESS' ? 1 : judgeOutcome.verdict === 'NOT_SUCCESS' ? 0 : undefined;
    }
  }

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

function readFinalPageUrl(tracePath: string | undefined): string | undefined {
  if (!tracePath) return undefined;
  try {
    const isDir = existsSync(tracePath) && statSync(tracePath).isDirectory();
    const traceFile = isDir ? join(tracePath, 'trace.json') : tracePath;
    if (existsSync(traceFile)) {
      const trace = JSON.parse(readFileSync(traceFile, 'utf8'));
      const observations = Array.isArray(trace?.observations) ? trace.observations : [];
      for (let index = observations.length - 1; index >= 0; index -= 1) {
        const url = observations[index]?.observation?.url;
        if (typeof url === 'string' && url.length > 0) return url;
      }
    }
  } catch {
    // continue to fallback
  }

  try {
    const dir = existsSync(tracePath) && statSync(tracePath).isDirectory() ? tracePath : dirname(tracePath);
    const stderrFile = join(dir, 'stderr.txt');
    if (existsSync(stderrFile)) {
      const stderr = readFileSync(stderrFile, 'utf8');
      const urlMatches = [...stderr.matchAll(/'url':\s*'([^']+)'/g)];
      if (urlMatches.length > 0) {
        return urlMatches[urlMatches.length - 1][1];
      }
    }
    const inputFile = join(dir, 'input.json');
    if (existsSync(inputFile)) {
      const input = JSON.parse(readFileSync(inputFile, 'utf8'));
      if (input.url) return input.url;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    evaluation.summary.judgedCount
      ? `Judge score (official methodology, ${evaluation.summary.judgedCount} judged): ${((evaluation.summary.judgeScoreRate ?? 0) * 100).toFixed(1)}%`
      : undefined,
    evaluation.summary.judgedCount
      ? `Environment-adjusted judge score: ${((evaluation.summary.environmentAdjustedJudgeScore ?? 0) * 100).toFixed(1)}%`
      : undefined,
    `Manual review count: ${evaluation.summary.manualReviewCount}`,
    `Environment blocked count: ${evaluation.summary.environmentBlockedCount}`,
    `Impossible task count: ${evaluation.summary.impossibleTaskCount}`,
    '',
    '| Task | Internal | Strict | Judge | Manual | Partial | Env | Ref Match | Review | Reasons |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...evaluation.verdicts.map(verdict => [
      verdict.taskId,
      verdict.internalPassed ? 1 : 0,
      verdict.strictScore,
      verdict.judgeScore !== undefined ? verdict.judgeScore : '-',
      verdict.manualCorrectedScore,
      verdict.partialCredit,
      verdict.environmentStatus,
      verdict.referenceMatchType,
      verdict.needsManualReview ? 'yes' : 'no',
      [verdict.reasons.join(', '), verdict.judgeVerdict ? `judge:${verdict.judgeVerdict}` : ''].filter(Boolean).join('; ') || 'none',
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

export function readCliOptions(): RunWebVoyagerLiteOptions {
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
  const plannerSerializationArg = readPlannerSerializationArg();
  if (plannerModeArg !== undefined) {
    throw new Error(`--planner-mode "${plannerModeArg}" is no longer supported; the compact_enforced plane was removed (use --planner-serialization).`);
  }

  const judgeEnabled = hasFlag('--judge');
  const judgeModel = readFlag('--judge-model');

  return {
    sourceRoot,
    adapter: createBenchmarkAdapter(adapterId, { env: process.env }),
    judgeEnabled,
    judgeModel,
    model,
    headed: hasFlag('--headed') || process.env.BROWSEGENT_V2_HEADED === 'true',
    count: countArg ? Number(countArg) : undefined,
    geminiKeyIndex: keyIndexArg ? Number(keyIndexArg) : undefined,
    requestRpm: requestRpmArg ? Number(requestRpmArg) : undefined,
    requestMinIntervalMs: requestMinIntervalArg ? Number(requestMinIntervalArg) : undefined,
    taskIds,
    taskSlice,
    manualAuditPath,
    plannerSerialization: readPlannerSerializationConfig(plannerSerializationArg),
    workingSetOptions: readWorkingSetOptions(),
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
  if (
    value === undefined ||
    value === 'balanced30' ||
    value === 'mvr5' ||
    value === 'mvr5-stable' ||
    value === 'fresh50' ||
    value === 'fresh50-stable'
  ) {
    return value;
  }
  throw new Error(`Unsupported WebVoyager slice "${value}". Use balanced30, mvr5, mvr5-stable, fresh50, or fresh50-stable.`);
}

function readPlannerSerializationArg(): NonNullable<RunBenchmarkOptions['plannerSerialization']>['mode'] | undefined {
  const value = readFlag('--planner-serialization');
  if (value === undefined || value === 'json' || value === 'prc') {
    return value;
  }
  throw new Error(`Unsupported --planner-serialization "${value}". Use json or prc.`);
}

function readPlannerSerializationConfig(
  mode: NonNullable<RunBenchmarkOptions['plannerSerialization']>['mode'] | undefined,
): RunBenchmarkOptions['plannerSerialization'] {
  const prcTierOmitted = hasFlag('--prc-tier-omitted');
  const compactDataPlane = hasFlag('--compact-data-plane');
  const prcLeanPlane = hasFlag('--prc-lean-plane');
  const conditionalPrompt = hasFlag('--planner-conditional-prompt');
  const stableOrder = hasFlag('--prc-stable-order');
  const composedPrompt = hasFlag('--planner-composed-prompt');
  const pageModel = hasFlag('--prc-page-model');
  const noJsonSchema = hasFlag('--planner-no-json-schema');
  if (prcTierOmitted || compactDataPlane || prcLeanPlane || conditionalPrompt || stableOrder || composedPrompt || pageModel) {
    if (mode !== 'prc') {
      const flags = [
        ...(prcTierOmitted ? ['--prc-tier-omitted'] : []),
        ...(compactDataPlane ? ['--compact-data-plane'] : []),
        ...(prcLeanPlane ? ['--prc-lean-plane'] : []),
        ...(conditionalPrompt ? ['--planner-conditional-prompt'] : []),
        ...(stableOrder ? ['--prc-stable-order'] : []),
        ...(composedPrompt ? ['--planner-composed-prompt'] : []),
        ...(pageModel ? ['--prc-page-model'] : []),
      ];
      throw new Error(`${flags.join(' and ')} require --planner-serialization prc.`);
    }
    return {
      mode,
      ...(prcTierOmitted ? { prcTierOmitted: true } : {}),
      ...(compactDataPlane ? { compactDataPlane: true } : {}),
      ...(prcLeanPlane ? { prcLeanPlane: true } : {}),
      ...(conditionalPrompt ? { conditionalSystemPrompt: true } : {}),
      ...(stableOrder ? { prcStableOrder: true } : {}),
      ...(composedPrompt ? { composedPrompt: true } : {}),
      ...(pageModel ? { pageModel: true } : {}),
    };
  }
  if (noJsonSchema) {
    if (mode === undefined) {
      throw new Error('--planner-no-json-schema requires --planner-serialization (json or prc).');
    }
    return { mode, ...(noJsonSchema ? { omitResponseJsonSchema: true } : {}) };
  }
  return mode === undefined ? undefined : { mode };
}

function readWorkingSetOptions(): RunBenchmarkOptions['workingSetOptions'] {
  const bonusArg = readFlag('--readable-phrase-bonus');
  if (bonusArg === undefined) return undefined;
  const readablePhraseBonus = Number(bonusArg);
  if (!Number.isFinite(readablePhraseBonus) || readablePhraseBonus < 0) {
    throw new Error(`Unsupported --readable-phrase-bonus "${bonusArg}". Use a non-negative finite number.`);
  }
  return { readablePhraseBonus };
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function isFlagValue(args: string[], value: string): boolean {
  const index = args.indexOf(value);
  return index > 0 && args[index - 1]?.startsWith('--') === true;
}
