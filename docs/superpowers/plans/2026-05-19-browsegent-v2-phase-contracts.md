# BrowseGent v2 Phase Contracts

This file complements `2026-05-19-browsegent-v2-runtime-continuity-plan.md`.

Its job is to make every implementation phase concrete enough for worker execution and review. The main plan defines the sequence. This file defines each phase contract: files, boundaries, interfaces, runtime responsibilities, event flow, tests, fixtures, replay outputs, rollout boundary, and BrowseGent v1 integration point.

## Global Invariants

- Governance files in `docs/governance/` are mandatory constraints for all phases.
- Runtime systems expose operational evidence, not semantic advice.
- Planner remains the only semantic cognition layer.
- v2 is off by default.
- v1 public behavior remains unchanged unless explicitly enabled.
- Refs are planner-facing execution targets; selectors are internal recovery hints.
- Every mutating action must be traceable.
- Every phase must pass `npm run build` and `npm run test:unit`.

## Required Governance Read Before Phase Work

Every phase worker must read:

- `docs/governance/ENGINEERING_CODEX.md`
- `docs/governance/AI_ENGINEERING_RULES.md`
- `docs/governance/ARCHITECTURE_BOUNDARIES.md`
- `docs/governance/IMPLEMENTATION_DISCIPLINE.md`

Runtime mutation phases must also read:

- `docs/governance/RUNTIME_SAFETY_RULES.md`
- `docs/governance/TESTING_AND_REPLAY_RULES.md`
- `docs/governance/CONTINUITY_AND_RUNTIME_LAWS.md`
- `docs/governance/CI_AND_ENFORCEMENT.md`

---

## Phase 0 - Plan-to-Code Guardrails

Exact files:
- `src/v2/index.ts`
- `src/v2/runtime/types.ts`
- `src/v2/runtime/config.ts`
- `src/v2/runtime/errors.ts`
- `tests/unit/v2/runtimeContracts.test.ts`

Module boundary:
- `src/v2/runtime/*` owns v2 contracts and runtime config only.
- No browser, planner, Brain1, Brain2, graph, or executor behavior is implemented here.

Interfaces/contracts:
- `V2RuntimeMode`
- `RuntimeConfig`
- `V2Ref`
- `BrowserObservation`
- `TransitionEvidence`
- `RuntimeWarning`
- `V2ToolError`
- `V2ToolResult`

Runtime responsibilities:
- Parse v2 runtime mode.
- Default to `off`.
- Fail fast on invalid mode.

Event flow:
```text
loadRuntimeConfig()
  -> read env
  -> normalize mode
  -> RuntimeConfig
```

Tests:
- Config default is `off`.
- `mvr` mode is accepted.
- Unknown mode throws deterministic config error.
- Contract types are importable from `src/v2/index.ts`.

Fixtures:
- None.

Replay outputs:
- None.

Rollout boundary:
- No v1 imports depend on v2.
- v2 imports may depend on existing shared utilities only if they do not change v1 behavior.

BrowseGent v1 integration point:
- None. This phase intentionally avoids `src/BrowseGent.ts`.

---

## Phase 1 - Browser Session and Observation

Exact files:
- `src/v2/substrate/BrowserSession.ts`
- `src/v2/substrate/ObservationService.ts`
- `src/v2/substrate/CdpBridge.ts`
- `src/v2/substrate/types.ts`
- `tests/fixtures/v2/static-controls.html`
- `tests/fixtures/v2/repeated-controls.html`
- `tests/unit/v2/observationShape.test.ts`
- `tests/integration/v2/observationRuntime.test.ts`

Module boundary:
- Substrate owns browser truth collection.
- Substrate does not project planner views.
- Substrate does not interpret transitions.
- Substrate does not classify semantic intent.

Interfaces/contracts:
- `BrowserSession.open(url)`
- `BrowserSession.currentPage()`
- `BrowserSession.close()`
- `ObservationService.capture(input)`
- `RawCandidate`
- `CaptureInput`

Runtime responsibilities:
- Start one Playwright Chromium session.
- Load local or remote URLs.
- Capture URL, title, generation id, timestamp, interactive candidates, readable candidates, visibility, geometry, disabled state, and actionability.
- Keep candidate facts operational and bounded.

Event flow:
```text
BrowserSession.open(url)
  -> page.goto(url)
  -> ObservationService.capture({ page, sessionId, generationId })
  -> CdpBridge optionally enriches backend node ids
  -> BrowserObservation
```

Tests:
- Fixture button, input, link, select, textarea, and contenteditable are captured.
- Hidden fixture nodes do not appear as ready actions.
- Disabled fixture nodes are marked disabled.
- Repeated controls produce distinct target identities.
- Observation output contains no Playwright handles.

