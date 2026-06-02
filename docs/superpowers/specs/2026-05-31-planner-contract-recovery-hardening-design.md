# BrowseGent V2 Planner Contract and Recovery Hardening Design

Date: 2026-05-31

Status: Draft for user review

## 1. Purpose

BrowseGent V2 has enough infrastructure to run local WebVoyager Lite smoke tests, but the latest traces show that the system is not yet using its Brain1, Brain2, graph, and planner boundary in a disciplined way.

This design defines the next hardening phase before another serious benchmark run. The phase focuses on general architecture quality:

- Planner contract correctness
- Loop recovery
- Context slimming and token efficiency
- Actionability typing
- Better use of Brain1, Brain2, graph, transition, and failure evidence

The design does not optimize for any specific benchmark task, website, or expected answer. Benchmark traces are used only as diagnostic signals.

## 2. Non-Goals

This phase will not:

- Add website-specific task logic.
- Hard-code WebVoyager task answers, selectors, URLs, or domain-specific recovery rules.
- Run the full 30-task benchmark before the core planner/runtime issues are fixed.
- Rewrite the entire perception layer.
- Make screenshots or visual reasoning the default action surface.
- Replace Brain1, Brain2, or the graph architecture with a competitor clone.

The target verification is a small 5-task WebVoyager Lite smoke run after implementation, plus unit and integration tests that prove the architecture changes directly.

## 3. Current Evidence

Latest local smoke run:

```text
logs/webvoyager-lite/webvoyager_lite_1780186353600
```

Summary:

- Strict pass rate: 20.0 percent.
- Trace complete rate: 100.0 percent.
- Average planner calls: 10.60.
- Max planner input artifact: 236,588 bytes.
- Max observation artifact: 370,150 bytes.
- Repeated/invalid action markers: 22/2.

Per-task symptoms:

```text
Allrecipes:
  Failed with planner output using selector fields.
  Repeated search_page 10 times before invalid final output.

ArXiv:
  Hit max steps.
  Repeated type/click pattern against the same refs.

GitHub:
  Hit max steps.
  Tried to type into a button-like search launcher.
  Runtime classified the wrong target as timeout.
  Initial planner input was 236,588 bytes.

Google Map:
  Failed with an unselected ref in planner output.

Wolfram Alpha:
  Passed, but still used 174k input tokens and 11 planner calls.
```

Important local code evidence:

- `src/providers/index.ts` applies the global Gemini response schema from `src/executor/catalog.ts`.
- `src/executor/catalog.ts` still defines action fields around `sel`.
- `src/v2/planner/PlannerOutputSchema.ts` forbids `sel` and requires V2 `ref`.
- `src/v2/planner/PlannerWorkingSetSelector.ts` caps selected current refs, but can still flood `workingSet.changedRefs`.
- `src/v2/substrate/InputService.ts` surfaces the wrong-target GitHub fill error as a generic timeout-like failure.

## 4. External Architecture Signals

External systems are useful references, not templates to copy.

Vercel `agent-browser`:

- Uses accessibility snapshots with stable element refs.
- Resolves actions through refs instead of exposing raw selectors to the agent.
- Maintains a ref map and invalidates/resnapshots after page changes.
- Enforces output limits and command boundaries.

Reference:

```text
https://deepwiki.com/vercel-labs/agent-browser
https://deepwiki.com/vercel-labs/agent-browser/5.2-optimal-ai-workflow
```

Browser-use:

- Builds an optimized DOM representation rather than sending raw DOM.
- Assigns indices only to selected interactive, visible, scrollable, or meaningful elements.
- Maintains a selector map behind those indices.
- Tracks failure state, history, and loop detection in runtime state.
- Uses context/history truncation and ephemeral read state.

References:

```text
https://deepwiki.com/browser-use/browser-use/5.2-agent-llm-communication
https://deepwiki.com/browser-use/browser-use/2.1-agent
https://deepwiki.com/browser-use/browser-use/2.3-controller-and-action-execution
```

