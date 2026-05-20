# BrowseGent v2 Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagents are allowed only when the user explicitly requests them.

**Goal:** Turn the verified Phase 0-15 v2 production-readiness milestone into a release-hardened opt-in agent path with public API proof, CI wiring, replay audit tooling, and provider smoke coverage.

**Architecture:** This plan keeps BrowseGent v2 bounded and planner-centered. It does not add a workflow engine, plugin layer, memory system, or hidden runtime cognition. It hardens the seams that remain weak after Phase 15: public API testability, release gates, trace auditability, production config defaults, and explicit provider smoke checks.

**Tech Stack:** TypeScript, Node.js, Playwright, existing `src/v2/` modules, existing provider transport, Node test runner through `tsx --test`, TypeScript through `tsc --noEmit`, GitHub Actions-compatible command gates.

---

## Why This Plan Exists

Phase 0-15 proves:

- Governance corpus and BrowseGent repo-local skill exist.
- v2 runtime is isolated and opt-in.
- `mvr` diagnostic mode preserves v1 default behavior.
- `agent` mode can execute deterministic fake-planner browser episodes.
- Planner input/output artifacts, runtime actions, observations, and transition evidence are replayable.
- Static boundary and no-cognition checks pass.

The broader production goal still needs stronger evidence in these areas:

- Public `BrowseGent.run()` / `BrowseGent.extract()` agent-mode execution without a live provider dependency.
- CI wiring that runs the governance, unit, integration, eval, and hygiene gates in a stable order.
- A replay auditor that can independently validate a trace manifest after a run.
- Production-safe v2 config defaults and explicit browser-mode semantics.
- Optional real-provider smoke coverage that is never required for offline local verification.

## Global Invariants

- v2 remains `off` by default.
- v1 behavior remains unchanged unless `BROWSEGENT_V2_RUNTIME` is explicitly set.
- The planner remains the only semantic decision-maker.
- Runtime, graph, Brain1, Brain2, trace, and tools remain mechanical.
- Provider smoke tests are opt-in and never run as part of default offline gates.
- CI must fail on governance drift, cognition leakage, replay incompleteness, or v1 route regression.

## Phase 16 - Public Agent-Mode Test Seam

Purpose: prove the public `BrowseGent` API routes to the full v2 agent path with deterministic fake planner behavior, without relying on a real provider call.

Exact files:

- `src/v2/agent/createV2AgentLoop.ts`
- `tests/integration/v2/publicAgentMode.test.ts`

Files modified:

- `src/BrowseGent.ts`
- `src/v2/index.ts`

Interface:

```ts
export interface V2AgentLoopFactoryInput {
  headed: boolean;
  traceDir: string;
  runId?: string;
}

export type V2AgentLoopFactory = (input: V2AgentLoopFactoryInput) => Pick<V2AgentLoop, 'run'>;
```

Implementation shape:

```ts
export function createV2AgentLoop(input: V2AgentLoopFactoryInput): Pick<V2AgentLoop, 'run'> {
  return new V2AgentLoop({
    headed: input.headed,
    traceDir: input.traceDir,
    runId: input.runId,
  });
}
```

Test seam rule:

- Production `BrowseGent` imports `createV2AgentLoop`.
- Tests may monkey-patch the exported factory through a narrow test helper only if the helper is located in `tests/integration/v2/`.
- No test hook may appear in planner input, runtime output, or public user-facing docs.

Tests:

- Public `BrowseGent.run()` with `BROWSEGENT_V2_RUNTIME=agent` returns the fake v2 agent result.
- Public `BrowseGent.extract()` with `BROWSEGENT_V2_RUNTIME=agent` parses `done.val` JSON and applies `parseResult`.
- Public `BrowseGent.extract()` returns explicit JSON parse failure for invalid planner JSON.
- Default `off` still routes to v1 in existing compatibility tests.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\integration\v2\publicAgentMode.test.ts tests\integration\v2\v1Compatibility.test.ts
cmd /c npm run build
cmd /c npm run check:v2
```

## Phase 17 - Trace Replay Auditor

Purpose: add an independent trace validator so replay completeness is not coupled only to smoke-runner assertions.

Exact files:

- `src/v2/trace/TraceReplayAuditor.ts`
- `tests/unit/v2/traceReplayAuditor.test.ts`

Files modified:

- `src/v2/index.ts`
- `tests/eval/v2/run_agent_smoke.ts`
- `tests/eval/v2/run_continuity_stress.ts`

Interface:

```ts
export interface TraceReplayAuditInput {
  tracePath: string;
  expectedPlannerCalls?: number;
  expectedToolExecutions?: number;
  requireAgentMode?: boolean;
}

export interface TraceReplayAuditResult {
  ok: boolean;
  plannerInputCount: number;
  plannerOutputCount: number;
  runtimeStepCount: number;
  failedStepCount: number;
  observationCount: number;
  mutationWithoutEvidenceCount: number;
  errors: string[];
}
```

Audit rules:

- Trace JSON must be parseable.
- `artifacts.trace.kind` must be `trace`.
- Agent traces must have `runtimeMode === 'agent'` when `requireAgentMode` is true.
- Planner input count and output count must meet expected planner-call counts when provided.
- Runtime step count must meet expected tool-execution counts when provided.
- Runtime steps must not have failed status.
- Mutating steps (`click`, `type`, `scroll`, `wait`) must include `afterObservationId` and transition evidence.
- At least one observation artifact must exist.

Tests:

- Complete trace returns `ok: true`.
- Missing planner output returns `ok: false` with `missing_planner_output_artifacts`.
- Failed runtime step returns `ok: false` with `failed_runtime_steps`.
- Completed click without transition evidence returns `ok: false` with `missing_mutation_evidence`.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\traceReplayAuditor.test.ts tests\unit\v2\agentSmokeRunner.test.ts tests\unit\v2\continuityStressRunner.test.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_agent_smoke.ts
cmd /c npm run build
cmd /c npm run check:v2
```

