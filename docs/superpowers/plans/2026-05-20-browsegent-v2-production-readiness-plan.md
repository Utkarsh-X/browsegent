# BrowseGent v2 Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagents are allowed only when the user explicitly requests them.

**Goal:** Extend the verified v2 MVR into an opt-in production-grade v2 agent path with a single planner loop, bounded runtime tool dispatch, planner/action lineage, and public API integration that keeps v1 unchanged by default.

**Architecture:** This plan does not redesign BrowseGent v2. It closes the gap between the diagnostic MVR plan and the refined architecture requirement that the MVR validate `think -> act -> observe` through one centralized planner stream. Runtime remains non-cognitive; the planner remains the only semantic authority; all runtime tools return operational evidence only.

**Tech Stack:** TypeScript, Node.js, Playwright, existing v2 runtime modules under `src/v2/`, existing provider transport under `src/providers`, Node test runner through `tsx --test`, TypeScript through `tsc --noEmit`.

---

## Why This Plan Exists

The current Phase 0-10 plan intentionally stopped at a diagnostic MVR:

- `BROWSEGENT_V2_RUNTIME=mvr` opens, observes, projects, writes planner input, and returns `v2_mvr_diagnostic_mode`.
- The planner bridge composes and validates planner I/O, but no v2 planner loop executes a semantic decision.
- `BrowseGentV2Harness` executes only developer diagnostics, not final agent behavior.

The refined architecture requires the next production-readiness milestone to include:

- Single planner loop (`think -> act -> observe`).
- Basic tools (`click`, `type`, `inspect`, `navigate` or local equivalent).
- Execution lineage (`trace planner -> action -> outcome`).
- Centralized cognition, with no runtime semantic routing.

This plan adds those missing production-readiness slices while preserving the Phase 0-10 invariants.

## Global Invariants

- v2 remains off by default.
- `mvr` remains diagnostic and does not become a hidden agent mode.
- New full-agent behavior is enabled only by a separate explicit runtime mode.
- Planner output continues to use refs, not selectors.
- Runtime tools never infer user intent, strategy, workflow, or task success.
- Runtime tools may mechanically validate, stabilize, observe, and report evidence.
- The v2 planner loop is serial: one planner decision, one bounded execution batch, one re-observation cycle.
- All mutating tool executions must be traceable.
- Planner inputs and outputs must be persisted as replay artifacts.
- Build, unit tests, v2 integration tests, `check:v2`, and v2 stress checks remain required gates.

## Runtime Modes

Keep current modes:

```ts
export type V2RuntimeMode = 'off' | 'mvr';
```

Add only after Phase 14 tests fail first:

```ts
export type V2RuntimeMode = 'off' | 'mvr' | 'agent';
```

Mode semantics:

- `off`: existing v1 behavior.
- `mvr`: diagnostic v2 MVR path only.
- `agent`: full opt-in v2 planner loop.

No phase may make `agent` the default.

---

## Phase 11 - Runtime Tool Dispatch and Read-Only Harness Tools

Purpose: give planner output a bounded runtime execution surface without adding planner cognition to runtime.

Exact files:

- `src/v2/tools/V2ToolDispatcher.ts`
- `src/v2/tools/types.ts`
- `tests/unit/v2/toolDispatcher.test.ts`

Files modified:

- `src/v2/harness/BrowseGentV2Harness.ts`
- `src/v2/index.ts`
- `tests/integration/v2/mvrRuntime.test.ts`

Interfaces/contracts:

```ts
export interface V2ToolDispatchContext {
  goal: string;
}

export interface V2ToolRuntime {
  click(refId: string): Promise<V2ToolResult>;
  type(refId: string, text: string): Promise<V2ToolResult>;
  get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>>;
  inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>>;
  searchPage(pattern: string): Promise<V2ToolResult<{ matches: number; preview: string[] }>>;
  scroll(direction?: 'down' | 'up'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>>;
  waitForState(input: { pattern?: string; timeout?: number }): Promise<V2ToolResult<{ matched: boolean }>>;
}
```

Runtime responsibilities:

- Dispatch valid `PlannerOutputStep` values to runtime tools.
- Reject unsupported tools as operational failures.
- Read-only tools must record trace action lifecycle but must not mutate browser state except `scroll` and bounded `wait`.
- `get` and `inspectRegion` resolve refs conservatively and never fall back to selectors exposed by the planner.
- `searchPage` searches current page text only and returns match evidence, not recommendations.
- `scroll` is mechanical and always followed by re-observation and transition evidence.
- `waitForState` is bounded by timeout and records whether a pattern appeared.