Gemini structured output:

- Gemini supports schema-constrained JSON outputs for agentic workflows.
- BrowseGent should use a V2 planner schema for V2 planner calls, not the legacy selector schema.

Reference:

```text
https://ai.google.dev/gemini-api/docs/structured-output
```

CDP accessibility:

- Chrome exposes full and partial accessibility trees, including scoped queries.
- This supports future targeted expansion without sending whole-page raw state by default.

Reference:

```text
https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
```

## 5. Root Causes

### 5.1 Planner Contract Mismatch

The V2 planner asks for `ref`, but the Gemini provider still attaches a schema built from the legacy selector catalog. That schema includes `sel`, so Gemini can be constrained toward output that V2 validation rejects.

This is a system boundary bug, not a model-quality issue.

### 5.2 Working Set Is Slimmed in One Place but Bloated in Another

The current planner input correctly caps `current.refs`, but `workingSet.changedRefs` can include hundreds of refs. In the latest GitHub trace, the initial planner input had 675 changed refs and the `changedRefs` section alone consumed about 95KB.

This happens because the selection logic treats graph refs as changed even when there is no meaningful latest-transition evidence.

### 5.3 Ref Lists Are Not Action-Typed Enough

The planner sees refs with `kind`, `role`, and text, but it is not given a strict tool-compatible target surface. The GitHub trace shows a `type` action sent to a search launcher button. That should have been prevented or recovered from deterministically.

### 5.4 Runtime Error Taxonomy Is Too Coarse

The browser error said the element was not an input, textarea, select, contenteditable, or ARIA-editable target. BrowseGent surfaced this as a timeout-like failure. That deprives Brain2 and the planner of the right recovery signal.

### 5.5 Loop Recovery Is Prompt-Only, Not Control-Plane Enforced

The agent repeated:

- The same `search_page` with zero useful progress.
- The same type/click pair on the same refs.
- The same wrong target after failure.

The current planner prompt tells the model not to repeat failed actions, but the runtime does not convert loop evidence into bounded recovery choices.

### 5.6 Graph Evidence Is Not Yet Used as a Planner Control Surface

The graph already has continuity and transition information, but the planner receives it mostly as summaries and large lists. It needs compact, decision-oriented state:

- What changed?
- What did not change?
- What ref is stale or wrong-typed?
- What region or scope should be expanded?
- Is this a loop?
- Should the next action be act, recover, expand, verify, or stop?

## 6. Design Principles

This phase follows these principles:

1. Contract first: the model must be asked for exactly what the runtime accepts.
2. Deterministic recovery before prompt creativity: obvious wrong-target and no-progress loops should be handled by runtime signals.
3. Brain1/Brain2/graph are the main architecture: do not bypass them with raw page dumps.
4. Bounded context by design: every planner input section should have a reason and a size ceiling.
5. Expansion over flooding: when the selected view is insufficient, expand a scope or ref set deliberately.
6. Evidence over benchmark tuning: every change must be justified by a general root cause and covered by tests.

## 7. Proposed Architecture

### 7.1 V2 Planner Provider Contract

Add a V2-specific provider contract for planner calls.

The V2 schema must allow:

```json
{"done":true,"val":"answer"}
{"escalate":"user_needed|captcha|dead_end","reason":"reason"}
{"plan":[{"tool":"click","ref":"v2ref_1"}],"confidence":"high"}
```

The V2 schema must not expose:

```text
sel
selector
css
xpath
coordinates
backendNodeId
script
playwright
cdp
```

Implementation direction:

- Keep the legacy schema for V1 compatibility.
- Add a provider option such as `responseSchema` or `contract: 'v2Planner'`.
- Make `V2PlannerClient` call the provider with the V2 planner schema.
- Keep post-LLM validation in `PlannerOutputSchema`; provider schema is not a replacement for runtime validation.

Expected result:

- Gemini is no longer guided toward selector-shaped output in V2.
- Invalid `sel` planner failures should drop sharply.

