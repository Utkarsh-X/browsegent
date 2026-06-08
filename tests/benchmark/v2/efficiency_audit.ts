import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { BenchmarkReport } from './types';
import { buildCompactPlannerView, measureCompactPlannerView } from './compact_planner_view';

interface PlannerInput {
  current?: { refs?: Record<string, unknown> };
  workingSet?: {
    primaryRefs?: unknown[];
    secondaryRefs?: unknown[];
    readableEvidence?: unknown[];
  };
  [key: string]: unknown;
}

export interface PlannerInputSectionBreakdown {
  taskId: string;
  plannerInputCount: number;
  maxInputBytes: number;
  averageInputBytes: number;
  maxSections: Record<string, number>;
  averageSections: Record<string, number>;
  maxRefCount: number;
  maxWorkingSetPrimaryRefs: number;
  maxWorkingSetSecondaryRefs: number;
  maxWorkingSetReadableEvidence: number;
}

export interface RefFailureSummary {
  taskId: string;
  totalFailures: number;
  byKind: Record<string, number>;
  byTargetRef: Record<string, number>;
}


export interface EfficiencyRunSummary {
  runId: string;
  adapterId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalPlannerCalls: number;
  totalToolExecutions: number;
  totalDurationMs: number;
  perTask: EfficiencyTaskSummary[];
}

export interface EfficiencyTaskSummary {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
  passed: boolean;
}

export interface EfficiencyComparison {
  left: EfficiencyRunSummary;
  right: EfficiencyRunSummary;
  ratios: {
    inputTokens: number;
    outputTokens: number;
    plannerCalls: number;
    toolExecutions: number;
    durationMs: number;
  };
}

export async function loadBenchmarkReport(runRoot: string): Promise<BenchmarkReport> {
  return JSON.parse(await readFile(join(runRoot, 'report.json'), 'utf8')) as BenchmarkReport;
}

export function summarizeEfficiency(report: BenchmarkReport): EfficiencyRunSummary {
  return {
    runId: report.runId,
    adapterId: report.adapterId,
    totalInputTokens: sum(report.results.map(result => result.metrics.inputTokens ?? 0)),
    totalOutputTokens: sum(report.results.map(result => result.metrics.outputTokens ?? 0)),
    totalPlannerCalls: sum(report.results.map(result => result.metrics.plannerCalls)),
    totalToolExecutions: sum(report.results.map(result => result.metrics.toolExecutions)),
    totalDurationMs: sum(report.results.map(result => result.metrics.durationMs)),
    perTask: report.results.map(result => ({
      taskId: result.taskId,
      inputTokens: result.metrics.inputTokens ?? 0,
      outputTokens: result.metrics.outputTokens ?? 0,
      plannerCalls: result.metrics.plannerCalls,
      toolExecutions: result.metrics.toolExecutions,
      durationMs: result.metrics.durationMs,
      passed: result.passed,
    })),
  };
}

export function compareEfficiency(left: EfficiencyRunSummary, right: EfficiencyRunSummary): EfficiencyComparison {
  return {
    left,
    right,
    ratios: {
      inputTokens: ratio(left.totalInputTokens, right.totalInputTokens),
      outputTokens: ratio(left.totalOutputTokens, right.totalOutputTokens),
      plannerCalls: ratio(left.totalPlannerCalls, right.totalPlannerCalls),
      toolExecutions: ratio(left.totalToolExecutions, right.totalToolExecutions),
      durationMs: ratio(left.totalDurationMs, right.totalDurationMs),
    },
  };
}

