# Phase A3 Compact Shadow Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate whether BrowseGent's compact graph-derived planner state can produce valid comparable decisions without executing those decisions or changing production behavior.

**Architecture:** Replay recorded planner episodes offline. Join each compact-view artifact with its recorded production planner output and trace step outcome, call a dedicated compact shadow planner once for eligible episodes, normalize compact indexes back to runtime refs, and write diagnostic disagreement reports. The production `V2AgentLoop`, production planner prompt, and browser tool execution remain unchanged.

**Tech Stack:** TypeScript, Node test runner, existing provider abstraction, `PlannerOutputSchema`, compact planner artifacts, Gemini key pool, `RequestPacer`, WebVoyager-lite trace artifacts.

---

## Hard Prerequisites

Do not run shadow model calls until:

- `D:\BrowseGent\docs\superpowers\plans\2026-06-07-phase-a2-ref-resolution-stabilization-plan.md` is complete.
- `npm.cmd run test:unit`, `npm.cmd run build`, and `npm.cmd run check:v2` pass.
- A2 audit reasons are specific rather than uniformly `runtime_resolution_failure`.

The latest A2 smoke telemetry has `87.1%` action-ref coverage, below the roadmap's `95%` A1 enforcement gate. This does not block diagnostic A3 replay because ineligible episodes perform zero provider calls. It does block A4. Every A3 report must show eligible, ineligible, and missing-ref counts so the compact path cannot look stronger by silently filtering hard cases.

## External Reference Decisions

Browser Use separates static system instructions, fresh per-step browser state, and ephemeral retry/validation context. It also bounds serialized browser state and validates structured output. Agent Browser reinforces compact indexed interactive state with runtime-owned refs and ref maps.

References:

- https://deepwiki.com/browser-use/browser-use/2.2-message-manager-and-prompt-construction
- https://deepwiki.com/browser-use/browser-use/8.7-structured-output-and-schema-optimization
- https://deepwiki.com/vercel-labs/agent-browser

Implementation decisions:

- A3 is offline replay first, not a second live planner inside benchmarks.
- A3 uses compact indexes like `a1` and `r1`, mapped internally to runtime refs.
- A3 calls the provider once per eligible episode and records invalid output instead of retrying.
- A3 does not execute shadow actions.
- A3 does not decide that shadow is better or worse. It only reports structural agreement and errors.
- Agreement with failed production actions is diagnostic only, never a rollout gate.
- Gemini key values must never be written to JSON, Markdown, logs, or error text.

---

## File Map

- Create `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
  - Builds compact shadow input, `indexToRef`, `refToIndex`, and eligibility diagnostics from `CompactPlannerView`.
- Create `D:\BrowseGent\tests\unit\v2\compactShadowInput.test.ts`
  - Tests stable indexing, tool mapping, duplicate ref handling, and first-step eligibility.
- Create `D:\BrowseGent\src\v2\planner\CompactShadowPrompt.ts`
  - Dedicated compact shadow system and user prompt.
- Create `D:\BrowseGent\tests\unit\v2\compactShadowPrompt.test.ts`
  - Tests prompt boundaries and absence of raw production planner sections.
- Create `D:\BrowseGent\src\v2\planner\CompactShadowPlanner.ts`
  - One-call provider wrapper with compact-index normalization and schema validation.
- Create `D:\BrowseGent\tests\unit\v2\compactShadowPlanner.test.ts`
  - Tests valid output, unknown compact indexes, invalid output, and provider errors.
- Create `D:\BrowseGent\src\v2\planner\CompactShadowComparison.ts`
  - Pure structural comparison between production and shadow output, preserving production first-step execution outcome.
- Create `D:\BrowseGent\tests\unit\v2\compactShadowComparison.test.ts`
  - Tests agreement classes and successful-production cohort behavior.
- Create `D:\BrowseGent\tests\benchmark\v2\compact_shadow_replay.ts`
  - Offline trace loader, key rotation, pacing, bounded episode execution, and report writer.
- Create `D:\BrowseGent\tests\unit\v2\compactShadowReplay.test.ts`
  - Tests artifact joining, step outcome derivation, eligibility-before-provider-call, and report summaries.

---

## Task 1: Compact Shadow Input

**Files:**

- Create: `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactShadowInput.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests covering:

