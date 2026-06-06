# Phase 1 Evaluation and Extraction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BrowseGent's next benchmark results truthful and make final answers harder to falsely accept, without a broad V2 loop rewrite or benchmark-specific tuning.

**Architecture:** This plan keeps the current Brain1 projection, ContinuityGraph, V2 planner loop, and ref system intact. It adds a stricter WebVoyager evaluation layer and a small answer-contract layer that validates whether the final answer shape matches the user goal before reporting success.

**Tech Stack:** TypeScript, Node test runner, Playwright-backed BrowseGent V2 runtime, existing WebVoyager-lite benchmark harness.

---

## Scope

This is the first implementation phase after the MVR5 result jump. It must not replace the agent loop with a new actor architecture and must not make website-specific product fixes for GitHub, ArXiv, Wolfram, Google Maps, or Allrecipes.

Allowed changes:
- Benchmark scoring and reporting that separates internal agent success from strict, manual-corrected, partial, and environment-adjusted success.
- General answer-shape checks for final output, such as "URL-only answer is insufficient when the task asks for an entity/title/repository/paper".
- General structured evidence extraction from existing readable refs and tool results.
- Measurement of compact projection sizes as a baseline for future A11y/semantic projection work.

Deferred changes:
- Full `do/get/check` Orchestrator/Actor rewrite.
- Exclusive accessibility-tree planner input.
- Captcha solving or stealth features.
- Site-specific selectors, site-specific ranking rules, or hardcoded benchmark answers.

External design references:
- Browser Use evaluation repo: https://github.com/browser-use/eval
- Browser Use benchmark caveats: https://browser-use.com/posts/browser-use-webvoyager
- Alumnium WebVoyager writeup: https://alumnium.ai/blog/webvoyager-benchmark/
- DeepWiki research already collected for `alumnium-hq/alumnium`, `browser-use/browser-use`, and `browser-use/eval`.

---

## File Structure

Benchmark/evaluation files:
- Modify: `tests/benchmark/webvoyager/types.ts`
  - Add verdict, manual audit, environment, and score summary types.
- Create: `tests/benchmark/webvoyager/manual_audit.ts`
  - Parse and validate optional manual-audit labels.
- Modify: `tests/benchmark/webvoyager/evaluator.ts`
  - Compute truthful WebVoyager scoring modes from benchmark result, reference match, environment status, and optional manual audit.
- Modify: `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
  - Add `--manual-audit` support and render expanded evaluation markdown.
- Create: `tests/benchmark/webvoyager/repeat_summary.ts`
  - Aggregate repeated run summaries with mean and standard deviation.
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`
  - Extend evaluator tests for partial, manual-corrected, and environment-adjusted scoring.
- Test: `tests/unit/v2/webVoyagerRunner.test.ts`
  - Add run-level manual-audit wiring coverage.

Product-side answer quality files:
- Create: `src/v2/agent/AnswerContract.ts`
  - Infer expected final-answer shape from the goal and validate candidate final answers.
- Modify: `src/v2/agent/FinalizationEvidence.ts`
  - Include compact answer contract and answer candidates in finalization evidence.
- Modify: `src/v2/agent/V2AgentLoop.ts`
  - Validate planner `done` output before completing success.
- Test: `tests/unit/v2/answerContract.test.ts`
  - Unit test answer-shape inference and validation.
- Test: `tests/unit/v2/finalizationEvidence.test.ts`
  - Unit test evidence includes useful candidates without bloating context.

Projection measurement files:
- Create: `src/v2/planner/ProjectionSizeDiagnostics.ts`
  - Compute planner input and projection byte counts in a small reusable helper.
- Modify: `src/v2/planner/PlannerInputComposer.ts`
  - Attach size diagnostics without changing planner behavior.
- Test: `tests/unit/v2/projectionSizeDiagnostics.test.ts`
  - Verify byte counts and thresholds are deterministic.

---

## Task 1: Add Truthful WebVoyager Verdict Types

**Files:**
- Modify: `tests/benchmark/webvoyager/types.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Extend WebVoyager evaluation types**

Add these types to `tests/benchmark/webvoyager/types.ts`:

```ts
export type WebVoyagerReferenceMatchType = 'exact' | 'semantic_subset' | 'partial' | 'mismatch' | 'missing_reference';

export type WebVoyagerEnvironmentStatus = 'normal' | 'environment_block' | 'impossible_task';

