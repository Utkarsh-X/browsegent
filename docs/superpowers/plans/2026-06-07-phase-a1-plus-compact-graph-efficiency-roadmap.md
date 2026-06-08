# Phase A1+ Compact Graph Efficiency Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans when converting any phase below into exact implementation tasks. This roadmap is a phase-level execution strategy, not a code-level task list.

**Goal:** Turn BrowseGent's Brain1/Brain2/ContinuityGraph architecture into a compact, efficient, reliable planner substrate that can beat Browser Use on token efficiency and match or exceed it on task quality.

**Architecture:** Keep graph intelligence in the control plane and expose only compact indexed planner views. Runtime changes must be telemetry-first, then shadow, then enforced only after quality and efficiency gates pass.

**Tech Stack:** TypeScript, BrowseGent V2 runtime, existing WebVoyager-lite benchmark harness, existing trace artifacts, Gemini model/key pool, Browser Use comparison adapter.

**External Pattern Used:** Browser Use and Alumnium validate compact agent-facing state. Vercel Agent Browser adds a direct ref-based operating pattern: compact interactive snapshot, explicit stale-ref lifecycle, runtime ref map, semantic fallback locators, disciplined waits, and output caps.

---

## Roadmap Overview

| Phase | Name | Purpose | Runtime Behavior Change |
| --- | --- | --- | --- |
| Phase A1 | Compact View Telemetry | Generate compact planner view beside current planner input | No |
| Phase A2 | Ref Resolution Control Plane | Reduce ambiguous/stale/blocked ref failures below planner | Yes, local runtime only |
| Phase A3 | Compact View Shadow Planner | Call or validate compact planner path in shadow mode | Optional/shadow only |
| Phase A4 | Compact View Enforcement | Use compact planner input for selected stable tasks | Yes, gated |
| Phase A5 | Graph-Informed Brain1 | Make Brain1 projection actually graph-informed | Yes |
| Phase A6 | Read/Action/Check Lanes | Separate mutation, extraction, and verification control | Yes |
| Phase A7 | Benchmark Expansion | Move from MVR5-stable to repeated MVR30-stable comparison | No product logic |
| Phase A8 | Production Hardening | Final reliability, observability, cost, docs, release gates | Yes |

---

## Phase A1: Compact View Telemetry

### Objective

Add compact planner view generation to runtime telemetry without changing the planner prompt or behavior.

### Why First

The offline prototype reduced planner payloads to roughly `10-15%` of current size. Before enforcing it, we must prove it can be generated reliably during real runs and that it preserves the candidates needed for actual successful actions.

### Work Items

- Move or adapt `tests/benchmark/v2/compact_planner_view.ts` concepts into a runtime-safe module.
- Generate compact view for every planner episode.
- Log compact view size beside current planner input size.
- Log whether compact view resembles the intended agent-facing contract:
  - compact interactive/action refs,
  - compact readable evidence,
  - compact recovery state,
  - no duplicated full `current` plus `workingSet` ref arrays.
- Log coverage:
  - whether the actual chosen action ref appears in compact actions,
  - whether successful read refs appear in compact reads,
  - whether failed refs are represented as recovery/quarantine signals,
  - how many selected refs were omitted.
- Log stale-ref lifecycle evidence:
  - snapshot or observation epoch,
  - whether a chosen ref came from the current epoch,
  - whether page mutation occurred before the next ref interaction.
- Add trace artifact for compact view.
- Keep existing planner input unchanged.

### Metrics

- Compact/current byte ratio.
- Action-ref coverage percentage.
- Read-ref coverage percentage.
- Missing successful action refs.
- Missing successful read refs.
- Per-section size reduction.
- Duplicated-state bytes removed.
- Stale-ref interaction count.

### Gate

Proceed only if:

- compact view <= `35%` of current planner input on average,
- compact view contains >= `95%` of successful action refs from current runs,
- compact view contains >= `90%` of successful read/finalization evidence refs,
- no runtime behavior changes were introduced.