- action indexes are `a1`, `a2`, in original compact action order,
- read indexes are `r1`, `r2`, in original compact read order,
- if a ref appears in actions and reads, keep the action index and do not duplicate it in reads,
- `clickable`, `typeable`, `selectable`, and `readable` map to planner tools `click`, `type`, `select`, and `get`,
- read entries expose `get` and `inspect_region`,
- an action episode is eligible when `productionOutput.plan[0].ref` exists in `refToIndex`,
- an action episode is ineligible when `productionOutput.plan[0].ref` is missing,
- a `done` or `escalate` production output is eligible with no required first ref,
- missing refs from later production plan steps are recorded in `missingProductionPlanRefs` but do not block first-decision eligibility.

Use this command:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts
```

Expected before implementation: fails because the module does not exist.

- [ ] **Step 2: Implement contracts**

Implement these exported contracts:

```ts
export interface CompactShadowPlannerInput {
  version: 'compact_shadow_input.v1';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  observationEpoch?: CompactPlannerView['observationEpoch'];
  lastResult?: CompactPlannerView['lastResult'];
  recovery?: CompactPlannerView['recovery'];
  uncertainty?: CompactPlannerView['uncertainty'];
  actions: Array<{ index: string; role?: string; label: string; tools: string[] }>;
  reads: Array<{ index: string; text: string; tools: ['get', 'inspect_region'] }>;
}

export interface CompactShadowInputBuildResult {
  input: CompactShadowPlannerInput;
  indexToRef: Record<string, string>;
  refToIndex: Record<string, string>;
  eligibility: {
    eligible: boolean;
    productionFirstRef?: string;
    missingProductionFirstRef?: string;
    productionPlanRefs: string[];
    missingProductionPlanRefs: string[];
  };
}
```

Implement:

```ts
export function buildCompactShadowInput(
  view: CompactPlannerView,
  productionOutput?: PlannerOutput,
): CompactShadowInputBuildResult
```

Rules:

- Do not mutate `view`.
- Tool mapping: `clickable -> click`, `typeable -> type`, `selectable -> select`, `readable -> get`.
- Output tools must be sorted and deduped.
- Production plan refs come only from `productionOutput.plan[*].ref`.
- First-decision eligibility checks only `productionOutput.plan[0].ref`.

- [ ] **Step 3: Verify**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts
```

Expected: pass.

---

## Task 2: Compact Shadow Prompt

**Files:**

- Create: `D:\BrowseGent\src\v2\planner\CompactShadowPrompt.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactShadowPrompt.test.ts`

- [ ] **Step 1: Write failing tests**

Tests must assert:

- system prompt includes `compact indexes`,
- system prompt says `Return only JSON`,
- system prompt forbids selectors, XPath, coordinates, scripts, and invented indexes,
- system prompt does not mention `current.refs`, `workingSet.primaryRefs`, or `selectorCandidates`,
- user message includes JSON with `index` values,
- user message does not include runtime refs if only compact input is passed.

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPrompt.test.ts
```

- [ ] **Step 2: Implement prompt builders**

Export:

```ts
export function buildCompactShadowSystemPrompt(): string
export function buildCompactShadowUserMessage(input: CompactShadowPlannerInput): string
```

Prompt requirements:

- Valid outputs remain the v2 shapes: `done`, `escalate`, or `plan`.
- `plan[*].ref` must use compact indexes such as `a1` or `r1`.
- Valid tools are `click`, `close`, `type`, `navigate`, `press`, `select`, `get`, `inspect_region`, `search_page`, `scroll`, and `wait`.
- The model must not emit runtime ref IDs, selectors, XPath, coordinates, browser scripts, CSS, or invented indexes.
- The user message must be exactly `Compact planner input JSON:\n${JSON.stringify(input)}`.

- [ ] **Step 3: Verify**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPrompt.test.ts
```

Expected: pass.

---

## Task 3: One-Call Compact Shadow Planner

**Files:**

- Create: `D:\BrowseGent\src\v2\planner\CompactShadowPlanner.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactShadowPlanner.test.ts`

- [ ] **Step 1: Write failing tests**

Tests must assert:

- provider output `{"plan":[{"tool":"click","ref":"a1"}],"confidence":"high"}` normalizes to runtime ref `ref_submit`,
- unknown compact index returns `status: 'invalid_output'`,
- selector-shaped output returns `status: 'invalid_output'`,
- provider error returns `status: 'provider_error'`,
- provider is called exactly once for invalid output,
- valid output is validated with allowed refs and first-step action compatibility.

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPlanner.test.ts
```

- [ ] **Step 2: Implement result contract**

Export:

```ts
export type CompactShadowPlannerResult =
  | { status: 'valid'; output: PlannerOutput; rawOutput: PlannerOutput; rawText: string; inputTokens: number; outputTokens: number; durationMs: number }
  | { status: 'invalid_output'; rawText: string; errors: string[]; inputTokens: number; outputTokens: number; durationMs: number }
  | { status: 'provider_error'; error: string; inputTokens: number; outputTokens: number; durationMs: number };
