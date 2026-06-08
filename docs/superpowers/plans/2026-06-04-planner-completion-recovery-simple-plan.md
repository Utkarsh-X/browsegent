# Planner Completion Recovery Simple Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Keep changes minimal. Do not expand scope without user approval.

**Goal:** Make BrowseGent V2 stop correctly when useful evidence is available, recover from correct runtime/validator refusals, and report benchmark trace failures clearly.

**Architecture:** Do not redesign BrowseGent. Add small control-plane improvements around the existing V2 planner loop, recovery state, planner validation feedback, and benchmark reporting. Runtime remains operational; planner remains the semantic layer.

**Tech Stack:** TypeScript, Playwright, Node test runner with `tsx`, BrowseGent V2 runtime/planner/benchmark code.

---

## Context

Read first:

- `docs/continuation-context-2026-06-02.md`
- `docs/superpowers/plans/2026-06-03-bounded-native-select-implementation-plan.md`
- Latest two reports under `logs/webvoyager-lite`

Current signal:

- Two most recent MVR5 runs were `0/5`.
- `select` was not used in either run, so do not rollback native select.
- Several tasks reached useful evidence but did not finish cleanly.
- Some failures are reported as `trace_error` with blank or unclear reasons.
- GitHub shows validator correctly rejecting `type` on a non-typeable ref, but the system turns that into a dead end instead of recovery.

## Non-Negotiables

- No benchmark-specific tuning.
- No site-specific logic.
- No validator weakening.
- No unsafe ambiguous ref execution.
- No broad prompt rewrites.
- No new tool surfaces unless clearly required.
- No benchmark rerun until tests pass and user approves API usage.

## Minimal Design

Implement only three small improvements.

### 1. Completion Gate

Problem:

- The planner sometimes has enough evidence but keeps acting until `max_steps`.

Add:

- A lightweight finalization path in `V2AgentLoop`.
- Trigger it when one of these is true:
  - `lastSuccessfulEvidenceValue` exists and max steps are near.
  - repeated no-progress signals appear.
  - last result is a successful read/search/get with strong value evidence.

Behavior:

- Ask planner for final answer only, not more actions.
- Restricted output should be `done` or `escalate`.
- If planner still refuses to finish, return current best evidence with explicit failure reason like `completion_available_but_not_finalized`.

Primary files:

- `src/v2/agent/V2AgentLoop.ts`
- `src/v2/planner/PlannerPrompt.ts`
- `tests/unit/v2/v2AgentLoop.test.ts`

### 2. Recovery From Correct Ref/Action Refusals

Problem:

- Runtime/validator correctly refuses bad actions, but planner gets stuck or dead-ends.

Add recovery states for:

- `ambiguous_ref_resolution`
- `low_confidence_ref`
- `invalid_action_contract`
- `completion_available`

Behavior:

- When planner validation rejects an action-compatible issue, preserve the exact error in planner output trace.
- Feed one more planner call with recovery guidance when safe.
- Guidance should say what changed operationally:
  - choose typeable ref
  - choose clickable ref
  - inspect/read/search instead of repeating
  - stop if useful evidence is enough

Primary files:

- `src/v2/runtime/RecoveryState.ts`
- `src/v2/planner/PlannerInputComposer.ts`
- `src/v2/planner/V2PlannerClient.ts`
- `src/v2/planner/PlannerOutputSchema.ts`
- `tests/unit/v2/recoveryState.test.ts`
- `tests/unit/v2/v2PlannerClient.test.ts`

### 3. Trace Error Reporting Clarity

Problem:

- Reports show `trace_error` with blank failure reason or `traceAudit: null`, which makes benchmark diagnosis unreliable.

Add:

- If trace audit fails, persist `trace.errors` into `failureReason`.
- Never emit `trace_error` with blank reason.
- Keep validation result separate from trace result.

Primary files:

- `tests/benchmark/v2/scoring.ts`
- `tests/benchmark/v2/run_benchmark.ts`
- `tests/benchmark/v2/report.ts`
- `tests/unit/v2/benchmarkScoring.test.ts`
- `tests/unit/v2/benchmarkRunnerSmoke.test.ts`
- `tests/unit/v2/benchmarkReport.test.ts`

## Suggested Task Order

1. Fix trace/report clarity first.
   - This makes future benchmark diagnosis trustworthy.

2. Add recovery state types and tests.
   - Do this before changing planner loop behavior.

3. Add completion gate.
   - Keep it small and conservative.

4. Run verification.
   - Do not benchmark yet.

## Required Verification

Run:

```powershell
npm.cmd run check:v2
npm.cmd run build
npm.cmd run test:unit
node --test --import tsx tests/integration/v2/mvrRuntime.test.ts
git diff --check
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\\.google|arxiv\\.org|wolframalpha" src/v2
```

Expected:

- All tests pass.
- `rg ... src/v2` has no matches. Exit code `1` is acceptable for no matches.

## Stop Conditions

Stop and ask before proceeding if:

- The fix requires broad architecture rewrite.
- The fix requires weakening validation.
- The fix requires benchmark/site-specific logic.
- The fix requires adding screenshot/multimodal reasoning.
- Three attempts fail for the same issue.

## Next Benchmark Rule

Only after verification passes, run one MVR5 smoke with user-approved key index.

Do not run multiple benchmarks to search for a good score.