### Main Concern

Compact view may drop structural details needed for disambiguation. If coverage is low, do not enforce compact mode. Improve compact view design first.

---

## Phase A2: Ref Resolution Control Plane

### Objective

Reduce planner-loop waste by solving common ref execution failures below the planner.

### Target Failures

- `ambiguous_ref_resolution`
- `low_confidence_ref`
- `target_blocked`
- `timeout` caused by action targeting uncertainty

### Work Items

- Add a ref-resolution audit for each failed action.
- Record why a ref is ambiguous:
  - same accessible name,
  - same role,
  - same bounding box,
  - same target ID,
  - duplicated DOM nodes,
  - stale continuity mapping,
  - overlay/occlusion.
- Add resolver strategies:
  - prefer same snapshot/observation epoch,
  - reject stale refs after meaningful page mutation unless self-healed,
  - prefer cached browser/backend node identity if available,
  - prefer visible ready node,
  - prefer highest continuity confidence,
  - prefer current focused/near-focus region,
  - prefer region/list position,
  - prefer exact target ID if available,
  - fallback to stable name/role/attribute matching.
- Add semantic fallback locator categories when direct refs fail:
  - role plus accessible name,
  - label,
  - placeholder,
  - visible text,
  - test id or stable attribute,
  - scoped region/list position.
- Return precise failure metadata if still unresolved.
- Do not ask planner to try random alternate refs.

### Metrics

- Ref failures per task.
- Repeated target failures.
- Planner calls after ref failure.
- Successful self-healed actions.
- False self-heal count from trace/manual review.
- Stale-ref rejections.
- Semantic fallback successes.

### Gate

Proceed only if:

- `ambiguous_ref_resolution` drops by at least `50%` on MVR5-stable,
- no new wrong-click/wrong-type regressions appear in traces,
- planner calls drop on ArXiv/GitHub-like tasks.

### Main Concern

Self-healing can become dangerous if it silently chooses the wrong equivalent element. Prefer conservative failure with explicit metadata over unsafe execution.

Destructive or high-risk actions should not silently self-heal unless confidence is very high and the trace records the exact matching reason.

---

## Phase A3: Compact View Shadow Planner

### Objective

Test whether a planner could operate from compact view without enforcing the result.

### Work Items

- Build compact-view planner input schema.
- Build compact-view planner prompt variant.
- Use small stable planner indexes mapped internally to runtime refs.
- Preserve runtime-only details outside the prompt:
  - full ref metadata,
  - graph evidence,
  - selector/identity candidates,
  - raw observations.
- In shadow mode, run compact planner call only on limited tasks or offline trace replay.
- Compare compact planner proposed action against production planner action.
- Do not execute compact planner actions.
- Store disagreement reports.

### Metrics

- Agreement with current planner on successful steps.
- Compact planner invalid-output rate.
- Compact planner input/output tokens.
- Cases where compact planner chooses better/fewer steps.
- Cases where compact planner lacks necessary evidence.

### Gate

Proceed only if:

- compact planner has low invalid-output rate,
- compact planner proposes equivalent or better actions on most successful steps,
- token usage is near or below Browser Use for same tasks.

### Main Concern

Shadow planner adds cost. Run selectively and use existing traces where possible.

---

## Phase A4: Compact View Enforcement

### Objective

Use compact planner input as the real planner substrate on a controlled stable slice.

### Work Items

- Add feature flag:
  - current mode,
  - compact telemetry mode,
  - compact shadow mode,
  - compact enforced mode.
- Start enforcement on MVR5-stable only.
- Keep automatic rollback to current planner input if compact view misses required coverage.
- Treat compact view as the planner API contract:
  - planner chooses stable planner indexes,
  - runtime maps indexes to refs or semantic locators,
  - runtime handles stale/ref-resolution failures below planner when safe.
