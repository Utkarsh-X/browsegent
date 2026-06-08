import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { auditTraceReplay } from '../../../src/v2';
import { createBenchmarkAdapter, readBenchmarkAdapterId } from './adapter_factory';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import { resolveBenchmarkRateLimit } from './benchmark_rate_limit';
import {
  applyGeminiKeySelection,
  collectGeminiKeyPool,
  collectGeminiKeyPoolDiagnostics,
  readRequestedGeminiKeyIndex,
  selectGeminiKeyForAttempt,
  selectGeminiKeyForRun,
} from './gemini_key_pool';
import { startLocalFixtureServerForTasks } from './local_fixture_server';
import { LOCAL_BENCHMARK_TASKS } from './local_tasks';
import { buildMvrReadinessReport, renderMvrReadinessMarkdown } from './readiness';
import { collectBenchmarkDiagnostics } from './diagnostics';
import { buildBenchmarkReport } from './report';
import { scoreBenchmarkResult } from './scoring';
import type {
  BenchmarkAdapter,
  BenchmarkGeminiKeyAssignment,
  BenchmarkPartition,
  BenchmarkReport,
  BenchmarkRunMetadata,
  BenchmarkTask,
  BenchmarkTraceScore,
  ScoredBenchmarkResult,
} from './types';

export type BenchmarkPartitionSelection = BenchmarkPartition | 'all';

export interface RunBenchmarkOptions {
  runId?: string;
  outputRoot?: string;
  adapter?: BenchmarkAdapter;
  tasks?: BenchmarkTask[];
  model?: string;
  repeat?: number;
  count?: number;
  partition?: BenchmarkPartitionSelection;
  headed?: boolean;
  env?: NodeJS.ProcessEnv;
  geminiKeyIndex?: number;
  requestRpm?: number;
  requestMinIntervalMs?: number;
  traceAudit?: (
    tracePath: string | undefined,
    expectedPlannerCalls: number,
    expectedToolExecutions: number,
  ) => Promise<BenchmarkTraceScore>;
  plannerMode?: 'current' | 'compact_enforced';
}

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<BenchmarkReport> {
  const runId = options.runId ?? `benchmark_${Date.now()}`;
  const env = options.env ?? process.env;
  const geminiKeyPool = collectGeminiKeyPool(env);
  const geminiKeyDiagnostics = collectGeminiKeyPoolDiagnostics(env);
  const initialGeminiSelection = selectGeminiKeyForRun(runId, geminiKeyPool, options.geminiKeyIndex);
  applyGeminiKeySelection(env, initialGeminiSelection);
  const rateLimit = resolveBenchmarkRateLimit({
    requestRpm: options.requestRpm,
    requestMinIntervalMs: options.requestMinIntervalMs,
    env,
  });
  if (rateLimit.mode === 'paced') {
    env.BROWSEGENT_GEMINI_MIN_INTERVAL_MS = String(rateLimit.minIntervalMs);
  }
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'v2-benchmark');
  const runRoot = join(outputRoot, runId);
  const traceDir = join(runRoot, 'traces');
  const adapter = options.adapter ?? new BrowseGentBenchmarkAdapter();
  const selectedTasks = selectBenchmarkTasks(
    options.tasks ?? LOCAL_BENCHMARK_TASKS,
    options.partition ?? 'all',
  ).slice(0, options.count);
  const repeat = Math.max(1, options.repeat ?? 1);
  const startedAt = new Date().toISOString();
  const scoredResults: ScoredBenchmarkResult[] = [];
  const keyAssignments: BenchmarkGeminiKeyAssignment[] = [];

  await mkdir(runRoot, { recursive: true });
  const fixtureServer = await startLocalFixtureServerForTasks(selectedTasks);
  const tasks = fixtureServer
    ? selectedTasks.map(task => fixtureServer.rewriteTask(task))
    : selectedTasks;

  try {
    let executionIndex = 0;
    for (const task of tasks) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        const geminiSelection = selectGeminiKeyForAttempt(
          runId,
          geminiKeyPool,
          executionIndex,
          options.geminiKeyIndex,
        );
        applyGeminiKeySelection(env, geminiSelection);
        if (geminiSelection) {
          keyAssignments.push({
            taskId: task.taskId,
            attempt,
            keyIndex: geminiSelection.keyIndex,
            selectedEnvName: geminiSelection.envName,
          });
        }
        executionIndex += 1;
        const result = await adapter.run(task, {
          runId,
          attempt,
          model: options.model,
          maxSteps: task.maxSteps,
          traceDir,
          headed: options.headed ?? false,
          requestMinIntervalMs: rateLimit.mode === 'paced' ? rateLimit.minIntervalMs : undefined,
          plannerMode: options.plannerMode,
        });
        const trace = options.traceAudit
          ? await options.traceAudit(
            result.tracePath,
            Math.max(1, result.metrics.plannerCalls),
            result.metrics.toolExecutions,
          )
          : await auditBenchmarkEvidence(
            adapter,
            result,
            Math.max(1, result.metrics.plannerCalls),
            result.metrics.toolExecutions,
          );
        result.diagnostics = await collectBenchmarkDiagnostics(result);
        scoredResults.push(scoreBenchmarkResult(task, result, trace));
      }
    }

    const report = buildBenchmarkReport({
      runId,
      adapterId: adapter.adapterId,
      startedAt,
      completedAt: new Date().toISOString(),
      model: options.model,
      runMetadata: buildRunMetadata(geminiKeyDiagnostics, initialGeminiSelection, rateLimit, keyAssignments),
      results: scoredResults,
    });

    await writeFile(join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(join(runRoot, 'summary.md'), renderMarkdownSummary(report), 'utf8');
    const readiness = buildMvrReadinessReport(report);
    await writeFile(join(runRoot, 'readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
    await writeFile(join(runRoot, 'readiness.md'), renderMvrReadinessMarkdown(readiness), 'utf8');
    return report;
  } finally {
    await fixtureServer?.close();
  }
}

async function auditBenchmarkTrace(
  tracePath: string | undefined,
  expectedPlannerCalls: number,
  expectedToolExecutions: number,
): Promise<BenchmarkTraceScore> {
  if (!tracePath) return { ok: false, errors: ['missing_trace_path'] };
  const audit = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls,
    expectedToolExecutions,
    requireAgentMode: true,
    allowFailedRuntimeSteps: true,
  });
  return { ok: audit.ok, errors: audit.errors };
}