### 7.2 Action-Compatible Working Set

Extend the planner working set with action-compatible lanes.

Example shape:

```json
{
  "actionSurface": {
    "clickableRefs": ["v2ref_1", "v2ref_2"],
    "typeableRefs": ["v2ref_3"],
    "selectableRefs": ["v2ref_4"],
    "readableRefs": ["v2ref_5"]
  }
}
```

Rules:

- `type` may only target typeable refs.
- `select` may only target selectable refs.
- `click` may target clickable refs.
- `get` and `inspect_region` may target readable or selected refs depending on tool semantics.

Compatibility enforcement should be graded:

- Hard reject actions against refs that are selected but known incompatible with high confidence.
- Allow ambiguous refs when the substrate cannot confidently classify them, but attach a validation warning or recovery signal.
- Let runtime execution produce a typed failure such as `target_not_editable` if an ambiguous ref fails in practice.
- Never accept unselected refs as normal executable targets.

This avoids hiding valid fallback targets such as custom controls, while still preventing obvious mistakes like typing into a known non-editable button.

The planner prompt should describe the lanes briefly, but enforcement must happen in validation and runtime.

Expected result:

- The model can still reason naturally, but the accepted action space is better aligned with actual browser capabilities.
- Wrong tool/target combinations become deterministic validation errors or deterministic recoverable runtime errors.

### 7.3 Working Set Slimming Fix

Change `changedRefs` from an unbounded list of all perceived changes to a compact summary plus a small top-N evidence list.

New shape:

```json
{
  "changedRefs": {
    "appearedCount": 148,
    "weakenedCount": 103,
    "preservedCount": 271,
    "topRefs": [
      {"refId":"v2ref_12","kind":"input","name":"Search","reasons":["recently_appeared","goal_keyword_match"]}
    ],
    "omittedCount": 247
  }
}
```

Rules:

- Never include all changed refs by default.
- Never treat initial graph population as a meaningful latest-transition change.
- Keep only refs already selected into current refs, top-scored appeared refs, failed refs, and explicit recovery refs.
- Preserve counts so Brain2 still knows the page changed substantially.

When the changed-ref budget is tight, preserve refs in this order:

1. Failed refs from the latest action or persistent failure evidence.
2. Explicit recovery refs required by the recovery state.
3. Goal-matching appeared refs.
4. Goal-matching weakened refs.
5. Other high-scoring appeared refs.
6. Other high-scoring weakened refs.

Preserved refs should not be expanded into a long list unless they are directly selected, failed, or recovery-relevant. Counts are enough for broad continuity awareness.

Expected result:

- Large pages stop flooding the planner through `workingSet.changedRefs`.
- The planner still receives transition semantics.

### 7.4 Recovery State Machine

Add a small deterministic recovery state derived from trace, last result, failure evidence, dead-state evidence, and transition evidence.

Example:

```json
{
  "recovery": {
    "state": "wrong_target_type|same_action_loop|zero_result_read_loop|unselected_ref|none",
    "severity": "info|warning|critical",
    "blockedAction": {"tool":"type","ref":"v2ref_260"},
    "nextMechanisms": ["click_launcher_then_type", "choose_typeable_ref", "expand_scope", "stop_dead_end"]
  }
}
```

This is not a second planner. It is a compact control signal that narrows the next decision.

Initial recovery cases:

- `wrong_target_type`: a tool was applied to an incompatible ref.
- `same_action_loop`: same mutating action repeats with weak/no transition.
- `zero_result_read_loop`: same read/search repeats with no new evidence.
- `unselected_ref`: planner references a valid-looking ref not present in selected refs.
- `invalid_output_repeat`: planner returns invalid schema twice.
- `max_step_risk`: loop signals are high before final step budget is exhausted.

Response policy:

- `wrong_target_type` should push the next planner input toward a different compatible ref or a preparatory click/expand action.
- `same_action_loop` should block another identical action unless the page changed strongly.
- `zero_result_read_loop` should recommend a different evidence-gathering action or stop with dead-end evidence.
- `unselected_ref` should recommend scoped expansion/reobserve instead of accepting stale refs.
- `invalid_output_repeat` should stop the current retry cycle. After a small consecutive invalid-output threshold for the episode, the agent should emit a controlled `dead_end` result with validation evidence rather than burning step budget.

Expected result:

- Repetition is interrupted earlier.
- The planner gets a clear reason to change strategy.
- Dead-end escalation is allowed only when evidence supports it.

### 7.5 Scoped Expansion Instead of Raw Flooding

When selected refs are insufficient, the system should prefer scoped expansion actions over bigger default context.

Short-term implementation should reuse existing tools where possible:

- `search_page` for text evidence.
- `inspect_region` for region/ref-local evidence.
- `scroll` for viewport expansion.
- `wait` for delayed UI.

The planner contract should make this explicit:

- If a needed ref is omitted, do not invent or use stale refs.
- Use expansion/read actions to surface missing evidence.

Future implementation may add dedicated tools:

- `snapshot_scope(ref|region)`
- `accessibility_snapshot(scope)`
- `visual_inspect(ref|viewport|region)`

Those future tools are out of scope for this phase unless current code already exposes most of the required substrate.

### 7.6 Runtime Error Taxonomy

Improve failure classification at the browser-action boundary.

Minimum new or clarified error categories:

```text
target_not_editable
target_not_clickable
stale_ref
unselected_ref
element_detached
navigation_blocked
captcha_or_access_block
timeout
```

The goal is not perfect classification. The goal is to stop collapsing wrong-target errors into timeout.

Expected result:

- Brain2 can distinguish "wait longer" from "use a different kind of target."
- Recovery state becomes meaningful.

### 7.7 Planner Prompt Adjustment

Prompt changes should be small and reflect real runtime contract changes.

Prompt must:

- Explain action lanes.
- Explain that omitted refs require expansion, not invented refs.
- Explain recovery state.
- Continue forbidding selectors, scripts, coordinates, Playwright, and CDP.

Prompt must not:

- Mention benchmark tasks.
- Include website-specific examples.
- Encourage long reasoning output.

### 7.8 Diagnostics and Observability

Add or preserve diagnostics for:

```text
plannerInputBytes.total
plannerInputBytes.current
plannerInputBytes.workingSet
plannerInputBytes.changedRefs
plannerInputBytes.recovery
selectedRefs.total
actionSurface.clickable/typeable/selectable/readable counts
loopState
recoveryState
invalidPlannerOutputCount
wrongTargetTypeCount
unselectedRefCount
```

This makes future benchmark results explainable without guessing.

## 8. Data Flow

Target flow after implementation:

```text
Brain1 projection
  -> operational refs with kind, role, visibility, actionability, state
  -> Brain2/graph continuity and transition evidence
  -> PlannerWorkingSetSelector
      -> bounded current refs
      -> action-compatible lanes
      -> compact changed/ref summaries
      -> omitted counts
  -> RecoveryStateBuilder
      -> loop and failure control signal
  -> PlannerInputComposer
      -> bounded planner input
  -> V2PlannerClient
      -> V2 provider response schema
      -> PlannerOutputSchema validation
  -> V2AgentLoop/InputService
      -> typed execution
      -> classified results
      -> trace/failure/graph update
```

## 9. Validation Rules

Add validation rules at planner-output validation time:

- `click.ref` must be in selected refs and click-compatible.
- `type.ref` must be in selected refs and type-compatible.
- `select.ref` must be in selected refs and select-compatible.
- `inspect_region.ref` must be in selected refs or a valid region representative.
- Unselected refs are invalid, but the feedback must recommend expansion/reobserve rather than accepting stale refs.

Compatibility validation should distinguish three states:

```text
compatible: accept
ambiguous: accept with warning/recovery context
incompatible: reject with a precise validation error
```

