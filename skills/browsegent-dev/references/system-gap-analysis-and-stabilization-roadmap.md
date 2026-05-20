# BrowseGent System Gap Analysis and Stabilization Roadmap

## Purpose

This file is the current architecture guide for evolving BrowseGent toward a production-grade browsing agent.

It is intentionally not a rewrite plan. BrowseGent should keep its own core shape:

- Brain1 produces compact semantic snapshots.
- Brain2 captures mutations and causal hints.
- The graph remains compact and LLM-facing.
- The executor remains a controlled tool/action pipeline.

The goal is to identify the weakest seams in the current implementation, remove or de-emphasize brittle ideas, and adopt the smallest high-leverage ideas from browser-use and Agent Browser where they solve BrowseGent's actual problems.

## Sources Considered

BrowseGent implementation:

- `src/BrowseGent.ts`
- `src/brain1/service.ts`
- `src/brain1/types.ts`
- `extension/content.ts`
- `src/executor/`
- `src/agent/loop.ts`
- `src/agent/planExecutor.ts`
- `src/graph/serializer.ts`
- `tests/unit/`
- `tests/eval/`

Browser-use reference answers:

- `discussion/browser-use-Questions/Phase-1questions/`
- `discussion/browser-use-Questions/Phase-2questions/`

Agent Browser reference answers:

- `discussion/phase1-questions/`
- `discussion/phase2-questions/`
- `discussion/Apr 11, 2026 11-01-58 AM Markdown Content.md`

## Current BrowseGent Baseline

The system already has useful foundations:

- LLM call, parse, validation, and provider configuration.
- Observe -> plan -> act -> re-observe loop.
- Brain1 semantic snapshot and Brain2 mutation capture.
- Compact graph serialization.
- Action registry, tool catalog, and executor pipeline.
- DOM-first execution with Playwright fallback.
- Read-only DOM tools: `search_page`, `find_elements`, `count_elements`, `inspect_region`.
- Progress strength, repeated no-progress guards, and loop detector.
- Brain1 interaction scoring and targeted enrichment.
- Deterministic targeting v1: identity metadata and target hints (`refId`, `backendNodeId`, `stableHash`, `nth`).
- Guarded CDP click execution path behind `BROWSEGENT_CDP_CLICK_ENABLED`.
- Basic comparison and A/B evaluation scripts.

This is enough to build on. It is not enough to treat the system as production-stable.

The last 10/10 comparison result is a useful canary, not proof of broad reliability.

## Core Diagnosis

BrowseGent's current weakest point is not only "which element is worth clicking."

The deeper weak seam is:

**BrowseGent still uses selector strings as the main execution identity.**

That creates several downstream limits:

- No reliable internal mapping from an LLM-visible target to a browser-native element identity.
- No backend-node based click path.
- Weak stale element recovery.
- Weak new-element detection.
- Limited ability to separate "semantic target" from "physical browser node."
- Better Brain1 scoring can still end in weak execution if the selector resolves differently later.

This is why the next step should not be a broad "DOM improvement" phase. It should be a deterministic targeting phase.

## Weakness Ranking

### 1. Missing Element Identity Layer

Status: partially addressed (phase 1 landed).

Current behavior:

- Brain1 emits `sel` selectors.
- The graph exposes selectors to the LLM.
- The executor receives selectors and runs DOM or Playwright actions.
- There is no first-class `ref -> backendNodeId -> frame/session` mapping.

Why this is weak:

- CSS selectors are not stable identities.
- A selector can match a different element after a re-render.
- A selector can match multiple elements if generation/ranking was imperfect.
- The executor cannot use `DOM.getContentQuads` or `Input.dispatchMouseEvent` directly without resolving a browser-native node.
- New-element detection cannot be robust without identity and stable hashes.

What to adopt:

- From Agent Browser: compact refs for the LLM, internal `ref -> backend_node_id` mapping.
- From browser-use: `backendNodeId` as the core internal join key across DOM, accessibility, and layout sources.

BrowseGent-native design:

- Keep selectors for compatibility during migration.
- Add internal optional identity metadata to Brain1 nodes.
- Use compact refs later if and only if the identity store is proven.
- Keep backend node IDs out of the prompt unless a deliberate ref migration is done.

### 2. Click Execution Is Too Selector/Framework Dependent

Status: partially addressed (phase 2 v1 landed).

Current behavior:

- DOM adapter queries the selector, checks simple CSS conditions, scrolls, and calls `el.click()`.
- Playwright adapter waits for selector and uses `locator.click()`.
- Brain1 enrichment does `elementFromPoint` style inspection for ranking, but the click path itself does not use a CDP coordinate pipeline.

Why this is weak:

- DOM `.click()` can bypass real pointer semantics.
- Playwright locator click is better than DOM click, but it is still selector-driven and does not give us full identity/control.
- No deterministic geometry cascade exists at execution time.
- No explicit center-point hit test exists in the execution path.
- No direct handling of stale `backendNodeId` exists because no identity layer exists.

What to adopt:

- From browser-use: `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `DOM.getBoxModel`, `Runtime.callFunctionOn(getBoundingClientRect)`, `elementFromPoint`, CDP mouse events, JS click fallback.
- From Agent Browser: coordinate-based CDP execution and explicit ref invalidation.

BrowseGent-native design:

- Add a CDP click path behind a rollout flag.
- Resolve target by internal identity first, then selector fallback.
- Use live `elementFromPoint` hit testing before coordinate click.
- Use JS click fallback only when hit testing or geometry fails.
- Keep Playwright fallback while CDP execution is being validated.

### 3. Brain1 Perception Is Better But Still DOM-First

Status: important.

Current behavior:

- Brain1 is a content-script DOM scan with strong heuristics.
- Brain1 service can do targeted enrichment using Playwright/CDP for selected candidates.
- It does not yet have a minimal merged DOM/AX/DOMSnapshot identity model.

Why this is weak:

- It misses some accessibility-tree semantics.
- Bounds/style data is local JS-derived, not joined with a broader browser snapshot model.
- It cannot robustly join layout, AX role/name, and DOM identity.
- It cannot produce high-quality stable identity hashes equivalent to browser-use without more source data.

What to adopt:

- From browser-use: minimal EnhancedDOMTreeNode fields, but not full architecture.
- Minimum fields: `backendNodeId`, tag, selected attributes, AX role/name when available, bounds, display/visibility/opacity/cursor/overflow, frame/session identity.
- Skip expensive full paint-order filtering for now.

BrowseGent-native design:

- Add targeted CDP identity/enrichment for emitted Brain1 candidates first.
- Only consider full DOMSnapshot capture after the targeted resolver proves insufficient.
- Keep Brain1 compact and selector/action-friendly.

### 4. New Element and Stale Element Semantics Are Too Weak

Status: important.

Current behavior:

- Brain2 records mutation deltas and cause chains.
- Loop/progress logic detects repeated stagnant action patterns.
- There is no robust `is_new` model based on backend node identity and stable semantic hashes.

Why this is weak:

- React/Vue re-renders can recreate nodes with the same meaning.
- A backend node diff alone would over-mark "new" elements.
- A selector-only diff can miss that the physical target changed underneath the same selector.

What to adopt:

- From browser-use: `backendNodeId` diff as the fast candidate-new gate.
- From browser-use history replay: stable hash to suppress framework re-render false positives.
- From Agent Browser: explicit ref invalidation on known page changes.

BrowseGent-native design:

- Add `stableHash` to internal Brain1 identity metadata.
- Treat `new` as a hint, not a hard planner instruction.
- Reset identity generations on navigation and meaningful page replacement.

### 5. Region Utility Is Under-modeled

Status: important, but not first.

Current behavior:

- Brain1 has `regionSelector`.
- Brain1 service supports local region rescans.
- The graph still mostly ranks individual nodes, not region relationships.

Why this is weak:

- Listing pages require relationships like title/company/location/price within the same card.
- Docs/article pages require distinguishing content links from nav/sidebar/TOC links.
- Product/job pages often have repeated controls with similar text.

What to adopt:

- From browser-use Phase 2 guidance: annotate structure, do not filter aggressively.
- High-value annotations: landmark region, heading association, repeated sibling group with N >= 3 guard, form grouping.

What not to adopt now:

- Hard page archetype classification.
- Hard nav/header/footer penalties.
- Price/title proximity rules as primary ranking.
- Visual-card grouping from paint-order or screenshot data.

BrowseGent-native design:

- Add internal region annotations and use them in ranking.
- Keep the LLM-facing graph compact.
- Do not remove candidates only because they are in nav/sidebar/footer.

### 6. Read Tools Exist, But Read-State Discipline Can Improve

Status: useful cleanup, not the main blocker.

Current behavior:

- Read tools are implemented and serialized as compact recent observations.
- Prompt rules tell the LLM to prefer them for lookup/count/inspect tasks.

Remaining weakness:

- There is not a dedicated one-step `<read_state>` equivalent.
- Full read outputs are carried as action values before serializer truncation.
- Tool result indices from `find_elements` must stay clearly separate from clickable/executable refs.

What to adopt:

- From browser-use: full read output should be shown once, compact summary should persist.
- Tool descriptions should explicitly say read tools are non-mutating and should not be used as click-target ref sources.

BrowseGent-native design:

- Keep compact `r` observations.
- Optionally add ephemeral read warnings/results to the next prompt only.
- Never let `find_elements` indices become executable target IDs.

### 7. Progress Intelligence Exists But Is Still Mostly Mechanical

Status: good foundation, future refinement.

Current behavior:

- Action effects are graded as strong, weak, or none.
- Repeated weak/no-effect actions can abort.
- Loop detector combines action repetition with graph stagnation.

Remaining weakness:

- Progress is not yet strongly tied to target intent or expected outcome.
- Hash-only and scroll-only changes are treated cautiously, but not semantically.
- The system can still accept a technically strong DOM change that is irrelevant to the task.

What to adopt:

- From browser-use: planner-level nudges and repeated-action awareness.
- From Agent Browser: explicit observe/act boundaries and pull-based state refresh.

BrowseGent-native design:

- Do not add a large MessageManager yet.
- Add expected-effect hints after identity and CDP click are stable.
- Track whether an action made task-relevant progress, not just browser-state progress.

### 8. Evaluation Is Still Too Small

Status: process weakness.

Current behavior:

- Unit tests cover key new components.
- Comparison suite is useful but small.
- A/B progress runner exists.

Why this is weak:

- Ten live sites cannot represent production browsing.
- Site-specific success can hide general brittleness.
- Fixed-site improvement can accidentally overfit.

What to adopt:

- From mature agent systems: behavior scenarios and invariants, not just site pass rate.
- From Agent Browser profiling notes: measure CDP round-trip cost and avoid sequential CDP fan-out.

BrowseGent-native design:

- Build scenario tests around behaviors.
- Keep site evals as canaries.
- Add targeted browser-level tests for identity, stale refs, occlusion, repeated-card structure, and one-step read state.

### 9. Type Action on Custom Hosts Is Underpowered

Status: active reliability gap.

Current behavior:

- `type` assumes the selected node is directly fillable.
- Custom host controls (`<custom-input>` style wrappers, role-based hosts, shadow-descendant editable fields) can be focusable but not directly writable.
- Repeated selector retries can continue even after deterministic non-fillable failures.

Why this is weak:

- Modern production sites frequently wrap real inputs in custom elements.
- Correct target selection can still fail at write execution if editable descendant resolution is missing.
- Repeated `execution_error` / `not_interactable` retries consume budget without strategy change.

What to adopt:

- From browser-use:
  - resilient write fallback behavior for non-native hosts
  - event dispatch after writes for framework compatibility
  - selector-failure memory to avoid repeated dead paths

BrowseGent-native design:

- keep one `type` action contract
- add editable-descendant resolution with open shadow-root traversal in adapters
- add host `value` fallback where present
- align readback with the same fallback path so verification remains deterministic
- trigger early replan for repeated same-selector non-fillable type failures

## What To Remove Or De-emphasize

Do not delete working code immediately, but stop using these as primary direction:

- Page archetype classification as the next phase.
- Hard labels like `result_link` or `primary_navigation` as deterministic truth.
- Selector-only execution as the final target architecture.
- Paint-order filtering in the first actionability phase.
- Full EventBus/watchdog framework in the near term.
- Full BrowserStateSummary/message-manager/memory architecture in the near term.
- Full-page CDP listener scans for every snapshot.
- Heavy screenshot/highlight system before identity, bounds, and cleanup discipline exist.
- Any site-specific heuristic that exists only to win the current comparison suite.

## Adopted Principles

### From browser-use

- A browser agent needs a fused element model, not raw DOM text alone.
- `backendNodeId` is the right browser-native identity key.
- Click action should be physically grounded in geometry and hit testing.
- `elementFromPoint` is safer for v1 occlusion handling than paint-order filtering.
- Read tools reduce unnecessary page mutation.
- New-element marking needs stable semantic hashes to avoid re-render noise.

### From Agent Browser

- Compact refs are better for the LLM than raw backend node IDs.
- Snapshot/ref maps should be explicit and invalidated on known page changes.
- Execution should compute coordinates fresh, not cache coordinates.
- CDP round trips dominate latency, so avoid broad sequential CDP work.
- Pull-based observation is a valid discipline for LLM agents.

### From BrowseGent

- Brain1/Brain2 is still a useful architecture.
- Compact graph serialization is a real advantage.
- Progress guards are a useful safety layer.
- The executor registry is the correct place to evolve action semantics.
- Changes should be feature-flagged and A/B testable.

## Revised Implementation Roadmap

### Deterministic Targeting Discipline

Until Phase 2 is stable, freeze speculative Brain1/utility work.

This does not mean Brain1 is unimportant. It means the current implementation risk is lower in Brain1 than in target identity and execution. The active slice should stay narrow:

- identity
- execution
- validation
- retry/re-observe behavior
- scenario guards

Do not add page archetype, advanced region intelligence, vision, full DOMSnapshot, or progress-intent upgrades during the identity/CDP click slice unless a test proves they are a blocker.

### Phase 0: Baseline Lock and Roadmap Cleanup

Status: do first.

Tasks:

- Treat the latest 10/10 comparison as a canary baseline, not proof.
- Update stale roadmap entries that still say read tools are the next step.
- Add behavior scenarios for identity and actionability before changing execution.
- Pull at least the regression-guard scenario into every phase gate from Phase 1 onward.

Acceptance criteria:

- The next phase is explicitly `Deterministic Targeting`.
- No stale doc says read tools/page-change guard are still the immediate target.
- Existing unit tests and comparison scripts still run.
- Every deterministic-targeting phase has a small scenario guard, not only end-of-roadmap eval.

### Phase 1: Element Identity Substrate

Status: completed.

Goal:

Add an internal mapping from compact/selector targets to browser-native element identity.

Proposed files:

- `src/brain1/types.ts`
- `src/brain1/service.ts`
- `src/executor/`
- new `src/identity/` or `src/browser/elementIdentity.ts`

Implementation shape:

- Add optional internal metadata fields:
  - `refId`
  - `backendNodeId`
  - `frameId`
  - `sessionId`
  - `stableHash`
  - `role`
  - `name`
  - `nth`
  - `identityGeneration`
- Keep `sel` for compatibility.
- Resolve identity for emitted Brain1 candidates, not every DOM node.
- Invalidate identity generation on navigation and major page replacement.
- Do not expose raw backend node IDs to the LLM.

Stable hash v1:

- Build from normalized tag, role, accessible name or primary text, stable selected attributes, nearest stable ancestor path, and sibling ordinal within the stable parent group.
- Strip dynamic class/id fragments that look generated, hover/focus/active, or animation-state related.
- Do not use geometry, timestamps, action history, or transient value-only text as the whole identity.
- If stable hash candidates are duplicated in a region, treat recovery as ambiguous and re-observe/replan instead of guessing.

Tests:

- Resolve identity for normal button/link/input candidates.
- Identity map invalidates on URL change.
- Selector fallback still works if CDP identity cannot be resolved.
- Stable hash remains same across harmless class churn.
- Stable hash changes when role/name/task-visible text changes meaningfully.
- Duplicate role/name candidates are not guessed as unique.
- Phase regression guard: normal direct-answer and existing read-tool flows remain unchanged.

Risks:

- Over-resolving candidates can add CDP latency.
- Stale identity can cause wrong actions if invalidation is weak.
- Duplicate candidates can make role/name fallback unsafe.

Mitigation:

- Resolve only top ranked actionable candidates first.
- Treat ambiguous recovery as re-observe/replan, not guess.
- Feature-flag identity-backed execution.

### Phase 2: CDP Click Pipeline

Status: v1 completed, hardening in progress.

Goal:

Make click execution physically grounded and less selector-dependent.

Proposed files:

- `src/executor/browserAdapter.ts`
- `src/executor/adapters/playwrightAdapter.ts`
- possibly new `src/executor/adapters/cdpClick.ts`
- `src/executor/definitions/click.ts`

Execution cascade:

- Resolve target identity.
- `DOM.scrollIntoViewIfNeeded`.
- v1: `DOM.getBoxModel`.
- v1: compute a center point and dispatch CDP mouse events:
  - `mouseMoved`
  - `mousePressed`
  - `mouseReleased`
- v1: if geometry fails, re-observe/replan or use controlled selector fallback only when unambiguous.
- v2: add `DOM.getContentQuads`.
- v2: add `Runtime.callFunctionOn(getBoundingClientRect)`.
- v2: add `document.elementFromPoint` hit test and occlusion-aware JS fallback.
- Keep Playwright fallback during rollout.
- Implement unsupported-frame failure classification early, not as a cleanup item.
- Add a structured retry policy before broad rollout:
  - attempt identity-backed CDP click
  - attempt scroll and fresh geometry
  - attempt safe fallback identity/selector path only if unique
  - re-observe/replan on ambiguity or unsupported frame

Tests:

- Visible button clicks by CDP path.
- Occluded center falls back to JS click or fails explainably.
- Stale target triggers re-resolution or replan, not silent wrong click.
- Timeout around mouse events prevents hangs.
- DOM/Playwright fallback remains available when CDP is unavailable.
- Unsupported frame returns a clear failure code instead of a silent selector fallback.
- Phase regression guard: direct-answer and non-click flows remain unchanged.

Risks:

- Incorrect coordinate space when scroll/frame handling is wrong.
- Dialogs or overlays can hang mouse event calls without timeouts.
- Cross-origin iframes add frame/session routing complexity.

Mitigation:

- Start top-frame only.
- Add explicit unsupported-frame failure code.
- Add timeouts around CDP mouse events.
- Do not remove existing DOM/Playwright paths until live tests prove safety.

### Phase 3: Minimal CDP Perception Enrichment

Status: after identity and click path.

Goal:

Improve Brain1 target quality without importing browser-use's full DOM engine.

Implementation shape:

- Targeted candidate enrichment first.
- Optional minimal DOMSnapshot only if targeted enrichment is insufficient.
- Capture only low-risk style/layout fields:
  - `display`
  - `visibility`
  - `opacity`
  - `cursor`
  - `overflow`
  - `overflow-x`
  - `overflow-y`
  - DOM rects
- Add AX role/name where available.
- Skip `paint_order` v1.
- Skip full page JS click listener scans v1.

Tests:

- AX role/name improves candidate confidence.
- Cursor pointer improves generic interactive wrappers.
- Hidden/disabled candidates are downgraded.
- Shadow/open-root behavior does not regress.
- Serialized graph token growth stays controlled.

Risks:

- DOMSnapshot can be heavy on large pages.
- Additional CDP calls can slow remote-browser use.

Mitigation:

- Prefer targeted enrichment.
- Batch CDP operations where possible.
- Feature flag any broader DOMSnapshot path.

### Phase 4: New Element and Stale Element Semantics

Status: after identity exists.

Goal:

Make post-action perception more meaningful without flooding the prompt.

Implementation shape:

- Track previous identity set per page generation.
- Candidate new if backend node ID is absent from previous generation.
- Suppress if stable hash already existed.
- Mark `isNew` as internal metadata or compact prompt marker only after validation.
- Treat stale backend node failures as re-observe/replan unless exact/stable hash recovery is safe.

Tests:

- React-like remount with same stable hash is not marked as meaningfully new.
- New modal button is marked as new.
- Changed role/name at same selector becomes semantically new.
- Ambiguous stale recovery does not click a guessed element.

Risks:

- False `new` floods can distract the LLM.
- Over-suppression can hide real modal/dropdown changes.

Mitigation:

- Use backend ID plus stable hash.
- Log identity transitions during evaluation.

### Phase 5: Structural Utility Annotations

Status: after deterministic targeting stabilizes.

Goal:

Help Brain1 rank "what matters" without brittle site rules.

Implementation shape:

- Add landmark annotations:
  - `main`
  - `nav`
  - `header`
  - `footer`
  - `aside`
  - `form`
- Add heading association.
- Add repeated sibling group detection with N >= 3.
- Add form grouping.
- Keep annotations internal first.
- Use annotations for ranking, not filtering.

Tests:

- Repeated job/product cards preserve first-card associations.
- Docs/article pages do not over-prioritize TOC/sidebar links.
- Header/footer links remain available when the goal requires navigation.
- No site-specific keyword rules are introduced.

Risks:

- Hard region penalties can hide needed navigation.
- Grouping can create false relationships.

Mitigation:

- Annotate, do not filter.
- Use structural signals as ranking tiebreakers, not primary truth.

### Phase 6: Read-State and Prompt Discipline Cleanup

Status: opportunistic cleanup.

Goal:

Ensure read tools reduce mutation without confusing target identity.

Implementation shape:

- Add one-step read-state injection for larger read outputs if needed.
- Keep compact `r` observations in serialized graph.
- Update tool descriptions to state that `find_elements` indices are not click targets.
- Prevent read tools from inventing new executable selectors outside the graph unless explicitly promoted by Brain1.

Tests:

- Read output appears once when configured as ephemeral.
- Compact read summary persists.
- LLM prompt/tool schema clearly separates read indices from action refs/selectors.

### Phase 7: Progress Intelligence Upgrade

Status: after identity/click/structure.

Goal:

Judge whether actions worked in a task-relevant way.

Implementation shape:

- Add expected-effect hints from target metadata:
  - navigation-like target expects URL/content change.
  - search trigger expects input value plus result-region change.
  - dismiss target expects overlay/region disappearance.
  - same-page anchor expects hash/scroll only and should stay weak unless goal needs section navigation.
- Keep no-progress guards conservative.
- Do not force done from progress logic.

Tests:

- Same-page anchor loops stay weak.
- Valid navigation remains strong.
- Repeated same-value reads stop.
- Dynamic content that actually changes task-relevant data is accepted.

### Phase 8: Evaluation Framework Expansion

Status: continuous, but start before broad tuning.

Goal:

Avoid overfitting to a small fixed website suite.

Scenario groups:

- Static direct-answer page.
- Search form with repeated search controls.
- Listing card extraction.
- Dynamic modal/dropdown.
- Occluded target / overlay.
- Stale ref after React-style remount.
- Same-page anchor / table-of-contents loop.
- Read-only lookup/count task.
- Cross-frame unsupported case.
- Normal passing task for regression guard.

Metrics:

- Success rate.
- Steps to answer.
- LLM calls.
- CDP calls per action.
- Read-vs-click ratio.
- Fallback path counts.
- No-progress aborts.
- Stale identity recoveries.
- Silent wrong-click count where detectable.

Decision rule:

- Keep a change only if it improves the targeted behavior without materially harming direct-answer and normal navigation tasks.
- Prefer telemetry-only rollout before enforcing hard behavior.

## Final Recommended Next Move

The immediate next implementation should be:

**Form Workflow Handoff Hardening: submit-control adaptation + interaction-to-read transition policy**

This is the right next step because:

- identity substrate, loop guards, and selector stale-memory are already in place.
- harder BU-style failures now cluster around search/form workflows that repeatedly fill fields but miss the correct submit/result transition.
- targeted runs show selector mismatch churn on submit controls (`not_found`, `not_interactable`, repeated re-entry) and weak extraction handoff.
- this can be addressed with generic control-family and form-region logic, without site-specific rules.

Do not jump to broad page archetype classification or full event-bus architecture now. Keep the next slice narrow and behavior-driven.

Do not start with full DOMSnapshot/paint-order/browser-state architecture for this issue. It is too heavy for the current seam.

### Status (2026-04-22)

This slice is now partially landed:

- interaction-to-read transition guard is implemented for submit-like flows
- submit-aware targeting is integrated into target utility checks
- loop prompt warnings include submit-transition no-progress guidance

Validated outcome:

- core suite run (`gemini-3.1-flash-lite-preview`) currently passes `10/10`
- BU hard tasks still expose a remaining seam: submit-control recovery and post-submit extraction completion on noisy form/search pages

Next recommended implementation slice:

**Submit Control Recovery and Read Extraction Completion**

- when submit-like controls repeatedly fail (`not_found` / `not_interactable`) after form fill, force read-only discovery of actionable controls before more typing
- prioritize region-scoped read extraction immediately after successful submit-like interactions
- keep policies generic and selector-family-based (no site heuristics)

## Working Rule

For every future component:

1. Identify the BrowseGent-specific weakness.
2. Confirm whether browser-use or Agent Browser has a proven primitive for that weakness.
3. Adapt the primitive into BrowseGent's architecture.
4. Keep it feature-flagged or reversible where risk is non-trivial.
5. Add behavior tests before trusting a fixed-site pass rate.
6. Run TypeScript and unit tests before live comparison.