export type WebVoyagerManualVerdict = 'pass' | 'partial' | 'fail' | 'environment_block' | 'impossible';

export interface WebVoyagerManualAuditEntry {
  taskId: string;
  verdict: WebVoyagerManualVerdict;
  reason: string;
  reviewer?: string;
}

export interface WebVoyagerManualAuditFile {
  runId?: string;
  entries: WebVoyagerManualAuditEntry[];
}
```

Replace `WebVoyagerVerdict` with:

```ts
export interface WebVoyagerVerdict {
  taskId: string;
  internalPassed: boolean;
  rawAutoScore: number;
  strictScore: number;
  manualCorrectedScore: number;
  partialCredit: number;
  environmentAdjustedEligible: boolean;
  environmentStatus: WebVoyagerEnvironmentStatus;
  referenceMatchType: WebVoyagerReferenceMatchType;
  needsManualReview: boolean;
  manualVerdict?: WebVoyagerManualVerdict;
  reasons: string[];
}
```

Replace `WebVoyagerEvaluationSummary` with:

```ts
export interface WebVoyagerEvaluationSummary {
  totalRuns: number;
  internalPassRate: number;
  rawAutoScore: number;
  strictScore: number;
  manualCorrectedScore: number;
  partialCreditRate: number;
  environmentAdjustedStrictScore: number;
  environmentAdjustedManualScore: number;
  manualReviewCount: number;
  environmentBlockedCount: number;
  impossibleTaskCount: number;
}
```

- [ ] **Step 2: Update evaluator tests to compile against new shape**

In `tests/unit/v2/webVoyagerEvaluator.test.ts`, update existing assertions so they check:

```ts
assert.equal(verdict.internalPassed, true);
assert.equal(verdict.strictScore, 1);
assert.equal(verdict.manualCorrectedScore, 1);
assert.equal(verdict.partialCredit, 1);
assert.equal(verdict.referenceMatchType, 'exact');
```

- [ ] **Step 3: Run the targeted evaluator test**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: it fails until `evaluator.ts` is updated in Task 3.

---

## Task 2: Add Manual Audit File Loading

**Files:**
- Create: `tests/benchmark/webvoyager/manual_audit.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Write manual audit loader**

Create `tests/benchmark/webvoyager/manual_audit.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { WebVoyagerManualAuditEntry, WebVoyagerManualAuditFile, WebVoyagerManualVerdict } from './types';

const VALID_VERDICTS = new Set<WebVoyagerManualVerdict>(['pass', 'partial', 'fail', 'environment_block', 'impossible']);

export async function loadWebVoyagerManualAudit(path: string | undefined): Promise<Map<string, WebVoyagerManualAuditEntry>> {
  if (!path) return new Map();
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return parseWebVoyagerManualAudit(parsed);
}

export function parseWebVoyagerManualAudit(value: unknown): Map<string, WebVoyagerManualAuditEntry> {
  if (!value || typeof value !== 'object' || !Array.isArray((value as WebVoyagerManualAuditFile).entries)) {
    throw new Error('Manual audit file must contain an entries array.');
  }

  const entries = new Map<string, WebVoyagerManualAuditEntry>();
  for (const rawEntry of (value as WebVoyagerManualAuditFile).entries) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error('Manual audit entry must be an object.');
    }
    const entry = rawEntry as WebVoyagerManualAuditEntry;
    if (typeof entry.taskId !== 'string' || entry.taskId.trim().length === 0) {
      throw new Error('Manual audit entry taskId must be a non-empty string.');
    }
    if (!VALID_VERDICTS.has(entry.verdict)) {
      throw new Error(`Manual audit entry ${entry.taskId} has invalid verdict ${String(entry.verdict)}.`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      throw new Error(`Manual audit entry ${entry.taskId} reason must be a non-empty string.`);
    }
    entries.set(entry.taskId, entry);
  }
  return entries;
}
```

- [ ] **Step 2: Add unit coverage**

Add a test in `tests/unit/v2/webVoyagerEvaluator.test.ts`:

```ts
import { parseWebVoyagerManualAudit } from '../../benchmark/webvoyager/manual_audit';

test('parseWebVoyagerManualAudit returns entries keyed by task id', () => {
  const audit = parseWebVoyagerManualAudit({
    entries: [
      { taskId: 'webvoyager_GitHub__0', verdict: 'fail', reason: 'Selected wrong repository.' },
      { taskId: 'webvoyager_Google_Map__10', verdict: 'pass', reason: 'Answer matches manual evidence.' },
    ],
  });

  assert.equal(audit.get('webvoyager_GitHub__0')?.verdict, 'fail');
  assert.equal(audit.get('webvoyager_Google_Map__10')?.verdict, 'pass');
});
```

