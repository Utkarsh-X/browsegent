# BrowseGent V2 Planner Working Set Architecture Design

**Date:** 2026-05-30

**Status:** Draft for review

**Scope:** Architecture correction for BrowseGent v2 planner input, Brain1/Brain2/graph usage, token efficiency, and production-grade benchmark readiness.

## 1. Objective

BrowseGent v2 must stop treating planner input as a full-page ref dump. The next architecture correction will introduce a graph-backed planner working set that converts Brain1 observations, Brain2 continuity, graph memory, runtime failures, and targeted expansion tools into a compact, high-signal state for each planner call.

The goal is not to copy Vercel agent-browser's extremely small snapshot model. The goal is to combine its strongest idea, compact ref-based semantic snapshots, with BrowseGent's stronger planned architecture: Brain1 semantic capture, Brain2 continuity, graph memory, uncertainty, dead-state evidence, and controlled expansion.

## 2. Non-Goals

- Do not tune for WebVoyager, any current five-task benchmark set, or any specific website.
- Do not hard-code task answers, website names, WebVoyager reference behavior, or benchmark-specific flows.
- Do not globally compress prompts after oversized payloads are already built as the main solution.
- Do not remove Brain1, Brain2, graph, or the planner architecture.
- Do not make screenshots or vision always-on.
- Do not rewrite the whole browser substrate before correcting planner-state semantics.

## 3. Current Failure Mode

The current v2 data flow is effectively:

```text
DOM interactive scrape
  -> V2 refs
  -> ProjectionService full views
  -> serializeProjection full ref catalog
  -> pretty JSON planner input
  -> planner receives too much low-value page state
```

Observed implementation problems:

- `ProjectionService.project(observation, _graphSnapshot)` accepts graph context but does not use it.
- `interactions` is built from all regioned items, not only meaningful action candidates.
- `serializeProjection()` emits all refs appearing in interactions, readables, or navigation.
- Since interactions contains nearly all refs, `current.refs` becomes the full ref catalog.
- Ranking is local and static: visibility, actionability, state, role, name, text length, and confidence. It is not goal-aware, history-aware, graph-aware, failure-aware, or viewport-neighborhood-aware.
- The planner prompt explicitly defines `current.refs` as full ref facts and serializes the full object using pretty JSON.
- The graph is summarized separately but does not decide what enters the planner context.

This means the architecture has Brain and graph components, but the planner-facing contract underuses them.

## 4. External Lessons

Vercel agent-browser demonstrates that browser agents benefit from compact accessibility-tree snapshots with temporary refs, interactive-only views, compact mode, depth limits, scoped snapshots, and targeted reads.

Browser-use demonstrates a practical agent loop with page state, indexed clickable elements, optional screenshots, and browser tools. It is not enough to be token-efficient; the runtime must also expose enough operational tools for recovery, extraction, and visual confirmation when required.

BrowseGent should use these lessons as engineering principles:

- The planner should see what it can act on now.
- The planner should not receive the whole page by default.
- Refs should be stable enough for the current decision, but the runtime must reobserve after page changes.
- Deep data should be requested through explicit tools, not eagerly stuffed into every planner call.
- Screenshots/vision are fallback evidence, not the primary state channel.

## 5. Target Architecture

The corrected architecture is:

```text
Browser substrate
  -> Semantic snapshot capture
  -> Brain1 fact extraction
  -> Brain2 continuity and salience
  -> Continuity graph memory
  -> Planner working set selection
  -> Planner input contract v2
  -> Planner action
  -> Tool execution
  -> Transition evidence back into graph
```

The key new component is `PlannerWorkingSetSelector`.

It selects the small set of facts the planner needs for the next decision. It is not a lossy last-minute compressor. It is an architectural boundary that decides what state is cognitively available to the planner.

## 6. Planner Working Set Contract

The planner input should contain:

```text
version
episodeId
goal
page
objective_state
working_set
continuity
last_result
failures
dead_state
uncertainty
available_tools
diagnostics
```

### 6.1 Page

Compact page facts:

```text
url
title
generationId
observationId
```

### 6.2 Objective State

Goal interpretation and current tactical mode:

```text
goal
mode: explore | act | verify | recover | extract | done_candidate
reason
```

This should remain deterministic where possible. It can start with rule-based inference and later accept model-assisted classification if needed.

### 6.3 Working Set

The working set should include selected refs and summaries:

```text
primary_refs
secondary_refs
readable_evidence
navigation_refs
changed_refs
failed_refs
region_summaries
omitted_summary
```