Event flow:

```text
PlannerOutputSchema.validate()
  -> V2ToolDispatcher.dispatch(step)
  -> BrowseGentV2Harness tool method
  -> TraceStore.recordActionStart()
  -> resolve/execute/read/observe
  -> TraceStore.recordActionEnd()
  -> V2ToolResult
```

Tests:

- Dispatcher calls `click`, `type`, `get`, `inspect_region`, `search_page`, `scroll`, and `wait` with ref-first inputs.
- Dispatcher rejects unknown or schema-bypassed tools with `success=false` and an operational error.
- Harness `get` returns current ref text/value without mutation.
- Harness `inspectRegion` returns bounded nearby ref ids and text preview.
- Harness `searchPage` returns match counts and compact previews.
- Harness `scroll` records before/after observations and transition evidence.
- All new runtime messages pass `npm run check:v2:no-cognition`.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\toolDispatcher.test.ts
node .\node_modules\tsx\dist\cli.cjs --test tests\integration\v2\mvrRuntime.test.ts
cmd /c npm run build
cmd /c npm run check:v2
```

---

## Phase 12 - Planner Client and v2 Prompt Protocol

Purpose: call the existing provider transport through a v2-specific prompt contract and validate planner output before any runtime dispatch.

Exact files:

- `src/v2/planner/V2PlannerClient.ts`
- `src/v2/planner/PlannerPrompt.ts`
- `tests/unit/v2/v2PlannerClient.test.ts`

Files modified:

- `src/v2/index.ts`
- `src/v2/trace/TraceStore.ts`
- `src/v2/trace/types.ts`

Interfaces/contracts:

```ts
export interface V2PlannerCallInput {
  plannerInput: PlannerInput;
  model?: string;
}

