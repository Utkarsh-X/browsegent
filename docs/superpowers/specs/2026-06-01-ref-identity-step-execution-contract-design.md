# BrowseGent V2 Ref Identity and Step Execution Contract Design

Date: 2026-06-01

Status: Draft for user review

## 1. Purpose

The latest MVR5 WebVoyager Lite run showed that the previous planner-contract hardening helped context size and schema discipline, but BrowseGent still fails on lower-level execution contracts.

This design defines the next focused hardening phase:

- Make refs execute against the intended observed element, not a loose selector match.
- Correct Brain1 action semantics so typeable, clickable, selectable, and readable refs match browser reality.
- Execute short planner mini-plans with fresh observations and safe continuation rules.
- Add an explicit keyboard/submit path without hiding submission inside `type`.
- Classify provider, planner, and runtime failures honestly.

This is not a benchmark-tuning phase. WebVoyager traces are diagnostic evidence only.

## 2. Current Evidence

Latest completed BrowseGent MVR5 run:

```text
logs/webvoyager-lite/webvoyager_lite_1780250567954
```

Summary:

- Pass/strict/raw: 20 percent.
- Trace completeness: 100 percent.
- Average planner calls: 7.0.
- Max planner input artifact: 86,071 bytes.
- Max projection section: 20,722 bytes.
- Max observation artifact: 369,979 bytes.
- Repeated/invalid action markers: 9/2.

Per-task evidence:

```text
Allrecipes:
  Correctly escalated captcha/environment block.

ArXiv:
  Planner selected a valid-looking search textbox and Search button.
  The Search button ref had selectorCandidates beginning with generic `button.button`.
  InputService used `page.locator(selector).first()`, so execution could hit a hidden/wrong earlier button.
  Result: repeated click timeouts against the intended visible ref.

Google Map:
  Google Maps search input was represented as role=combobox/kind=select.
  actionSurface.typeableRefs was empty.
  Planner's natural `type` into the search box was rejected as incompatible.

GitHub:
  Search field typing succeeded once, then repeated no-progress typing.
  The loop ended with provider_error:fetch failed, but the agent reported planner_invalid_output_dead_end.
  That is a reporting/classification bug, not a planner schema bug.

Wolfram Alpha:
  Passed, but still showed repeated submit-like clicking before final answer extraction.
```

## 3. External Architecture Signals

External systems are references, not templates to copy.

### 3.1 Agent Browser

Agent Browser refs are deterministic because each ref stores:

- Backend node id.
- Role.
- Accessible name.
- Nth disambiguator for duplicate role/name pairs.
- Frame id.

Execution prefers cached backend node id and falls back to role/name/nth lookup against a fresh accessibility tree. CSS selector fallback is for non-ref use, not the main ref path.

Relevant local research note:

```text
D:/agent-browser.md
```

Design implication for BrowseGent:

- Ref execution must not blindly execute `selectorCandidates[0]`.
- A V2 ref needs an execution identity that can be verified against observed facts.
- Fallback must prove the candidate is visible/enabled and semantically compatible.

### 3.2 Browser Use

Browser Use builds a selector map from visible interactive elements and uses backend node ids for action execution. It also performs runtime occlusion checks and has cascading rematch diagnostics when a historical element cannot be found.

Browser Use also treats text input and submit/Enter as separate actions. It allows safe action chaining, but stops queued actions when page-changing actions or runtime page-change guards fire.

Relevant local research notes:

```text
D:/browser-use.md
D:/one-question.md
```

Design implication for BrowseGent:

- Type/fill should not auto-submit.
- Safe actions may continue in one mini-plan.
- Navigation/focus/page changes should stop stale follow-up actions.
- Autocomplete/combobox fields need a small observe/wait path, not automatic Enter.

### 3.3 Alumnium

Alumnium separates planner and actor:

- Planner creates high-level steps.
- Actor executes each step using the current accessibility tree.
- It re-observes before each step in a multi-step plan but does not fully re-plan between every step.
- It exposes explicit click, type, and press-key tools.

Design implication for BrowseGent:

- BrowseGent should keep Brain1/Brain2/graph, but adopt the pattern of fresh observation before each mini-plan step.
- Re-observation is cheaper and safer than full re-planning after every microstate.
- Press/keyboard should be explicit.

## 4. Non-Goals
this is the qorls
This phase will not:

