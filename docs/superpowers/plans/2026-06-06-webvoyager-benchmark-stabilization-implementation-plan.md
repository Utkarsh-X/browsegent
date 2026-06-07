# WebVoyager Benchmark Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize BrowseGent's WebVoyager benchmark harness so it tests valid tasks, reports truthful comparable scores, and can fairly compare BrowseGent against Browser Use and similar browser agents.

**Architecture:** Keep the benchmark harness independent from BrowseGent product logic. Add a task registry, stable slices, environment-aware scoring, artifact packaging, manual audit support, and an optional calibrated judge interface that is disabled by default until manually validated.

**Tech Stack:** TypeScript, Node test runner, existing WebVoyager-lite benchmark runner, existing benchmark adapters for BrowseGent and Browser Use.

---

## Design Decision: Do We Need an LLM Judge?

Yes, but only as a calibrated evaluation aid, not as the first source of truth.

For MVR5 stabilization, deterministic reference checks plus manual audit are enough and safer. For MVR30 and competitor comparison, an LLM judge becomes useful because manual review cost grows and many WebVoyager references are vague or dynamic. The judge must receive the task, final answer, reference/rubric, trace summary, and screenshots when available. Its output must be treated as `judge_verdict`, not automatically as truth, until we calibrate it against manual labels.

Implementation rule:
- Phase 1: implement the judge interface and artifact format, but keep `--judge` off by default.
- Phase 2: calibrate judge on manually reviewed MVR5/MVR30 artifacts.
- Phase 3: use judge for scalable triage, while still manually reviewing all suspected false positives and a sample of auto-passes.

This follows the useful parts of Browser Use and Alumnium while avoiding Browser Use's weakness of selective manual review only on failed/unknown tasks.

References:
- Browser Use eval fork filters impossible tasks, changes stale dates, uses screenshot + final response evaluation, and manually reviews uncertain/failed outcomes: https://github.com/browser-use/eval
- Browser Use impossible task list includes `Allrecipes--3`: https://raw.githubusercontent.com/browser-use/eval/main/data/WebVoyagerImpossibleTasks.json
- Alumnium publishes transcripts, screenshots, evaluator responses, benchmark patches, and commit-level explanations: https://alumnium.ai/blog/webvoyager-benchmark/
- Emergence WebVoyager warns that inconsistent task handling, captcha handling, and weak evaluators distort comparisons: https://arxiv.org/abs/2603.29020

---

## Scope

Allowed:
- Add benchmark metadata and stable task slices.
- Exclude known impossible tasks from stable slices.
- Separate `impossible`, `environment_block`, `runtime_startup_failure`, and normal task failures.
- Produce artifact packs suitable for manual review and optional LLM judging.
- Add a judge interface that can run later without changing benchmark data structures.
- Keep MVR5 small and cheap.

Not allowed:
- Product-side planner changes.
- Site-specific BrowseGent behavior.
- Hardcoded benchmark answers in production code.
- Claiming public benchmark performance from MVR5.
- Treating one benchmark run as stable evidence.

---

## File Structure

Create:
- `tests/benchmark/webvoyager/task_registry.ts`
  - Task status registry, Browser Use impossible task set, stable slice definitions.
- `tests/benchmark/webvoyager/artifacts.ts`
  - Build per-task artifact summaries for manual review and future judge inputs.
- `tests/benchmark/webvoyager/judge_types.ts`
  - Pure types for optional judge input/output.
- `tests/unit/v2/webVoyagerTaskRegistry.test.ts`
  - Registry and stable slice tests.
- `tests/unit/v2/webVoyagerArtifacts.test.ts`
  - Artifact summary tests.

Modify:
- `tests/benchmark/webvoyager/types.ts`
  - Add task status, benchmark slice, and artifact types.
- `tests/benchmark/webvoyager/task_selection.ts`
  - Replace current `mvr5` with `mvr5-stable`; keep legacy slice available.
- `tests/benchmark/webvoyager/evaluator.ts`
  - Stop marking impossible/environment-block cases as normal reference mismatches.
