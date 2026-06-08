# Efficiency Root-Cause Audit and Compact View Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine why BrowseGent uses roughly 3x more input tokens and 2x more steps than Browser Use on MVR5-stable, then prove whether a compact graph-derived planner view can close the gap before changing runtime behavior.

**Architecture:** This is an audit-first plan. It adds benchmark analysis scripts, section-size diagnostics, ref-failure analysis, and an offline compact planner-view prototype. The production BrowseGent planner loop, runtime, graph, and prompts must not change until the final decision gate is reviewed.

**Tech Stack:** TypeScript, Node test runner, existing WebVoyager-lite run artifacts, existing BrowseGent traces, existing Browser Use local adapter artifacts.

---

## Non-Negotiable Guardrails

- Do not modify BrowseGent production planner/runtime behavior in this phase.
- Do not tune against one WebVoyager task.
- Do not hide inefficiency by increasing budgets, reducing max steps, or deleting evidence blindly.
- Do not compare architectures until token accounting parity has been checked.
- Do not commit `new-keys.yaml`, `debug.log`, benchmark logs, screenshots, or generated run artifacts.
- Treat MVR5-stable as a smoke signal, not a public benchmark claim.

## Current Baseline Evidence

Use these two run IDs unless a newer same-slice pair is explicitly provided:

- BrowseGent: `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780799594140`
- Browser Use: `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780800317301`

Known baseline:

- BrowseGent input tokens: `612,683`
- Browser Use input tokens: `188,813`
- BrowseGent planner/tool calls: `8.2 / 9.6` average
- Browser Use planner/tool calls: `4.6 / 4.6` average
- BrowseGent worst task: ArXiv, `197,420` input tokens, `13` planner calls, `22` tool executions

Observed likely root causes:

- BrowseGent serializes both `current` and `workingSet`; the same selected refs are often represented twice.
- BrowseGent sends 64-80 selected refs per planner call on complex pages.
- ArXiv and GitHub waste steps on `ambiguous_ref_resolution`, `low_confidence_ref`, and `target_blocked`.
- Graph/continuity data is useful internally, but too much of it may be exposed to the planner.

Reference patterns to keep in mind:

- Browser Use: compact indexed interactive element tree, action schema, history compaction, element identity in control plane.
- Alumnium: accessibility-tree-oriented `do/get/check`, compact state to agent, richer mechanics outside prompt.
- Desired BrowseGent direction: graph stays as control-plane intelligence; planner sees a compact indexed action/read evidence view.

---

## Deliverables

By the end of this plan, the cheaper agent should produce:

1. `tests/benchmark/v2/efficiency_audit.ts`
   - CLI script that compares two benchmark run directories and writes section-level metrics.
2. `tests/benchmark/v2/compact_planner_view.ts`
   - Offline transformer from existing BrowseGent planner input JSON to compact planner input JSON.
3. Unit tests for both scripts/helpers.
4. A report at `docs/evaluation/efficiency-root-cause-audit.md`.
5. A decision section saying one of:
   - Continue graph architecture with compact planner view.
   - Keep graph only for control-plane, switch planner-facing state to indexed a11y/interactive tree.
   - Stop and redesign because compact view cannot approach Browser Use efficiency.

---

## Task 1: Add Efficiency Audit Script Skeleton

**Files:**
- Create: `tests/benchmark/v2/efficiency_audit.ts`
- Test: `tests/unit/v2/efficiencyAudit.test.ts`

- [ ] **Step 1: Create script with run loading**

Create `tests/benchmark/v2/efficiency_audit.ts`:

```ts
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { BenchmarkReport } from './types';

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
    ...rows.map(([label, left, right, value]) => `| ${label} | ${left} | ${right} | ${(value as number).toFixed(2)}x |`),
    '',
  ].join('\n');
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(left: number, right: number): number {
  return right === 0 ? 0 : left / right;
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
  await writeEfficiencyComparisonMarkdown(output, comparison);
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
```

- [ ] **Step 2: Add basic test**

