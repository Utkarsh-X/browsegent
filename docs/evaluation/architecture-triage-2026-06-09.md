# BrowseGent Architecture Triage - 2026-06-09

## Verdict

BrowseGent is not close to production-grade browser-agent readiness yet. The current evidence does not prove that the Brain1/Brain2/ContinuityGraph architecture is fundamentally invalid, but it does prove that the current V2 implementation is not using that architecture in a reliability-winning way.

The system has moved from token-bloated full planner input to compact-enforced input, but compact enforcement exposed a more basic issue: the planner-facing action surface is not reliably presenting the right actionable candidates. Low token usage is not useful while the compact interface omits or buries the actual controls required to solve tasks.

## Evidence Baseline

- Latest comparison: `D:\BrowseGent\logs\webvoyager-lite\mvr5_comparison.md`
- Latest compact-enforced run: `webvoyager_lite_1780918177110`
- Latest compact-enforced result: 0/5 harness pass, 0/5 strict, 0/5 manual, 0/5 partial.
- Browser Use local reference row: 5/5 harness pass, 60% strict/manual/partial, but older key-pool diagnostics.
- BrowseGent compact-enforced token counts are lower than Browser Use, but the latest run failed early with only 2.00 average planner calls and 1.40 average tool executions.

This means the current comparison proves reliability weakness more than efficiency strength.

## Root Causes Found

### 1. Compact Candidate Loss

In the Cambridge Dictionary trace, the correct search input exists:

- `v2ref_59`
- role: `textbox`
- name: `Search`
- tagName: `input`
- inputType: `text`
- visibility: `visible`
- actionability: `ready`
- capabilities: `typeable: true`

It is present in the working set secondary refs and action surface, but compact view truncates the action list before it. The planner receives distractors like close buttons, dictionary tabs, privacy content, and readable-only entries before the actual search box.

This is not a model-quality issue. The runtime had the needed data and discarded it at the planner boundary.

### 2. Readable-Only Items Are Mixed Into Action Slots

Compact input currently includes `a*` entries whose tools are only `get`. Example from Google Maps:

```json
{"index":"a2","label":"Castle Mountains National Monument ...","tools":["get"]}
```

The model then attempted:

```json
{"tool":"click","ref":"a2"}
```

Validation rejected this because the ref is not clickable. The validator is correct; the planner-facing interface is confusing.

Competitor-style browser agents generally keep the agent-facing contract simple: interactive/action refs are actionable, read-only evidence is separate.

### 3. Generic Ranking Is Too Weak for Search/Form Tasks

The current ranking treats search inputs as normal candidates among many refs. On pages with hundreds of refs, broad signals like recently changed or goal keyword matches flood the candidate list.

For browser-agent reliability, finding the active search/input control is foundational. It should not depend on a generic top-24 truncation.

### 4. Compact Planner Invalid Output Is Terminal

`CompactPlannerClient` converts invalid compact output into `PLANNER_INVALID_OUTPUT`, and the agent loop terminates with `planner_invalid_output_dead_end`. That is appropriate for detecting contract failures, but too brittle for production execution.

The control plane should be able to recover from first-step compatibility mismatch by rebuilding a clearer lane-specific compact input, not by ending the task immediately.

### 5. Provider Failures Are Mixed With Planner Failures

The latest run includes two `planner_client_error:fetch failed` failures. These should be separated from architecture/planner failures before drawing conclusions.

Provider/network instability is real operational risk, but it should not be counted as evidence that the compact action surface is bad.

## Competitor Lessons

Browser Use, Agent Browser, and Alumnium converge on a simpler pattern:

- compact state representation;
- short element indexes/refs;
- clear distinction between actionable controls and readable evidence;
- strong actionability validation;
- fresh observation after page mutation;
- stale-ref recovery using stable element identity;
- optional visual reasoning only when structural state is insufficient.

BrowseGent should not copy their architecture wholesale. The graph layer can still be valuable, but it should operate behind a simple planner contract by improving ranking, stability, and recovery. The planner should not have to understand graph internals.

## Production Readiness Assessment

Current state: research prototype / unstable MVR, not production candidate.

Estimated readiness distance:

- Local MVR stability: not achieved.
- Benchmark trustworthiness: improving, but still limited by tiny MVR5 slice and older competitor baseline.
- Planner/action reliability: not achieved.
- Token efficiency: promising only after compact mode, but currently confounded by early failures.
- Production-grade claim: far away.
- SOTA/browser-use-beating claim: not supported by evidence.

The project should stop expanding benchmark machinery until the planner-facing action surface is reliable on the stable 5-task slice.

## Simplification Direction

The next architecture move should be simplification, not another major system layer.

### Keep

- Brain1 projection as the source of normalized browser state.
- Brain2/ContinuityGraph as control-plane memory for stability, ranking, and stale-ref recovery.
- Compact planner input as the intended low-token interface.
- Strict/manual/partial scoring as reporting, not as design drivers.

### Change

- Make the planner-facing compact input lane-based:
  - `typeable`: visible ready text/search/combobox inputs;
  - `clickable`: visible ready buttons/links/tabs/options;
  - `selectable`: select/combobox controls;
  - `readable`: text/evidence only;
  - `page`: URL/title/status.
- Do not put get-only refs into action slots.
- Guarantee a small quota of high-priority typeable controls for search/find/look-up tasks before generic ranked refs.
- Treat first-step action compatibility failures as recoverable control-plane events for one replan, not immediate dead ends.
- Separate provider errors from planner errors in reports and readiness gates.

### Avoid

- No benchmark-specific selectors, website logic, or golden-answer tuning.
- No more broad scoring/reporting expansion until the stable slice can pass reliably.
- No new planner brain/layer unless lane-based compact input fails after controlled testing.
- No claim that token use is better unless success rate is comparable.

## Minimum Next Implementation Target

Implement a small "action-lane compact input" correction:

1. Build compact lanes from the existing working set/action surface.
2. Exclude readable-only refs from action indexes.
3. Add explicit typeable quota and prioritization for search/form goals.
4. Preserve compact token discipline.
5. Add unit tests using the Cambridge failure fixture:
   - `v2ref_59` must appear in the typeable lane.
   - close/autocomplete button must not outrank the visible search input for a look-up/search goal.
6. Add unit tests using the Google Maps failure fixture:
   - get-only place summary must appear only in readable evidence, not clickable action candidates.
7. Rerun MVR5-stable once with Browsegent compact-enforced.
8. Only after Browsegent is stable on the slice, rerun Browser Use with a fresh key index starting at 26, then 31, then 36.

## Decision

Do not abandon the architecture yet. The current failure is more likely a planner-boundary/candidate-contract failure than proof that Brain1/Brain2/Graph is fundamentally wrong.

However, if lane-based compact input plus one controlled recovery pass still cannot reach reliable MVR5-stable performance, then the architecture should be simplified further toward a Browser Use / Agent Browser style accessibility-tree-first planner, with the graph retained only as optional execution recovery metadata.