The initial implementation should prioritize hard rejection for high-confidence incompatible cases and warning/recovery for ambiguous cases. This keeps the action surface safe without blocking legitimate custom widgets.

Keep alias handling conservative:

- Do not accept `sel` as a normal V2 field.
- If a temporary compatibility alias remains, it must only map exact selected V2 refs and should be removed after compatibility tests pass.

## 10. Testing Strategy

Unit tests:

- V2 provider schema does not include `sel`.
- V1 provider schema remains unchanged if V1 still depends on it.
- `V2PlannerClient` passes V2 schema/options to provider.
- `PlannerOutputSchema` rejects high-confidence tool-incompatible refs.
- `PlannerOutputSchema` allows ambiguous compatible refs only with warning/recovery context.
- `PlannerOutputSchema` rejects unselected refs with actionable feedback.
- `PlannerWorkingSetSelector` caps `changedRefs` and does not mark initial graph population as changed.
- `PlannerWorkingSetSelector` preserves changed refs by the priority order in this spec.
- Recovery state detects repeated zero-result `search_page`.
- Recovery state detects repeated same failed target.
- Recovery state stops repeated invalid planner output before step budget is wasted.
- Input error mapping classifies "not an input/contenteditable" as `target_not_editable`.

Integration tests:

- Synthetic GitHub-like search launcher: planner/runtime must click launcher or select a typeable ref, not type into a button.
- Synthetic large page: planner input remains below a configured section budget.
- Synthetic repeated read loop: recovery state appears before max steps.
- Synthetic unselected ref: planner validation feedback asks for expansion/reobserve.

Smoke benchmark:

- Run only the 5-task WebVoyager Lite slice.
- Compare against previous run using trace diagnostics, not only pass rate.
- Expected readiness gates:
  - No V2 planner output using `sel`.
  - Large initial planner input reduced materially, especially `workingSet.changedRefs`.
  - Wrong-target errors are classified.
  - Repeated action markers reduced.
  - Trace completeness remains 100 percent.

## 11. Risks and Mitigations

Risk: V2 schema becomes too strict and blocks valid plans.

Mitigation:

- Keep runtime validation errors explicit.
- Add targeted tests for every valid action shape.
- Keep V1 schema path separate.

Risk: Action lanes hide useful fallback targets.

Mitigation:

- Preserve selected refs and readable evidence separately.
- Add expansion path instead of silently dropping context.

Risk: Context slimming removes answer evidence.

Mitigation:

- Keep answer/readable evidence lane.
- Preserve counts and top evidence.
- Test synthetic extraction pages.

Risk: Recovery state becomes another over-engineered planner.

Mitigation:

- Keep recovery as a small finite set of states.
- It may recommend, but not invent domain-specific actions.

Risk: Benchmarks tempt tuning.

Mitigation:

- Every change must map to a root cause in this spec.
- Any future benchmark-specific observation must be translated into a general failure category before implementation.

## 12. Approval Boundary

If approved, the implementation plan should be limited to this phase:

1. V2 provider schema separation.
2. Runtime error taxonomy improvements.
3. `changedRefs` compact summary.
4. Recovery state builder.
5. Action-compatible working set lanes.
6. Scoped expansion/reobserve behavior using existing tools.
7. Planner prompt and validation updates.
8. Tests and 5-task smoke benchmark readiness check.

This priority order is intentional:

- Schema separation fixes the contract bug that contaminates all other planner behavior.
- Error taxonomy makes runtime evidence trustworthy.
- `changedRefs` slimming addresses the largest confirmed context flood.
- Recovery state then has reliable evidence to work from.
- Action-compatible lanes are valuable but higher-risk, so they come after the lower-risk contract and evidence fixes.
- Prompt changes come last and should describe implemented behavior, not substitute for it.

No full benchmark run should be treated as required for this phase. The full benchmark belongs after the 5-task smoke proves the planner contract, recovery, and context-size issues are materially improved.