- `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
  - Persist artifact summaries and add slice names.
- `tests/benchmark/v2/types.ts`
  - Add `runtime_startup_failure` failure type if needed by scoring.
- `tests/benchmark/v2/scoring.ts`
  - Classify missing trace path from startup/navigation failure separately from trace integrity failure.
- Existing tests:
  - `tests/unit/v2/webVoyagerEvaluator.test.ts`
  - `tests/unit/v2/webVoyagerRunner.test.ts`
  - `tests/unit/v2/benchmarkScoring.test.ts`

---

## Task 1: Add WebVoyager Task Registry

**Files:**
- Create: `tests/benchmark/webvoyager/task_registry.ts`
- Modify: `tests/benchmark/webvoyager/types.ts`
- Test: `tests/unit/v2/webVoyagerTaskRegistry.test.ts`

- [ ] **Step 1: Add registry types**

In `tests/benchmark/webvoyager/types.ts`, add:

```ts
export type WebVoyagerTaskStatus =
  | 'valid'
  | 'impossible'
  | 'date_normalized'
  | 'environment_block_risk'
  | 'ambiguous';

export type WebVoyagerBenchmarkSlice = 'mvr5' | 'mvr5-stable' | 'balanced30';

export interface WebVoyagerTaskRegistryEntry {
  id: string;
  status: WebVoyagerTaskStatus;
  source: 'browser_use_eval' | 'browsegent' | 'manual_review';
  reason: string;
}
```

- [ ] **Step 2: Create task registry**

Create `tests/benchmark/webvoyager/task_registry.ts`:

```ts
import type { WebVoyagerBenchmarkSlice, WebVoyagerTaskRegistryEntry, WebVoyagerTaskStatus } from './types';

export const BROWSER_USE_IMPOSSIBLE_TASK_IDS = new Set([
  'Allrecipes--16', 'Allrecipes--19', 'Allrecipes--23', 'Allrecipes--3', 'Allrecipes--30', 'Allrecipes--7',
  'Amazon--16', 'Amazon--19', 'Amazon--4',
  'Apple--1', 'Apple--14', 'Apple--16', 'Apple--2', 'Apple--20', 'Apple--37', 'Apple--41', 'Apple--42', 'Apple--7', 'Apple--9',
  'ArXiv--11',
  'BBC News--14', 'BBC News--16', 'BBC News--18', 'BBC News--2', 'BBC News--21', 'BBC News--33', 'BBC News--37',
  'Booking--11', 'Booking--13', 'Booking--14', 'Booking--6',
  'Coursera--17', 'Coursera--28',
  'ESPN--19', 'ESPN--2', 'ESPN--21', 'ESPN--26',
  'GitHub--22',
  'Google Flights--0', 'Google Flights--20', 'Google Flights--7',
  'Google Map--13', 'Google Map--18', 'Google Map--26',
  'Google Search--15', 'Google Search--16', 'Google Search--22',
  'Huggingface--1', 'Huggingface--10', 'Huggingface--20', 'Huggingface--21', 'Huggingface--22', 'Huggingface--23', 'Huggingface--32', 'Huggingface--6',
]);

export const WEBVOYAGER_TASK_REGISTRY_OVERRIDES: Record<string, WebVoyagerTaskRegistryEntry> = {
  'Allrecipes--3': {
    id: 'Allrecipes--3',
    status: 'impossible',
    source: 'browser_use_eval',
    reason: 'Listed as impossible in browser-use/eval and repeatedly reaches Cloudflare/captcha in local runs.',
  },
  'Google Flights--0': {
    id: 'Google Flights--0',
    status: 'impossible',
    source: 'browser_use_eval',
    reason: 'Listed as impossible in browser-use/eval; date-sensitive travel task is unsuitable for stable smoke slice.',
  },
};