- [ ] **Step 3: Run the targeted test**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: the manual audit parser test passes once imports and types compile.

---

## Task 3: Make WebVoyager Evaluation Truthful

**Files:**
- Modify: `tests/benchmark/webvoyager/evaluator.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Change evaluator signature**

Change `evaluateWebVoyagerResult` to accept optional manual audit:

```ts
export function evaluateWebVoyagerResult(
  task: WebVoyagerBenchmarkTask,
  result: ScoredBenchmarkResult,
  manualAudit?: WebVoyagerManualAuditEntry,
): WebVoyagerVerdict {
  const reasons: string[] = [];
  const reference = task.webVoyager.referenceAnswer;
  const internalPassed = result.passed === true;
  const environmentStatus = classifyEnvironmentStatus(result, manualAudit);
  const referenceMatchType = reference ? classifyReferenceMatch(result.value, reference.answer) : 'missing_reference';

  if (!internalPassed) reasons.push('benchmark_result_failed');
  if (!reference) reasons.push('missing_reference');
  if (reference && referenceMatchType === 'mismatch') reasons.push('reference_mismatch');
  if (manualAudit) reasons.push(`manual_${manualAudit.verdict}`);

  const strictScore = internalPassed && referenceMatchType !== 'mismatch' && referenceMatchType !== 'missing_reference' ? 1 : 0;
  const manualCorrectedScore = scoreManual(manualAudit, strictScore);
  const partialCredit = scorePartial(manualAudit, strictScore, referenceMatchType);

  return {
    taskId: task.taskId,
    internalPassed,
    rawAutoScore: strictScore,
    strictScore,
    manualCorrectedScore,
    partialCredit,
    environmentAdjustedEligible: environmentStatus === 'normal',
    environmentStatus,
    referenceMatchType,
    needsManualReview: !manualAudit && (!reference || referenceMatchType === 'mismatch' || referenceMatchType === 'partial'),
    manualVerdict: manualAudit?.verdict,
    reasons,
  };
}
```

- [ ] **Step 2: Add helper behavior**

Implement helper functions in the same file:

```ts
function classifyEnvironmentStatus(
  result: ScoredBenchmarkResult,
  manualAudit: WebVoyagerManualAuditEntry | undefined,
): WebVoyagerEnvironmentStatus {
  if (manualAudit?.verdict === 'environment_block') return 'environment_block';
  if (manualAudit?.verdict === 'impossible') return 'impossible_task';
  if (result.failureType === 'environment_block') return 'environment_block';
  return 'normal';
}

function scoreManual(manualAudit: WebVoyagerManualAuditEntry | undefined, strictScore: number): number {
  if (!manualAudit) return strictScore;
  if (manualAudit.verdict === 'pass') return 1;
  return 0;
}