Fixtures:
- `static-controls.html`
- `repeated-controls.html`

Replay outputs:
- Observation JSON may be snapshot-tested in memory.
- No persistent trace files until Phase 3.

Rollout boundary:
- Only integration tests instantiate `BrowserSession`.
- No v1 agent or executor path calls v2 observation.

BrowseGent v1 integration point:
- None.

---

## Phase 2 - Ref Lifecycle

Exact files:
- `src/v2/runtime/RefService.ts`
- `src/v2/runtime/refFingerprint.ts`
- `src/v2/runtime/refResolution.ts`
- `tests/unit/v2/refFingerprint.test.ts`
- `tests/unit/v2/refService.test.ts`
- `tests/fixtures/v2/rerender-replacement.html`

Files modified:
- `src/v2/substrate/ObservationService.ts`

Module boundary:
- `RefService` owns identity lifecycle.
- Observation captures facts but does not decide continuity.
- No planner or Brain1 logic here.

Interfaces/contracts:
- `RefService.assign(observation)`
- `RefService.resolve(refId, currentObservation)`
- `RefService.compare(before, after)`
- `RefResolution`
- `RefComparison`

Runtime responsibilities:
- Assign generation-scoped refs.
- Preserve refs when identity confidence remains high.
- Weaken refs when only soft identity signals match.
- Invalidate refs when confidence falls below execution threshold.
- Reject ambiguous resurrection.

Event flow:
```text
ObservationService.capture()
  -> RefService.assign()
  -> BrowserObservation(refs)

RefService.compare(before, after)
  -> preserved/weakened/disappeared/appeared refs
```

Tests:
- Stable DOM preserves refs.
- Rerendered equivalent DOM preserves or weakens refs according to confidence.
- Replaced unrelated DOM invalidates old refs.
- Duplicate controls do not alias.
- Ref resolution below threshold is not executable.

Fixtures:
- `rerender-replacement.html`
- `repeated-controls.html`

Replay outputs:
- `RefComparison` object is serializable and ready for Phase 3 trace.

Rollout boundary:
- Ref ids are not exposed to v1 planner yet.
- v1 selectors remain untouched.

BrowseGent v1 integration point:
- None.

---

## Phase 3 - Trace Lineage

Exact files:
- `src/v2/trace/TraceStore.ts`
- `src/v2/trace/types.ts`
- `src/v2/trace/serialize.ts`
- `tests/unit/v2/traceStore.test.ts`
- `tests/unit/v2/traceSerialization.test.ts`

Module boundary:
- Trace is passive.
- Trace records runtime facts but never changes runtime behavior.
- Trace serialization owns artifact shape.

Interfaces/contracts:
- `TraceStore.recordObservation(observation)`
- `TraceStore.recordActionStart(input)`
- `TraceStore.recordActionEnd(stepId, result)`
- `TraceStore.flush()`
- `TraceManifest`
- `TraceStep`

Runtime responsibilities:
- Persist observations.
- Persist action lifecycle.
- Persist errors and warnings.
- Keep artifacts JSON-serializable.
- Avoid storing browser handles.

Event flow:
```text
observe()
  -> TraceStore.recordObservation()

mutatingAction()
  -> TraceStore.recordActionStart()
  -> runtime execution
  -> TraceStore.recordActionEnd()
  -> TraceStore.flush()
```

Tests:
- Trace manifest has run id, start time, runtime mode, steps, and artifacts.
- Observation artifacts round-trip through JSON.
- Action step links before and after observations.
- Trace remains passive under repeated test runs.

Fixtures:
- None.

Replay outputs:
- `logs/v2-runs/<runId>/trace.json`
- `logs/v2-runs/<runId>/observations/<observationId>.json`
- `logs/v2-runs/<runId>/screenshots/<artifactId>.png` only when screenshot capture is requested.

Rollout boundary:
- Trace path is v2-only.
- Existing v1 logs are unchanged.

BrowseGent v1 integration point:
- None.

---

## Phase 4 - Interaction and Transition Verification

Exact files:
- `src/v2/substrate/InputService.ts`
- `src/v2/runtime/StabilizationService.ts`
- `src/v2/runtime/TransitionService.ts`
- `src/v2/harness/BrowseGentV2Harness.ts`
- `src/v2/harness/types.ts`
- `tests/fixtures/v2/modal-transition.html`
- `tests/fixtures/v2/blocked-overlay.html`
- `tests/integration/v2/mvrRuntime.test.ts`

Files modified:
- `src/v2/index.ts`