async function auditBenchmarkEvidence(
  adapter: BenchmarkAdapter,
  result: ScoredBenchmarkResult | Awaited<ReturnType<BenchmarkAdapter['run']>>,
  expectedPlannerCalls: number,
  expectedToolExecutions: number,
): Promise<BenchmarkTraceScore> {
  if (adapter.traceMode === 'external_artifact') {
    return auditExternalArtifact(result.artifactPath);
  }
  return auditBenchmarkTrace(result.tracePath, expectedPlannerCalls, expectedToolExecutions);
}

async function auditExternalArtifact(artifactPath: string | undefined): Promise<BenchmarkTraceScore> {
  if (!artifactPath) return { ok: false, errors: ['missing_artifact_path'] };
  try {
    await access(artifactPath);
    return { ok: true, errors: [] };
  } catch {
    return { ok: false, errors: ['missing_artifact_path'] };
  }
}

function buildRunMetadata(
  keyDiagnostics: ReturnType<typeof collectGeminiKeyPoolDiagnostics>,
  selection: ReturnType<typeof selectGeminiKeyForRun>,
  rateLimit: ReturnType<typeof resolveBenchmarkRateLimit>,
  assignments: BenchmarkGeminiKeyAssignment[],
): BenchmarkRunMetadata {
  return {
    geminiKeyPool: {
      keyCount: keyDiagnostics.uniqueKeyCount,
      configuredKeyCount: keyDiagnostics.configuredKeyCount,
      uniqueKeyCount: keyDiagnostics.uniqueKeyCount,
      duplicateKeyCount: keyDiagnostics.duplicateKeyCount,
      keyIndex: selection?.keyIndex,
      selectedEnvName: selection?.envName,
      assignmentMode: assignments.length > 0 ? 'per_task_attempt' : undefined,
      assignments: assignments.length > 0 ? assignments : undefined,
    },
    rateLimit,
  };
}

