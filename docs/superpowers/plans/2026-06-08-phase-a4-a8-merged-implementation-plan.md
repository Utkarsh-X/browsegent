# Phase A4-A8 Merged Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move BrowseGent from compact-shadow diagnostics to compact-enforced, graph-informed, benchmark-verified, production-hardened operation without benchmark overfitting or unnecessary architectural expansion.

**Architecture:** Keep Brain1, Brain2, and ContinuityGraph as runtime control-plane intelligence. The planner should receive compact indexed state, not raw graph/browser internals. Every phase is gated by tests, trace evidence, and repeated benchmark comparison before the next risk level is allowed.

**Tech Stack:** TypeScript, Node test runner, Playwright, BrowseGent V2 runtime, compact planner modules, WebVoyager-lite benchmark harness, Browser Use local adapter, Gemini key pool, V2 release gate.

---

## Execution Doctrine

- Do not skip A3.1. A3 is implemented, but its replay method still needs correction before compact enforcement.
- Do not tune prompts or code for individual WebVoyager tasks, domains, URLs, selectors, or answers.
- Do not add a second planner. Compact mode is a different planner input contract, not another reasoning layer.
- Do not hide filtered episodes. Every report must show eligible, ineligible, provider-error, invalid-output, missing-ref, and environment-blocked counts.
- Do not use strict score alone. Use manual-corrected, environment-adjusted, token, call, tool, and failure-class metrics together.
- Do not treat benchmark wins as proof until they repeat across at least two controlled runs.
- Do not modify `.env`, `new-keys.yaml`, API keys, or generated benchmark logs unless the task explicitly requires a new report.

## Phase Order

| Phase | Name | Required Before |
| --- | --- | --- |
| A3.1 | Shadow Replay Method Corrections | A4 |
| A4 | Compact Planner Enforcement | A5, A7 comparisons |
| A5 | Graph-Informed Brain1 Ranking | A6, stronger compact coverage |
| A6 | Read/Action/Check Lanes | A7 |
| A7 | Benchmark Expansion and Competitor Comparison | A8 release claims |
| A8 | Production Hardening | Release |

---

## Phase A3.1: Shadow Replay Method Corrections

**Purpose:** Make A3 evidence trustworthy before compact enforcement.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPlanner.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
- Modify: `D:\BrowseGent\tests\benchmark\v2\compact_shadow_replay.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowPlanner.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowInput.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowReplay.test.ts`

### Task A3.1.1: Reject Compact Selector Aliases

- [ ] Add a failing test in `compactShadowPlanner.test.ts` where provider returns:

```ts
{ plan: [{ tool: 'click', sel: 'a1' }], confidence: 'high' }
```

Expected result:

```ts
assert.equal(result.status, 'invalid_output');
assert.match(result.errors.join('\n'), /selector|alias|compact ref/i);
```

- [ ] In `CompactShadowPlanner.ts`, stop accepting `sel` and `selector` as compact aliases.
- [ ] Preserve schema validation for normalized `ref` only.
- [ ] Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPlanner.test.ts
```

### Task A3.1.2: Treat Ref-Less First Actions Separately

- [ ] Add tests in `compactShadowInput.test.ts` for a production first step:

```ts
{ tool: 'navigate', url: 'https://example.com' }
```

Expected behavior:

- eligible is true,
- `productionFirstRef` is undefined,
- no missing first ref is reported,
- a new eligibility detail marks this as a `no_ref_action`.

- [ ] Extend `CompactShadowInputBuildResult.eligibility` with:

```ts
productionFirstStepKind: 'ref_action' | 'no_ref_action' | 'termination' | 'empty';
```

- [ ] Update replay reports to count no-ref actions separately.
- [ ] Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts tests/unit/v2/compactShadowReplay.test.ts
```

### Task A3.1.3: Fix Token Averages

- [ ] Add replay tests proving provider-error `0/0` calls do not reduce measured token averages.
- [ ] In `compact_shadow_replay.ts`, add:

```ts
tokenMeasuredCalls: number;
averageInputTokensMeasured: number;
averageOutputTokensMeasured: number;
```

- [ ] Keep attempted episode count separate from measured token call count.
- [ ] Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowReplay.test.ts
```

### Phase A3.1 Verification

- [ ] Run focused A3 tests:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts tests/unit/v2/compactShadowPrompt.test.ts tests/unit/v2/compactShadowPlanner.test.ts tests/unit/v2/compactShadowComparison.test.ts tests/unit/v2/compactShadowReplay.test.ts
```

- [ ] Run full checks:

```powershell
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

- [ ] Run dry replay:

```powershell
$latestRunDir = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
npx.cmd tsx tests/benchmark/v2/compact_shadow_replay.ts --root $latestRunDir --max-episodes 10 --dry-run
```

- [ ] Run one five-episode replay with a fresh key:

```powershell
npx.cmd tsx tests/benchmark/v2/compact_shadow_replay.ts --root $latestRunDir --model gemini/gemini-3.1-flash-lite --max-episodes 5 --request-rpm 8 --key-index 31
```

**Gate to A4:** A3.1 tests pass, no selector aliases accepted, no-ref actions are visible, token averages are not understated, and reports contain no Gemini key values.

---

## Phase A4: Compact Planner Enforcement

**Purpose:** Use compact planner input as the real planner substrate on a controlled slice.

**Files:**

- Modify: `D:\BrowseGent\src\v2\agent\types.ts`
- Modify: `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPrompt.ts`
- Create: `D:\BrowseGent\src\v2\planner\CompactPlannerClient.ts`
- Create: `D:\BrowseGent\tests\unit\v2\compactPlannerClient.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`
- Modify: `D:\BrowseGent\tests\benchmark\webvoyager\run_webvoyager_lite.ts`

### Task A4.1: Add Compact Mode Contract

- [ ] Extend `V2AgentLoopInput` with:

```ts
plannerMode?: 'current' | 'compact_enforced';
```

- [ ] Default mode remains `current`.
- [ ] Add unit test proving existing callers still use current planner input.
- [ ] Add unit test proving compact mode routes through compact client only when explicitly set.

### Task A4.2: Build Compact Planner Client

- [ ] Create `CompactPlannerClient.ts` as production equivalent of shadow planner.
- [ ] It must accept compact input only.
- [ ] It must emit normal `PlannerOutput` with runtime refs.
- [ ] It must reject unknown compact indexes and selector aliases.
- [ ] It must use the same provider schema as V2 planner.
- [ ] It must record input/output artifacts without writing key values.

### Task A4.3: Enforce Compact Input In Loop

- [ ] In `V2AgentLoop`, when `plannerMode === 'compact_enforced'`, build compact input from the current `PlannerInput`.
- [ ] Do not serialize `current.refs`, `workingSet.primaryRefs`, or raw graph details to the compact planner.
- [ ] Keep existing compact telemetry artifacts in both modes.
- [ ] If compact input cannot represent the first required ref, return controlled failure:

```text
compact_planner_input_ineligible
```

- [ ] Do not silently fall back to full planner input during benchmark runs.

### Task A4.4: Add CLI Flag

- [ ] Add WebVoyager CLI flag:

```text
--planner-mode current|compact_enforced
```

- [ ] Default is `current`.
- [ ] Pass through to BrowseGent adapter and V2 loop.

### Phase A4 Verification

- [ ] Run focused tests:

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/compactShadowPlanner.test.ts
```

- [ ] Run full checks:

```powershell
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

- [ ] Run current mode MVR5-stable:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 32 --planner-mode current
```

- [ ] Run compact enforced MVR5-stable:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 33 --planner-mode compact_enforced
```

**Gate to A5:** Compact enforced has no catastrophic behavior regression, trace completeness stays 100%, compact input tokens are materially lower than current mode, and failures are classified rather than hidden.

---

## Phase A5: Graph-Informed Brain1 Ranking

**Purpose:** Make compact candidates better by using ContinuityGraph and transition evidence, not by adding prompt size.

**Files:**

- Modify: `D:\BrowseGent\src\v2\brain1\ProjectionService.ts`
- Modify: `D:\BrowseGent\src\v2\planner\PlannerWorkingSetSelector.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
- Create: `D:\BrowseGent\tests\unit\v2\graphInformedProjection.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\plannerWorkingSetSelector.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`

### Task A5.1: Add Graph Signal Inputs Without Prompt Bloat

- [ ] Add projection item metadata fields for internal ranking only:

```ts
graphPresent?: boolean;
graphConfidence?: number;
recentlyAppeared?: boolean;
recentlyChanged?: boolean;
recentlyWeakened?: boolean;
```

- [ ] Do not serialize verbose graph internals into planner input.
- [ ] Add test proving graph metadata does not expose raw graph topology or transition arrays.

### Task A5.2: Improve Candidate Ranking

- [ ] Boost visible ready candidates that are present in graph and recently appeared after a meaningful transition.
- [ ] Demote recently weakened candidates unless they are the only evidence candidate.
- [ ] Preserve fresh observation authority over old graph continuity.
- [ ] Add tests for:
  - appeared search result moves into compact actions/reads,
  - weakened stale ref is demoted,
  - failed ref remains as recovery evidence but not same-action target.

### Task A5.3: Compact Region Summaries