`primary_refs` are the top action candidates for the next planner call. `secondary_refs` are useful but lower priority. `readable_evidence` contains text snippets relevant to answering or verifying the goal. `navigation_refs` contains route-changing refs only when navigation is likely useful. `changed_refs` includes appeared, disappeared, weakened, or last-changed refs from the graph. `failed_refs` includes targets recently tried and why they are risky. `region_summaries` summarize dense regions without expanding every ref. `omitted_summary` tells the planner what was intentionally not included.

### 6.4 Continuity

The graph should drive context selection and also emit a compact continuity summary:

```text
presentRefCount
selectedRefCount
changedRefCount
staleRefCount
latestTransition
loopRisk
stateHash
```

The planner does not need raw graph topology. It needs actionable continuity evidence.

### 6.5 Available Tools

The planner must know how to ask for deeper context:

```text
click(ref)
type(ref, text)
navigate(url)
scroll(direction)
wait(pattern, timeout)
get(ref)
inspect_region(ref)
search_page(pattern)
find_elements(pattern)
count_elements(pattern)
```

Later additions:

```text
snapshot_scope(ref | selector)
visual_inspect(ref | viewport | region)
accessibility_snapshot(scope)
```

Expansion tools are crucial. If the working set is bounded, the planner needs legal ways to request more evidence without receiving everything by default.

## 7. Selection Policy

Selection must be general and explainable. A ref enters the planner working set because of one or more reason codes:

```text
visible_ready
goal_keyword_match
role_relevant_to_goal
near_focus
recently_appeared
recently_changed
last_target
last_success
last_failure
dead_state_evidence
answer_candidate
navigation_candidate
form_candidate
region_representative
```

Rejected or summarized refs should also have reason codes:

```text
hidden_low_value
offscreen_low_value
generic_low_value
duplicate_region_member
navigation_overflow
readable_overflow
stale_unrelated
low_confidence_unrelated
token_budget_exceeded
```

This makes the system inspectable and protects us from hidden benchmark-specific tuning.

## 8. Ranking Policy

Ranking should combine multiple general signals:

```text
base role score
visibility score
actionability score
goal lexical score
semantic role-goal score
viewport/focus proximity score
graph recency score
transition-change score
failure penalty
loop-risk penalty
region diversity bonus
answer-evidence bonus
```

The current score function should become only one part of ranking. It should not be the whole salience model.

## 9. View Policy

The existing four-view idea should be retained only if views become bounded, meaningful lenses. The views should not each act as another path for all refs to enter `current.refs`.

Recommended views:

```text
actions: selected actionable refs
evidence: selected readable answer/verification evidence
navigation: selected route-changing refs
regions: selected dense regions with representatives and counts
```

Each view points to selected refs. A view may also include summaries. It must not force the full underlying page into planner input.

## 10. Token Budget Policy

Token efficiency should be an architecture invariant, not an emergency compression path.

Initial target budgets:

```text
normal_step_input: 3k-10k tokens
complex_step_input: 10k-25k tokens
exceptional_step_input: allowed only after explicit expansion
```

Hard caps should be enforced at the working-set boundary:

```text
primary_refs: 20-40
secondary_refs: 20-60
readable_evidence: 20-60 snippets
navigation_refs: 10-30
region_summaries: 5-20
text_per_ref: bounded by role and reason
```

These numbers are starting guardrails, not benchmark tuning. They should be adjusted only from cross-task diagnostics.

## 11. Semantic Capture Strategy

Phase 1 should correct planner-state architecture using the current capture substrate.

Phase 2 should introduce an accessibility-first capture path:

```text
Chrome Accessibility.getFullAXTree
  -> semantic roles/names/states
  -> stable backend node linkage
  -> cursor-interactive DOM supplement
  -> BrowseGent ref model
```

The reason to delay AX-first substrate work is risk control. If we rewrite capture before fixing working-set semantics, we may only create a better full-page dump. Working-set selection must be correct first.

## 12. Visual/Image Strategy

Screenshots and vision should be selective.

Use visual evidence when general signals show DOM/AX is insufficient:

```text
high SVG/canvas density
math rendered as image/SVG
map UI with visual-only information
repeated failed DOM reads
answer section present but text unavailable
shadow/iframe ambiguity
click target visible but semantic state inconsistent
```

The planner should receive a compact visual observation result, not raw screenshot data by default.

## 13. Loop and Self-Healing Strategy

Self-healing should be introduced as graph/routing behavior, not as vague retrying.

Required signals:

```text
same action same ref no progress
same read same value no progress
same failure same ref
transition none after mutation
visible in projection but hidden at execution
target blocked by overlay
state hash unchanged after action
```