- Add release gate comparing current vs compact:
  - manual-corrected score,
  - strict score,
  - input tokens,
  - planner calls,
  - ref failures.

### Metrics

- Manual-corrected success.
- Input-token ratio versus current BrowseGent.
- Input-token ratio versus Browser Use.
- Planner-call ratio versus Browser Use.
- Tool-execution ratio versus Browser Use.
- Ref failure count.

### Gate

Proceed only if over 3 repeated MVR5-stable runs:

- no manual-corrected score regression,
- input tokens <= `1.2x` Browser Use,
- planner calls <= `1.3x` Browser Use,
- repeated/invalid/ref failures do not increase.

### Main Concern

If quality drops, do not patch per task. Analyze missing compact evidence and ref-resolution failure classes.

---

## Phase A5: Graph-Informed Brain1

### Objective

Make Brain1 projection genuinely use ContinuityGraph and transition evidence.

### Current Gap

`ProjectionService.project()` accepts graph snapshot but does not materially use it. This means the current projection is not fully exploiting the architecture.

### Work Items

- Use graph presence/staleness/confidence in candidate scoring.
- Use transition changed/appeared refs to prioritize new evidence.
- Use repeated regions to represent lists/tables compactly.
- Use failure history to demote unsafe candidates.
- Use graph continuity to assign stable planner indexes.
- Produce compact region summaries instead of flat repeated refs.
- Add one lightweight snapshot-ref-map concept:
  - current observation epoch,
  - stable planner index,
  - runtime ref id,
  - identity/confidence reason,
  - stale-after-mutation marker.

### Metrics

- Selected ref count.
- Candidate coverage.
- Correct top candidate rate on historical traces.
- Token size reduction.
- Ref failure reduction.

### Gate

Proceed only if:

- graph-informed ranking improves or preserves successful action/read coverage,
- selected refs reduce without quality loss,
- list/ranking tasks expose better structured evidence.

### Main Concern

Over-scoring graph continuity can preserve stale or wrong refs. Fresh observation evidence must remain authoritative.

---

## Phase A6: Read/Action/Check Lanes

### Objective

Introduce explicit operation lanes without rewriting the whole loop.

### Lanes

Action lane:

- mutating operations: click, type, select, navigate, press, scroll.

Read lane:

- read-only operations: get, inspect region, extract list/table, search page.

Check lane:

- verification operations: assert page state, answer completeness, sorted/ranked evidence, target reached.

### Work Items

- Add lane metadata to compact planner view.
- Enforce lane-compatible refs.
- Require page-changing actions to carry or infer a wait strategy when possible:
  - expected text,
  - expected element/region,
  - URL pattern,
  - load state.
- Keep blind time waits as a last-resort fallback and trace them explicitly.
- Make finalization use read/check evidence rather than raw planner confidence.
- Add completeness contracts:
  - named entity,
  - numeric answer,
  - ranked result,
  - multi-slot answer such as address + hours + phone.

### Metrics

- False-positive final answers.
- Missing required answer slots.
- Read-before-finalize rate.
- Action attempts on read-only refs.
- Mutating actions after sufficient evidence.
- Blind fixed waits after mutating actions.

### Gate

Proceed only if:

- false positives decrease,
- answer completeness improves,
- planner calls do not increase materially.

### Main Concern

Do not create a second planner. Lanes are runtime constraints and compact state organization, not a new architecture layer.

Do not copy Agent Browser's CLI workflow literally. BrowseGent is an autonomous agent loop, so these lanes should be internal contracts and telemetry, not a command-line scripting layer.

---

## Phase A7: Benchmark Expansion

### Objective

Move from MVR5-stable smoke tests to reliable competitor comparison.

### Work Items

- Freeze MVR5-stable for regression.
- Build MVR30-stable from valid WebVoyager tasks.
- Exclude known impossible tasks.
- Add manual audit rubric.
- Add optional calibrated LLM judge only after manual calibration.
- Run BrowseGent and Browser Use on same tasks, model, rate limit, timeout, browser mode, and scoring.