function renderMarkdownSummary(report: BenchmarkReport): string {
  return [
    `# BrowseGent v2 Benchmark ${report.runId}`,
    '',
    `Adapter: ${report.adapterId}`,
    `Model: ${report.model ?? 'default'}`,
    `Gemini key pool: ${report.runMetadata?.geminiKeyPool?.keyCount ?? 0} keys${report.runMetadata?.geminiKeyPool?.keyIndex ? `, start index ${report.runMetadata.geminiKeyPool.keyIndex}` : ''}`,
    `Gemini key diagnostics: configured ${report.runMetadata?.geminiKeyPool?.configuredKeyCount ?? 0}, unique ${report.runMetadata?.geminiKeyPool?.uniqueKeyCount ?? 0}, duplicates ${report.runMetadata?.geminiKeyPool?.duplicateKeyCount ?? 0}`,
    `Gemini key assignment: ${report.runMetadata?.geminiKeyPool?.assignmentMode ?? 'none'}${report.runMetadata?.geminiKeyPool?.assignments?.length ? `, ${report.runMetadata.geminiKeyPool.assignments.length} task attempts` : ''}`,
    `Rate limit: ${report.runMetadata?.rateLimit?.mode ?? 'disabled'}${report.runMetadata?.rateLimit?.minIntervalMs ? `, ${report.runMetadata.rateLimit.minIntervalMs}ms minimum interval` : ''}`,
    `Runs: ${report.summary.totalRuns}`,
    `Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
    `Trace complete rate: ${(report.summary.traceCompleteRate * 100).toFixed(1)}%`,
    `Avg planner calls: ${report.summary.avgPlannerCalls.toFixed(2)}`,
    `Avg tool executions: ${report.summary.avgToolExecutions.toFixed(2)}`,
    `Max planner input artifact: ${report.summary.diagnostics?.maxPlannerInputBytes ?? 0} bytes`,
    `Max projection section: ${report.summary.diagnostics?.maxProjectionBytes ?? 0} bytes`,
    `Max readable/interaction projection sections: ${report.summary.diagnostics?.maxReadableProjectionBytes ?? 0}/${report.summary.diagnostics?.maxInteractionProjectionBytes ?? 0} bytes`,
    `Max observation artifact: ${report.summary.diagnostics?.maxObservationBytes ?? 0} bytes`,
    `Max projection multi-section refs: ${report.summary.diagnostics?.maxProjectionMultiSectionRefs ?? 0}`,
    `Repeated/invalid action markers: ${report.summary.diagnostics?.totalRepeatedActions ?? 0}/${report.summary.diagnostics?.totalInvalidActions ?? 0}`,
    `Dev pass rate: ${(report.summary.partitions.dev.passRate * 100).toFixed(1)}% (${report.summary.partitions.dev.passedRuns}/${report.summary.partitions.dev.totalRuns})`,
    `Holdout pass rate: ${(report.summary.partitions.holdout.passRate * 100).toFixed(1)}% (${report.summary.partitions.holdout.passedRuns}/${report.summary.partitions.holdout.totalRuns})`,
    '',
  ].join('\n');
}

export function selectBenchmarkTasks(
  tasks: BenchmarkTask[],
  partition: BenchmarkPartitionSelection,
): BenchmarkTask[] {
  if (partition === 'all') return tasks;
  return tasks.filter(task => task.partition === partition);
}

if (require.main === module) {
  runBenchmark(readCliOptions())
    .then(report => {
      console.log(JSON.stringify(report.summary, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

function readCliOptions(): RunBenchmarkOptions {
  const model = readModelArg();
  const adapterId = readBenchmarkAdapterId(readFlag('--adapter'));
  const countArg = readFlag('--count');
  const repeatArg = readFlag('--repeat');
  const keyIndexArg = readFlag('--key-index');
  const requestRpmArg = readFlag('--request-rpm');
  const requestMinIntervalArg = readFlag('--request-min-interval-ms');
  const partitionArg = readPartitionArg();
  const plannerModeArg = readFlag('--planner-mode');
  let plannerMode: 'current' | 'compact_enforced' = 'current';
  if (plannerModeArg === 'current' || plannerModeArg === 'compact_enforced') {
    plannerMode = plannerModeArg;
  } else if (plannerModeArg !== undefined) {
    throw new Error(`Unsupported --planner-mode "${plannerModeArg}". Use current or compact_enforced.`);
  }

  return {
    adapter: createBenchmarkAdapter(adapterId, { env: process.env }),
    model,
    count: countArg ? Number(countArg) : undefined,
    repeat: repeatArg ? Number(repeatArg) : undefined,
    geminiKeyIndex: keyIndexArg ? Number(keyIndexArg) : readRequestedGeminiKeyIndex(),
    requestRpm: requestRpmArg ? Number(requestRpmArg) : undefined,
    requestMinIntervalMs: requestMinIntervalArg ? Number(requestMinIntervalArg) : undefined,
    partition: partitionArg,
    plannerMode,
  };
}

function readModelArg(): string | undefined {
  const scriptIndex = process.argv.findIndex(arg => arg.endsWith('run_benchmark.ts'));
  const args = process.argv.slice(scriptIndex === -1 ? 2 : scriptIndex + 1);
  return args.find(arg => !arg.startsWith('--') && !isFlagValue(args, arg));
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readPartitionArg(): BenchmarkPartitionSelection | undefined {
  const value = readFlag('--partition');
  if (value === undefined || value === 'all' || value === 'dev' || value === 'holdout') {
    return value;
  }
  throw new Error(`Unsupported benchmark partition "${value}". Use all, dev, or holdout.`);
}

function isFlagValue(args: string[], value: string): boolean {
  const index = args.indexOf(value);
  return index > 0 && args[index - 1]?.startsWith('--') === true;
}