export const WEBVOYAGER_STABLE_SLICES: Record<WebVoyagerBenchmarkSlice, readonly string[]> = {
  mvr5: ['Allrecipes--3', 'ArXiv--0', 'GitHub--0', 'Google Map--10', 'Wolfram Alpha--0'],
  'mvr5-stable': ['Cambridge Dictionary--0', 'ArXiv--0', 'GitHub--0', 'Google Map--10', 'Wolfram Alpha--0'],
  balanced30: [
    'Allrecipes--3', 'Allrecipes--10', 'Amazon--0', 'Amazon--10', 'Apple--0', 'Apple--10',
    'ArXiv--0', 'ArXiv--10', 'BBC News--0', 'BBC News--10', 'Booking--0', 'Booking--10',
    'Cambridge Dictionary--0', 'Cambridge Dictionary--10', 'Coursera--0', 'Coursera--10',
    'ESPN--0', 'ESPN--10', 'GitHub--0', 'GitHub--10', 'Google Flights--0', 'Google Flights--10',
    'Google Map--0', 'Google Map--10', 'Google Search--0', 'Google Search--10',
    'Huggingface--0', 'Huggingface--10', 'Wolfram Alpha--0', 'Wolfram Alpha--10',
  ],
};

export function getWebVoyagerTaskStatus(taskId: string): WebVoyagerTaskStatus {
  const override = WEBVOYAGER_TASK_REGISTRY_OVERRIDES[taskId];
  if (override) return override.status;
  if (BROWSER_USE_IMPOSSIBLE_TASK_IDS.has(taskId)) return 'impossible';
  return 'valid';
}

export function assertStableSliceContainsNoImpossibleTasks(slice: WebVoyagerBenchmarkSlice): void {
  const taskIds = WEBVOYAGER_STABLE_SLICES[slice];
  const impossible = taskIds.filter(taskId => getWebVoyagerTaskStatus(taskId) === 'impossible');
  if (impossible.length > 0 && slice.endsWith('stable')) {
    throw new Error(`Stable WebVoyager slice ${slice} contains impossible tasks: ${impossible.join(', ')}`);
  }
}
```

- [ ] **Step 3: Add registry tests**

Create `tests/unit/v2/webVoyagerTaskRegistry.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertStableSliceContainsNoImpossibleTasks,
  BROWSER_USE_IMPOSSIBLE_TASK_IDS,
  getWebVoyagerTaskStatus,
  WEBVOYAGER_STABLE_SLICES,
} from '../../benchmark/webvoyager/task_registry';

test('Browser Use impossible task list marks Allrecipes--3 impossible', () => {
  assert.equal(BROWSER_USE_IMPOSSIBLE_TASK_IDS.has('Allrecipes--3'), true);
  assert.equal(getWebVoyagerTaskStatus('Allrecipes--3'), 'impossible');
});