function scorePartial(
  manualAudit: WebVoyagerManualAuditEntry | undefined,
  strictScore: number,
  referenceMatchType: WebVoyagerReferenceMatchType,
): number {
  if (manualAudit?.verdict === 'partial') return 0.5;
  if (manualAudit?.verdict === 'pass') return 1;
  if (strictScore === 1) return 1;
  if (referenceMatchType === 'partial') return 0.5;
  return 0;
}
```

Update the old `answerMatchesReference` helper into `classifyReferenceMatch`. Keep it conservative:

```ts
function classifyReferenceMatch(value: string, answer: unknown): WebVoyagerReferenceMatchType {
  const normalizedValue = normalize(value);
  const candidates = Array.isArray(answer) ? answer : [answer];
  const normalizedCandidates = candidates
    .flatMap(candidate => typeof candidate === 'string' ? [candidate] : [JSON.stringify(candidate)])
    .map(normalize)
    .filter(Boolean);

  if (normalizedCandidates.some(candidate => normalizedValue === candidate || normalizedValue.includes(candidate))) {
    return 'exact';
  }

  if (normalizedCandidates.some(candidate => candidate.includes(normalizedValue) && normalizedValue.length >= 12)) {
    return 'semantic_subset';
  }

  if (normalizedCandidates.some(candidate => hasTokenOverlap(normalizedValue, candidate, 0.6))) {
    return 'partial';
  }

  return 'mismatch';
}
```

- [ ] **Step 3: Update summary math**

Update `summarizeWebVoyagerEvaluation`:

```ts
export function summarizeWebVoyagerEvaluation(verdicts: WebVoyagerVerdict[]): WebVoyagerEvaluationSummary {
  const totalRuns = verdicts.length;
  const eligible = verdicts.filter(verdict => verdict.environmentAdjustedEligible);
  return {
    totalRuns,
    internalPassRate: ratio(verdicts.filter(verdict => verdict.internalPassed).length, totalRuns),
    rawAutoScore: ratio(sum(verdicts.map(verdict => verdict.rawAutoScore)), totalRuns),
    strictScore: ratio(sum(verdicts.map(verdict => verdict.strictScore)), totalRuns),
    manualCorrectedScore: ratio(sum(verdicts.map(verdict => verdict.manualCorrectedScore)), totalRuns),
    partialCreditRate: ratio(sum(verdicts.map(verdict => verdict.partialCredit)), totalRuns),
    environmentAdjustedStrictScore: ratio(sum(eligible.map(verdict => verdict.strictScore)), eligible.length),
    environmentAdjustedManualScore: ratio(sum(eligible.map(verdict => verdict.manualCorrectedScore)), eligible.length),
    manualReviewCount: verdicts.filter(verdict => verdict.needsManualReview).length,
    environmentBlockedCount: verdicts.filter(verdict => verdict.environmentStatus === 'environment_block').length,
    impossibleTaskCount: verdicts.filter(verdict => verdict.environmentStatus === 'impossible_task').length,
  };
}
```

- [ ] **Step 4: Add focused evaluator test cases**

Add tests:

```ts
test('manual audit fail overrides internal pass', () => {
  const verdict = evaluateWebVoyagerResult(webTask(), result({ passed: true, value: 'wrong answer' }), {
    taskId: 'webvoyager_GitHub__0',
    verdict: 'fail',
    reason: 'Wrong entity selected.',
  });

  assert.equal(verdict.internalPassed, true);
  assert.equal(verdict.strictScore, 0);
  assert.equal(verdict.manualCorrectedScore, 0);
  assert.equal(verdict.needsManualReview, false);
});

test('manual audit partial contributes half credit only to partial score', () => {
  const verdict = evaluateWebVoyagerResult(webTask(), result({ passed: true, value: 'advanced search page url' }), {
    taskId: 'webvoyager_ArXiv__0',
    verdict: 'partial',
    reason: 'Reached relevant page but did not return requested paper title.',
  });

  assert.equal(verdict.manualCorrectedScore, 0);
  assert.equal(verdict.partialCredit, 0.5);
});
```

- [ ] **Step 5: Run evaluator tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: PASS.

---

## Task 4: Wire Manual Audit Into WebVoyager Runner Reports

**Files:**
- Modify: `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
- Test: `tests/unit/v2/webVoyagerRunner.test.ts`

- [ ] **Step 1: Add runner option**

Add to `RunWebVoyagerLiteOptions`:

```ts
manualAuditPath?: string;
```

Import the loader:

```ts
import { loadWebVoyagerManualAudit } from './manual_audit';
```

Load the audit before evaluating:

```ts
const manualAudit = await loadWebVoyagerManualAudit(options.manualAuditPath);
const verdicts = benchmark.results.map(result => evaluateWebVoyagerResult(
  byTaskId.get(result.taskId)!,
  result,
  manualAudit.get(result.taskId),
));
```

- [ ] **Step 2: Add CLI flag**

In `readCliOptions`, read:

```ts
const manualAuditPath = readFlag('--manual-audit');
```

Return it:

```ts
manualAuditPath,
```

- [ ] **Step 3: Expand markdown report**

Update `renderWebVoyagerEvaluationMarkdown` to include:

```ts
`Internal pass rate: ${(evaluation.summary.internalPassRate * 100).toFixed(1)}%`,
`Strict score: ${(evaluation.summary.strictScore * 100).toFixed(1)}%`,
`Manual-corrected score: ${(evaluation.summary.manualCorrectedScore * 100).toFixed(1)}%`,
`Partial-credit score: ${(evaluation.summary.partialCreditRate * 100).toFixed(1)}%`,
`Environment-adjusted strict score: ${(evaluation.summary.environmentAdjustedStrictScore * 100).toFixed(1)}%`,
`Environment-adjusted manual score: ${(evaluation.summary.environmentAdjustedManualScore * 100).toFixed(1)}%`,
`Manual review count: ${evaluation.summary.manualReviewCount}`,
`Environment blocked count: ${evaluation.summary.environmentBlockedCount}`,
`Impossible task count: ${evaluation.summary.impossibleTaskCount}`,
```

