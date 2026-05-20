# BrowseGent v2 Runtime Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build BrowseGent v2 incrementally around one proof: the runtime can observe browser state, assign stable refs, execute a bounded interaction, re-observe, verify the transition, and replay the evidence without hidden cognition.

**Architecture:** Centralized planner cognition over a non-cognitive continuity runtime. The runtime owns browser truth, refs, mechanical stabilization, Brain1 operational projection, Brain2 transition interpretation, shallow continuity graph, and trace lineage. The planner remains the only semantic reasoning authority.

**Tech Stack:** TypeScript, Node.js, Playwright, Chromium/CDP, existing BrowseGent v1 modules under `src/`, Node test runner through `tsx --test`, TypeScript through `tsc --noEmit`.

---

## Scope

This plan is for implementation planning, not implementation. It defines the exact build sequence and boundaries for BrowseGent v2.

The first milestone is a Minimal Viable Runtime, not a full browser agent.

The MVR must prove:
- A browser session can be opened and observed deterministically.
- Observations produce generation-scoped refs.
- Refs can be resolved or rejected honestly.
- A simple interaction can execute through refs.
- The browser can be re-observed after interaction.
- Transition evidence can be computed mechanically.
- The entire sequence can be replayed from trace artifacts.

The MVR must not include:
- Planner rewrite.
- LLM prompt redesign.
- Multi-tab orchestration.
- Vision escalation.
- Advanced memory.
- Benchmark tuning.
- Hidden strategic recovery.
- Domain-specific heuristics.

## Governance Gate

Before implementing any task in this plan, read and follow:

- `docs/governance/ENGINEERING_CODEX.md`
- `docs/governance/AI_ENGINEERING_RULES.md`
- `docs/governance/ARCHITECTURE_BOUNDARIES.md`
- `docs/governance/IMPLEMENTATION_DISCIPLINE.md`

For browser mutation, refs, transitions, trace, or runtime safety, also read:

- `docs/governance/RUNTIME_SAFETY_RULES.md`
- `docs/governance/TESTING_AND_REPLAY_RULES.md`
- `docs/governance/CONTINUITY_AND_RUNTIME_LAWS.md`
- `docs/governance/CI_AND_ENFORCEMENT.md`

Governance is not optional. If this plan and governance conflict, stop and resolve the conflict before implementation.

## Success Conditions

- `src/v2/` exists as an isolated runtime surface and does not alter v1 behavior by default.
- `BROWSEGENT_V2_RUNTIME=mvr` enables the MVR path explicitly.
- A local fixture run produces `observe -> click/type -> reobserve -> transition evidence -> trace`.
- Every mutating runtime action writes a trace step.
- Ref invalidation is conservative: uncertain refs are weakened or rejected before wrong execution.
- Tests cover contracts, ref lifecycle, trace lineage, transition evidence, and fixture-level runtime behavior.
- `npm run build` passes.
- `npm run test:unit` passes.

## Failure Conditions

- v2 changes default `BrowseGent.run()`, `extract()`, or v1 eval behavior before rollout is enabled.
- Runtime emits strategic advice such as "try another search" or "this page is not useful".
- Tools return semantic conclusions instead of operational evidence.
- Refs silently fall back to broad selectors when identity confidence is low.
- Trace artifacts cannot reconstruct what the planner/runtime saw before and after an action.
- Brain1 or Brain2 stores domain semantics, benchmark-specific labels, or hidden task strategy.
- Any phase requires benchmark pass-rate improvement as its primary proof.

## Rollout Boundary

Initial rollout is off by default.

Configuration:

```ts
export type V2RuntimeMode = 'off' | 'mvr';

export interface RuntimeConfig {
  v2RuntimeMode: V2RuntimeMode;
  traceDir: string;
  headed: boolean;
}
```

Environment:

```powershell
$env:BROWSEGENT_V2_RUNTIME="mvr"
```

Default:

```powershell
$env:BROWSEGENT_V2_RUNTIME="off"
```

No public v1 API changes are allowed in the MVR. v2 is introduced through explicit imports from `src/v2/index.ts` and test harnesses only.

---

## Core Contracts