### Metrics

- Strict score.
- Manual-corrected score.
- Partial-credit score.
- Environment-adjusted score.
- Input/output tokens.
- Planner/tool calls.
- Duration.
- Ref failure categories.
- Variance over 3 runs.

### Gate

Proceed only if:

- MVR5-stable is stable across repeated runs,
- MVR30-stable task metadata is reviewed,
- competitor comparison method is identical across adapters.

### Main Concern

Do not use benchmark results as training targets. Use them as signals for general failures.

---

## Phase A8: Production Hardening

### Objective

Prepare the architecture for production-quality open-source release.

### Work Items

- Stabilize public API.
- Document architecture and benchmark method.
- Add cost/rate-limit observability.
- Add trace viewer or trace summarizer.
- Add safe defaults for model, max steps, compact mode, and browser mode.
- Add release gates:
  - unit tests,
  - build,
  - V2 checks,
  - MVR5-stable,
  - compact efficiency gate,
  - no secret/log artifact leakage.

### Metrics

- Local install success.
- Benchmark reproducibility.
- Average cost per task.
- Task success quality.
- Recovery behavior.
- Trace completeness.

### Gate

Proceed only if:

- compact architecture is enforced or clearly positioned,
- Browser Use comparison is honest and reproducible,
- no major unresolved architectural ambiguity remains.

---

## Cross-Phase Risks

### Risk: Compact View Drops Useful Structure

Mitigation:

- telemetry before enforcement,
- coverage checks,
- shadow planner,
- ref-resolution audit.

### Risk: Borrowed Patterns Overfit BrowseGent Toward A Simpler Tool

Mitigation:

- use Agent Browser only for compact snapshot/ref lifecycle discipline,
- keep Brain1/Brain2/ContinuityGraph as internal intelligence,
- measure whether graph-derived compact state beats plain interactive snapshots,
- pivot only if graph-derived state fails the explicit gates.

### Risk: Runtime Self-Healing Clicks Wrong Element

Mitigation:

- conservative confidence thresholds,
- trace every self-heal decision,
- manual review wrong-action cases,
- never silently self-heal destructive actions.

### Risk: Graph Adds Complexity Without Value

Mitigation:

- require measurable improvements:
  - lower tokens,
  - fewer steps,
  - fewer ref failures,
  - equal/better manual-corrected quality.

### Risk: Benchmark Overfitting

Mitigation:

- no site-specific code,
- stable and holdout slices,
- repeated runs,
- manual audit,
- compare failure classes, not only scores.

### Risk: Multiple Architecture Changes At Once

Mitigation:

- telemetry,
- shadow,
- enforced only after gates,
- one major runtime change per phase.

---

## Review Questions Before Phase A1 Implementation

1. Should compact planner view initially include region/list summaries, or should Phase A1 measure action/read coverage first and add region summaries only if needed?
2. What is the acceptable initial compact/current ratio target for telemetry: `35%`, `25%`, or more aggressive?
3. Should compact mode preserve `refId` in planner output, or introduce smaller stable planner indexes with runtime mapping?
4. Should self-healing ref resolution be designed before compact enforcement, or can it run in parallel as Phase A2?
5. What benchmark gate should be considered failure severe enough to pivot away from graph-facing planning?
6. Should Phase A1 compare graph-derived compact view against a plain Agent-Browser-style interactive snapshot baseline?

## Recommended Next Step

Create a precise Phase A1 implementation plan only after this roadmap is reviewed.

Phase A1 should be limited to:

- runtime compact view telemetry,
- trace artifacts,
- coverage metrics,
- size metrics,
- stale-ref lifecycle metrics,
- optional plain interactive snapshot baseline for comparison,
- no planner prompt changes,
- no production behavior changes.