- Add site-specific handling for ArXiv, GitHub, Google Maps, Wolfram Alpha, Allrecipes, or WebVoyager.
- Hard-code benchmark answers, selectors, URLs, or task-specific recovery.
- Replace BrowseGent's Brain1/Brain2/graph architecture with Browser Use, Agent Browser, or Alumnium.
- Make full-page raw observations larger to improve short-term pass rate.
- Add screenshots or visual reasoning as a default path.
- Run the full 30-task benchmark as a gate.

The target external check after implementation is only the MVR5 slice.

## 5. Design Principles

1. Refs are contracts, not selector strings.
2. Execution must verify identity and actionability at runtime.
3. Brain1 classifies what a ref can do; the planner chooses among those capabilities.
4. `type` enters text only. Submission is explicit through click or keyboard.
5. Continue safe mini-plan actions; stop stale actions after meaningful page/focus changes.
6. Provider/network failures must not be mislabeled as planner-output failures.
7. Every change must be covered by a generic fixture or unit test before benchmark rerun.

## 6. Proposed Architecture

### 6.1 Ref Execution Identity

Extend runtime ref metadata so the substrate can resolve the intended element deterministically.

Current state:

- `V2Ref` already has optional `backendNodeId`.
- `ObservationService` does not reliably populate it.
- `InputService` ignores it and loops over CSS selectors using `.first()`.

New execution identity should include:

```ts
interface RefExecutionIdentity {
  backendNodeId?: number;
  targetId: string;
  frameId?: string;
  role?: string;
  name?: string;
  text?: string;
  tagName?: string;
  inputType?: string;
  nthRoleName?: number;
  selectorCandidates: string[];
  box?: Rect;
}
```

Implementation direction:

- Populate `backendNodeId` when the browser substrate can expose it.
- Preserve `targetId` and semantic facts as the continuity identity fallback.
- Add `tagName` and `inputType` to refs so action classification does not infer from selector strings.
- Track `nthRoleName` for duplicate role/name pairs in the observation snapshot.

Planner inputs must continue excluding raw backend node ids and selector candidates. This metadata is substrate-only.

### 6.2 Verified Ref Resolution

Replace blind selector `.first()` execution with a resolver that returns a single verified target.

Resolution order:

1. Backend node id/object handle if available.
2. Fresh current-observation ref with same `refId` if still live and high-confidence.
3. Semantic fallback by role/name/nth/tag/frame when backend identity is stale.
4. CSS selector fallback only if it resolves to a unique visible/enabled candidate matching the ref's semantic facts.

Selector fallback rules:

- Never use `.first()` without verifying uniqueness or semantic match.
- If a selector returns multiple elements, prefer the candidate matching role/name/text/tag/geometry and visible/enabled state.
- If no candidate can be verified, return `stale_ref` or `ambiguous_ref_resolution`, not timeout.
- If the resolved candidate is hidden, disabled, detached, or occluded, return the corresponding operational error.

This should fix hidden-first and duplicate-selector failures without adding site-specific logic.

### 6.3 Runtime Visibility, Enabled, and Occlusion Checks

Before click/type/select/press-on-ref:

- Check bounding rect width and height.
- Check computed `display`, `visibility`, and opacity.
- Check disabled/readOnly where relevant.
- For click, check `elementFromPoint` at the center.
- Allow label/input containment cases where the top element is semantically associated with the target.

Failure mapping:

```text
hidden or zero rect -> target_hidden
disabled -> target_disabled
readOnly or non-editable type target -> target_not_editable
not a clickable action target -> target_not_clickable
detached -> element_detached
occluded by unrelated element -> target_blocked
multiple matching fallback candidates -> ambiguous_ref_resolution
no matching live candidate -> stale_ref
```

JavaScript click fallback should not be added in this phase unless there is a generic test proving it is safe. It can bypass user-real interaction semantics and hide occlusion problems.

### 6.4 Action Semantics Contract

Brain1 must classify capabilities from real DOM facts, not selector text.

Add or expose these normalized fields:

```text
tagName
inputType
editableKind
ariaAutocomplete
ariaHasPopup
isContentEditable
```

Classification rules:

- `input[type=text|search|email|url|tel|number|password]`, `textarea`, contenteditable, and searchable comboboxes are typeable.
- `input[type=submit|button|reset|image]`, button, link, and role button/link/menuitem/tab are clickable.
- Native `select` and listbox-style controls are selectable.
- Combobox is split:
  - searchable combobox: typeable, may also be clickable.
  - closed select-like combobox: selectable/clickable, not typeable.
- Generic visible elements are not automatically clickable unless role, handlers, tabindex, or cursor evidence supports it.