Create these contracts first. Do not implement behavior before these contracts are reviewed by tests.

File: `src/v2/runtime/types.ts`

```ts
export type V2RuntimeMode = 'off' | 'mvr';
export type RefState = 'live' | 'weakened' | 'stale' | 'invalid';
export type VisibilityState = 'visible' | 'offscreen' | 'hidden' | 'unknown';
export type ActionabilityState = 'ready' | 'disabled' | 'blocked' | 'unknown';
export type TransitionStrength = 'none' | 'weak' | 'moderate' | 'strong' | 'negative';
export type TransitionClass = 'microstate' | 'structural_local' | 'structural_macrostate' | 'hard_reset';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface V2Ref {
  refId: string;
  generationId: number;
  targetId: string;
  frameId?: string;
  backendNodeId?: number;
  selectorCandidates: string[];
  role?: string;
  name?: string;
  text?: string;
  regionId?: string;
  box?: Rect;
  visibility: VisibilityState;
  actionability: ActionabilityState;
  continuityConfidence: number;
  state: RefState;
  invalidationReason?: string;
}

export interface BrowserObservation {
  observationId: string;
  sessionId: string;
  generationId: number;
  url: string;
  title: string;
  timestamp: number;
  refs: V2Ref[];
  warnings: RuntimeWarning[];
  stats: {
    refCount: number;
    visibleRefCount: number;
    durationMs: number;
  };
}

export interface TransitionEvidence {
  beforeObservationId: string;
  afterObservationId: string;
  transitionClass: TransitionClass;
  strength: TransitionStrength;
  generationChanged: boolean;
  urlChanged: boolean;
  refChanges: {
    appeared: string[];
    disappeared: string[];
    weakened: string[];
    preserved: string[];
  };
  notes: string[];
}

export interface RuntimeWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface V2ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface V2ToolResult<TValue = unknown> {
  success: boolean;
  kind: string;
  targetRef?: string;
  value?: TValue;
  error?: V2ToolError;
  evidence?: TransitionEvidence;
  traceStepId: string;
}
```

Contract rules:
- `V2Ref.refId` is the only planner-visible execution target.
- `selectorCandidates` are internal recovery hints, not planner instructions.
- `continuityConfidence` is operational confidence, not semantic correctness.
- `TransitionEvidence.strength` describes observable browser change, not task success.
- `RuntimeWarning.message` must remain operational and must not recommend strategy.

---

## Runtime Event Flow

MVR observation flow:

```text
BrowseGentV2Harness.observe()
  -> BrowserSession.currentPage()
  -> ObservationService.capture()
  -> RefService.assignRefs()
  -> TraceStore.recordObservation()
  -> BrowserObservation
```

MVR interaction flow:

```text
BrowseGentV2Harness.click(refId)
  -> TraceStore.recordActionStart()
  -> RefService.resolve(refId)
  -> InputService.validateActionability()
  -> InputService.click()
  -> StabilizationService.waitForSettledState()
  -> ObservationService.capture()
  -> TransitionService.compare(before, after)
  -> TraceStore.recordActionEnd()
  -> V2ToolResult
```

MVR rejection flow:

```text
BrowseGentV2Harness.click(refId)
  -> RefService.resolve(refId)
  -> ref missing, weakened below threshold, hidden, disabled, or blocked
  -> TraceStore.recordActionEnd(error)
  -> V2ToolResult(success=false, error=operational_failure)
```

Runtime never performs strategic substitution. If the requested ref cannot be executed, it reports evidence.

---

## Phase 0 - Plan-to-Code Guardrails

Purpose: create isolated v2 package structure and config without touching v1 behavior.

Files to add:
- `src/v2/index.ts`
- `src/v2/runtime/types.ts`
- `src/v2/runtime/config.ts`
- `src/v2/runtime/errors.ts`
- `tests/unit/v2/runtimeContracts.test.ts`

Files to read but not modify unless needed:
- `src/config/runtime.ts`
- `src/BrowseGent.ts`
- `package.json`