Create `tests/unit/v2/efficiencyAudit.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEfficiency, summarizeEfficiency } from '../../benchmark/v2/efficiency_audit';
import type { BenchmarkReport } from '../../benchmark/v2/types';

test('summarizeEfficiency totals token and step metrics', () => {
  const summary = summarizeEfficiency(reportFixture('browsegent', [
    { taskId: 'a', inputTokens: 10, outputTokens: 2, plannerCalls: 1, toolExecutions: 2, durationMs: 100 },
    { taskId: 'b', inputTokens: 30, outputTokens: 3, plannerCalls: 2, toolExecutions: 3, durationMs: 200 },
  ]));

  assert.equal(summary.totalInputTokens, 40);
  assert.equal(summary.totalOutputTokens, 5);
  assert.equal(summary.totalPlannerCalls, 3);
  assert.equal(summary.totalToolExecutions, 5);
});

test('compareEfficiency reports left over right ratios', () => {
  const left = summarizeEfficiency(reportFixture('browsegent', [
    { taskId: 'a', inputTokens: 100, outputTokens: 10, plannerCalls: 10, toolExecutions: 20, durationMs: 1000 },
  ]));
  const right = summarizeEfficiency(reportFixture('browser-use-local', [
    { taskId: 'a', inputTokens: 50, outputTokens: 20, plannerCalls: 5, toolExecutions: 10, durationMs: 2000 },
  ]));

  const comparison = compareEfficiency(left, right);
  assert.equal(comparison.ratios.inputTokens, 2);
  assert.equal(comparison.ratios.outputTokens, 0.5);
  assert.equal(comparison.ratios.plannerCalls, 2);
});

function reportFixture(adapterId: string, rows: Array<{
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
}>): BenchmarkReport {
  return {
    runId: `${adapterId}_run`,
    adapterId,
    startedAt: '2026-06-07T00:00:00.000Z',
    completedAt: '2026-06-07T00:00:01.000Z',
    summary: {
      totalRuns: rows.length,
      passedRuns: rows.length,
      failedRuns: 0,
      passRate: 1,
      traceCompleteRate: 1,
      avgPlannerCalls: 0,
      avgToolExecutions: 0,
      avgDurationMs: 0,
      failureTypes: {},
      partitions: {
        dev: { totalRuns: 0, passedRuns: 0, failedRuns: 0, passRate: 0, traceCompleteRate: 0 },
        holdout: { totalRuns: rows.length, passedRuns: rows.length, failedRuns: 0, passRate: 1, traceCompleteRate: 1 },
      },
    },
    results: rows.map(row => ({
      adapterId,
      taskId: row.taskId,
      attempt: 1,
      success: true,
      value: 'ok',
      metrics: {
        plannerCalls: row.plannerCalls,
        toolExecutions: row.toolExecutions,
        durationMs: row.durationMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
      partition: 'holdout',
      passed: true,
      validation: { passed: true, reasons: [], preview: 'ok' },
      trace: { ok: true, errors: [] },
    })),
  };
}
```

- [ ] **Step 3: Run test**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/efficiencyAudit.test.ts
```

Expected: PASS.

---

## Task 2: Add BrowseGent Planner Section Breakdown

**Files:**
- Modify: `tests/benchmark/v2/efficiency_audit.ts`
- Test: `tests/unit/v2/efficiencyAudit.test.ts`

- [ ] **Step 1: Add section breakdown types**

Add to `tests/benchmark/v2/efficiency_audit.ts`:

```ts
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
```

- [ ] **Step 2: Add planner input scanning helper**

Add:

```ts
export async function collectPlannerInputBreakdowns(runRoot: string, report: BenchmarkReport): Promise<PlannerInputSectionBreakdown[]> {
  const rows: PlannerInputSectionBreakdown[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const plannerDir = join(result.tracePath, '..', 'planner');
    const files = (await safeReaddir(plannerDir)).filter(file => file.endsWith('-input.json'));
    const inputs = await Promise.all(files.map(async file => JSON.parse(await readFile(join(plannerDir, file), 'utf8')) as Record<string, unknown>));
    if (inputs.length === 0) continue;
    rows.push(buildPlannerInputBreakdown(result.taskId, inputs));
  }
  return rows;
}

