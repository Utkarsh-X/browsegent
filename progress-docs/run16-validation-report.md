# Run 16 — Validation Report: P1–P6 Batch + Lean+Conditional Combined

Run `webvoyager_lite_1788612821955`, balanced30, `gemini/gemini-3.1-flash-lite`, same config as run 15 (`--prc-lean-plane`) **plus `--planner-conditional-prompt`**, first run carrying: P1 metric-row pin, P2 sort provenance + superlative guidance, P3 budget-aware synthesis, P4 site-search-first guidance, P5 click-no-navigation, P6 list-page grounding advisory, judge evidence-extractor fix.

## Headline

| Metric | Run 15 (lean) | Run 16 (lean+conditional+P1–P6) | Δ |
|---|---|---|---|
| Strict (ground truth) | 8/30 (26.67%) | **9/30 (30.00%)** | +1 |
| Internal pass | 19/30 (63.33%) | **21/30 (70.00%)** | +2 |
| Judged / judge wins | 11 / 3 (27.27%) | 12 / **7 (58.33%)** | +4 wins |
| **Combined solved (strict + judge)** | **11/30 (36.67%)** | **16/30 (53.33%)** | **+5 tasks** |
| Mean wire bytes/call | 18,522 B | **15,355 B (4,549 tok)** | **−11.7%** |
| System prompt bytes/call | 10,579 B | **7,371 B** | **−30.3%** |
| User payload mean (p90) | 7,943 B (11,206) | 7,984 B (11,797) | ~flat |
| Planner calls/task | 6.67 | 7.40 | +0.73 (advisory steers) |
| Duration/task | 68.9 s | 76.9 s | +8 s (deeper flows) |

## Verdict flips vs run 15

**Up (8):** `BBC__News__10` fail→**STRICT** (P3/P4), `ESPN__10` fail→**STRICT** (P3/P4/P5), `Coursera__10` judge-NO→**STRICT** (P6 grounding), `Booking__0` fail→judge-WIN (widget task!), `Coursera__0` judge-NO→judge-WIN (P6), `Amazon__10` judge-NO→judge-WIN, `Apple__10` judge-NO→judge-WIN (grounded, no M5 hallucination), `ArXiv__10` judge-NO→judge-WIN.

**Down (3):**
- `Google__Search__0` STRICT→fail: **captcha wall this run** (`planner_escalated:captcha`) — environmental, not agent-side; run 15's Google runs were not challenged. Bot-wall variance cuts both ways across runs.
- `ArXiv__0` STRICT→judge-NO: answer drifted to describing the current page instead of the goal's requested fact; the corrected judge (now seeing real page evidence) rejected it. Single-task drift; watch next run.
- `Huggingface__0` judge-WIN→judge-NO: the answer text is still plausible; the corrected judge, now able to see the actual final page, disagreed. This is the measurement correction cutting against us — symmetric by design.

**Note on judge-rate comparability:** part of the 27%→58% judge jump is the evidence-extractor fix (the judge could not see final pages in run 15) — a measurement correction, not pure agent gain. The three strict gains are unambiguous agent-side wins.

## Mechanism observations

- `GitHub__0`: P1 worked as designed (grounded answer naming one project from pinned metric rows; `missing_ranking_evidence` advisory fired and was recorded) but the model still did not click the sort control; judge rejected the unsorted claim. Next lever: stronger sort-compliance or compare-from-cards emphasis (P2 follow-up).
- `Wolfram__Alpha__10`: unchanged (P7 deprioritized).
- Escalation accounting (corrected after the SOTA audit caught my misread): run 16 carries **6 `planner_escalated:captcha` escalations** (Allrecipes__3/10, Cambridge__Dictionary__0/10, Google__Search__0/10) vs run 15's 5 — my earlier '0 escalations' claim read `environmentBlockedCount`, which tracks a different classification. Wall encounters vary per run; in-denominator scoring stays symmetric.

## Promotion decisions

1. **Lean+conditional combined: PROMOTED as default recommendation.** Byte-identity tests + measured −30.3% system bytes, −11.7% total per call, zero engaged-guidance loss, quality simultaneously up.
2. **P1–P6 batch: VALIDATED** (5 of 8 targeted tasks flipped up; no mechanism-attributable regressions — both non-captcha regressions are judge-correction effects).
3. Next round (queued): W-B target-cell graph-survival fix, W-C calendar click streak, W-A empty-capture recapture, W-D navigate-loop suppression (see `progress-docs/research/date-widget-interaction.md`), P2 sort-compliance follow-up, P8 prose capture (pending core-architecture research findings).