Implementation tasks:
- [ ] Add `src/v2/index.ts` exporting only contract types and an explicit future harness factory.
- [ ] Add `src/v2/runtime/types.ts` with the core contracts above.
- [ ] Add `src/v2/runtime/config.ts` reading `BROWSEGENT_V2_RUNTIME` with default `off`.
- [ ] Add `src/v2/runtime/errors.ts` for bounded operational error codes.
- [ ] Add tests proving default mode is `off` and invalid runtime modes fail fast.

Tests:
- `tests/unit/v2/runtimeContracts.test.ts`

Expected command:

```powershell
npm run build
npm run test:unit
```

Expected output:
- TypeScript has no errors.
- Unit tests pass.
- No v1 eval or public API behavior changes.

Rollback:
- Delete `src/v2/` and `tests/unit/v2/`; no v1 code should depend on it.

---

## Phase 1 - MVR Browser Session and Observation

Purpose: prove browser truth can be captured into deterministic observations.

Files to add:
- `src/v2/substrate/BrowserSession.ts`
- `src/v2/substrate/ObservationService.ts`
- `src/v2/substrate/CdpBridge.ts`
- `src/v2/substrate/types.ts`
- `tests/fixtures/v2/static-controls.html`
- `tests/fixtures/v2/repeated-controls.html`
- `tests/unit/v2/observationShape.test.ts`
- `tests/integration/v2/observationRuntime.test.ts`

Module boundaries:
- `BrowserSession` owns Playwright browser/page lifecycle.
- `CdpBridge` owns CDP session access and low-level browser truth.
- `ObservationService` captures DOM, AX-like attributes, geometry, visibility, and actionability facts.
- No Brain1, Brain2, graph, or planner code in this phase.

Runtime responsibilities:
- Open one headed Chromium page.
- Capture URL, title, timestamp, generation id, and raw interactive candidates.
- Include native controls, role controls, contenteditable, positive tabindex, and link/button/input/select/textarea.
- Compute visibility and actionability mechanically.
- Never classify intent or page meaning.

Interfaces:

```ts
export interface ObservationService {
  capture(input: CaptureInput): Promise<BrowserObservation>;
}

export interface CaptureInput {
  sessionId: string;
  generationId: number;
  page: import('playwright').Page;
}
```

Event flow:

```text
BrowserSession.open(url)
  -> ObservationService.capture()
  -> BrowserObservation
```

Tests:
- Static fixture returns refs for button, input, link, select, and contenteditable.
- Hidden controls are present only with `visibility='hidden'` or excluded according to capture policy.
- Disabled controls have `actionability='disabled'`.
- Observation shape has stable required fields and bounded stats.
- Repeated controls produce unique `targetId` and `refId` values.

Replay output:
- None yet except test snapshots if needed. Trace starts in Phase 3.

Rollout boundary:
- Only test harness uses this path.
- v1 `Brain1Service` remains untouched.

---

## Phase 2 - Ref Lifecycle

Purpose: prove interaction identity exists above selectors and can degrade safely.

Files to add:
- `src/v2/runtime/RefService.ts`
- `src/v2/runtime/refFingerprint.ts`
- `src/v2/runtime/refResolution.ts`
- `tests/unit/v2/refFingerprint.test.ts`
- `tests/unit/v2/refService.test.ts`
- `tests/fixtures/v2/rerender-replacement.html`

Files to modify:
- `src/v2/substrate/ObservationService.ts`

Module boundaries:
- `RefService` assigns, stores, resolves, weakens, and invalidates refs.
- `refFingerprint.ts` produces deterministic identity fingerprints.
- `refResolution.ts` ranks identity matches mechanically.
- `ObservationService` supplies candidate facts only.

Runtime responsibilities:
- Assign refs scoped by `sessionId` and `generationId`.
- Prefer backend node id when available.
- Use role, name, text, selector candidates, region id, and box as recovery hints.
- Preserve refs across microstate changes.
- Weaken refs on structural local uncertainty.
- Invalidate refs on hard reset or failed resolution.

Interfaces:

```ts
export interface RefService {
  assign(observation: BrowserObservation): BrowserObservation;
  resolve(refId: string, current: BrowserObservation): RefResolution;
  compare(before: BrowserObservation, after: BrowserObservation): RefComparison;
}

export interface RefResolution {
  ref?: V2Ref;
  state: RefState;
  confidence: number;
  reason?: string;
}
```

Tests:
- Same stable button across observation receives preserved identity.
- Full DOM replacement weakens or invalidates old refs rather than silently reusing them.
- Duplicate buttons do not collapse into one ref.
- Low-confidence matches are rejected before execution.
- Ref service output is deterministic across repeated captures of unchanged fixture.

Replay output:
- Ref comparison objects become Phase 3 trace input.

Rollout boundary:
- No v1 selector execution changes yet.

---

## Phase 3 - Trace Lineage and Replay Artifacts

Purpose: prove every runtime observation and mutation is reconstructable.

Files to add:
- `src/v2/trace/TraceStore.ts`
- `src/v2/trace/types.ts`
- `src/v2/trace/serialize.ts`
- `tests/unit/v2/traceStore.test.ts`
- `tests/unit/v2/traceSerialization.test.ts`

Module boundaries:
- `TraceStore` records events and artifacts passively.
- Trace does not influence runtime decisions.
- Trace never stores hidden planner state in runtime modules.

Runtime responsibilities:
- Record observations.
- Record action start and action end.
- Record warnings and errors.
- Serialize deterministic JSON artifacts.
- Store screenshots only when explicitly requested by the harness or test.

Trace paths:

```text
logs/v2-runs/<runId>/trace.json
logs/v2-runs/<runId>/observations/<observationId>.json
logs/v2-runs/<runId>/screenshots/<artifactId>.png
```

Interfaces:

```ts
export interface TraceStore {
  recordObservation(observation: BrowserObservation): Promise<void>;
  recordActionStart(input: TraceActionStart): Promise<string>;
  recordActionEnd(stepId: string, result: V2ToolResult): Promise<void>;
  flush(): Promise<TraceManifest>;
}
```

Tests:
- Trace manifest includes run id, runtime version, observation ids, and action ids.
- Observation artifacts are serializable and do not contain Playwright handles.
- Action trace can reconstruct before observation, action, after observation, and evidence.
- Trace output is passive and does not change runtime result.

Rollout boundary:
- Trace enabled for v2 only.
- v1 logs remain unchanged.

---

## Phase 4 - MVR Interaction and Transition Verification

Purpose: prove refs can drive bounded interactions and produce mechanical transition evidence.

Files to add:
- `src/v2/substrate/InputService.ts`
- `src/v2/runtime/StabilizationService.ts`
- `src/v2/runtime/TransitionService.ts`
- `src/v2/harness/BrowseGentV2Harness.ts`
- `src/v2/harness/types.ts`
- `tests/fixtures/v2/modal-transition.html`
- `tests/fixtures/v2/blocked-overlay.html`
- `tests/integration/v2/mvrRuntime.test.ts`

Files to modify:
- `src/v2/index.ts`

Module boundaries:
- `InputService` owns click/type/scroll mechanical execution.
- `StabilizationService` owns bounded waits and local settle checks.
- `TransitionService` compares observations and emits evidence.
- `BrowseGentV2Harness` is a developer-facing test harness, not the final agent.

Runtime responsibilities:
- Execute click by ref only.
- Execute type by ref only.
- Validate visibility and actionability before mutation.
- Reobserve after mutation.
- Compare before/after observations.
- Return operational evidence.

Interfaces:

```ts
export interface BrowseGentV2Harness {
  open(url: string): Promise<void>;
  observe(): Promise<BrowserObservation>;
  click(refId: string): Promise<V2ToolResult>;
  type(refId: string, text: string): Promise<V2ToolResult>;
  close(): Promise<void>;
}
```

Tests:
- Clicking a button opens a modal and produces `transitionClass='structural_local'`.
- Typing into an input updates observed value and produces weak or moderate evidence.
- Clicking a blocked target returns `success=false` with `error.code='target_blocked'`.
- Clicking a stale ref returns `success=false` without selector guessing.
- Trace contains before observation, action result, after observation, and transition evidence.

Rollout boundary:
- Harness is for tests and diagnostics.
- No planner integration yet.

