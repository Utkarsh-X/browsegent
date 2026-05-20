# BrowseGent Roadmap

## Purpose

This roadmap is the working source of truth for BrowseGent development. It exists to keep both planning and implementation focused on real failures, real system constraints, and component-by-component progress.

Use browser-use as a strong reference system, not as a template to copy.

## Development Principles

### 1. Controlled Evolution

Work one component at a time:

`design -> implement -> clean -> stabilize -> test -> move forward`

### 2. Problem-First Engineering

Every component must answer a real observed failure, weakness, or limitation.

### 3. Minimal BrowseGent-Native Solutions

Borrow the problem framing from browser-use. Keep the implementation aligned with BrowseGent's own architecture.

### 4. Validation Before Expansion

Do not build the next layer on top of an unproven layer.

## Current System Snapshot

### Latest Stabilization Update (2026-04-22)

- Landed generic form handoff guardrails:
  - submit-like interaction to read-only transition policy
  - submit-aware utility targeting to reduce ambiguous extraction clicks
- Verified with compile + unit tests and live eval:
  - `core` suite currently passes `10/10` with `gemini-3.1-flash-lite-preview`
- Remaining hard-case gap is still BU-style form-control recovery and extraction completion on complex pages (not basic looping).

### Stable Enough To Build On

- LLM call / parse / validate pipeline
- Observe -> plan -> act -> re-observe loop
- Brain1 + Brain2 integration
- Semantic graph and graph serialization
- Action System foundation
- Loop detection and behavioral nudges
- Action-effect detection
- Progress strength and plan-level progress guards
- Comparison/eval progress telemetry
- Runtime/provider configuration standardization
- Read-only DOM tools and runtime page-change guard
- Brain1 staged interaction scoring and targeted enrichment
- Deterministic targeting v1: Brain1 identity hints + guarded CDP click path with DOM fallback

### Action System Foundation Status

- `Tools Registry and Action Models`: done for phase 1
- `Action Execution Pipeline`: done for phase 1
- `Click Action`: basic implementation done, hardening still open
- `Input Action`: basic implementation done, hardening still open

### Current Highest-Value Failure Pattern

The system now mostly fails at the boundary between **target utility judgment** and **deterministic target execution**, not basic action plumbing.

That means:

- the chosen element is interactive, but not the best element
- the target is represented mainly by selector string instead of browser-native identity
- stale or ambiguous targets cannot be recovered safely enough
- click execution is not yet CDP-coordinate/hit-test grounded
- the agent clicks when it should inspect
- repeated layouts still need stronger region-level association
- same-page movement can still look more useful than it is
- queued mini-plans can stay alive after page changes that should force re-observation

## Tiered Roadmap

## Tier 1: Critical

These directly affect success rate and reliability.

### 1. Tools Registry and Action Models

Status: done for phase 1

Repo implementation:

- `/d:/BrowseGent/src/executor/types.ts`
- `/d:/BrowseGent/src/executor/catalog.ts`
- `/d:/BrowseGent/src/executor/registry.ts`
- `/d:/BrowseGent/src/executor/normalize.ts`

Keep open only for stabilization and hardening, not redesign.

### 2. Action Execution Pipeline

Status: done for phase 1

Repo implementation:

- `/d:/BrowseGent/src/executor/executor.ts`
- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`
- `/d:/BrowseGent/src/executor/adapters/playwrightAdapter.ts`

Keep open only for metrics, retry tuning, and fallback verification.

### 3. Click Action Deep Dive

Status: partial

What exists:

- basic click validation
- DOM-first execution
- retry policy
- Playwright fallback
- identity-backed target hints from Brain1 metadata
- guarded CDP click path (scroll, geometry, hit-test-lite, JS click fallback, frame guard)

What remains:

- stale identity recovery and re-resolution policy
- stronger ambiguous-selector handling before mutating clicks
- deeper safety guards for cross-frame and navigation-race paths
- richer failure classification and retry staging

Primary repo files:

- `/d:/BrowseGent/src/executor/definitions/click.ts`
- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`
- `/d:/BrowseGent/src/executor/adapters/playwrightAdapter.ts`

### 4. Input Action

Status: partial

What exists:

- input validation
- DOM-first typing
- value verification
- Playwright fallback

What remains:

- autocomplete / combobox awareness
- smarter search-field behavior
- improved mismatch handling

Primary repo files:

- `/d:/BrowseGent/src/executor/definitions/type.ts`
- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`
- `/d:/BrowseGent/src/executor/adapters/playwrightAdapter.ts`

### 5. Interactive Element Detection

Status: partial / basic

What exists:

- Brain1 classifies `input`, `trigger`, and `data`
- simple heuristics for triggers, forms, links, and goal filtering

What remains:

- stronger selector quality
- less ambiguity for repeated controls
- better signal for interactive affordances

Primary repo files:

- `/d:/BrowseGent/extension/content.ts`
- `/d:/BrowseGent/src/BrowseGent.ts`
- `/d:/BrowseGent/src/graph/serializer.ts`

### 6. Visibility Calculation

Status: partial / basic

What exists:

- simple display / visibility / opacity checks

What remains:

- interactability scoring
- viewport relevance
- occlusion / overlap awareness
- better clickability checks

Primary repo files:

- `/d:/BrowseGent/extension/content.ts`
- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`

### 7. Loop Detection and Behavioral Nudges

Status: done for phase 1

What exists:

- executed-action fingerprint detection
- graph stagnation detection
- prompt-level warning injection
- conservative `no_progress_detected` exit

What remains:

- tuning thresholds with more live eval evidence
- richer loop-aware traces in comparison output

Primary repo files:

- `/d:/BrowseGent/src/agent/loop.ts`
- `/d:/BrowseGent/src/agent/planExecutor.ts`
- `/d:/BrowseGent/src/agent/loopDetector.ts`

## Tier 2: Important

Build after Tier 1 is meaningfully stabilized.

### 1. Navigation and Tab Control

Purpose:

- wrong-page recovery
- navigation handling
- tab confusion reduction

### 2. Browser State Summary

Purpose:

- clearer state compression for the planner
- easier page expectation checks
- better planner context after actions

### 3. Error Recovery and Resilience

Purpose:

- classify and react to failures intelligently
- support retry vs replan vs fail-fast

### 4. Agent State and History

Purpose:

- make prior attempts useful
- improve repeated-pattern avoidance
- support later loop intelligence and replanning

### 5. Runtime Watchers and Signals

Purpose:

- popup/dialog handling
- download detection
- browser-health monitoring
- navigation invalidation and runtime observability

## Tier 3: Later

Ignore until Tier 1 and key Tier 2 pieces are stable.

- testing frameworks expansion
- full session lifecycle systems
- advanced prompt systems
- memory systems

## Phase Plan

## Phase 6A: Loop Intelligence

Status: done for phase 1

Goal:

Stop successful-but-useless action loops and wasted step budgets.

Tasks:

- add action fingerprinting
- detect repeated action sequences
- detect unchanged graph / unchanged meaningful state
- surface `no_progress` / dead-pattern outcomes
- short-circuit max-step waste

Load these browser-use docs for this phase:

- `Agent Core and Execution Loop`
- `Loop Detection and Behavioral Nudges`
- `Agent State and History Management`
- `Browser State Summary` (optional, if state compression becomes relevant)

Detailed notes for this phase:

- see [agent-system-analysis.md](./agent-system-analysis.md)

BrowseGent repo focus:

- `/d:/BrowseGent/src/agent/loop.ts`
- `/d:/BrowseGent/src/agent/planExecutor.ts`
- `/d:/BrowseGent/src/graph/serializer.ts`

Acceptance criteria:

- repeated useless action patterns are detected before max steps
- prompt nudges appear only when needed
- no regression on already-passing tasks

## Phase 6B: DOM Understanding Hardening

Status: phase 1 completed

Goal:

Improve target quality before touching broader navigation/recovery work.

Tasks:

- strengthen interactive element detection
- improve selector specificity
- add stronger visibility / interactability checks
- reduce false-positive "successful" interactions

Load these browser-use docs for this phase:

- `DOM Processing Engine`
- `Interactive Element Detection`
- `Visibility Calculation and Coordinate Transformation`
- `DOM Tree Construction`
- `DOM Serialization Pipeline`
- `Browser State Summary` (for lighter future summary fields only)

BrowseGent repo focus:

- `/d:/BrowseGent/extension/content.ts`
- `/d:/BrowseGent/src/brain1/types.ts`
- `/d:/BrowseGent/src/BrowseGent.ts`
- `/d:/BrowseGent/src/graph/serializer.ts`
- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`

Acceptance criteria:

- fewer ambiguous selectors
- better success on interactive tasks
- clearer failure reasons when interaction should not proceed
- Brain1 emits stronger interaction and selector signals

Completed phase-1 outcomes:

- staged Brain1 scoring pipeline
- targeted enrichment
- local region rescan hook
- richer internal Brain1 metadata
- compact graph preserved

Detailed notes for this phase:

- see [dom-and-event-analysis.md](./dom-and-event-analysis.md)

## Phase 6C: Target Utility and Read Tools

Status: partially implemented / no longer the immediate next step

Goal:

Teach the system which element is worth acting on, reduce unnecessary clicks by adding cheap read-only DOM tools, and stop stale queued plans after page changes.

Completed tasks:

- read-only DOM tools such as page search / element finding / counting / region inspection
- runtime page-change guard for stale queued plan steps

Deferred tasks:

- page archetype classification
- soft action-intent scoring for interactive candidates
- stronger region association for repeated layouts

Current correction:

Browser-use Phase 2 and Agent Browser reference analysis suggest that page archetype classification should not be the next hard layer. The next safer architecture slice is deterministic targeting: internal element identity plus CDP-grade click execution. Page/region intent should return later as annotation and ranking metadata, not hard filtering.

Load these browser-use docs for this phase:

- `Interactive Element Detection`
- `DOM Serialization Pipeline`
- `Browser State Summary`
- `search_page`, `find_elements`, and extract-related guidance from the action docs

Acceptance criteria:

- fewer clicks on extractive tasks
- queued plan steps stop after real page changes
- better ranking of result/content links over navigation chrome
- better first-card / repeated-layout extraction
- improved generalization without site-specific heuristics

Detailed notes for this phase:

- see [target-selection-and-read-tools-plan.md](./target-selection-and-read-tools-plan.md)
- see [system-gap-analysis-and-stabilization-roadmap.md](./system-gap-analysis-and-stabilization-roadmap.md)

## Phase 6D: Intent-aware Progress Intelligence

Status: after 6C foundations are in

Goal:

Judge whether an action helped the task, not just whether it changed the page mechanically.

Tasks:

- tie progress expectations to soft intent signals
- treat weak same-page jumps as weak progress
- treat repeated identical read-only observations as no-progress over time
- strengthen post-action semantic verification without adding prompt bloat

Acceptance criteria:

- scroll/hash/focus changes no longer masquerade as strong progress
- repeated inspection loops are detected earlier
- progress control stays conservative and general

## Phase 6E: Action Hardening

Status: after 6D

Goal:

Make click and input robust on dynamic, real-world pages.

Tasks:

- deepen click safety and target resolution
- improve input handling for search/autocomplete fields
- tune retry and fallback behavior with real eval evidence

Load these browser-use docs for this phase:

- `Click Action Deep Dive`
- `Input Action and Autocomplete Detection`
- `Action Execution Pipeline`

Acceptance criteria:

- retry/fallback behavior is explainable from logs
- action failures are classified meaningfully
- action success paths remain fast

## Phase 6F: Stabilization and A/B Evaluation

Status: active discipline, not the next feature phase

Goal:

Measure behavior changes conservatively before treating fixed-site evals as product truth.

Tasks:

- keep progress telemetry visible in eval output
- compare `telemetry-only` vs `enforced` progress-guard behavior
- use scenario-style tests to validate invariants
- use the site suite as a canary, not the optimization target
- maintain a custom benchmark runner that can sample encrypted BU Bench tasks and curated JSON task files
- treat BU subset runs as capability/completion probes unless strict ground-truth validators are provided

BrowseGent repo focus:

- `/d:/BrowseGent/src/config/runtime.ts`
- `/d:/BrowseGent/src/agent/planExecutor.ts`
- `/d:/BrowseGent/tests/eval/run_comparison.ts`
- `/d:/BrowseGent/tests/eval/run_progress_ab.ts`
- `/d:/BrowseGent/tests/unit/progressScenarios.test.ts`

Acceptance criteria:

- baseline vs variant can be run without code edits
- progress metrics are visible per task and per run
- changes are judged on behavior deltas, not pass rate alone
- no site-specific heuristics are introduced to game the suite

## Phase 7: Navigation, Recovery, and State

Status: next tier

Goal:

Handle wrong page, navigation confusion, and smarter recovery.

Tasks:

- page expectation checks
- navigation and tab-awareness
- error recovery decisions
- better state/history usage

Load these browser-use docs for this phase:

- `Navigation and Tab Control`
- `Browser State Summary`
- `Error Recovery and Resilience`
- `Agent State and History Management`
- `BrowserSession Lifecycle` only if session-level behavior becomes the blocker

Acceptance criteria:

- wrong-page situations are detected earlier
- recovery choices are more deliberate
- fewer tasks fail due to navigation confusion

## Phase 7B: Runtime Watchers and Signals

Status: after 7

Goal:

Improve browser-runtime robustness without importing a full event bus architecture.

Tasks:

- add lightweight popup/dialog monitoring
- add download monitoring
- add browser/network health monitoring
- add typed runtime signals and correlated logging

Load these browser-use docs for this phase:

- `Event Driven Architecture`
- `Event System Overview`
- `Event Types Reference`
- `Watchdog Pattern and Base Classes`
- `Core Watchdog Implementations`

Acceptance criteria:

- runtime disruptions are surfaced clearly
- popup/download handling is not smeared across unrelated code
- execution traces include browser-runtime signals

## Browser-use Intake Protocol

For each component:

1. Identify the BrowseGent failure or limitation first.
2. Load only the browser-use docs relevant to that component.
3. Extract:
   - what problem browser-use is solving
   - what assumptions its solution depends on
   - what parts map to BrowseGent
   - what parts do not
4. Design the smallest BrowseGent-native version.
5. Implement and validate against the real failure.

Do not load large unrelated topic groups when the current component is narrow.

## Validation Protocol

Always run:

```powershell
npx tsc --noEmit
npm run test:unit
```

For runtime behavior:

1. Run targeted live scenarios first.
2. Inspect logs for:
   - repeated actions
   - retries
   - fallback usage
   - progress strength
   - no-progress aborts
   - terminal error codes
3. Run broader comparison only after targeted traces look sane.
4. For progress-control changes, run:

```powershell
npm run comparison:ab
```

and compare `telemetry-only` vs `enforced` before changing thresholds.

## Immediate Sub-Iteration (Completed in Current Iteration)

This sub-iteration is focused on two cross-site reliability gaps surfaced by BU-bench style tasks:

1. **Custom-component input reliability (Type Action Hardening)**

- Problem:
  - repeated failures on host elements that are focusable but not directly fillable (`<custom-input>` patterns, shadow descendants, role-based editable hosts)
- Implementation direction:
  - DOM-first editable-descendant resolution with open shadow-root traversal
  - host-value fallback (`el.value`) when available
  - readback alignment so type verification can pass on custom hosts
  - keyboard fallback path in Playwright adapter when direct value-setting cannot be applied

2. **Selector failure memory for repeated type/click dead paths**

- Problem:
  - repeated retries on the same stale/non-fillable selector before true strategy change
- Implementation direction:
  - treat repeated non-fillable `type` failures as stale-selector churn
  - trigger early plan re-observe/replan for repeated same-selector terminal failures
  - keep this as generic selector-family behavior, not site-specific heuristics

Exit criteria for this sub-iteration:

- fewer repeated `type` retries on unsupported host selectors
- earlier replan on repeated selector failures
- no regression on direct-answer tasks and already-stable click flows

Observed status:

- Type helper runtime bug (`__name is not defined`) was removed by switching the helper to raw page-expression scripts.
- Repeated interaction churn now triggers `utility_guard:read_after_interaction_churn` and avoids blindly continuing click/type loops.
- BU targeted runs still show a major gap: form workflows can loop on stale submit/selectors and fail to transition into reliable result extraction.

## Current Next Step

The next immediate product-layer step is:

**Form Workflow Handoff Hardening: search/submit selector adaptation + interaction-to-read transition policy**

Reason:

- deterministic targeting and type fallback are in place, but BU-style form tasks still fail at submit/control targeting (`button[type='submit']`, variant search buttons, dynamic suggestion controls).
- current planner can repeatedly fill fields without reliably switching to result extraction on the same page.
- this is now the dominant non-environment planning failure in harder BU-style tasks.

Risk notes:

- do not hardcode selector lists per site.
- keep all improvements selector-family/role/state based.
- preserve current no-progress guard conservatism; add form-specific signals as ranking or guard hints only.

Implementation focus:

1. Add form-submit archetype hints in Brain1 metadata (input/search + nearby trigger association).
2. Add generic submit-target adaptation in planning guard path (same form region, equivalent control family).
3. Add explicit interaction-to-read handoff guard when extraction goals repeat form fills/submits without durable result evidence.
4. Keep readOutcome strict for region summaries to avoid false final answers.

The detailed working plan remains:

- [system-gap-analysis-and-stabilization-roadmap.md](./system-gap-analysis-and-stabilization-roadmap.md)
- [target-selection-and-read-tools-plan.md](./target-selection-and-read-tools-plan.md) as historical context.