Module boundary:
- `InputService` executes mechanics.
- `StabilizationService` waits for bounded operational settle.
- `TransitionService` compares observations.
- `BrowseGentV2Harness` exposes developer diagnostics, not final agent behavior.

Interfaces/contracts:
- `InputService.click(ref, page)`
- `InputService.type(ref, text, page)`
- `StabilizationService.waitForSettledState(page)`
- `TransitionService.compare(before, after)`
- `BrowseGentV2Harness.open/observe/click/type/close`

Runtime responsibilities:
- Resolve refs before mutation.
- Validate actionability before mutation.
- Execute bounded interaction.
- Reobserve after mutation.
- Compute mechanical transition evidence.
- Record trace lineage.

Event flow:
```text
harness.click(refId)
  -> TraceStore.recordActionStart()
  -> RefService.resolve(refId)
  -> InputService.validateActionability()
  -> InputService.click()
  -> StabilizationService.waitForSettledState()
  -> ObservationService.capture()
  -> RefService.assign()
  -> TransitionService.compare()
  -> TraceStore.recordActionEnd()
  -> V2ToolResult
```

Tests:
- Click opens modal and emits structural local evidence.
- Type changes input value and emits weak or moderate evidence.
- Blocked overlay returns target blocked.
- Stale ref returns stale ref error.
- Trace replay has before and after observations.

Fixtures:
- `modal-transition.html`
- `blocked-overlay.html`
- `rerender-replacement.html`

Replay outputs:
- Trace manifest.
- Before observation JSON.
- After observation JSON.
- Action result JSON embedded in trace.

Rollout boundary:
- Harness remains opt-in.
- No planner integration.

BrowseGent v1 integration point:
- None.

---

## Phase 5 - Brain1 Operational Projection

Exact files:
- `src/v2/brain1/ProjectionService.ts`
- `src/v2/brain1/projectionTypes.ts`
- `src/v2/brain1/rankOperationalItems.ts`
- `src/v2/brain1/serializeProjection.ts`
- `tests/unit/v2/brain1Projection.test.ts`
- `tests/fixtures/v2/list-region.html`
- `tests/fixtures/v2/form-region.html`

Module boundary:
- Brain1 consumes observations and graph context.
- Brain1 emits operational projections.
- Brain1 does not own transitions, ref invalidation, or strategy.

Interfaces/contracts:
- `ProjectionService.project(observation, graphSnapshot?)`
- `OperationalProjection`
- `ProjectionItem`
- `ProjectionRegion`
- `ProjectionFocus`

Runtime responsibilities:
- Expose interactions, readables, regions, navigation, warnings, and focus.
- Rank operationally by visibility, actionability, locality, continuity confidence, and structural prominence.
- Keep labels operational and shallow.
- Serialize compactly.

Event flow:
```text
BrowserObservation
  -> optional ContinuityGraphSnapshot
  -> ProjectionService.project()
  -> OperationalProjection
  -> serializeProjection()
```

Tests:
- Actionable controls appear in interaction view.
- Text-heavy nodes appear in readable view.
- Repeated structures form shallow regions.
- Navigation view exposes route-changing controls without strategy.
- Serialized projection excludes backend node ids and selector candidate lists.

Fixtures:
- `list-region.html`
- `form-region.html`
- `static-controls.html`

Replay outputs:
- Projection snapshot can be linked from `trace.json` as `brain1ProjectionId`.
- Persistent projection artifact path: `logs/v2-runs/<runId>/projections/<projectionId>.json`.

Rollout boundary:
- v2 projection does not replace v1 graph serializer.

BrowseGent v1 integration point:
- Read only: compare projection size against `src/graph/serializer.ts` behavior if useful.
- No v1 writes.

---

## Phase 6 - Brain2 and Continuity Graph

Exact files:
- `src/v2/graph/ContinuityGraph.ts`
- `src/v2/graph/types.ts`
- `src/v2/brain2/ContinuityInterpreter.ts`
- `src/v2/brain2/transitionClassifier.ts`
- `src/v2/brain2/progressEvidence.ts`
- `tests/unit/v2/continuityGraph.test.ts`
- `tests/unit/v2/brain2Transition.test.ts`
- `tests/fixtures/v2/spa-route-transition.html`
- `tests/fixtures/v2/local-rerender.html`

Module boundary:
- Brain2 owns transition interpretation.
- Graph stores shallow continuity topology.
- Brain2 updates graph mechanically.
- Brain2 does not interpret user goals.

Interfaces/contracts:
- `ContinuityGraph.applyObservation(observation)`
- `ContinuityGraph.applyTransition(evidence)`
- `ContinuityGraph.snapshot()`
- `ContinuityInterpreter.interpret(before, after)`
- `TransitionEvidence`