Expand the table columns to:

```ts
'| Task | Internal | Strict | Manual | Partial | Env | Ref Match | Review | Reasons |'
```

- [ ] **Step 4: Add runner test**

In `tests/unit/v2/webVoyagerRunner.test.ts`, add a unit run with a temporary manual-audit file:

```ts
await writeFile(join(root, 'manual-audit.json'), JSON.stringify({
  entries: [
    { taskId: 'webvoyager_GitHub__0', verdict: 'fail', reason: 'Wrong repo selected.' },
  ],
}), 'utf8');
```

Assert the persisted evaluation contains:

```ts
assert.equal(evaluation.summary.manualCorrectedScore, 0);
assert.equal(evaluation.verdicts[0].manualVerdict, 'fail');
```

- [ ] **Step 5: Run runner tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerRunner.test.ts tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: PASS.

---

## Task 5: Add Answer Contract Validation

**Files:**
- Create: `src/v2/agent/AnswerContract.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Test: `tests/unit/v2/answerContract.test.ts`

- [ ] **Step 1: Create answer contract module**

Create `src/v2/agent/AnswerContract.ts`:

```ts
export type AnswerKind = 'number' | 'url' | 'entity' | 'ranked_entity' | 'description' | 'unknown';

export interface AnswerContract {
  kind: AnswerKind;
  requiresNonUrlText: boolean;
  requiresRankingEvidence: boolean;
  reason: string;
}

export interface AnswerValidation {
  ok: boolean;
  reasons: string[];
}