- [ ] Improve repeated list/table summaries in `ProjectionService`.
- [ ] Preserve a small sample of representative refs per region.
- [ ] Add region labels based on role/text patterns only, not domain names.
- [ ] Add tests for repeated GitHub-like result rows and generic list rows.

### Phase A5 Verification

```powershell
npx.cmd tsx --test tests/unit/v2/graphInformedProjection.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/compactPlannerView.test.ts
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

**Gate to A6:** Compact action coverage improves toward `95%`, read coverage stays at least `90%`, selected refs reduce or stay bounded, and no site-specific ranking logic appears.

---

## Phase A6: Read/Action/Check Lanes

**Purpose:** Separate mutation, extraction, and verification control without creating another planner.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
- Modify: `D:\BrowseGent\src\v2\planner\PlannerOutputSchema.ts`
- Modify: `D:\BrowseGent\src\v2\tools\V2ToolDispatcher.ts`
- Modify: `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
- Create: `D:\BrowseGent\src\v2\runtime\LanePolicy.ts`
- Create: `D:\BrowseGent\tests\unit\v2\lanePolicy.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\plannerOutputSchema.test.ts`

### Task A6.1: Add Lane Metadata

- [ ] Add lane labels:

```ts
type PlannerLane = 'action' | 'read' | 'check';
```

- [ ] Compact actions belong to `action`.
- [ ] Compact reads belong to `read`.
- [ ] Finalization/answer contract checks belong to `check`.

### Task A6.2: Enforce Lane-Compatible Tool Use

- [ ] Create `LanePolicy.ts`.
- [ ] `click`, `type`, `select`, `navigate`, `press`, and `scroll` are action lane.
- [ ] `get`, `inspect_region`, and `search_page` are read lane.
- [ ] `done` and final answer validation are check lane.
- [ ] Add tests proving read-only refs cannot be clicked and action-only refs cannot be used as answer evidence without a read/check result.

### Task A6.3: Wait Strategy Discipline

- [ ] For page-changing actions, record an inferred wait strategy:

```ts
type WaitStrategy = 'url_change' | 'new_text' | 'new_region' | 'load_state' | 'fixed_fallback';
```

- [ ] Trace fixed fallback waits explicitly.
- [ ] Do not require the model to produce waits for every action in this phase; infer conservative runtime waits first.

### Task A6.4: Completeness Contracts

- [ ] Extend answer contract checks for:
  - named entity,
  - numeric answer,
  - ranked result,
  - multi-slot answer.
- [ ] Add tests for false-positive prevention on partial ranked answers.

### Phase A6 Verification

```powershell
npx.cmd tsx --test tests/unit/v2/lanePolicy.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2AgentLoop.test.ts
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

**Gate to A7:** False-positive final answers decrease, action-on-read-only errors decrease, planner calls do not materially increase, and fixed fallback waits are visible in traces.

---

## Phase A7: Benchmark Expansion And Competitor Comparison

**Purpose:** Move from MVR5 signals to honest repeated MVR30 comparison against Browser Use.

**Files:**

- Modify: `D:\BrowseGent\tests\benchmark\webvoyager\task_registry.ts`
- Modify: `D:\BrowseGent\tests\benchmark\webvoyager\task_selection.ts`
- Modify: `D:\BrowseGent\tests\benchmark\webvoyager\evaluator.ts`
- Modify: `D:\BrowseGent\tests\benchmark\webvoyager\manual_audit.ts`
- Modify: `D:\BrowseGent\tests\benchmark\v2\compare_reports.ts`
- Create: `D:\BrowseGent\docs\evaluation\webvoyager-mvr30-method.md`
- Create: `D:\BrowseGent\tests\unit\v2\webVoyagerMvr30Method.test.ts`

### Task A7.1: Freeze Regression Slices

- [ ] Keep `mvr5-stable` unchanged.
- [ ] Define `mvr30-stable` from reviewed WebVoyager tasks.
- [ ] Exclude impossible tasks with explicit reason metadata.
- [ ] Add tests proving stable slices contain no impossible tasks.

### Task A7.2: Normalize Comparison Method

- [ ] Browser Use and BrowseGent must use the same:
  - task text,
  - model family when possible,
  - timeout,
  - request pacing,
  - max steps,
  - browser headed/headless mode,
  - scoring method.
- [ ] Document all non-identical conditions.

### Task A7.3: Manual Audit Rubric

- [ ] Document strict, partial, manual-corrected, and environment-adjusted scoring.
- [ ] Add rubric examples for:
  - exact answer,
  - equivalent answer,
  - outdated live-site data,
  - captcha or bot block,
  - wrong target,
  - incomplete ranked result.

### Task A7.4: Repeated Run Protocol

- [ ] Run two MVR5-stable passes for BrowseGent compact enforced.
- [ ] Run two MVR5-stable passes for Browser Use.
- [ ] Only then run one MVR30-stable pass per adapter.
- [ ] Do not run broad benchmarks after a code change until focused tests and MVR5 pass.

Commands:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 45 --planner-mode compact_enforced
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browser-use-local --request-rpm 51 --key-index 35
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browsegent --request-rpm 8 --key-index 1 --planner-mode compact_enforced
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browser-use-local --request-rpm 8 --key-index 6
```