export async function writeEfficiencyComparisonMarkdown(outputPath: string, comparison: EfficiencyComparison): Promise<void> {
  await mkdir(join(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, renderEfficiencyComparisonMarkdown(comparison), 'utf8');
}

export function renderEfficiencyComparisonMarkdown(comparison: EfficiencyComparison): string {
  const rows = [
    ['Input tokens', comparison.left.totalInputTokens, comparison.right.totalInputTokens, comparison.ratios.inputTokens],
    ['Output tokens', comparison.left.totalOutputTokens, comparison.right.totalOutputTokens, comparison.ratios.outputTokens],
    ['Planner calls', comparison.left.totalPlannerCalls, comparison.right.totalPlannerCalls, comparison.ratios.plannerCalls],
    ['Tool executions', comparison.left.totalToolExecutions, comparison.right.totalToolExecutions, comparison.ratios.toolExecutions],
    ['Duration ms', comparison.left.totalDurationMs, comparison.right.totalDurationMs, comparison.ratios.durationMs],
  ];

  return [
    '# Efficiency Root-Cause Audit',
    '',
    `Left: ${comparison.left.adapterId} (${comparison.left.runId})`,
    `Right: ${comparison.right.adapterId} (${comparison.right.runId})`,
    '',
    '| Metric | Left | Right | Left/Right |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(([label, left, right, value]) => `| ${label} | ${left} | ${right} | ${value === Infinity ? '∞' : (value as number).toFixed(2) + 'x'} |`),
    '',
  ].join('\n');
}

export async function collectRefFailureSummaries(report: BenchmarkReport): Promise<RefFailureSummary[]> {
  const summaries: RefFailureSummary[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const failureDir = join(result.tracePath, '..', 'failures');
    const files = (await safeReaddir(failureDir)).filter(file => file.endsWith('.json'));
    const failures = (
      await Promise.all(
        files.map(async file => {
          try {
            return JSON.parse(await readFile(join(failureDir, file), 'utf8')) as {
              kind?: string;
              targetRef?: string;
            };
          } catch (error) {
            console.warn(`Failed to read or parse failure file ${file} in ${failureDir}:`, error);
            return null;
          }
        })
      )
    ).filter((x): x is { kind?: string; targetRef?: string } => x !== null);
    summaries.push(summarizeRefFailures(result.taskId, failures));
  }
  return summaries;
}

export function summarizeRefFailures(taskId: string, failures: Array<{ kind?: string; targetRef?: string }>): RefFailureSummary {
  const byKind: Record<string, number> = {};
  const byTargetRef: Record<string, number> = {};
  for (const failure of failures) {
    const kind = failure.kind ?? 'unknown';
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (failure.targetRef) {
      byTargetRef[failure.targetRef] = (byTargetRef[failure.targetRef] ?? 0) + 1;
    }
  }
  return {
    taskId,
    totalFailures: failures.length,
    byKind,
    byTargetRef,
  };
}

export async function collectPlannerInputBreakdowns(runRoot: string, report: BenchmarkReport): Promise<PlannerInputSectionBreakdown[]> {
  const rows: PlannerInputSectionBreakdown[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const plannerDir = join(result.tracePath, '..', 'planner');
    const files = (await safeReaddir(plannerDir)).filter(file => file.endsWith('-input.json'));
    const inputs = (
      await Promise.all(
        files.map(async file => {
          try {
            return JSON.parse(await readFile(join(plannerDir, file), 'utf8')) as PlannerInput;
          } catch (error) {
            console.warn(`Failed to read or parse planner input ${file} in ${plannerDir}:`, error);
            return null;
          }
        })
      )
    ).filter((x): x is PlannerInput => x !== null);
    if (inputs.length === 0) continue;
    rows.push(buildPlannerInputBreakdown(result.taskId, inputs));
  }
  return rows;
}

export function buildPlannerInputBreakdown(taskId: string, inputs: PlannerInput[]): PlannerInputSectionBreakdown {
  const sectionNames = ['goal', 'current', 'workingSet', 'continuity', 'transition', 'lastResult', 'failures', 'deadState', 'recovery', 'uncertainty', 'lineage'];
  const inputBytes = inputs.map(input => byteLength(input));
  const sectionByteRows = inputs.map(input => Object.fromEntries(sectionNames.map(name => [name, byteLength(input[name])])) as Record<string, number>);
  return {
    taskId,
    plannerInputCount: inputs.length,
    maxInputBytes: Math.max(...inputBytes),
    averageInputBytes: average(inputBytes),
    maxSections: maxBySection(sectionByteRows),
    averageSections: averageBySection(sectionByteRows),
    maxRefCount: Math.max(...inputs.map(input => Object.keys(input.current?.refs ?? {}).length)),
    maxWorkingSetPrimaryRefs: Math.max(...inputs.map(input => (input.workingSet?.primaryRefs ?? []).length)),
    maxWorkingSetSecondaryRefs: Math.max(...inputs.map(input => (input.workingSet?.secondaryRefs ?? []).length)),
    maxWorkingSetReadableEvidence: Math.max(...inputs.map(input => (input.workingSet?.readableEvidence ?? []).length)),
  };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function byteLength(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function maxBySection(rows: Array<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      result[key] = Math.max(result[key] ?? 0, value);
    }
  }
  return result;
}

function averageBySection(rows: Array<Record<string, number>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, rows.length === 0 ? 0 : total / rows.length]));
}

export function renderPlannerBreakdownMarkdown(rows: PlannerInputSectionBreakdown[]): string {
  return [
    '## BrowseGent Planner Input Section Breakdown',
    '',
    '| Task | Inputs | Max Bytes | Avg Bytes | Max Refs | Max Primary | Max Secondary | Max Readable Evidence |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(row => `| ${row.taskId} | ${row.plannerInputCount} | ${row.maxInputBytes} | ${Math.round(row.averageInputBytes)} | ${row.maxRefCount} | ${row.maxWorkingSetPrimaryRefs} | ${row.maxWorkingSetSecondaryRefs} | ${row.maxWorkingSetReadableEvidence} |`),
    '',
  ].join('\n');
}

export function renderRefFailuresMarkdown(rows: RefFailureSummary[]): string {
  return [
    '## Ref Execution Failure Audit',
    '',
    '| Task | Total Failures | Failure Kinds | Repeated Target Refs |',
    '| --- | ---: | --- | --- |',
    ...rows.map(row => `| ${row.taskId} | ${row.totalFailures} | ${formatCounts(row.byKind)} | ${formatCounts(topCounts(row.byTargetRef, 5))} |`),
    '',
  ].join('\n');
}