---

## Phase 5 - Brain1 Operational Projection Bridge

Purpose: produce compact planner-facing operational views over v2 observations without semantic cognition.

Files to add:
- `src/v2/brain1/ProjectionService.ts`
- `src/v2/brain1/projectionTypes.ts`
- `src/v2/brain1/rankOperationalItems.ts`
- `src/v2/brain1/serializeProjection.ts`
- `tests/unit/v2/brain1Projection.test.ts`
- `tests/fixtures/v2/list-region.html`
- `tests/fixtures/v2/form-region.html`

Module boundaries:
- Brain1 consumes `BrowserObservation`.
- Brain1 emits operational projections.
- Brain1 does not own transitions, invalidation, task strategy, or semantic meaning.

Runtime responsibilities:
- Produce `interactions`, `readables`, `regions`, `navigation`, `warnings`, and `focus`.
- Rank by visibility, actionability, structural prominence, locality, and continuity confidence.
- Preserve ambiguity rather than over-labeling.
- Keep serialized projection compact and deterministic.

Interfaces:

```ts
export interface OperationalProjection {
  observationId: string;
  generationId: number;
  interactions: ProjectionItem[];
  readables: ProjectionItem[];
  regions: ProjectionRegion[];
  navigation: ProjectionItem[];
  warnings: RuntimeWarning[];
  focus?: ProjectionFocus;
}
```

Tests:
- Projection exposes actionable controls and readable text separately.
- Repeated cards form shallow regions without domain labels.
- Navigation view includes operational navigation controls without strategy.
- Serializer excludes internal selector candidates and backend node ids by default.
- Projection token size remains bounded on fixture pages.

Rollout boundary:
- v1 graph serializer remains unchanged.
- Planner does not consume v2 projection until Phase 7.

---

## Phase 6 - Brain2 and Shallow Continuity Graph

Purpose: preserve and interpret runtime continuity mechanically across observations.

Files to add:
- `src/v2/graph/ContinuityGraph.ts`
- `src/v2/graph/types.ts`
- `src/v2/brain2/ContinuityInterpreter.ts`
- `src/v2/brain2/transitionClassifier.ts`
- `src/v2/brain2/progressEvidence.ts`
- `tests/unit/v2/continuityGraph.test.ts`
- `tests/unit/v2/brain2Transition.test.ts`
- `tests/fixtures/v2/spa-route-transition.html`
- `tests/fixtures/v2/local-rerender.html`

Module boundaries:
- Graph stores shallow runtime topology: refs, regions, relationships, generations.
- Brain2 compares observations and updates graph.
- Brain2 emits transition summaries and progress evidence.
- Brain2 never decides task success.

Runtime responsibilities:
- Classify transition as microstate, structural local, structural macrostate, or hard reset.
- Produce progress strength as none, weak, moderate, strong, or negative.
- Weaken or invalidate refs through RefService based on transition evidence.
- Keep graph execution-scoped and bounded.

Interfaces:

```ts
export interface ContinuityGraph {
  applyObservation(observation: BrowserObservation): void;
  applyTransition(evidence: TransitionEvidence): void;
  snapshot(): ContinuityGraphSnapshot;
}

export interface ContinuityInterpreter {
  interpret(before: BrowserObservation, after: BrowserObservation): TransitionEvidence;
}
```

Tests:
- Scroll-like microstate does not bump generation.
- Modal open is structural local.
- SPA route change is structural macrostate.
- Full reload is hard reset.
- Graph preserves unaffected refs and regions.
- Graph size remains bounded after repeated fixture transitions.

Rollout boundary:
- No planner feedback loop changes yet.

---

## Phase 7 - Planner I/O Bridge

Purpose: connect v2 runtime evidence to planner context without planner micromanagement.

Files to add:
- `src/v2/planner/PlannerInputComposer.ts`
- `src/v2/planner/PlannerOutputSchema.ts`
- `src/v2/planner/LineageCompressor.ts`
- `src/v2/planner/types.ts`
- `tests/unit/v2/plannerInputComposer.test.ts`
- `tests/unit/v2/plannerOutputSchema.test.ts`