## Phase 18 - Release Gate Script and CI Workflow

Purpose: make the verified local gates reproducible as one release command and one CI workflow.

Exact files:

- `scripts/check_v2_release_gate.ts`
- `.github/workflows/v2-release-gate.yml`
- `tests/unit/v2/releaseGateScript.test.ts`

Files modified:

- `package.json`
- `docs/governance/CI_AND_ENFORCEMENT.md`

Package script:

```json
{
  "scripts": {
    "check:v2:release": "tsx scripts/check_v2_release_gate.ts"
  }
}
```

Gate command order:

```powershell
cmd /c npm run build
cmd /c npm run test:unit
cmd /c npm run check:v2
node .\node_modules\tsx\dist\cli.cjs --test tests\integration\v2\observationRuntime.test.ts tests\integration\v2\mvrRuntime.test.ts tests\integration\v2\v1Compatibility.test.ts tests\integration\v2\publicAgentMode.test.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_continuity_stress.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_agent_smoke.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_provider_smoke.ts
git diff --check
rg -n "[ \t]+$" docs\governance docs\refined-architecture-v2.1 docs\superpowers\plans scripts src\v2 tests\unit\v2 tests\integration\v2 tests\eval\v2 tests\fixtures\v2 package.json skills\browsegent-dev skills\codex.md .github\workflows
rg -n "TO[D]O|FIXM[E]|T[B]D" docs\governance docs\refined-architecture-v2.1 docs\superpowers\plans scripts src\v2 tests\unit\v2 tests\integration\v2 tests\eval\v2 skills\browsegent-dev skills\codex.md .github\workflows
```

Tests:

- Script builds the expected command list without executing child processes.
- Script reports the failing command name and exit code when a child process fails.
- Script treats `rg` exit code `1` as success only for the no-match hygiene scans.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\releaseGateScript.test.ts
cmd /c npm run check:v2:release
```

## Phase 19 - Production Config Hardening

Purpose: make v2 browser execution defaults explicit and CI-safe without changing v1 defaults.

Exact files:

- `tests/unit/v2/runtimeConfigHardening.test.ts`

Files modified:

- `src/v2/runtime/config.ts`
- `src/v2/runtime/types.ts`
- `src/config/runtime.ts`
- `docs/governance/RUNTIME_SAFETY_RULES.md`

Rules:

- `BROWSEGENT_V2_RUNTIME` default remains `off`.
- `BROWSEGENT_V2_HEADED` must parse only `true` or `false`.
- Agent-mode tests and release gates must run with `BROWSEGENT_V2_HEADED=false`.
- `BrowseGent` v2 agent mode must document whether it follows `BROWSEGENT_V2_HEADED` or `BrowseGentOptions.headless`; the code must match the documented rule.
- Invalid booleans fail fast with `invalid_runtime_mode`.

Tests:

- `loadV2RuntimeConfig({})` remains mode `off`.
- `loadV2RuntimeConfig({ BROWSEGENT_V2_HEADED: 'false' })` sets headed false.
- `loadV2RuntimeConfig({ BROWSEGENT_V2_HEADED: 'maybe' })` throws.
- Public v2 agent integration tests seed `BROWSEGENT_V2_HEADED=false`.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\runtimeContracts.test.ts tests\unit\v2\runtimeConfigHardening.test.ts tests\integration\v2\publicAgentMode.test.ts
cmd /c npm run build
cmd /c npm run check:v2
```

## Phase 20 - Optional Provider Smoke

Purpose: verify the real provider transport can produce valid v2 planner JSON without making network or paid-provider access part of default development.

Exact files:

- `tests/eval/v2/run_provider_smoke.ts`
- `tests/unit/v2/providerSmokeRunner.test.ts`

Rules:

- The provider smoke runner exits as skipped unless `BROWSEGENT_RUN_PROVIDER_SMOKE=true`.
- The runner uses a local fixture URL only.
- The runner must require `BROWSEGENT_V2_RUNTIME=agent`.
- The runner must write `logs/v2-provider-smoke/<runId>/report.json`.
- A provider response must pass `PlannerOutputSchema`.
- Provider failures must include raw validation errors, not silent fallback.

Completion gate:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\providerSmokeRunner.test.ts
$env:BROWSEGENT_RUN_PROVIDER_SMOKE='false'; node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_provider_smoke.ts
cmd /c npm run build
cmd /c npm run check:v2
```

Manual opt-in gate when credentials and network are available:

```powershell
$env:BROWSEGENT_RUN_PROVIDER_SMOKE='true'
$env:BROWSEGENT_V2_RUNTIME='agent'
$env:BROWSEGENT_V2_HEADED='false'
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_provider_smoke.ts
```

## Full Release-Hardening Verification

After Phase 20, run:

```powershell
cmd /c npm run check:v2:release
```

Then inspect:

```powershell
git status --short
git status --short --ignored skills logs
```

The release-hardening milestone is complete only when:

- Public agent mode is tested through `BrowseGent.run()` and `BrowseGent.extract()` without a live provider.
- Trace replay auditing is centralized and reused by eval runners.
- CI has an explicit v2 release gate workflow.
- v2 browser-mode config semantics are documented and tested.
- Provider smoke exists as an opt-in gate.
- Default offline gates pass without network.
- No new runtime cognition leakage appears.
- v1 remains the default path.