`PlannerWorkingSetSelector` should build action lanes from these capability flags:

```json
{
  "actionSurface": {
    "clickableRefs": [],
    "typeableRefs": [],
    "selectableRefs": [],
    "pressableRefs": [],
    "readableRefs": [],
    "ambiguousRefs": []
  }
}
```

This fixes searchable-combobox action typing failures without adding site-specific logic.

### 6.5 Step Execution Policy

The current agent loop interrupts a mini-plan after any successful mutation with transition evidence. That is too conservative for low-level `type` microstates and causes excess replanning.

Adopt a hybrid Browser Use plus Alumnium policy:

- The planner may return a mini-plan.
- The agent re-observes after each action.
- It does not call the planner again after every safe microstate.
- It stops the remaining mini-plan only when stale execution risk is meaningful.

Action categories:

```text
Always terminal in current mini-plan:
  navigate, external search, go_back/future navigation tools, done, escalate

Potentially terminal:
  click, press, select, wait

Normally safe to continue:
  type, get, search_page, inspect_region, scroll
```

Runtime stop conditions after an action:

- URL changed.
- Generation changed strongly.
- Focus target changed away from the intended input after a non-read action.
- Transition class is structural_macrostate or hard_reset.
- Tool failed.
- Action produced new modal/dialog/menu evidence that invalidates planned refs.
- Planner step references a ref that is no longer live after re-observe.

Runtime continue conditions:

- `type` succeeded and only input value changed.
- `get`, `search_page`, or `inspect_region` succeeded.
- `scroll` succeeded and next planned action does not target stale refs.
- `wait` did not produce a structural change.

This should prevent repeated type loops while still allowing efficient `type -> click submit` or `type -> press Enter` plans.

### 6.6 Explicit Keyboard Tool

Add a first-class keyboard action after ref identity and action semantics are stable.

Candidate planner step shape:

```json
{"tool":"press","key":"Enter"}
{"tool":"press","ref":"v2ref_10","key":"Enter"}
```

Rules:

- `press` without `ref` operates on current focused element.
- `press` with `ref` first resolves and focuses that ref.
- Allowed keys should be a small enum initially: `Enter`, `Escape`, `Tab`, `ArrowDown`, `ArrowUp`.
- `press` is potentially terminal because Enter may submit/navigate.

Do not merge submit behavior into `type`.

### 6.7 Autocomplete and Combobox Handling

Autocomplete/search comboboxes should use mechanical observation, not hidden heuristics.

After typing into a searchable combobox:

- Optionally wait a small bounded delay for suggestions if aria-autocomplete/role evidence exists.
- Re-observe.
- If suggestions appear as new selectable/clickable refs, planner can click a suggestion.
- If no suggestions appear, planner may use explicit `press Enter` or click a submit/search button.

This is generic web behavior and should be tested with a synthetic fixture.

### 6.8 Failure Classification and Reporting

Fix the current planner/provider classification issue.

Planner failure buckets:

```text
provider_error
provider_rate_limited
provider_budget_guard
planner_invalid_output
planner_validation_rejected
planner_no_action
planner_escalated
```

Runtime failure buckets:

```text
target_hidden
target_disabled
target_blocked
target_not_editable
target_not_clickable
stale_ref
ambiguous_ref_resolution
element_detached
timeout
navigation_blocked
environment_block
```

Agent loop rule:

- Provider errors must return `planner_client_error:<provider_error>` or equivalent provider-specific classification.
- Only validation exhaustion after two invalid model outputs can return `planner_invalid_output_dead_end`.

This fixes provider-failure report distortion.

## 7. Data Flow

Target flow:

```text
ObservationService
  -> refs with backend identity, semantic facts, DOM facts, visibility, actionability
  -> RefService
      -> stable ref ids and continuity confidence
  -> Brain1 ProjectionService
      -> capability-aware projection items
  -> PlannerWorkingSetSelector
      -> actionSurface lanes
  -> V2PlannerClient
      -> ref-only plan
  -> V2AgentLoop
      -> execute mini-plan step 1
      -> observe fresh state
      -> stop/continue decision
      -> execute next safe step or replan
  -> InputService / KeyboardService
      -> verified ref resolution
      -> typed runtime result or typed operational error
  -> FailureClassifier / RecoveryStateBuilder
      -> compact recovery evidence for next planner call
```

## 8. Implementation Slices

Implementation should be staged. Each slice needs tests before code changes.

### Slice 1: Failure Classification Cleanup