```

- [ ] **Step 3: Implement planner**

Use existing:

- `robustJsonParse`,
- `V2PlannerProvider` type from `V2PlannerClient`,
- `buildV2PlannerResponseSchema`,
- `PlannerOutputSchema`.

Flow:

1. Build compact prompts.
2. Call provider exactly once.
3. Parse JSON.
4. Replace compact indexes in `plan[*].ref` with runtime refs using `indexToRef`.
5. Reject unknown compact indexes before schema validation.
6. Validate normalized output with allowed refs from `indexToRef` and an action surface derived from compact tools.
7. Return a status object; do not throw normal provider or validation failures.

- [ ] **Step 4: Verify**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPlanner.test.ts
```

Expected: pass.

---

## Task 4: Shadow Comparison

**Files:**

- Create: `D:\BrowseGent\src\v2\planner\CompactShadowComparison.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactShadowComparison.test.ts`

- [ ] **Step 1: Implement comparison contracts**

Export:

```ts
export type CompactShadowAgreement =
  | 'exact_first_action'
  | 'same_tool_different_ref'
  | 'different_tool'
  | 'both_done'
  | 'both_escalate'
  | 'production_done_shadow_action'
  | 'production_action_shadow_done'
  | 'production_escalate_shadow_action'
  | 'production_action_shadow_escalate'
  | 'shadow_invalid'
  | 'shadow_provider_error'
  | 'episode_ineligible';

export interface CompactShadowComparison {
  agreement: CompactShadowAgreement;
  productionFirstStep?: PlannerOutputStep;
  shadowFirstStep?: PlannerOutputStep;
  productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable';
  productionOutputKind: 'plan' | 'done' | 'escalate' | 'empty';
  shadowOutputKind: 'plan' | 'done' | 'escalate' | 'invalid' | 'provider_error';
  countsTowardSuccessfulProductionAgreement: boolean;
}
```

- [ ] **Step 2: Write tests**

Cover:

- same tool and same ref,
- same tool and different ref,
- different tool,
- both done,
- both escalate,
- production done with shadow action,
- invalid shadow output,
- provider error,
- ineligible episode,
- exact agreement where production step failed does not count toward successful-production agreement,
- exact agreement where production step succeeded does count.

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowComparison.test.ts
```

- [ ] **Step 3: Implement pure comparator**

The comparator must not assign quality labels such as better or worse. It only classifies structural agreement and preserves execution outcome. Primary readiness metrics use only `countsTowardSuccessfulProductionAgreement`.

- [ ] **Step 4: Verify**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowComparison.test.ts
```

Expected: pass.

---

## Task 5: Offline Trace Replay

**Files:**

- Create: `D:\BrowseGent\tests\benchmark\v2\compact_shadow_replay.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactShadowReplay.test.ts`

- [ ] **Step 1: Implement trace loader contracts**

Export:

```ts
export interface CompactReplayEpisode {
  runId: string;
  episodeId: string;
  compactArtifactPath: string;
  plannerOutputArtifactPath: string;
  compactPayload: { view: CompactPlannerView };
  productionOutput: PlannerOutput;
  productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable';
}

export async function loadCompactReplayEpisodes(root: string, options?: {
  includeFinalization?: boolean;
}): Promise<CompactReplayEpisode[]>
```

Join rules:

- Find `trace.json` recursively under the provided root only.
- Read `artifacts.compactPlannerViews`.
- Read `artifacts.planner`.
- Match `${episodeId}-compact` with `${episodeId}-output`.
- Extract production output from planner artifact field `output`.
- Skip artifacts without compact `view` or production output.
- For a production plan, find the earliest trace step whose `kind` and `targetRef` match the first production step and whose `beforeObservationId` matches `view.observationEpoch.observationId`.
- Mark first-step execution `succeeded` when the trace step completed, `failed` when it failed, and `not_found` when no unambiguous match exists.
- Mark production `done` and `escalate` episodes `not_applicable`.
- Sort by trace path then episode ID for deterministic replay.

- [ ] **Step 2: Write trace loader tests**

Use temporary fixture directories. Tests must cover:

- correct compact/output join,
- missing output artifact skipped,
- deterministic ordering,
- finalization exclusion by default,
- successful and failed production first-step derivation,
- absent or ambiguous trace step match becomes `not_found`.

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowReplay.test.ts
```

- [ ] **Step 3: Implement CLI**

Support:

```text
--root <path>
--model <model>
--max-episodes <positive integer>
--key-index <one-based integer>
--request-rpm <positive integer>
--include-finalization
--dry-run
```

Defaults:

- `--root` is required.
- `--model` defaults to `gemini/gemini-3.1-flash-lite`.
- `--max-episodes` defaults to `10`.
- `--request-rpm` defaults to `8`.
- finalization episodes are excluded unless `--include-finalization` is set.
- dry-run defaults to false.

- [ ] **Step 4: Add key rotation and pacing**

Reuse:

- `collectGeminiKeyPool`,
- `selectGeminiKeyForAttempt`,
- `applyGeminiKeySelection`,
- `RequestPacer`.

Use one sequential key selection per attempted shadow episode, starting at `--key-index`. Convert RPM to the pacer's minimum interval with `Math.ceil(60_000 / requestRpm)`. Apply the selected key immediately before the provider call. Reports may include only key index and key env name, never the key value.

- [ ] **Step 5: Apply eligibility before provider call**

For each episode:

1. Build compact shadow input with production output.
2. If ineligible, write comparison `episode_ineligible` and do not call provider.
3. If `--dry-run`, report eligible and ineligible counts without provider calls.
4. Otherwise call compact shadow planner once.

- [ ] **Step 6: Write reports**

Write:

```text
<root>/compact-shadow/compact_shadow_report.json
<root>/compact-shadow/compact_shadow_report.md
```

JSON fields:

```ts
{
  version: 'compact_shadow_report.v1',
  root,
  model,
  generatedAt,
  selectedEpisodes,
  eligibleEpisodes,
  ineligibleEpisodes,
  eligibilityRate,
  attemptedEpisodes,
  validOutputs,
  invalidOutputs,
  providerErrors,
  averageInputTokens,
  averageOutputTokens,
  successfulProductionCohortSize,
  successfulProductionAgreementRate,
  agreementCounts,
  missingProductionFirstRefsByTool,
  missingProductionPlanRefsByTool,
  results
}
```

Markdown must include one row per selected episode:

- episode ID,
- eligibility,
- production first-step execution outcome,
- production first decision,
- shadow first decision,
- agreement,
- shadow input/output tokens,
- validation or provider error.

- [ ] **Step 7: Verify replay tests**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowReplay.test.ts
```

Expected: pass.

---

## Task 6: Verification And Controlled Shadow Run

- [ ] **Step 1: Focused tests**

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts tests/unit/v2/compactShadowPrompt.test.ts tests/unit/v2/compactShadowPlanner.test.ts tests/unit/v2/compactShadowComparison.test.ts tests/unit/v2/compactShadowReplay.test.ts
```

- [ ] **Step 2: Full verification**

```powershell
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

- [ ] **Step 3: Dry replay**

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/compact_shadow_replay.ts --root $latestRunDir --max-episodes 10 --dry-run
```

Expected:

- selected, eligible, and ineligible counts are printed,
- zero provider calls occur,
- missing production refs are grouped before paid execution.

- [ ] **Step 4: Five-episode controlled replay**

Use an operator-approved fresh key index:

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/compact_shadow_replay.ts --root $latestRunDir --model gemini/gemini-3.1-flash-lite --max-episodes 5 --request-rpm 8 --key-index 4
```

Expected:

- no browser actions execute,
- no production trace artifacts are overwritten,
- report appears under `<root>/compact-shadow/`,
- each eligible episode uses at most one provider request,
- no Gemini key value appears in the report.

---

## A3 Acceptance Gates

A3 is complete only if:

- A2 stabilization prerequisites pass.
- Shadow replay never modifies production behavior.
- Ineligible episodes produce zero provider calls.
- Every shadow call uses compact input only.
- Unknown indexes and incompatible actions are rejected.
- Invalid-output and provider-error rates are measured without retry masking.
- Reports classify agreement without claiming better or worse.
- Agreement metrics identify the successful-production cohort explicitly.
- Missing first-step and later-plan refs are grouped by tool and remain visible.
- No Gemini key value appears in generated artifacts.
- Compact shadow average input tokens are materially below current planner input tokens.

Do not proceed to A4 enforcement until:

- at least `90%` of eligible shadow outputs are valid,
- at least `75%` of the successful-production cohort agrees on the first action or both terminate equivalently across two controlled replays,
- action-ref coverage is at least `95%` and read-ref coverage is at least `90%` across two controlled runs,
- no systematic missing-ref class is hidden by eligibility filtering,
- compact input remains within the A1 size gate,
- all disagreements and `not_found` execution joins are reviewed before rollout.