test('mvr5-stable replaces impossible Allrecipes task', () => {
  assert.deepEqual(WEBVOYAGER_STABLE_SLICES['mvr5-stable'], [
    'Cambridge Dictionary--0',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
  assert.doesNotThrow(() => assertStableSliceContainsNoImpossibleTasks('mvr5-stable'));
});
```

- [ ] **Step 4: Run registry tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerTaskRegistry.test.ts
```

Expected: PASS.

---

## Task 2: Wire Stable Slice Selection

**Files:**
- Modify: `tests/benchmark/webvoyager/task_selection.ts`
- Modify: `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
- Test: `tests/unit/v2/webVoyagerTaskSelection.test.ts`
- Test: `tests/unit/v2/webVoyagerRunner.test.ts`

- [ ] **Step 1: Replace hardcoded slice constants with registry**

In `tests/benchmark/webvoyager/task_selection.ts`, import:

```ts
import { assertStableSliceContainsNoImpossibleTasks, WEBVOYAGER_STABLE_SLICES } from './task_registry';
```

Replace the local slice type with:

```ts
import type { WebVoyagerBenchmarkSlice } from './types';
export type WebVoyagerTaskSlice = WebVoyagerBenchmarkSlice;
```

Replace `resolveWebVoyagerTaskIds` with:

```ts
export function resolveWebVoyagerTaskIds(slice: WebVoyagerTaskSlice = 'balanced30'): readonly string[] {
  assertStableSliceContainsNoImpossibleTasks(slice);
  return WEBVOYAGER_STABLE_SLICES[slice];
}
```

Keep exported `WEBVOYAGER_LITE_TASK_IDS` and `WEBVOYAGER_MVR_5_TASK_IDS` only if existing tests still import them. If kept, define them from the registry:

```ts
export const WEBVOYAGER_LITE_TASK_IDS = WEBVOYAGER_STABLE_SLICES.balanced30;
export const WEBVOYAGER_MVR_5_TASK_IDS = WEBVOYAGER_STABLE_SLICES.mvr5;
export const WEBVOYAGER_MVR_5_STABLE_TASK_IDS = WEBVOYAGER_STABLE_SLICES['mvr5-stable'];
```

- [ ] **Step 2: Accept `mvr5-stable` CLI slice**

In `tests/benchmark/webvoyager/run_webvoyager_lite.ts`, update `readTaskSliceArg`:

```ts
function readTaskSliceArg(): WebVoyagerTaskSlice | undefined {
  const value = readFlag('--slice');
  if (value === undefined || value === 'balanced30' || value === 'mvr5' || value === 'mvr5-stable') {
    return value;
  }
  throw new Error(`Unsupported WebVoyager slice "${value}". Use balanced30, mvr5, or mvr5-stable.`);
}
```

- [ ] **Step 3: Add slice tests**

In `tests/unit/v2/webVoyagerTaskSelection.test.ts`, add:

```ts
test('resolveWebVoyagerTaskIds supports mvr5-stable', () => {
  assert.deepEqual(resolveWebVoyagerTaskIds('mvr5-stable'), [
    'Cambridge Dictionary--0',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
});
```

- [ ] **Step 4: Run slice tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerTaskSelection.test.ts tests/unit/v2/webVoyagerRunner.test.ts
```

Expected: PASS.

---

## Task 3: Fix Environment and Impossible Scoring Semantics

**Files:**
- Modify: `tests/benchmark/webvoyager/evaluator.ts`
- Modify: `tests/benchmark/webvoyager/types.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Add non-applicable reference match**

In `tests/benchmark/webvoyager/types.ts`, change:

```ts
export type WebVoyagerReferenceMatchType = 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'missing_reference';
```

to:

```ts
export type WebVoyagerReferenceMatchType = 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'missing_reference' | 'not_applicable';
```

- [ ] **Step 2: Evaluate environment status before reference match**

In `tests/benchmark/webvoyager/evaluator.ts`, change the reference match assignment to:

```ts
const environmentStatus = classifyEnvironmentStatus(result, manualAudit);
const referenceMatchType = environmentStatus === 'normal'
  ? (reference ? classifyReferenceMatch(result.value, reference.answer) : 'missing_reference')
  : 'not_applicable';
```

Only add `reference_mismatch` when environment status is normal:

```ts
if (environmentStatus === 'normal' && reference && referenceMatchType === 'mismatch') {
  reasons.push('reference_mismatch');
}
if (environmentStatus !== 'normal') {
  reasons.push(environmentStatus);
}
```

- [ ] **Step 3: Ensure strict score excludes non-normal tasks**

Set:

```ts
const strictScore = environmentStatus === 'normal'
  && internalPassed
  && referenceMatchType !== 'mismatch'
  && referenceMatchType !== 'missing_reference'
  && referenceMatchType !== 'not_applicable'
  ? 1
  : 0;
```

- [ ] **Step 4: Add evaluator test**

In `tests/unit/v2/webVoyagerEvaluator.test.ts`, add:

```ts
test('environment-block task does not produce normal reference mismatch', () => {
  const verdict = evaluateWebVoyagerResult(webTask(), result({
    passed: false,
    value: '',
    failureType: 'environment_block',
  }));

  assert.equal(verdict.environmentStatus, 'environment_block');
  assert.equal(verdict.referenceMatchType, 'not_applicable');
  assert.equal(verdict.environmentAdjustedEligible, false);
  assert.equal(verdict.reasons.includes('reference_mismatch'), false);
});
```

- [ ] **Step 5: Run evaluator tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: PASS.

---

## Task 4: Classify Runtime Startup Failures Separately

**Files:**
- Modify: `tests/benchmark/v2/types.ts`
- Modify: `tests/benchmark/v2/scoring.ts`
- Test: `tests/unit/v2/benchmarkScoring.test.ts`

- [ ] **Step 1: Add failure type**

In `tests/benchmark/v2/types.ts`, add this union member:

```ts
| 'runtime_startup_failure'
```

Place it near `runtime_crash`.

- [ ] **Step 2: Preserve adapter runtime startup failures**

In `tests/benchmark/v2/scoring.ts`, update `inferFailureType` so `runtime_crash` with no trace path and zero tool executions becomes `runtime_startup_failure`:

```ts
if (
  result.failureType === 'runtime_crash'
  && !result.tracePath
  && result.metrics.toolExecutions === 0
) {
  return 'runtime_startup_failure';
}
```

This should run before generic trace error inference.

- [ ] **Step 3: Add scoring test**

In `tests/unit/v2/benchmarkScoring.test.ts`, add:

```ts
test('scoreBenchmarkResult classifies startup crash without trace separately', () => {
  const scored = scoreBenchmarkResult(
    task(),
    {
      adapterId: 'browsegent',
      taskId: 'task',
      attempt: 1,
      success: false,
      value: '',
      failureType: 'runtime_crash',
      failureReason: 'page.goto timeout before trace creation',
      metrics: { plannerCalls: 0, toolExecutions: 0, durationMs: 30000 },
    },
    { passed: false, reasons: ['minLength:2'], preview: '' },
    { ok: false, errors: ['missing_trace_path'] },
  );

  assert.equal(scored.failureType, 'runtime_startup_failure');
});
```

- [ ] **Step 4: Run scoring tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/benchmarkScoring.test.ts
```

Expected: PASS.

---

## Task 5: Persist Review-Ready Artifact Summaries

**Files:**
- Create: `tests/benchmark/webvoyager/artifacts.ts`
- Modify: `tests/benchmark/webvoyager/types.ts`
- Modify: `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
- Test: `tests/unit/v2/webVoyagerArtifacts.test.ts`

- [ ] **Step 1: Add artifact types**

In `tests/benchmark/webvoyager/types.ts`, add:

```ts
export interface WebVoyagerTaskArtifactSummary {
  taskId: string;
  webVoyagerId: string;
  webName: string;
  goal: string;
  url: string;
  referenceAnswer?: unknown;
  finalAnswer: string;
  internalPassed: boolean;
  failureType?: string;
  failureReason?: string;
  tracePath?: string;
  artifactPath?: string;
  plannerCalls: number;
  toolExecutions: number;
  durationMs: number;
}
```

- [ ] **Step 2: Create artifact builder**

Create `tests/benchmark/webvoyager/artifacts.ts`:

```ts
import type { ScoredBenchmarkResult } from '../v2/types';
import type { WebVoyagerBenchmarkTask, WebVoyagerTaskArtifactSummary } from './types';

export function buildWebVoyagerTaskArtifactSummary(
  task: WebVoyagerBenchmarkTask,
  result: ScoredBenchmarkResult,
): WebVoyagerTaskArtifactSummary {
  return {
    taskId: task.taskId,
    webVoyagerId: task.webVoyager.id,
    webName: task.webVoyager.webName,
    goal: task.goal,
    url: task.url,
    referenceAnswer: task.webVoyager.referenceAnswer?.answer,
    finalAnswer: result.value,
    internalPassed: result.success,
    failureType: result.failureType,
    failureReason: result.failureReason,
    tracePath: result.tracePath,
    artifactPath: result.artifactPath,
    plannerCalls: result.metrics.plannerCalls,
    toolExecutions: result.metrics.toolExecutions,
    durationMs: result.metrics.durationMs,
  };
}
```

- [ ] **Step 3: Persist artifact summaries**

In `tests/benchmark/webvoyager/run_webvoyager_lite.ts`, import:

```ts
import { buildWebVoyagerTaskArtifactSummary } from './artifacts';
```

After evaluation creation, build:

```ts
const artifactSummaries = benchmark.results.map(result => buildWebVoyagerTaskArtifactSummary(byTaskId.get(result.taskId)!, result));
```

Add to the returned evaluation object:

```ts
artifactSummaries,
```

Persist:

```ts
await writeFile(join(runRoot, 'webvoyager_artifacts.json'), `${JSON.stringify(artifactSummaries, null, 2)}\n`, 'utf8');
```

- [ ] **Step 4: Add artifact test**

Create `tests/unit/v2/webVoyagerArtifacts.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebVoyagerTaskArtifactSummary } from '../../benchmark/webvoyager/artifacts';

test('buildWebVoyagerTaskArtifactSummary captures review-critical fields', () => {
  const summary = buildWebVoyagerTaskArtifactSummary(
    {
      taskId: 'webvoyager_GitHub__0',
      category: 'webvoyager',
      difficulty: 'navigation',
      partition: 'holdout',
      url: 'https://github.com/',
      goal: 'Find a climate data visualization repository with most stars.',
      validation: { minLength: 2 },
      webVoyager: {
        id: 'GitHub--0',
        webName: 'GitHub',
        originalQuestion: 'Find a climate data visualization repository with most stars.',
        normalizedQuestion: 'Find a climate data visualization repository with most stars.',
        normalized: false,
        referenceAnswer: { id: 'GitHub--0', webName: 'GitHub', type: 'golden', answer: 'resource-watch/resource-watch' },
      },
    },
    {
      adapterId: 'browsegent',
      taskId: 'webvoyager_GitHub__0',
      attempt: 1,
      success: true,
      value: 'bcgov/cccharts',
      tracePath: 'logs/run/trace.json',
      metrics: { plannerCalls: 3, toolExecutions: 4, durationMs: 1000 },
      partition: 'holdout',
      passed: true,
      validation: { passed: true, reasons: [], preview: 'bcgov/cccharts' },
      trace: { ok: true, errors: [] },
    },
  );

  assert.equal(summary.webVoyagerId, 'GitHub--0');
  assert.equal(summary.referenceAnswer, 'resource-watch/resource-watch');
  assert.equal(summary.finalAnswer, 'bcgov/cccharts');
  assert.equal(summary.tracePath, 'logs/run/trace.json');
});
```

- [ ] **Step 5: Run artifact tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerArtifacts.test.ts tests/unit/v2/webVoyagerRunner.test.ts
```

Expected: PASS.

---

## Task 6: Add Optional Judge Types Without Running Judge

**Files:**
- Create: `tests/benchmark/webvoyager/judge_types.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Create judge schema types**

Create `tests/benchmark/webvoyager/judge_types.ts`:

```ts
export type WebVoyagerJudgeVerdict = 'pass' | 'partial' | 'fail' | 'unknown';

export interface WebVoyagerJudgeInput {
  taskId: string;
  task: string;
  url: string;
  referenceAnswer?: unknown;
  finalAnswer: string;
  traceSummary: string;
  screenshotPaths: string[];
  currentDateIso: string;
}

export interface WebVoyagerJudgeResult {
  verdict: WebVoyagerJudgeVerdict;
  confidence: 'high' | 'medium' | 'low';
  failureReason: string;
  impossibleTask: boolean;
  reachedCaptcha: boolean;
  referenceMatchType: 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'not_applicable';
}

export function isWebVoyagerJudgeResult(value: unknown): value is WebVoyagerJudgeResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as WebVoyagerJudgeResult;
  return ['pass', 'partial', 'fail', 'unknown'].includes(candidate.verdict)
    && ['high', 'medium', 'low'].includes(candidate.confidence)
    && typeof candidate.failureReason === 'string'
    && typeof candidate.impossibleTask === 'boolean'
    && typeof candidate.reachedCaptcha === 'boolean'
    && ['exact', 'semantic_subset', 'partial', 'mismatch', 'not_applicable'].includes(candidate.referenceMatchType);
}
```

- [ ] **Step 2: Add schema guard test**

In `tests/unit/v2/webVoyagerEvaluator.test.ts`, add:

```ts
import { isWebVoyagerJudgeResult } from '../../benchmark/webvoyager/judge_types';

test('isWebVoyagerJudgeResult validates optional judge schema', () => {
  assert.equal(isWebVoyagerJudgeResult({
    verdict: 'unknown',
    confidence: 'low',
    failureReason: 'insufficient screenshot evidence',
    impossibleTask: false,
    reachedCaptcha: false,
    referenceMatchType: 'not_applicable',
  }), true);

  assert.equal(isWebVoyagerJudgeResult({
    verdict: 'success',
    confidence: 'low',
    failureReason: '',
    impossibleTask: false,
    reachedCaptcha: false,
    referenceMatchType: 'exact',
  }), false);
});
```

- [ ] **Step 3: Run evaluator tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: PASS.

---

## Task 7: Verification and Benchmark Commands

**Files:**
- No extra files.

- [ ] **Step 1: Run unit tests**

Run:

```powershell
npm.cmd run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 3: Run V2 guard checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected: PASS.

- [ ] **Step 4: Run BrowseGent stable MVR5**

Run:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 21
```

Expected:
- The run uses `Cambridge Dictionary--0` instead of `Allrecipes--3`.
- No known impossible task appears in the stable slice.
- The report persists `webvoyager_artifacts.json`.

- [ ] **Step 5: Run Browser Use stable MVR5 with same slice**

Run with a different key index:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browser-use --request-rpm 8 --key-index 22
```

Expected:
- Same task IDs as BrowseGent.
- Same scoring logic.
- Same artifact format.

- [ ] **Step 6: Report results conservatively**

Use this report template:

```text
MVR5-stable smoke:
- BrowseGent: internal X/5, strict Y/5, manual-corrected pending, environment-adjusted Z/N.
- Browser Use: internal A/5, strict B/5, manual-corrected pending, environment-adjusted C/N.
- Known excluded task: Allrecipes--3, listed impossible by browser-use/eval and observed Cloudflare/captcha locally.
- This is a smoke comparison only. A release comparison requires 3 repeated runs and manual audit.
```

---

## Execution Guardrails

- Do not alter BrowseGent planner/runtime behavior in this benchmark stabilization phase.
- Do not remove hard tasks just because BrowseGent fails them.
- Do not keep known impossible tasks inside `mvr5-stable`.
- Do not count captcha/rate-limit/startup failures as normal answer mismatches.
- Do not use LLM judge verdicts as final truth until at least one manually audited calibration set exists.
- Do not copy Browser Use's selective-only manual correction without false-positive checks.
- Do not commit `new-keys.yaml`, `debug.log`, benchmark logs, screenshots, or generated artifacts.

---

## Self-Review

Spec coverage:
- Browser Use impossible-task handling is covered by Task 1.
- Stable MVR5 replacement is covered by Task 2.
- Environment/impossible scoring cleanup is covered by Task 3.
- Runtime startup failure separation is covered by Task 4.
- Review-ready artifact packaging is covered by Task 5.
- Optional judge foundation is covered by Task 6.
- Competitor comparison commands are covered by Task 7.

Scope check:
- This plan does not change BrowseGent product logic.
- This plan does not implement an LLM judge call yet; it creates the schema and artifact foundation only.
- This plan is small enough to execute before another benchmark run.

Ambiguity check:
- `mvr5` remains legacy for historical comparison.
- `mvr5-stable` is the default recommended smoke slice after this plan.
- `Allrecipes--3` is excluded from `mvr5-stable` because it is known impossible/environment-blocked, not because BrowseGent performed poorly.
- Judge is optional and disabled until calibrated.