Files to read before modification:
- `src/agent/prompt.ts`
- `src/agent/llm.ts`
- `src/agent/parser.ts`
- `src/agent/loop.ts`
- `src/agent/planExecutor.ts`

Module boundaries:
- Planner composer assembles objective, Brain1 projection, Brain2 summary, execution evidence, uncertainty, and recent lineage.
- Planner composer does not modify runtime state.
- Planner output is semantic intent, translated later by runtime tools.

Runtime responsibilities:
- Provide structured state.
- Provide operational warnings.
- Provide evidence.
- Avoid raw graph internals, browser mechanics, and CDP details in planner context.

Interfaces:

```ts
export interface PlannerInput {
  objective: string;
  operationalState: OperationalProjection;
  continuityState: TransitionEvidence | null;
  executionState: V2ToolResult | null;
  uncertaintyState: RuntimeWarning[];
  recentLineage: LineageSummary[];
  activeConstraints: PlannerConstraints;
}
```

Tests:
- Planner input excludes graph topology and raw selectors.
- Runtime warnings are operational, not strategic.
- Recent lineage is bounded.
- Planner output schema rejects raw CSS-selector-only execution requests in v2 mode.

Rollout boundary:
- v2 planner bridge remains behind `BROWSEGENT_V2_RUNTIME=mvr`.
- v1 agent loop remains default.

---

## Phase 8 - v1 Integration Adapter

Purpose: allow BrowseGent v1 and v2 to coexist without mixing responsibilities.

Files to add:
- `src/v2/adapter/V1CompatibilityAdapter.ts`
- `src/v2/adapter/types.ts`
- `tests/integration/v2/v1Compatibility.test.ts`

Files to modify only after Phase 7 passes:
- `src/BrowseGent.ts`
- `src/config/runtime.ts`

Module boundaries:
- Adapter chooses v1 or v2 path based on runtime config.
- Adapter does not translate v2 refs into v1 selectors unless explicitly marked diagnostic-only.
- Adapter does not make strategic decisions.

Runtime responsibilities:
- Default mode remains v1.
- v2 mode can run a diagnostic task through harness path.
- Public methods remain stable.

Tests:
- Without env flag, `BrowseGent.run()` uses v1 path.
- With `BROWSEGENT_V2_RUNTIME=mvr`, diagnostic v2 harness path is available.
- v1 unit and eval commands still run.

Rollout boundary:
- v2 remains opt-in.
- Any v1 regression blocks merge.

---

## Phase 9 - Failure and Dead-State Evidence

Purpose: expose operational degradation honestly without hidden recovery strategy.

Files to add:
- `src/v2/runtime/FailureClassifier.ts`
- `src/v2/runtime/DeadStateDetector.ts`
- `src/v2/runtime/UncertaintySignals.ts`
- `tests/unit/v2/failureClassifier.test.ts`
- `tests/unit/v2/deadStateEvidence.test.ts`
- `tests/fixtures/v2/captcha-wall.html`
- `tests/fixtures/v2/no-action-state.html`

Module boundaries:
- Failure classifier maps runtime facts to operational failure classes.
- Dead state detector emits mechanical evidence only.
- Planner owns semantic response.

Runtime responsibilities:
- Classify target hidden, target disabled, target blocked, stale ref, timeout, navigation interrupted, projection empty.
- Emit dead-state evidence only after bounded local repair options are exhausted.
- Never say "task impossible" or "strategy wrong".

Tests:
- Blocked overlay produces persistent mechanical failure evidence.
- Empty interaction state produces dead-state evidence after observation, not immediately.
- Repeated weak progress is exposed as evidence, not a forced strategy change.
- Failure outputs contain no strategic advice.

Rollout boundary:
- Dead-state evidence can be shown to planner later but does not abort tasks by itself in MVR.

---

## Phase 10 - Continuity Stress Validation

Purpose: validate architecture against browser hostility before broad benchmarks.