export function inferAnswerContract(goal: string): AnswerContract {
  const normalized = goal.toLowerCase();
  if (/\b(url|link|website)\b/.test(normalized)) {
    return { kind: 'url', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_requests_url' };
  }
  if (/\b(count|number|how many|calculate|compute|value|answer)\b/.test(normalized)) {
    return { kind: 'number', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_requests_numeric_or_direct_answer' };
  }
  if (/\b(most|highest|lowest|largest|smallest|top|latest|newest|oldest|best)\b/.test(normalized)) {
    return { kind: 'ranked_entity', requiresNonUrlText: true, requiresRankingEvidence: true, reason: 'goal_requests_ranked_entity' };
  }
  if (/\b(repo|repository|paper|article|title|name|place|location|company|person|product)\b/.test(normalized)) {
    return { kind: 'entity', requiresNonUrlText: true, requiresRankingEvidence: false, reason: 'goal_requests_named_entity' };
  }
  if (/\b(describe|summary|explain|tell me about)\b/.test(normalized)) {
    return { kind: 'description', requiresNonUrlText: true, requiresRankingEvidence: false, reason: 'goal_requests_description' };
  }
  return { kind: 'unknown', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_shape_unknown' };
}

export function validateAnswerAgainstContract(answer: string, contract: AnswerContract): AnswerValidation {
  const compact = answer.replace(/\s+/g, ' ').trim();
  const reasons: string[] = [];
  if (compact.length === 0) reasons.push('empty_answer');
  if (contract.requiresNonUrlText && isUrlOnly(compact)) reasons.push('url_only_answer_for_named_entity_goal');
  if (contract.kind === 'number' && !/[0-9]/.test(compact)) reasons.push('numeric_goal_without_number');
  return { ok: reasons.length === 0, reasons };
}

function isUrlOnly(value: string): boolean {
  const withoutUrls = value.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim();
  return withoutUrls.length === 0 || /^[/:?=&._#%a-z0-9-]+$/i.test(withoutUrls);
}
```

- [ ] **Step 2: Add answer contract unit tests**

Create `tests/unit/v2/answerContract.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { inferAnswerContract, validateAnswerAgainstContract } from '../../src/v2/agent/AnswerContract';

test('inferAnswerContract requires non-url text for named entity goals', () => {
  const contract = inferAnswerContract('Find the latest paper about quantum computing on arXiv');
  assert.equal(contract.kind, 'ranked_entity');
  assert.equal(contract.requiresNonUrlText, true);
});

test('validateAnswerAgainstContract rejects url-only answer for entity goal', () => {
  const contract = inferAnswerContract('Find the repository with the most stars');
  const validation = validateAnswerAgainstContract('https://github.com/example/repo', contract);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.reasons, ['url_only_answer_for_named_entity_goal']);
});

test('validateAnswerAgainstContract allows numeric direct answers', () => {
  const contract = inferAnswerContract('Compute 4.2 + 7');
  const validation = validateAnswerAgainstContract('11.2', contract);
  assert.equal(validation.ok, true);
});
```

- [ ] **Step 3: Guard planner `done` in V2AgentLoop**

In `src/v2/agent/V2AgentLoop.ts`, import:

```ts
import { inferAnswerContract, validateAnswerAgainstContract } from './AnswerContract';
```

Before completing success for a normal planner `done`, validate:

```ts
if (plannerResult.output.done === true) {
  const value = plannerResult.output.val ?? '';
  const validation = validateAnswerAgainstContract(value, inferAnswerContract(input.goal));
  if (!validation.ok) {
    return await this.complete(harness, {
      success: false,
      value,
      failureReason: `answer_contract_failed:${validation.reasons.join('|')}`,
      steps: metrics.plannerCalls,
      metrics,
    });
  }
  return await this.complete(harness, {
    success: true,
    value,
    steps: metrics.plannerCalls,
    metrics,
  });
}
```

Use the same validation inside `attemptFinalization` before finalization success.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/answerContract.test.ts
```

Expected: PASS.

---

## Task 6: Improve Finalization Evidence Without Expanding Context

**Files:**
- Modify: `src/v2/agent/FinalizationEvidence.ts`
- Test: `tests/unit/v2/finalizationEvidence.test.ts`

- [ ] **Step 1: Add answer contract to finalization evidence**

Import:

```ts
import { inferAnswerContract } from './AnswerContract';
```

Inside `buildFinalizationEvidence`, compute:

```ts
const contract = inferAnswerContract(input.goal);
sections.push(`Answer contract: ${contract.kind}; ${contract.reason}; nonUrlText=${contract.requiresNonUrlText}; rankingEvidence=${contract.requiresRankingEvidence}`);
```

- [ ] **Step 2: Add compact candidate extraction**

After readable item selection, add a compact candidate section:

```ts
const answerCandidates = readableItems
  .map(item => compactText([item.name, item.text].filter(Boolean).join(' '), maxTextLength))
  .filter(text => text.length > 0)
  .filter((text, index, all) => all.findIndex(existing => existing.toLowerCase() === text.toLowerCase()) === index)
  .slice(0, 8);

if (answerCandidates.length > 0) {
  sections.push([
    'Answer candidates:',
    ...answerCandidates.map((text, index) => `- candidate_${index + 1}: ${text}`),
  ].join('\n'));
}
```

Keep `maxReadableItems` default at 12 and `maxTextLength` default at 180. Do not increase either default in this task.

- [ ] **Step 3: Add finalization evidence test**

Create `tests/unit/v2/finalizationEvidence.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinalizationEvidence } from '../../src/v2/agent/FinalizationEvidence';
import type { OperationalProjection } from '../../src/v2/brain1/projectionTypes';

test('buildFinalizationEvidence includes answer contract and bounded candidates', () => {
  const projection = {
    refs: {},
    interactions: [],
    readables: [
      readable('r1', 'resource-watch/resource-watch', '1.2k stars climate data platform'),
      readable('r2', 'akshaysonvane/Climate-Change-Data-Analytics', '20 stars visualization'),
    ],
    navigation: [],
    regions: [],
    warnings: [],
    stats: { interactionCount: 0, readableCount: 2, navigationCount: 0, regionCount: 0 },
  } as unknown as OperationalProjection;

  const evidence = buildFinalizationEvidence({
    goal: 'Find the repository with the most stars for climate change data visualization',
    projection,
    lastSuccessfulEvidenceValue: 'GitHub search results',
  });

  assert.match(evidence, /Answer contract: ranked_entity/);
  assert.match(evidence, /candidate_1/);
  assert.match(evidence, /resource-watch\/resource-watch/);
});

function readable(refId: string, name: string, text: string) {
  return {
    refId,
    kind: 'text',
    role: 'text',
    name,
    text,
    score: 10,
    visibility: 'visible',
    actionability: 'readable',
  };
}
```

- [ ] **Step 4: Run finalization tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/finalizationEvidence.test.ts tests/unit/v2/answerContract.test.ts
```

Expected: PASS.

---

## Task 7: Add Projection Size Diagnostics Baseline

**Files:**
- Create: `src/v2/planner/ProjectionSizeDiagnostics.ts`
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerInputComposer.ts`
- Test: `tests/unit/v2/projectionSizeDiagnostics.test.ts`

- [ ] **Step 1: Create diagnostics helper**

Create `src/v2/planner/ProjectionSizeDiagnostics.ts`:

```ts
export interface ProjectionSizeDiagnostics {
  currentBytes: number;
  workingSetBytes: number;
  totalPlannerInputBytes: number;
}

export function measureProjectionSize(input: {
  current: unknown;
  workingSet: unknown;
  plannerInput?: unknown;
}): ProjectionSizeDiagnostics {
  const currentBytes = byteLength(input.current);
  const workingSetBytes = byteLength(input.workingSet);
  return {
    currentBytes,
    workingSetBytes,
    totalPlannerInputBytes: input.plannerInput ? byteLength(input.plannerInput) : currentBytes + workingSetBytes,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
```

- [ ] **Step 2: Add type field**

In `src/v2/planner/types.ts`, add:

```ts
import type { ProjectionSizeDiagnostics } from './ProjectionSizeDiagnostics';
```

Add to `PlannerInput`:

```ts
sizeDiagnostics?: ProjectionSizeDiagnostics;
```

- [ ] **Step 3: Attach diagnostics in composer**

In `src/v2/planner/PlannerInputComposer.ts`, import:

```ts
import { measureProjectionSize } from './ProjectionSizeDiagnostics';
```

Build the planner input object in a local variable, attach diagnostics, and return it:

```ts
const plannerInput: PlannerInput = {
  version: 'v2.planner_input.v2',
  episodeId: input.episodeId,
  goal: input.goal,
  current,
  workingSet: workingSetSelection.workingSet,
  workingSetDiagnostics: workingSetSelection.diagnostics,
  continuity: input.graphSnapshot ? summarizeContinuity(input.graphSnapshot) : undefined,
  transition: input.transitionEvidence ? summarizeTransition(input.transitionEvidence) : undefined,
  lastResult: input.lastResult ? summarizeLastResult(input.lastResult) : undefined,
  failures: input.failureEvidence?.map(summarizeFailure),
  deadState: input.deadStateEvidence ? summarizeDeadState(input.deadStateEvidence) : undefined,
  recovery,
  uncertainty: buildUncertainty(input),
  lineage: input.trace
    ? this.lineageCompressor.compress(input.trace, { maxSteps: input.maxLineageSteps })
    : undefined,
};

plannerInput.sizeDiagnostics = measureProjectionSize({
  current: plannerInput.current,
  workingSet: plannerInput.workingSet,
  plannerInput,
});

return plannerInput;
```

- [ ] **Step 4: Add diagnostics test**

Create `tests/unit/v2/projectionSizeDiagnostics.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureProjectionSize } from '../../src/v2/planner/ProjectionSizeDiagnostics';

test('measureProjectionSize reports deterministic utf8 byte counts', () => {
  const diagnostics = measureProjectionSize({
    current: { refs: { r1: { text: 'hello' } } },
    workingSet: { primaryRefs: ['r1'] },
  });

  assert.equal(diagnostics.currentBytes, Buffer.byteLength(JSON.stringify({ refs: { r1: { text: 'hello' } } }), 'utf8'));
  assert.equal(diagnostics.workingSetBytes, Buffer.byteLength(JSON.stringify({ primaryRefs: ['r1'] }), 'utf8'));
  assert.equal(diagnostics.totalPlannerInputBytes, diagnostics.currentBytes + diagnostics.workingSetBytes);
});
```

- [ ] **Step 5: Run diagnostics tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/projectionSizeDiagnostics.test.ts
```

Expected: PASS.

---

## Task 8: Add Repeat Summary Aggregation

**Files:**
- Create: `tests/benchmark/webvoyager/repeat_summary.ts`
- Modify: `tests/benchmark/webvoyager/run_webvoyager_lite.ts`
- Test: `tests/unit/v2/webVoyagerEvaluator.test.ts`

- [ ] **Step 1: Create repeat summary helper**

Create `tests/benchmark/webvoyager/repeat_summary.ts`:

```ts
import type { WebVoyagerEvaluationSummary } from './types';

export interface WebVoyagerRepeatSummary {
  runs: number;
  strictMean: number;
  strictStdDev: number;
  manualMean: number;
  manualStdDev: number;
  environmentAdjustedManualMean: number;
  environmentAdjustedManualStdDev: number;
}

export function summarizeWebVoyagerRepeats(summaries: WebVoyagerEvaluationSummary[]): WebVoyagerRepeatSummary {
  return {
    runs: summaries.length,
    strictMean: mean(summaries.map(summary => summary.strictScore)),
    strictStdDev: stdDev(summaries.map(summary => summary.strictScore)),
    manualMean: mean(summaries.map(summary => summary.manualCorrectedScore)),
    manualStdDev: stdDev(summaries.map(summary => summary.manualCorrectedScore)),
    environmentAdjustedManualMean: mean(summaries.map(summary => summary.environmentAdjustedManualScore)),
    environmentAdjustedManualStdDev: stdDev(summaries.map(summary => summary.environmentAdjustedManualScore)),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
```

- [ ] **Step 2: Add unit coverage**

Add in `tests/unit/v2/webVoyagerEvaluator.test.ts`:

```ts
import { summarizeWebVoyagerRepeats } from '../../benchmark/webvoyager/repeat_summary';

test('summarizeWebVoyagerRepeats reports mean and standard deviation', () => {
  const summary = summarizeWebVoyagerRepeats([
    summaryFixture({ strictScore: 0.2, manualCorrectedScore: 0.4, environmentAdjustedManualScore: 0.5 }),
    summaryFixture({ strictScore: 0.6, manualCorrectedScore: 0.8, environmentAdjustedManualScore: 1.0 }),
  ]);

  assert.equal(summary.runs, 2);
  assert.equal(summary.strictMean, 0.4);
  assert.ok(summary.strictStdDev > 0);
});
```

Use a local `summaryFixture` helper that fills all `WebVoyagerEvaluationSummary` fields with zero defaults and applies overrides.

- [ ] **Step 3: Run tests**

Run:

```powershell
npm.cmd run test:unit -- tests/unit/v2/webVoyagerEvaluator.test.ts
```

Expected: PASS.

---

## Task 9: Full Verification and Safe Benchmark Commands

**Files:**
- No source file changes.

- [ ] **Step 1: Run unit tests**

Run:

```powershell
npm.cmd run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 3: Run anti-leakage checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected: PASS.

- [ ] **Step 4: Run one BrowseGent MVR5 smoke only after tests pass**

Run with a fresh key index:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 41
```

Expected output now reports internal pass rate separately from strict/manual-corrected/environment-adjusted scores.

- [ ] **Step 5: Do not claim SOTA or production readiness from one run**

Acceptable claim format:

```text
MVR5 smoke result: internal pass X/5, strict Y/5, manual-corrected Z/5, environment-adjusted W/N. This is a smoke signal only; release claims require 3 repeated runs on the same slice and manual-audit calibration.
```

---

## Execution Guardrails

- Do not add website-specific product rules.
- Do not change planner prompts to mention individual benchmark tasks.
- Do not increase context budgets to hide extraction problems.
- Do not include API keys, `new-keys.yaml`, `debug.log`, benchmark logs, screenshots, or generated run artifacts in commits.
- If a change reduces benchmark score but improves truthfulness, keep it and report the corrected metric honestly.
- If answer-contract validation causes many false negatives, loosen only the general contract rule that caused them; do not add site exceptions.

---

## Self-Review

Spec coverage:
- Benchmark method correction is covered by Tasks 1-4 and 8.
- Product answer correctness is covered by Tasks 5-6.
- Token/projection measurement is covered by Task 7.
- Verification and safe benchmark use are covered by Task 9.

Scope check:
- The full `do/get/check` actor architecture and exclusive accessibility-tree switch are intentionally deferred because they are high-risk rewrites. This plan creates the measurement and answer-quality foundations needed before that rewrite.

Ambiguity check:
- Manual-corrected score counts only manual `pass` as success.
- Manual `partial` contributes only to `partialCreditRate`, not strict or manual-corrected success.
- Environment-adjusted scores exclude `environment_block` and `impossible_task`.
- Product answer validation is based on general answer shape, not websites.
