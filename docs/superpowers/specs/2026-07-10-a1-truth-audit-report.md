# Phase A1 — Architecture Truth Audit Report

**Date:** 2026-07-11
**Run:** `webvoyager_lite_1783748097228` (balanced30, gemini-3.1-flash-lite, PRC serialization)
**Score:** 63.3% internal pass, 41.7% environment-adjusted strict

---

## Exit Gate Verification

| Gate | Status | Detail |
|------|--------|--------|
| Trace completeness | ✅ | 30/30 tasks have `latency_ledger.json` + `action_outcomes.json` |
| No new failure class | ✅ | Only `{success, environment, step_exhaustion, planner_failure}` |
| All tests pass | ✅ | Build clean, 606 unit tests, V2 boundary + cognition checks |
| Top 2 identified | ✅ | `step_exhaustion (3)`, `planner_failure (2)` |

---

## Failure Categories

| Category | Count | % | Notes |
|----------|-------|---|-------|
| success | 19 | 63.3% | — |
| environment | 6 | 20.0% | Cloudflare/CAPTCHA blocks |
| step_exhaustion | 3 | 10.0% | Booking, Google Flights ×2 |
| planner_failure | 2 | 6.7% | Amazon, Coursera (invalid output dead end) |

> [!IMPORTANT]
> **Top 2 controllable failure categories:**
> 1. **step_exhaustion** (3 tasks) — agent uses all steps without reaching the goal
> 2. **planner_failure** (2 tasks) — planner produces invalid output after retry exhaustion

---

## Latency Breakdown (5 Independent Categories)

All 30 tasks instrumented. No composite `browsegent_owned` — each category is independent.

| Phase | Total | Avg/Task | % of Total |
|-------|-------|----------|------------|
| provider | 229.0s | 7.6s | 52.3% |
| unaccounted | 186.6s | 6.2s | 42.6% |
| observation_capture | 16.2s | 0.5s | 3.7% |
| browser_interaction | 4.9s | 0.2s | 1.1% |
| stabilization_wait | 1.0s | 0.0s | 0.2% |
| local_compute | 0.2s | 0.0s | 0.0% |
| **total** | **437.9s** | **14.6s** | **100%** |

> [!NOTE]
> Provider time dominates at 52.3%. The `unaccounted` bucket (42.6%) captures time between loop iterations
> (e.g., `progressMemory` processing, failure classification, uncertainty signals, dead state detection)
> that is not yet instrumented at phase granularity. This is the primary target for Phase A2 instrumentation refinement.

---

## Action Economy

| Metric | Total | Avg/Task | Notes |
|--------|-------|----------|-------|
| total | 273 | 9.1 | All action outcomes |
| dispatched | 271 | 9.0 | Actually executed by harness |
| preExecutionRejected | 0 | 0.0 | URL guard / validation |
| hardBlocked | 2 | 0.1 | Loop detector 3× repeat block |
| stateChanging | 80 | 2.7 | URL or generation changed |
| evidenceProducing | 26 | 0.9 | Successful get/inspect_region/search_page with text |
| failed | 59 | 2.0 | Dispatch failures |
| noEffect | 144 | 4.8 | Success but no state change + no evidence |

> [!WARNING]
> **52.8% of dispatched actions have no observable effect** (144/273). This is the single largest efficiency gap:
> the agent dispatches actions that succeed but produce neither state change nor read evidence.
> Phase A2 should investigate whether these are navigation-redundant scrolls, clicks on already-focused
> elements, or planner repetition loops below the hard-block threshold.

---

## Phase A2 Priority Recommendation

Based on the truth audit data, the recommended Phase A2 priorities (per design spec decision rules):

1. **Reduce no-effect actions** (52.8% waste rate) — Instrument which tool kinds produce no-effect outcomes
   and add planner feedback when consecutive no-effect actions are detected
2. **Address step exhaustion** (top controllable failure) — The 3 exhausted tasks (Booking, Google Flights ×2)
   suggest complex multi-step flows where the agent runs out of budget. Investigate whether better
   action selection or mid-task pruning can improve completion within budget
3. **Refine unaccounted latency** (42.6%) — Instrument the inter-step processing in V2AgentLoop
   (failure classification, uncertainty, dead state) to break down the unaccounted bucket