Files to add:
- `tests/eval/v2/continuity_scenarios.ts`
- `tests/eval/v2/run_continuity_stress.ts`
- `tests/eval/v2/README.md`
- `tests/fixtures/v2/virtualized-list.html`
- `tests/fixtures/v2/random-rerender.html`
- `tests/fixtures/v2/delayed-load.html`
- `tests/fixtures/v2/layout-shift.html`

Module boundaries:
- Eval runner is passive.
- Eval runner does not tune runtime behavior.
- Scenario classes vary instability patterns, not fixed benchmark tricks.

Runtime responsibilities:
- Produce diagnostics: ref survival rate, invalidation counts, transition classes, trace replay completeness, planner context size.

Validation metrics:
- Ref survival rate by transition class.
- Wrong-ref execution count.
- Trace completeness.
- Projection size.
- Transition classification stability.
- Dead-state evidence accuracy.

Tests:
- Stress runner completes fixtures and writes a report.
- Report contains diagnostics even for failures.
- Runner does not import planner or change runtime config.

Rollout boundary:
- Continue using small fixture pressure tests before adding external benchmark tasks.

---

## Validation Commands

Run after every phase:

```powershell
npm run build
npm run test:unit
```

Run after browser-backed phases:

```powershell
npx tsx --test tests/integration/v2/**/*.test.ts
```

Run after continuity stress phase:

```powershell
npx tsx tests/eval/v2/run_continuity_stress.ts
```

Expected invariant:
- A phase is not complete unless its own tests pass and v1 unit tests still pass.

---

## Implementation Order

Strict order:

1. Phase 0 - Plan-to-code guardrails.
2. Phase 1 - Browser session and observation.
3. Phase 2 - Ref lifecycle.
4. Phase 3 - Trace lineage.
5. Phase 4 - Interaction and transition verification.
6. Phase 5 - Brain1 projection bridge.
7. Phase 6 - Brain2 and graph continuity.
8. Phase 7 - Planner I/O bridge.
9. Phase 8 - v1 integration adapter.
10. Phase 9 - Failure and dead-state evidence.
11. Phase 10 - Continuity stress validation.

Do not skip directly to planner integration. The architecture stands or fails on runtime truth first.

---

## Anti-Drift Gates

Before merging any phase, answer these questions in the PR or implementation summary:

- Which governance files were read for this phase?
- Does this phase prove a foundational runtime assumption?
- Did any runtime code make a strategic recommendation?
- Did any tool output semantic advice?
- Did any selector become the primary planner-facing target?
- Did trace evidence become strong enough to replay the run?
- Did v1 remain unchanged by default?
- Did the phase add only the minimal files needed for its proof?
- Did tests prove failure behavior, not just success behavior?

If any answer is unclear, the phase is not complete.

---

## First Worker Slice

The first implementation worker should only execute Phase 0 and Phase 1.

Allowed files:
- `src/v2/index.ts`
- `src/v2/runtime/types.ts`
- `src/v2/runtime/config.ts`
- `src/v2/runtime/errors.ts`
- `src/v2/substrate/BrowserSession.ts`
- `src/v2/substrate/ObservationService.ts`
- `src/v2/substrate/CdpBridge.ts`
- `src/v2/substrate/types.ts`
- `tests/unit/v2/runtimeContracts.test.ts`
- `tests/unit/v2/observationShape.test.ts`
- `tests/integration/v2/observationRuntime.test.ts`
- `tests/fixtures/v2/static-controls.html`
- `tests/fixtures/v2/repeated-controls.html`

Worker must not modify:
- `src/BrowseGent.ts`
- `src/agent/*`
- `src/brain1/*`
- `src/brain2/*`
- `src/executor/*`
- `tests/eval/*`

Completion gate:
- `npm run build`
- `npm run test:unit`
- Browser-backed observation integration test passes or is documented with exact environmental blocker.

---

## Notes for Future Phases

- Existing v1 Brain1 and Brain2 code can be studied for practical selector and visibility behavior, but v2 should not inherit v1 coupling.
- Existing progress detection and loop detection are useful validation references, not final v2 architecture.
- Benchmarks should stay diagnostic. Do not modify runtime behavior to win a specific test.
- Browser Harness, browser-use, and agent-browser inspirations should be treated as operational references, not implementation templates.