Allowed recovery actions:

```text
reobserve
scroll to target
wait for pattern
dismiss likely overlay using visible close/accept controls
choose alternative matching ref
request scoped snapshot
use keyboard fallback
use visual inspection
stop with dead-state evidence
```

Retries must be bounded and justified by evidence.

## 14. Diagnostics and Governance

Every planner call should record:

```text
selectedRefCount
observedRefCount
droppedRefCount
selectedByReason
droppedByReason
sectionBytes
estimatedTokens
actualProviderTokens when available
topRefScores
loopRisk
expansionToolUsed
```

Benchmark reports should expose:

```text
pass/fail
failure type
planner calls
tool calls
input tokens
output tokens
max planner input bytes
max working set bytes
selected refs per step
drop reasons
manual review flag
environment block flag
```

This gives us quality and efficiency evidence without tuning against benchmark answers.

## 15. Implementation Phases

### Phase 1: Working Set Contract

Create the planner working-set types and serializer. Preserve current behavior behind tests while adding the new contract in parallel.

Expected outcome:

```text
Planner input can be generated from a bounded selected set.
Diagnostics explain what was included and omitted.
No browser behavior changes yet.
```

### Phase 2: Graph-Backed Selection

Add `PlannerWorkingSetSelector` and connect it to Brain1 projection, graph snapshot, transition evidence, failure evidence, and last result.

Expected outcome:

```text
Planner receives selected refs and summaries instead of full ref catalog.
Graph materially affects context selection.
No benchmark-specific rules.
```

### Phase 3: Planner Prompt Contract

Update planner prompt to understand the new schema and expansion tools.

Expected outcome:

```text
Planner reasons over working-set state.
Planner asks for targeted expansion when needed.
Planner stops assuming full ref facts are always present.
```

### Phase 4: Runtime Recovery Signals

Improve error classification, loop evidence, dead-state evidence, and bounded recovery options.

Expected outcome:

```text
Repeated no-progress loops become recover, expand, or stop decisions.
Timeout versus hidden/blocked execution errors are classified correctly.
```

### Phase 5: Accessibility-First Capture

Introduce Chrome AX tree capture as the primary semantic source, with DOM cursor-interactive supplement.

Expected outcome:

```text
Cleaner semantic refs.
Less generic cursor-pointer noise.
Better parity with agent-browser-style snapshots.
```

### Phase 6: Selective Visual Evidence

Add visual inspection only for DOM/AX-insufficient states.

Expected outcome:

```text
Visual-heavy tasks get support without making every step expensive.
```

## 16. Testing Strategy

Testing must be architecture-first, not benchmark-first.

Unit tests:

```text
working set excludes hidden/offscreen low-value refs
working set keeps last failed target with failure reason
working set keeps recently appeared refs
working set keeps answer-candidate readable evidence
working set summarizes dense repeated regions
working set records dropped reason counts
graph transitions affect selected refs
planner input does not include selector candidates or backend ids
planner input stays under configured byte budget for synthetic large pages
```

Integration tests:

```text
simple form task still completes
search and answer task still completes
repeated no-progress task triggers recovery or dead-state evidence
large synthetic page keeps planner input bounded
hidden generic DOM noise does not dominate planner input
```

Benchmark readiness tests:

```text
five-task WebVoyager-lite smoke only after unit/integration pass
compare pass/fail and token profile before and after
manual review for environment blocks and reference mismatches
no task-specific code changes based on benchmark failures
```

## 17. Success Criteria

Architecture success:

```text
Graph snapshot affects planner-visible state.
Planner no longer receives all observed refs by default.
Selected refs have explainable inclusion reasons.
Dropped refs have explainable omission reasons.
Expansion tools replace eager full-page inclusion.
```

Efficiency success:

```text
Normal planner input drops from tens/hundreds of KB to a bounded working set.
No million-token five-task runs caused by repeated full-page state.
Output token behavior remains small.
Input token use becomes predictable.
```

Quality success:

```text
No regression on local smoke tasks.
Fewer repeated no-progress loops.
Better recovery from hidden/blocked/stale refs.
Better answer extraction when evidence is visible in page state.
```

Governance success:

```text
No benchmark-specific tuning.
Every heuristic has a domain-general reason.
Every benchmark improvement can be traced to architecture-level behavior.
```

## 18. Approval Gate

Implementation should not begin until this design is reviewed and accepted.

After approval, the next artifact should be an implementation plan in:

```text
docs/superpowers/plans/2026-05-30-planner-working-set-implementation-plan.md
```

That plan should use TDD, small tasks, and verification gates before any benchmark rerun.