Smallest safe starting point.

- Split provider errors from invalid planner output errors.
- Add tests for `provider_error:fetch failed` classification.

### Slice 2: DOM Facts and Action Semantics

- Add `tagName`, `inputType`, `editableKind`, and autocomplete facts to `V2Ref`.
- Populate them from observation.
- Classify input/button/combobox capabilities from facts.
- Update actionSurface tests.

### Slice 3: Verified Ref Resolution

- Add a resolver inside substrate/runtime boundary.
- Prefer backend node id if available.
- Fall back to verified semantic/visible selector candidates.
- Replace `page.locator(selector).first()` in InputService with the resolver.
- Add hidden-first and duplicate-selector fixtures.

### Slice 4: Step Execution Policy

- Re-observe after each mini-plan step.
- Continue safe microstate actions.
- Stop on structural/navigation/focus/stale/error conditions.
- Add tests for `type -> click submit` continuation and stale follow-up interruption.

### Slice 5: Explicit Press Tool

- Add planner schema, dispatcher, runtime execution, validation, and tests for `press`.
- Keep allowed keys bounded.
- Mark Enter as potentially terminal.

## 9. Testing Strategy

Unit tests:

- Provider/network error is not classified as invalid planner output.
- Text/search inputs are typeable.
- Submit/button/reset/image inputs are clickable and not typeable.
- Searchable combobox is typeable.
- Select-like combobox is selectable/clickable, not typeable.
- ActionSurface exposes correct lanes and excludes high-confidence incompatible refs.
- Ref resolver rejects ambiguous selector fallback instead of choosing `.first()`.
- Ref resolver rejects hidden-first matches and finds the visible semantic match when provable.
- Runtime maps ambiguous resolution to `ambiguous_ref_resolution`.
- Mini-plan continues after no-progress `type` when next step is safe against live refs.
- Mini-plan stops after URL/generation/focus structural change.
- `press Enter` is validated and marked potentially terminal.

Integration/fixture tests:

- Hidden duplicate button before visible target button.
- Generic class selector matching multiple buttons.
- Search box with role combobox and suggestions.
- Search form requiring explicit Enter.
- Search form requiring explicit submit button.
- Provider fetch failure during planner call.

Benchmark smoke after implementation:

```text
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root C:\tmp\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 4 --key-index <chosen>
```

Expected smoke signals:

- Valid visible refs do not repeatedly timeout because execution selected a hidden duplicate.
- Searchable fields appear in a typeable or otherwise correct action lane.
- Provider failures are reported honestly if they occur.
- Repeated no-progress type loops reduce.
- Trace completeness remains 100 percent.

Pass rate improvement is useful, but not the only acceptance criterion.

## 10. Risks and Mitigations

Risk: Backend node id is unavailable in some Playwright contexts.

Mitigation:

- Keep semantic verified fallback.
- Return explicit resolution failures when identity cannot be proven.

Risk: Ref resolver becomes too complex and fragile.

Mitigation:

- Keep it behind one substrate boundary.
- Use narrow fixture tests for each fallback path.
- Do not expose resolver details to the planner.

Risk: Strict action typing blocks custom controls.

Mitigation:

- Preserve ambiguous lane.
- Runtime can try ambiguous refs if selected and evidence supports them.
- Known incompatible refs are rejected; unknown custom controls are not silently hidden.

Risk: Mini-plan continuation executes stale actions.

Mitigation:

- Re-observe after every action.
- Stop on URL/generation/focus/ref-liveness changes.
- Validate each planned ref against the fresh observation before executing it.

Risk: Adding `press` increases action space and planner confusion.

Mitigation:

- Add it after ref/action contracts are fixed.
- Bound allowed keys.
- Keep prompt change minimal and tool semantics explicit.

Risk: Benchmark pressure causes overfitting.

Mitigation:

- All fixes must map to a general failure class in this spec.
- All fixes must be proven with synthetic tests before MVR5 rerun.
- No website names or WebVoyager ids in runtime logic.

## 11. Approval Boundary

If approved, the implementation plan should cover only:

1. Provider/planner failure classification cleanup.
2. DOM fact capture and capability-aware action typing.
3. Verified ref resolution replacing blind selector `.first()` execution.
4. Safe mini-plan step execution with fresh re-observation.
5. Explicit bounded `press` tool.
6. Tests and MVR5 readiness check.

This phase should not include visual reasoning, full benchmark runs, site-specific fixes, stealth/captcha work, or large prompt rewrites.