function topCounts(input: Record<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(Object.entries(input).sort((left, right) => right[1] - left[1]).slice(0, limit));
}

function formatCounts(input: Record<string, number>): string {
  const entries = Object.entries(input);
  return entries.length === 0 ? 'none' : entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(left: number, right: number): number {
  if (right === 0) {
    return left === 0 ? 1 : Infinity;
  }
  return left / right;
}

export function renderInitialInterpretation(
  comparison: EfficiencyComparison,
  plannerBreakdowns: PlannerInputSectionBreakdown[],
  refFailures: RefFailureSummary[],
): string {
  const worstInputTask = [...comparison.left.perTask].sort((left, right) => right.inputTokens - left.inputTokens)[0];
  const worstFailureTask = [...refFailures].sort((left, right) => right.totalFailures - left.totalFailures)[0];
  return [
    '## Initial Interpretation',
    '',
    `- Worst BrowseGent input-token task: ${worstInputTask?.taskId ?? 'none'}.`,
    `- Worst BrowseGent ref-failure task: ${worstFailureTask?.taskId ?? 'none'} (${worstFailureTask?.totalFailures ?? 0} failures).`,
    `- Input-token ratio left/right: ${comparison.ratios.inputTokens.toFixed(2)}x.`,
    `- Planner-call ratio left/right: ${comparison.ratios.plannerCalls.toFixed(2)}x.`,
    '- This report is diagnostic only. Do not change runtime behavior from this output without the decision gate.',
    '',
  ].join('\n');
}

export interface CompactViewAuditSummary {
  taskId: string;
  plannerInputCount: number;
  averageOriginalBytes: number;
  averageCompactBytes: number;
  averageReductionRatio: number;
  maxOriginalBytes: number;
  maxCompactBytes: number;
}

export async function collectCompactViewAudit(report: BenchmarkReport): Promise<CompactViewAuditSummary[]> {
  const rows: CompactViewAuditSummary[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const plannerDir = join(result.tracePath, '..', 'planner');
    const files = (await safeReaddir(plannerDir)).filter(file => file.endsWith('-input.json'));
    const stats = [];
    for (const file of files) {
      try {
        const input = JSON.parse(await readFile(join(plannerDir, file), 'utf8')) as Record<string, any>;
        const view = buildCompactPlannerView(input);
        stats.push(measureCompactPlannerView(input, view));
      } catch (error) {
        console.warn(`Failed to read/parse input ${file} in ${plannerDir}:`, error);
      }
    }
    if (stats.length === 0) continue;
    rows.push({
      taskId: result.taskId,
      plannerInputCount: stats.length,
      averageOriginalBytes: average(stats.map(item => item.originalBytes)),
      averageCompactBytes: average(stats.map(item => item.compactBytes)),
      averageReductionRatio: average(stats.map(item => item.reductionRatio)),
      maxOriginalBytes: Math.max(...stats.map(item => item.originalBytes)),
      maxCompactBytes: Math.max(...stats.map(item => item.compactBytes)),
    });
  }
  return rows;
}

export function renderCompactViewAuditMarkdown(rows: CompactViewAuditSummary[]): string {
  return [
    '## Offline Compact Planner View Audit',
    '',
    '| Task | Inputs | Avg Original Bytes | Avg Compact Bytes | Avg Compact/Original | Max Original | Max Compact |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(row => `| ${row.taskId} | ${row.plannerInputCount} | ${Math.round(row.averageOriginalBytes)} | ${Math.round(row.averageCompactBytes)} | ${(row.averageReductionRatio * 100).toFixed(1)}% | ${row.maxOriginalBytes} | ${row.maxCompactBytes} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const leftRun = readFlag('--left-run');
  const rightRun = readFlag('--right-run');
  const output = readFlag('--output') ?? 'docs/evaluation/efficiency-root-cause-audit.md';
  if (!leftRun || !rightRun) {
    throw new Error('Usage: tsx tests/benchmark/v2/efficiency_audit.ts --left-run <runRoot> --right-run <runRoot> --output <mdPath>');
  }
  const [leftReport, rightReport] = await Promise.all([
    loadBenchmarkReport(leftRun),
    loadBenchmarkReport(rightRun),
  ]);
  const comparison = compareEfficiency(summarizeEfficiency(leftReport), summarizeEfficiency(rightReport));
  const plannerBreakdowns = await collectPlannerInputBreakdowns(leftRun, leftReport);
  const refFailures = await collectRefFailureSummaries(leftReport);
  const compactViewAudits = await collectCompactViewAudit(leftReport);
  const markdown = [
    renderEfficiencyComparisonMarkdown(comparison),
    renderPlannerBreakdownMarkdown(plannerBreakdowns),
    renderRefFailuresMarkdown(refFailures),
    renderCompactViewAuditMarkdown(compactViewAudits),
    renderInitialInterpretation(comparison, plannerBreakdowns, refFailures),
  ].join('\n');
  await mkdir(join(output, '..'), { recursive: true });
  await writeFile(output, markdown, 'utf8');
  console.log(`Wrote ${output} for ${basename(leftRun)} vs ${basename(rightRun)}`);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