Runtime responsibilities:
- Classify microstate, structural local, structural macrostate, and hard reset.
- Emit progress strength from observable change only.
- Preserve unaffected refs and regions.
- Bound graph history.

Event flow:
```text
beforeObservation + afterObservation
  -> ContinuityInterpreter.interpret()
  -> TransitionEvidence
  -> ContinuityGraph.applyTransition()
  -> GraphSnapshot
  -> ProjectionService.project(after, graphSnapshot)
```

Tests:
- Scroll-like change is microstate.
- Modal open is structural local.
- SPA route change is structural macrostate.
- Reload is hard reset.
- Graph preserves unaffected relationships.
- Graph history remains bounded after repeated transitions.

Fixtures:
- `spa-route-transition.html`
- `local-rerender.html`
- `modal-transition.html`

Replay outputs:
- `logs/v2-runs/<runId>/transitions/<transitionId>.json`
- `logs/v2-runs/<runId>/graph/<graphSnapshotId>.json`

Rollout boundary:
- Brain2 output is not planner input until Phase 7.

BrowseGent v1 integration point:
- Read only: compare ideas with `src/brain2/graphUpdater.ts`.
- No shared mutable graph state.

---

## Phase 7 - Planner I/O Bridge

Exact files:
- `src/v2/planner/PlannerInputComposer.ts`
- `src/v2/planner/PlannerOutputSchema.ts`
- `src/v2/planner/LineageCompressor.ts`
- `src/v2/planner/types.ts`
- `tests/unit/v2/plannerInputComposer.test.ts`
- `tests/unit/v2/plannerOutputSchema.test.ts`

Files to inspect before editing:
- `src/agent/prompt.ts`
- `src/agent/llm.ts`
- `src/agent/parser.ts`
- `src/agent/loop.ts`
- `src/agent/planExecutor.ts`

Module boundary:
- Composer assembles planner input.
- Composer does not execute actions.
- Output schema validates semantic intent.
- Planner remains outside runtime.

Interfaces/contracts:
- `PlannerInputComposer.compose(input)`
- `PlannerInput`
- `PlannerOutput`
- `LineageCompressor.compress(trace)`

Runtime responsibilities:
- Expose current operational state.
- Expose continuity summary.
- Expose last execution evidence.
- Expose uncertainty.
- Keep recent lineage bounded.

Event flow:
```text
OperationalProjection + TransitionEvidence + V2ToolResult + TraceLineage
  -> PlannerInputComposer.compose()
  -> PlannerInput
  -> LLM/planner
  -> PlannerOutputSchema.validate()
  -> semantic intent for runtime tool dispatch
```

Tests:
- Planner input excludes raw graph topology.
- Planner input excludes raw CDP and Playwright details.
- Planner input includes transition summary and uncertainty signals.
- Output schema rejects low-level browser mechanics in v2 mode.

Fixtures:
- Serialized projection and transition fixtures produced from prior fixture tests.

Replay outputs:
- `logs/v2-runs/<runId>/planner/<episodeId>-input.json`
- `logs/v2-runs/<runId>/planner/<episodeId>-output.json`

Rollout boundary:
- Planner bridge is opt-in and test-only until Phase 8.

BrowseGent v1 integration point:
- Read existing prompt/parser contracts.
- Do not alter v1 prompt unless v2 mode is explicitly enabled.

---

## Phase 8 - v1 Integration Adapter

Exact files:
- `src/v2/adapter/V1CompatibilityAdapter.ts`
- `src/v2/adapter/types.ts`
- `tests/integration/v2/v1Compatibility.test.ts`

Files modified only after prior phases pass:
- `src/BrowseGent.ts`
- `src/config/runtime.ts`

Module boundary:
- Adapter selects v1 or v2 path based on config.
- Adapter must not translate v2 runtime evidence into v1 hidden strategy.
- Adapter must not make semantic decisions.

Interfaces/contracts:
- `V1CompatibilityAdapter.create(config)`
- `V1CompatibilityAdapter.run(input)`
- `V1CompatibilityAdapter.extract(input)`

Runtime responsibilities:
- Keep v1 default.
- Enable v2 diagnostic path only when configured.
- Preserve public API shape.

Event flow:
```text
BrowseGent.run()
  -> loadRuntimeConfig()
  -> mode off: existing v1 path
  -> mode mvr: V1CompatibilityAdapter invokes v2 harness/planner bridge path
```

Tests:
- Default env uses v1.
- `BROWSEGENT_V2_RUNTIME=mvr` enables v2 diagnostic path.
- Public API signatures remain stable.
- Existing v1 unit tests still pass.

