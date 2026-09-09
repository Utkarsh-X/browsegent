# Cross-Model Parity Verdict: stealth/ox-alpha vs gemini-3.1-flash-lite (balanced30 / webvoyager-lite)

Date: 2026-08-24
Status: verdict delivered; feeds Step B prioritization and WebArena pilot rationale
Runs compared (all `browsegent` adapter, PRC serialization, paced):

| Run | Model | Internal | Strict | Env-adj strict | Partial | Env blocks |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `webvoyager_lite_1787420313020` (Aug 22 baseline) | gemini-3.1-flash-lite | 63.3% (19/30) | 26.7% (8/30) | 33.3% | 30.0% | 6 |
| `webvoyager_lite_1787536192417` (stealth panel) | openrouter/stealth/ox-alpha | 60.0% (18/30) | 33.3% (10/30) | 38.5% | 36.7% | 4 |
| `webvoyager_lite_1787529412865` (competitor, same model) | browser-use-local | 6.7% (2/30) | 3.3% (1/30) | 3.3% | 5.0% | 0 |

Reference baselines from the July/Aug comparative report: internal 63.3%, strict 26.7–33.3%, env-adj 33.3–41.7%.

## Headline judgment

**Model capacity did not move our ceiling on this benchmark.** Internal completion went
19 → 18 tasks (net −1); strict went 8 → 10 (+2), of which both Google Search tasks were
env-blocked in the Lite run and runnable in the stealth run — i.e. environment variance,
not capability. Like-for-like real flips:

- Stealth strict gains: Amazon__10, BBC__News__0 (both genuine reading fixes).
- Stealth losses vs Lite: ESPN__10 (answered bare "Gamecast"), Google__Map__10,
  GitHub__10, Apple__10, Booking__0, Huggingface__10.

Cost of the reasoning model for a noise-level delta:

- Avg planner calls 6.77 → 8.67 (+28%), tool executions 6.30 → 8.33 (+32%).
- Provider attempts/calls 219/203 → 269/260; payload 4.26 MB → 5.65 MB.
- Per-task latency p50 449 s, p95 1,122 s; provider phase total ≈ 14.26 M ms (~3.96 h).

## The smoking gun: computed answers override read facts

`GitHub__10` ("Copilot Individual cost per year"): the page states $10/month or
**$100/year**.

- flash-lite answered: "$10 USD per month or **$100 USD per year**" (read).
- stealth answered: "$10 per month, which totals **$120 per year**" (computed $10×12,
  overriding the annual price printed on the page).

A powerful reasoner will substitute inference for perception exactly when the page
already contains the fact. This is the strongest single argument for the planned
deterministic answer-vs-read cross-check.

## Failure taxonomy of the stealth run's 20 strict failures

- **Environment blocks (4)** — Allrecipes__3/__10 (Cloudflare Turnstile),
  Cambridge Dictionary__0/__10.
- **Stale/impossible gold (≈9)** — no agent can win these as scored:
  - Apple__10: gold frozen at "MacBook Pro M3"; current hardware is M4/M5 (Lite said M4, stealth said Air M5 — both truthful for today, both scored 0).
  - Booking__0: gold is the literal string "Be Local".
  - Booking__10: gold pinned to Feb 14–21 **2024**; question normalized to 2027 by our harness.
  - ESPN__10: gold is an unfilled template `<score>; <summary>`.
  - Coursera__0/__10: gold courses retired/renamed; live catalog has valid alternatives.
  - Huggingface__0: over-constrained gold (one specific sentiment model among many valid).
  - Huggingface__10: Space deleted upstream (404) — dead task.
- **Live-data drift with "possible"/real-time gold (≈4)** — Flights__0/__10 (2024 fare
  snapshots vs today's prices; stealth's NY→Tokyo answer was a genuinely correct current
  cheapest itinerary), Map__0 (>4.8-rated salons drift), Search__10 (Billboard #1 this week).
- **Genuine agent-side failures (≈2–3)** — the only truly winnable misses:
  - Google__Map__10 (Castle Mountains basic info): phone number (760) 252-6100 was on the
    page; neither run captured it. Stealth honestly refused internally; Lite passed while
    also missing it.
  - Wolfram__Alpha__10 ("give the geomagnetic field…"): gold = total field strength
    51.5 µT; both models reported declination instead — answer-selection/completeness gap.
  - ArXiv__10 (borderline): right help page section, phrasing diverges from gold text.

Excluding env blocks and stale/drifted gold, the winnable-task score is ≈ 10/17 ≈ 59%
— that is the honest number this benchmark can express about us right now.

## Competitor run corroboration

Browser-Use under the same stealth model collapsed to avg 0.37 planner calls/task
(died on call #1): hard 75 s client timeout vs >80 s thinking, rigid JSON schema parsing
vs prose/fenced output, no upstream 429 retry. Its 6.7%/3.3% measures harness
brittleness, not agent quality — confirming that cross-agent scores on this benchmark
under heavy models are currently dominated by infrastructure, exactly as suspected.

## Consequences for the plan

1. **Step B reordering (data-driven).** Dropdown/calendar robustness showed no visible
   failure in this panel (Booking/Flights date construction worked under both models).
   The dominant winnable gaps are (a) answer completeness/selection (Map__10 phone,
   Wolfram total-field) and (b) answer grounding (GitHub $120-computed). Priority:
   deterministic claim↔evidence cross-check at finalization first, interaction
   robustness second, calendar third.
2. **Cross-check design constraint (Codex-clean).** Runtime exposes per-claim evidence
   match/mismatch only; the planner remains sole semantic authority and decides retry vs
   accept. No site/task-specific rules; fixture-gated unit tests.
3. **WebArena pilot rationale strengthened.** WebArena's deterministic end-state
   evaluators remove categories B and C entirely (no gold-text matching against live
   sites), so measured deltas there reflect capability, including model-capacity deltas
   that WebVoyager-lite structurally cannot express.
4. **Model-capacity hypothesis (user's):** partially confirmed but redirected — capacity
   is not our binding constraint on webvoyager-lite; grounding/evidence completeness is.
   Capacity differences will only become measurable on deterministic-evaluator benches.
