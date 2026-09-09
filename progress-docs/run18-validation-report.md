# Run 18 — Validation Report: W-C + C1 + D1 Prose Capture + Recovery Hook

Run `webvoyager_lite_1788634111591`, balanced30, `gemini/gemini-3.1-flash-lite`, run-16-identical flags. First run carrying: W-C calendar click verification, C1 href-vs-landed advisory, D1 bounded prose capture, and the recovery-path pick_option hook.

## Headline

| Metric | Run 16 | Run 17 | Run 18 | Δ (18 vs best prior) |
|---|---|---|---|---|
| **Strict (ground truth)** | 9/30 | 9/30 | **11/30 (36.67%)** | **+2 — best ever** |
| Internal pass | 21/30 | 19/30 | 19/30 | = |
| Judge wins | 7/12 | 7/10 | 4/8 | judge-sample noise (8 judged) |
| **Combined** | **16/30** | **16/30** | **15/30** | within variance band |
| User bytes mean | 7,984 B | 8,514 B | **7,784 B** | prose gate cost ~nothing |
| Planner calls/task | 7.4 | 6.8 | 6.43 | — |
| Duration/task | 76.9 s | 71.8 s | 67.4 s | — |

## The strict record and where it came from

**Strict 11/30** (Amazon__0, Apple__0, ArXiv__0, BBC__News__0, BBC__News__10, Coursera__10, ESPN__0, ESPN__10, Google__Map__10, Huggingface__0, Wolfram__Alpha__0). Judge wins: ArXiv__10, Coursera__0, Huggingface__10, **Wolfram__Alpha__10**.

- **Wolfram__Alpha__10 passed for the first time in 15+ runs** — internal pass AND judge-win. The answer ("approximately 0.506 gauss") is the D1-captured pod value (51.5 µT) with unit conversion — the prose capture did exactly what the blueprint predicted: the S2/S3 silence broke and the compound measurement became reachable.
- **ArXiv__0 strict** (full ground truth) and **ArXiv__10 judge-win** — the second prose-class casualty recovered; both ArXiv tasks pass in the same run for the first time.
- **BBC__News__0 STRICT** — the run-17 timeout-loss recovered.
- **Google__Flights__0 passed internally for the first time ever**: the flow reached a real results surface ("flight search results for Lucknow, India, which does not match the requested route" — an honest, grounded report). The substrate stack (prose gate n/a here; the type-churn/recovery machinery) moved the task from `v2_max_steps_exhausted` to a judged-flow.

## Mechanism verification

- **Prose gate**: prose reached **17/193** planner inputs (extract/verify modes on prose-poor pages), mean **150 B** on gated episodes — the wire cost of D1 is negligible and user bytes went DOWN vs run 17 (7,784 vs 8,514).
- **pick_option**: still 0 explicit plans — repeated_type_same_value did not fire this run on a suggestion-backed control, so the recovery hook never engaged. Remains armed for the Flights churn regime.
- **Must-not-regress guards held**: Amazon__0, Apple__0, both ESPN tasks, Google__Map__10, Huggingface__0/10, Wolfram__Alpha__0 — all strict passes intact. Amazon Enter flows untouched.

## Honest accounting

- **Booking__0/10 escalated dead_end honestly** (Booking served a 502 on __10; __0 reported the page did not provide the flow) — environment + honest escalation, not a regression of the W-C machinery (neither trajectory reached the date cells this run).
- **Combined 15 vs 16**: the delta is judge-sample variance (8 judged this run vs 10-12 prior) plus churn on Amazon__10/Apple__10/GitHub__0/10 — the same tasks that flip between every run. The strict metric (deterministic, judge-independent) is the trustworthy comparator, and it hit a new record.
- **GitHub__0 flip-flops between runs** (judge-WIN → judge-NO) — the sort-compliance variance the SOTA audit predicted; R4's substrate-side sort verification remains the structural fix.

## Cumulative trajectory (combined, same flags)

Run 15: 11/30 → Run 16: 16/30 → Run 17: 16/30 → Run 18: 15/30 combined / **11 strict**. The strict trend is the cleanest signal of the mechanism stack's real effect: 8 → 9 → 9 → 11 across four runs while per-call wire cost stayed ~4.5-5K tokens.

## Next (blueprint order)

D4 batched CDP identity (removes 150 sequential describeNode calls + the live-page marker mutation; shadow refs gain identity) and D3 stabilization quiet window — both de-risk every other mechanism. Then D2 iframes, D5 targetId hardening last.