Fixtures:
- Use v2 fixture pages only.

Replay outputs:
- v2 mode writes v2 traces.
- v1 mode writes existing v1 logs only.

Rollout boundary:
- v2 stays opt-in.
- Any v1 regression blocks this phase.

BrowseGent v1 integration point:
- `src/BrowseGent.ts`
- `src/config/runtime.ts`

---

## Phase 9 - Failure and Dead-State Evidence

Exact files:
- `src/v2/runtime/FailureClassifier.ts`
- `src/v2/runtime/DeadStateDetector.ts`
- `src/v2/runtime/UncertaintySignals.ts`
- `tests/unit/v2/failureClassifier.test.ts`
- `tests/unit/v2/deadStateEvidence.test.ts`
- `tests/fixtures/v2/captcha-wall.html`
- `tests/fixtures/v2/no-action-state.html`

Module boundary:
- Failure classifier maps mechanical facts to evidence.
- Dead-state detector emits operational degradation.
- Planner decides semantic response.

Interfaces/contracts:
- `FailureClassifier.classify(error, context)`
- `DeadStateDetector.assess(input)`
- `UncertaintySignals.fromRuntimeState(input)`
- `DeadStateEvidence`

Runtime responsibilities:
- Classify hidden, disabled, blocked, stale, timeout, interrupted navigation, empty projection, and low-confidence continuity.
- Emit dead-state evidence only after bounded local mechanisms are exhausted.
- Never declare task failure semantically.

Event flow:
```text
V2ToolResult or ObservationFailure
  -> FailureClassifier.classify()
  -> UncertaintySignals.fromRuntimeState()
  -> DeadStateDetector.assess()
  -> operational warnings/evidence
  -> PlannerInputComposer includes evidence
```

Tests:
- Blocked overlay classified as persistent mechanical failure.
- Captcha fixture classified as environment block evidence, not task impossibility.
- Empty actionable state produces dead-state evidence after observation.
- Failure messages contain no strategic advice.

Fixtures:
- `captcha-wall.html`
- `no-action-state.html`
- `blocked-overlay.html`

Replay outputs:
- Failure evidence embedded in `trace.json`.
- Optional `logs/v2-runs/<runId>/failures/<failureId>.json`.

Rollout boundary:
- Dead-state evidence does not automatically abort tasks in MVR.

BrowseGent v1 integration point:
- None initially.
- Later mapping to v1 `failureReason` is allowed only behind v2 mode.

---

## Phase 10 - Continuity Stress Validation

Exact files:
- `tests/eval/v2/continuity_scenarios.ts`
- `tests/eval/v2/run_continuity_stress.ts`
- `tests/eval/v2/README.md`
- `tests/fixtures/v2/virtualized-list.html`
- `tests/fixtures/v2/random-rerender.html`
- `tests/fixtures/v2/delayed-load.html`
- `tests/fixtures/v2/layout-shift.html`

Module boundary:
- Eval is diagnostic infrastructure.
- Eval must not import runtime internals except public v2 harness APIs.
- Eval must not tune thresholds automatically.

Interfaces/contracts:
- `ContinuityScenario`
- `ContinuityStressResult`
- `runContinuityStress(options)`

Runtime responsibilities:
- None beyond existing public v2 harness behavior.
- Report diagnostics passively.

Event flow:
```text
load scenario
  -> harness.open(fixture)
  -> scripted instability
  -> harness.observe/click/type
  -> collect trace and diagnostics
  -> write report
```

Tests:
- Runner writes report for all scenarios.
- Failed scenarios still include trace path and failure type.
- Metrics include ref survival, wrong-ref count, transition class distribution, trace completeness, and projection size.

Fixtures:
- `virtualized-list.html`
- `random-rerender.html`
- `delayed-load.html`
- `layout-shift.html`

Replay outputs:
- `logs/v2-stress/<runId>/report.json`
- `logs/v2-stress/<runId>/scenario-results.json`
- Per-scenario `logs/v2-runs/<runId>/trace.json`

Rollout boundary:
- Stress eval is not part of normal unit test command.
- It runs manually or in a dedicated script.

BrowseGent v1 integration point:
- None.

---

## Completion Rule Per Phase

A phase is complete only when:
- All exact files listed for that phase exist.
- All listed tests exist and pass.
- The event flow can be demonstrated through test output or trace artifacts.
- Replay outputs exist where the phase requires them.
- v1 default behavior is unchanged.
- No runtime output contains semantic advice.
- No hidden planner, workflow engine, or benchmark-specific behavior was added.
