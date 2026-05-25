import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { auditTraceReplay } from '../../../src/v2';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import { LOCAL_BENCHMARK_TASKS } from './local_tasks';
import { buildMvrReadinessReport, renderMvrReadinessMarkdown } from './readiness';
import { buildBenchmarkReport } from './report';
import { scoreBenchmarkResult } from './scoring';
import type {
  BenchmarkAdapter,
  BenchmarkPartition,
  BenchmarkReport,
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
  traceAudit?: (
    tracePath: string | undefined,
    expectedPlannerCalls: number,
    expectedToolExecutions: number,
  ) => Promise<BenchmarkTraceScore>;
}

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<BenchmarkReport> {
  const runId = options.runId ?? `benchmark_${Date.now()}`;
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'v2-benchmark');
  const runRoot = join(outputRoot, runId);
  const traceDir = join(runRoot, 'traces');
  const adapter = options.adapter ?? new BrowseGentBenchmarkAdapter();
  const tasks = selectBenchmarkTasks(
    options.tasks ?? LOCAL_BENCHMARK_TASKS,
    options.partition ?? 'all',
  ).slice(0, options.count);
  const repeat = Math.max(1, options.repeat ?? 1);
  const startedAt = new Date().toISOString();
  const scoredResults: ScoredBenchmarkResult[] = [];

  await mkdir(runRoot, { recursive: true });

  for (const task of tasks) {
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const result = await adapter.run(task, {
        runId,
        attempt,
        model: options.model,
        maxSteps: task.maxSteps,
        traceDir,
        headed: options.headed ?? false,
      });
      const trace = await (options.traceAudit ?? auditBenchmarkTrace)(
        result.tracePath,
        Math.max(1, result.metrics.plannerCalls),
        result.metrics.toolExecutions,
      );
      scoredResults.push(scoreBenchmarkResult(task, result, trace));
    }
  }

  const report = buildBenchmarkReport({
    runId,
    adapterId: adapter.adapterId,
    startedAt,
    completedAt: new Date().toISOString(),
    model: options.model,
    results: scoredResults,
  });

  await writeFile(join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(runRoot, 'summary.md'), renderMarkdownSummary(report), 'utf8');
  const readiness = buildMvrReadinessReport(report);
  await writeFile(join(runRoot, 'readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  await writeFile(join(runRoot, 'readiness.md'), renderMvrReadinessMarkdown(readiness), 'utf8');
  return report;
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

function renderMarkdownSummary(report: BenchmarkReport): string {
  return [
    `# BrowseGent v2 Benchmark ${report.runId}`,
    '',
    `Adapter: ${report.adapterId}`,
    `Model: ${report.model ?? 'default'}`,
    `Runs: ${report.summary.totalRuns}`,
    `Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
    `Trace complete rate: ${(report.summary.traceCompleteRate * 100).toFixed(1)}%`,
    `Avg planner calls: ${report.summary.avgPlannerCalls.toFixed(2)}`,
    `Avg tool executions: ${report.summary.avgToolExecutions.toFixed(2)}`,
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
  const countArg = readFlag('--count');
  const repeatArg = readFlag('--repeat');
  const partitionArg = readPartitionArg();
  return {
    model,
    count: countArg ? Number(countArg) : undefined,
    repeat: repeatArg ? Number(repeatArg) : undefined,
    partition: partitionArg,
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