### Phase A7 Verification

```powershell
npx.cmd tsx --test tests/unit/v2/webVoyagerMvr30Method.test.ts tests/unit/v2/benchmarkScoring.test.ts tests/unit/v2/benchmarkComparison.test.ts
npm.cmd run test:unit
npm.cmd run build
```

**Gate to A8:** Benchmark method is documented, repeated MVR5 behavior is stable, MVR30 metadata is reviewed, and competitor comparison reports include token, step, tool, score, environment, and failure-class metrics.

---

## Phase A8: Production Hardening

**Purpose:** Prepare BrowseGent for credible open-source production release.

**Files:**

- Modify: `D:\BrowseGent\scripts\check_v2_release_gate.ts`
- Modify: `D:\BrowseGent\package.json`
- Modify: `D:\BrowseGent\src\BrowseGent.ts`
- Modify: `D:\BrowseGent\src\v2\agent\createV2AgentLoop.ts`
- Create: `D:\BrowseGent\docs\evaluation\production-release-gates.md`
- Create: `D:\BrowseGent\docs\architecture\compact-graph-planner.md`
- Create: `D:\BrowseGent\docs\api\task-first-api.md`
- Create: `D:\BrowseGent\tests\unit\v2\productionReleaseGate.test.ts`

### Task A8.1: Public API Defaults

- [ ] Set safe defaults for:
  - model name,
  - max steps,
  - compact planner mode,
  - trace output,
  - headed/headless browser mode,
  - request pacing.
- [ ] Document how a user passes a natural-language task and receives result, trace path, metrics, and failure reason.

### Task A8.2: Observability And Cost

- [ ] Add report fields for:
  - input tokens,
  - output tokens,
  - planner calls,
  - tool executions,
  - duration,
  - provider errors,
  - rate-limit errors,
  - compact/current ratio.
- [ ] Add no-secret scan over reports and traces.

### Task A8.3: Release Gate

- [ ] Extend `check_v2_release_gate.ts` with:
  - compact shadow replay dry-run,
  - compact telemetry summary on latest smoke run when available,
  - no secret leakage scan,
  - benchmark method doc existence check.
- [ ] Do not make paid benchmark runs part of default release gate.

### Task A8.4: Architecture And Benchmark Docs

- [ ] Write compact graph planner architecture doc.
- [ ] Write task-first API doc.
- [ ] Write production release gate doc.
- [ ] Include limitations honestly:
  - captcha/bot blocks,
  - live-site variance,
  - model quality variance,
  - compact mode gates,
  - current benchmark status.

### Phase A8 Verification

```powershell
npx.cmd tsx --test tests/unit/v2/productionReleaseGate.test.ts tests/unit/v2/releaseGateScript.test.ts
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
npm.cmd run check:v2:release
```

**Release Gate:** Release only if tests/build/checks pass, docs are present, no secret leakage is found, benchmark method is reproducible, and compact mode is either the default with evidence or clearly marked experimental.

---

## Final Success Criteria

BrowseGent is ready for the next production-grade comparison cycle when:

- Compact enforced mode runs MVR5-stable without trace or contract regressions.
- Compact input reduces planner tokens materially versus current mode.
- BrowseGent is at or below Browser Use token/call/tool ratios on repeated stable slices, or the remaining gap is clearly explained by quality tradeoffs.
- MVR30 comparison uses the same task/method constraints across adapters.
- No benchmark-specific code, prompt, selector, URL, domain, or answer shortcut was introduced.
- Release gate catches build, test, governance, benchmark-method, and secret-leak failures.

## Recommended Execution Style

Use subagent-driven execution one phase at a time:

1. Execute A3.1 correction tasks.
2. Review diffs and run checks.
3. Execute A4 only after A3.1 reports are clean.
4. Execute A5 and A6 as separate implementation batches.
5. Execute A7 only after compact enforced mode is stable.
6. Execute A8 after benchmark methodology is stable.

Do not collapse A4-A8 into one coding run. This document is merged for coordination, not permission to mix high-risk changes in one commit.