export interface V2PlannerCallResult {
  output: PlannerOutput;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
```

Planner responsibilities:

- Receive compact operational state from `PlannerInputComposer`.
- Return one of: `done`, `escalate`, or `plan`.
- Use refs for execution targets.
- Never return selectors, scripts, CDP commands, Playwright commands, or coordinates.

Client responsibilities:

- Build the v2 planner system/user prompt from `PlannerInput`.
- Call an injectable provider function for tests and the existing `callProvider` for production.
- Parse JSON with the existing robust parser.
- Validate with `PlannerOutputSchema`.
- On invalid output, perform at most one targeted retry with validation errors.
- Persist planner input/output artifacts through `TraceStore`.

Tests:

- Valid provider JSON becomes validated `PlannerOutput`.
- Selector-based provider JSON is rejected.
- Invalid first response triggers exactly one bounded retry.
- Retry failure returns a deterministic planner validation error.
- TraceStore writes planner input/output artifacts with raw text and validation status.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\v2PlannerClient.test.ts tests\unit\v2\plannerOutputSchema.test.ts tests\unit\v2\traceStore.test.ts
cmd /c npm run build
cmd /c npm run check:v2
```

---

## Phase 13 - Serial v2 Agent Loop

Purpose: implement the production `think -> act -> observe` loop with centralized planner cognition and deterministic runtime coordination.

Exact files:

- `src/v2/agent/V2AgentLoop.ts`
- `src/v2/agent/types.ts`
- `tests/unit/v2/v2AgentLoop.test.ts`

Files modified:

- `src/v2/index.ts`

Interfaces/contracts:

```ts
export interface V2AgentLoopInput {
  url: string;
  goal: string;
  maxSteps: number;
  model?: string;
}

export interface V2AgentLoopResult {
  success: boolean;
  value: string;
  failureReason?: string;
  steps: number;
  tracePath?: string;
  metrics: {
    plannerCalls: number;
    inputTokens: number;
    outputTokens: number;
    plannerDurationMs: number;
    toolExecutions: number;
  };
}
```

Runtime responsibilities:

- Open URL through `BrowseGentV2Harness`.
- Compose planner input from observation, projection, graph snapshot, transition evidence, last result, failures, and lineage.
- Call `V2PlannerClient`.
- If planner returns `done`, return success.
- If planner returns `escalate`, return an explicit failure reason.
- If planner returns `plan`, dispatch plan steps serially through `V2ToolDispatcher`.
- Recompose state after each execution batch.
- Stop at `maxSteps` with operational exhaustion, not semantic judgment.

Tests:

- Fake planner can answer from initial state without tool execution.
- Fake planner can issue click/type/read sequence and receive updated state.
- Loop records planner call count and tool execution count.
- Runtime tool failure is fed into the next planner input as evidence.
- `maxSteps` stops the loop deterministically.
- Loop does not inspect goals to choose tools; all action selection comes from fake planner output.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\v2AgentLoop.test.ts
cmd /c npm run build
cmd /c npm run check:v2
```

---

## Phase 14 - Public Opt-In v2 Agent Mode

Purpose: expose the v2 agent loop through the public `BrowseGent.run()` and `BrowseGent.extract()` APIs without changing default v1 behavior.

Exact files modified:

- `src/v2/runtime/types.ts`
- `src/v2/runtime/config.ts`
- `src/v2/adapter/V1CompatibilityAdapter.ts`
- `src/v2/adapter/types.ts`
- `src/BrowseGent.ts`
- `src/config/runtime.ts`
- `tests/unit/v2/runtimeContracts.test.ts`
- `tests/integration/v2/v1Compatibility.test.ts`

Runtime responsibilities:

- Add `BROWSEGENT_V2_RUNTIME=agent` as explicit opt-in.
- Keep invalid runtime modes deterministic errors.
- Keep `off` default.
- Keep `mvr` diagnostic behavior unchanged.
- Route `agent` to `V2AgentLoop`.
- Preserve public result shapes.
- For `extract`, run the v2 agent loop with an extraction objective and parse JSON only from planner `done.val`; parser failure must be explicit.

Tests:

- Default env routes to v1.
- `mvr` routes to diagnostic path.
- `agent` routes to full v2 agent path through an injectable fake runner.
- Public method signatures remain stable.
- Existing v1 unit tests still pass.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\runtimeContracts.test.ts tests\integration\v2\v1Compatibility.test.ts
cmd /c npm run test:unit
cmd /c npm run build
cmd /c npm run check:v2
```

---

## Phase 15 - Agent-Level Replay and Smoke Evaluation

Purpose: verify that the opt-in v2 agent path is replayable and operationally useful before any external benchmark work.

Exact files:

- `tests/eval/v2/run_agent_smoke.ts`
- `tests/eval/v2/agent_smoke_scenarios.ts`
- `tests/unit/v2/agentSmokeRunner.test.ts`

Fixtures:

- Reuse `tests/fixtures/v2/static-controls.html`
- Reuse `tests/fixtures/v2/modal-transition.html`
- Reuse `tests/fixtures/v2/form-region.html`

Runtime responsibilities:

- None. Eval remains passive.

Evaluation responsibilities:

- Run deterministic fake-planner scenarios without network dependency.
- Verify planner input/output artifacts exist.
- Verify trace includes planner decision, runtime action, before/after observations, transition evidence, and final result.
- Record per-scenario success/failure diagnostics under `logs/v2-agent-smoke/<runId>/`.

Tests:

- Smoke runner writes report and scenario result artifacts.
- Failed fake-planner scenario includes trace path and failure reason.
- Report includes planner calls, tool executions, trace completeness, and final result status.
- Eval code imports only public v2 APIs.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\agentSmokeRunner.test.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_agent_smoke.ts
cmd /c npm run build
cmd /c npm run check:v2
```

---

## Full Production-Readiness Verification

After Phase 15, run:

```powershell
cmd /c npm run build
cmd /c npm run test:unit
cmd /c npm run check:v2
node .\node_modules\tsx\dist\cli.cjs --test tests\integration\v2\observationRuntime.test.ts tests\integration\v2\mvrRuntime.test.ts tests\integration\v2\v1Compatibility.test.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_continuity_stress.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_agent_smoke.ts
git diff --check
rg -n "[ \t]+$" docs\governance docs\superpowers\plans scripts src\v2 tests\unit\v2 tests\integration\v2 tests\eval\v2 tests\fixtures\v2 package.json
rg -n "TO[D]O|FIXM[E]|T[B]D" docs\governance docs\superpowers\plans scripts src\v2 tests\unit\v2 tests\integration\v2 tests\eval\v2
```

The global goal is not complete until this full verification passes and the completion audit proves:

- Governance corpus exists and is enforceable.
- Phase 0-10 MVR remains complete.
- Phase 11-15 production-readiness path is complete.
- v1 default behavior remains unchanged.
- `agent` mode is opt-in only.
- Runtime contains no semantic cognition leakage.
- Planner/action/runtime replay artifacts can reconstruct an agent episode.
- No benchmark-specific behavior or hidden workflow engine was introduced.