export function buildPlannerInputBreakdown(taskId: string, inputs: Array<Record<string, unknown>>): PlannerInputSectionBreakdown {
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
    maxRefCount: Math.max(...inputs.map(input => Object.keys(((input.current as { refs?: Record<string, unknown> } | undefined)?.refs) ?? {}).length)),
    maxWorkingSetPrimaryRefs: Math.max(...inputs.map(input => ((input.workingSet as { primaryRefs?: unknown[] } | undefined)?.primaryRefs ?? []).length)),
    maxWorkingSetSecondaryRefs: Math.max(...inputs.map(input => ((input.workingSet as { secondaryRefs?: unknown[] } | undefined)?.secondaryRefs ?? []).length)),
    maxWorkingSetReadableEvidence: Math.max(...inputs.map(input => ((input.workingSet as { readableEvidence?: unknown[] } | undefined)?.readableEvidence ?? []).length)),
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
```

- [ ] **Step 3: Add breakdown test**

Add to `tests/unit/v2/efficiencyAudit.test.ts`:

```ts
import { buildPlannerInputBreakdown } from '../../benchmark/v2/efficiency_audit';

test('buildPlannerInputBreakdown identifies duplicated current and working set size', () => {
  const breakdown = buildPlannerInputBreakdown('task', [
    {
      goal: 'goal',
      current: { refs: { r1: { text: 'one' }, r2: { text: 'two' } } },
      workingSet: { primaryRefs: [{ refId: 'r1' }], secondaryRefs: [{ refId: 'r2' }], readableEvidence: [{ refId: 'r1' }] },
    },
  ]);

  assert.equal(breakdown.plannerInputCount, 1);
  assert.equal(breakdown.maxRefCount, 2);
  assert.equal(breakdown.maxWorkingSetPrimaryRefs, 1);
  assert.equal(breakdown.maxWorkingSetSecondaryRefs, 1);
});
```

- [ ] **Step 4: Extend markdown report**

Update `renderEfficiencyComparisonMarkdown` to include planner section breakdowns later if present. Keep this simple:

```ts
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
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/efficiencyAudit.test.ts
```

Expected: PASS.

---

## Task 3: Add Ref Execution Failure Audit

**Files:**
- Modify: `tests/benchmark/v2/efficiency_audit.ts`
- Test: `tests/unit/v2/efficiencyAudit.test.ts`

- [ ] **Step 1: Add failure audit types**

Add:

```ts
export interface RefFailureSummary {
  taskId: string;
  totalFailures: number;
  byKind: Record<string, number>;
  byTargetRef: Record<string, number>;
}
```

- [ ] **Step 2: Add failure folder scanner**

Add:

```ts
export async function collectRefFailureSummaries(report: BenchmarkReport): Promise<RefFailureSummary[]> {
  const summaries: RefFailureSummary[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const failureDir = join(result.tracePath, '..', 'failures');
    const files = (await safeReaddir(failureDir)).filter(file => file.endsWith('.json'));
    const failures = await Promise.all(files.map(async file => JSON.parse(await readFile(join(failureDir, file), 'utf8')) as {
      kind?: string;
      targetRef?: string;
    }));
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
```

- [ ] **Step 3: Add test**

Add:

```ts
import { summarizeRefFailures } from '../../benchmark/v2/efficiency_audit';

test('summarizeRefFailures groups failures by kind and target ref', () => {
  const summary = summarizeRefFailures('arxiv', [
    { kind: 'ambiguous_ref_resolution', targetRef: 'r1' },
    { kind: 'ambiguous_ref_resolution', targetRef: 'r1' },
    { kind: 'timeout' },
  ]);

  assert.equal(summary.totalFailures, 3);
  assert.equal(summary.byKind.ambiguous_ref_resolution, 2);
  assert.equal(summary.byKind.timeout, 1);
  assert.equal(summary.byTargetRef.r1, 2);
});
```

- [ ] **Step 4: Extend audit report**

Add a markdown renderer:

```ts
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
```

- [ ] **Step 5: Run test**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/efficiencyAudit.test.ts
```

Expected: PASS.

---

## Task 4: Generate Root-Cause Report from Baseline Runs

**Files:**
- Modify: `tests/benchmark/v2/efficiency_audit.ts`
- Output: `docs/evaluation/efficiency-root-cause-audit.md`

- [ ] **Step 1: Wire section and failure audit into CLI**

In `main`, after comparison creation:

```ts
const plannerBreakdowns = await collectPlannerInputBreakdowns(leftRun, leftReport);
const refFailures = await collectRefFailureSummaries(leftReport);
const markdown = [
  renderEfficiencyComparisonMarkdown(comparison),
  renderPlannerBreakdownMarkdown(plannerBreakdowns),
  renderRefFailuresMarkdown(refFailures),
  renderInitialInterpretation(comparison, plannerBreakdowns, refFailures),
].join('\n');
await mkdir(join(output, '..'), { recursive: true });
await writeFile(output, markdown, 'utf8');
```

Add:

```ts
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
```

- [ ] **Step 2: Run report generation**

Run:

```powershell
npm.cmd run benchmark:v2 -- --help
```

This command may print help or error depending on CLI shape; it is only a quick package sanity check. Then run:

```powershell
npx.cmd tsx tests/benchmark/v2/efficiency_audit.ts --left-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780799594140 --right-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780800317301 --output docs/evaluation/efficiency-root-cause-audit.md
```

Expected:

- `docs/evaluation/efficiency-root-cause-audit.md` is created.
- It includes efficiency comparison, planner section breakdown, ref failure audit, and initial interpretation.

- [ ] **Step 3: Inspect report**

Run:

```powershell
Get-Content docs/evaluation/efficiency-root-cause-audit.md -TotalCount 120
```

Expected:

- BrowseGent/Browser Use input-token ratio is visible.
- ArXiv appears as a high-token and high-failure task.
- Planner section table shows current/working-set size pressure.

---

## Task 5: Add Offline Compact Planner View Prototype

**Files:**
- Create: `tests/benchmark/v2/compact_planner_view.ts`
- Test: `tests/unit/v2/compactPlannerView.test.ts`

- [ ] **Step 1: Create compact view types and transformer**

Create `tests/benchmark/v2/compact_planner_view.ts`:

```ts
export interface CompactPlannerView {
  version: 'compact_planner_view.v0';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  lastResult?: unknown;
  recovery?: unknown;
  uncertainty?: unknown;
  actions: CompactActionRef[];
  reads: CompactReadRef[];
  omitted: {
    originalCurrentRefs: number;
    originalPrimaryRefs: number;
    originalSecondaryRefs: number;
    originalReadableEvidence: number;
  };
}

export interface CompactActionRef {
  id: number;
  refId: string;
  kind?: string;
  role?: string;
  label: string;
  tools: string[];
}

export interface CompactReadRef {
  id: number;
  refId: string;
  text: string;
}

export interface CompactPlannerViewStats {
  originalBytes: number;
  compactBytes: number;
  reductionRatio: number;
}

export function buildCompactPlannerView(input: Record<string, any>, options: { maxActions?: number; maxReads?: number } = {}): CompactPlannerView {
  const maxActions = options.maxActions ?? 24;
  const maxReads = options.maxReads ?? 16;
  const workingSet = input.workingSet ?? {};
  const currentRefs = input.current?.refs ?? {};
  const actionSurface = workingSet.actionSurface ?? {};
  const toolByRef = buildToolMap(actionSurface);
  const rankedRefs = [
    ...(workingSet.primaryRefs ?? []),
    ...(workingSet.secondaryRefs ?? []),
  ];

  const actions = rankedRefs
    .filter((ref: any) => toolByRef.has(ref.refId))
    .slice(0, maxActions)
    .map((ref: any, index: number) => toCompactAction(index + 1, ref, currentRefs[ref.refId], toolByRef.get(ref.refId) ?? []));

  const reads = (workingSet.readableEvidence ?? [])
    .slice(0, maxReads)
    .map((ref: any, index: number) => ({
      id: index + 1,
      refId: ref.refId,
      text: compactText(ref.text ?? '', 220),
    }));

  return {
    version: 'compact_planner_view.v0',
    episodeId: input.episodeId,
    goal: input.goal,
    url: input.continuity?.url,
    mode: workingSet.mode,
    lastResult: input.lastResult,
    recovery: input.recovery,
    uncertainty: input.uncertainty,
    actions,
    reads,
    omitted: {
      originalCurrentRefs: Object.keys(currentRefs).length,
      originalPrimaryRefs: (workingSet.primaryRefs ?? []).length,
      originalSecondaryRefs: (workingSet.secondaryRefs ?? []).length,
      originalReadableEvidence: (workingSet.readableEvidence ?? []).length,
    },
  };
}

export function measureCompactPlannerView(input: Record<string, any>, view: CompactPlannerView): CompactPlannerViewStats {
  const originalBytes = byteLength(input);
  const compactBytes = byteLength(view);
  return {
    originalBytes,
    compactBytes,
    reductionRatio: originalBytes === 0 ? 0 : compactBytes / originalBytes,
  };
}

function buildToolMap(actionSurface: Record<string, string[]>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [tool, refs] of Object.entries(actionSurface)) {
    if (!Array.isArray(refs)) continue;
    for (const refId of refs) {
      const tools = map.get(refId) ?? [];
      tools.push(tool.replace(/Refs$/, ''));
      map.set(refId, tools);
    }
  }
  return map;
}

function toCompactAction(id: number, ref: any, currentRef: any, tools: string[]): CompactActionRef {
  return {
    id,
    refId: ref.refId,
    kind: ref.kind ?? currentRef?.kind,
    role: ref.role ?? currentRef?.role,
    label: compactText([ref.name, ref.text, currentRef?.name, currentRef?.text].filter(Boolean).join(' '), 180),
    tools: [...new Set(tools)].sort(),
  };
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
```

- [ ] **Step 2: Add compact view test**

Create `tests/unit/v2/compactPlannerView.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompactPlannerView, measureCompactPlannerView } from '../../benchmark/v2/compact_planner_view';

test('buildCompactPlannerView keeps compact actions and readable evidence', () => {
  const input = {
    episodeId: 'episode_1',
    goal: 'Find the latest preprints',
    continuity: { url: 'https://arxiv.org/search/advanced' },
    current: {
      refs: {
        r1: { kind: 'input', role: 'textbox', name: 'Search term' },
        r2: { kind: 'button', role: 'button', name: 'Search' },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: [{ refId: 'r1', kind: 'input', name: 'Search term' }, { refId: 'r2', kind: 'button', name: 'Search' }],
      secondaryRefs: [],
      readableEvidence: [{ refId: 'r3', text: 'Quantum element-wise transforms arXiv:2606.06456' }],
      actionSurface: { typeableRefs: ['r1'], clickableRefs: ['r2'], readableRefs: ['r3'] },
    },
  };

  const view = buildCompactPlannerView(input);
  assert.equal(view.actions.length, 2);
  assert.equal(view.reads.length, 1);
  assert.equal(view.actions[0].tools.includes('typeable'), true);
  assert.equal(view.omitted.originalCurrentRefs, 2);
});

test('measureCompactPlannerView reports compact/original ratio', () => {
  const input = {
    goal: 'x',
    current: { refs: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`r${index}`, { text: 'long text '.repeat(20) }])) },
    workingSet: { primaryRefs: [], secondaryRefs: [], readableEvidence: [], actionSurface: {} },
  };
  const view = buildCompactPlannerView(input);
  const stats = measureCompactPlannerView(input, view);
  assert.ok(stats.compactBytes < stats.originalBytes);
  assert.ok(stats.reductionRatio < 1);
});
```

- [ ] **Step 3: Run compact view tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/compactPlannerView.test.ts
```

Expected: PASS.

---

## Task 6: Measure Compact View on Existing BrowseGent Traces

**Files:**
- Modify: `tests/benchmark/v2/efficiency_audit.ts`
- Output: `docs/evaluation/efficiency-root-cause-audit.md`

- [ ] **Step 1: Add compact-view measurement**

Import in `tests/benchmark/v2/efficiency_audit.ts`:

```ts
import { buildCompactPlannerView, measureCompactPlannerView } from './compact_planner_view';
```

Add types:

```ts
export interface CompactViewAuditSummary {
  taskId: string;
  plannerInputCount: number;
  averageOriginalBytes: number;
  averageCompactBytes: number;
  averageReductionRatio: number;
  maxOriginalBytes: number;
  maxCompactBytes: number;
}
```

Add function:

```ts
export async function collectCompactViewAudit(report: BenchmarkReport): Promise<CompactViewAuditSummary[]> {
  const rows: CompactViewAuditSummary[] = [];
  for (const result of report.results) {
    if (!result.tracePath) continue;
    const plannerDir = join(result.tracePath, '..', 'planner');
    const files = (await safeReaddir(plannerDir)).filter(file => file.endsWith('-input.json'));
    const stats = [];
    for (const file of files) {
      const input = JSON.parse(await readFile(join(plannerDir, file), 'utf8')) as Record<string, any>;
      const view = buildCompactPlannerView(input);
      stats.push(measureCompactPlannerView(input, view));
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
```

Add renderer:

```ts
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
```

In `main`, collect and render `compactRows`.

- [ ] **Step 2: Run audit generation**

Run:

```powershell
npx.cmd tsx tests/benchmark/v2/efficiency_audit.ts --left-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780799594140 --right-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780800317301 --output docs/evaluation/efficiency-root-cause-audit.md
```

Expected:

- Report includes `Offline Compact Planner View Audit`.
- Average compact/original ratio should be visible for every BrowseGent task.

- [ ] **Step 3: Decision target**

Record this in the report manually after reviewing:

```text
Compact view decision target:
- Strong signal: average compact/original <= 35%.
- Weak signal: average compact/original between 35% and 55%.
- Bad signal: average compact/original > 55%.
```

If the compact view cannot reach at least `55%` of current prompt size offline, stop and discuss architecture before runtime implementation.

---

## Task 7: Final Decision Gate Report

**Files:**
- Modify: `docs/evaluation/efficiency-root-cause-audit.md`

- [ ] **Step 1: Add decision gate section**

Append this section to `docs/evaluation/efficiency-root-cause-audit.md`:

```md
## Decision Gate

### Evidence Summary

- Token parity confidence:
- Biggest input-token cause:
- Biggest step-count cause:
- Biggest ref-execution cause:
- Compact view average reduction:
- Remaining quality risk:

### Decision

Choose exactly one:

1. Continue graph architecture with compact planner view.
2. Keep graph only for control-plane and switch planner-facing state to indexed a11y/interactive tree.
3. Stop and redesign; current architecture cannot justify its complexity.

### Required Next Plan

If decision is 1:
- Create a runtime compact-planner-view implementation plan.
- Start with telemetry-only mode.
- Compare current vs compact prompts on same traces before enforcing.

If decision is 2:
- Create an indexed accessibility/interactive-tree substrate plan.
- Keep continuity graph as internal validation and recovery only.

If decision is 3:
- Stop BrowseGent V2 feature work and write a clean architecture replacement proposal.
```

- [ ] **Step 2: Fill the evidence fields**

Use data from the generated report. Do not write vague statements such as "probably" or "seems". Use numbers:

```md
- Biggest input-token cause: `current + workingSet duplication`, average sections X bytes + Y bytes.
- Biggest step-count cause: `ambiguous_ref_resolution`, N failures on ArXiv and M failures on GitHub.
- Compact view average reduction: Z%.
```

- [ ] **Step 3: Stop before implementation**

Do not implement runtime compact planner view in this phase. Ask the lead reviewer to approve the decision gate.

---

## Verification Commands

Run after implementation:

```powershell
npm.cmd run test:unit -- tests/unit/v2/efficiencyAudit.test.ts tests/unit/v2/compactPlannerView.test.ts
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

Generate the audit report:

```powershell
npx.cmd tsx tests/benchmark/v2/efficiency_audit.ts --left-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780799594140 --right-run D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780800317301 --output docs/evaluation/efficiency-root-cause-audit.md
```

Review:

```powershell
Get-Content docs/evaluation/efficiency-root-cause-audit.md -TotalCount 220
```

---

## What I Should Handle Personally Later

These are higher-risk and should not be delegated blindly:

- Reviewing the decision gate.
- Deciding whether graph remains planner-facing or becomes control-plane-only.
- Designing runtime compact planner view enforcement.
- Any change to `V2AgentLoop`, `PlannerInputComposer`, `PlannerWorkingSetSelector`, `RefService`, or `ObservationService`.
- Any conclusion that the architecture should be abandoned.

---

## Self-Review

Spec coverage:
- Token parity audit is covered by Tasks 1 and 4.
- Planner input bloat audit is covered by Task 2.
- Ref execution bug audit is covered by Task 3.
- Control-plane vs planner-plane split is handled by Task 7 decision gate.
- Compact planner view prototype is covered by Tasks 5 and 6.
- Architecture continue/pivot decision is covered by Task 7.

Scope check:
- This plan does not alter production BrowseGent behavior.
- This plan produces evidence and an offline compact prototype only.
- Runtime changes require a follow-up approved plan.

Ambiguity check:
- Baseline run IDs are explicit.
- Compact-view success thresholds are explicit.
- The cheaper agent is told where to stop.
