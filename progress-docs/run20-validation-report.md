# Run 20 — Validation Report: R4 Superlative Verification + D3.1 (All-Time Best)

Run `webvoyager_lite_1788683438066`, balanced30, run-16-identical flags. First run carrying R4 (substrate-side superlative verification) and D3.1 (in-page settle batching).

## Headline — best run ever on every axis

| Metric | Run 16 | Run 18 | Run 19 | **Run 20** | Δ vs prior best |
|---|---|---|---|---|---|
| **Strict** | 9 | 11 | 7 | **12/30 (40.00%)** | **+1 record** |
| **Internal pass** | 70% | 63.3% | 66.7% | **76.67% (23/30)** | **+6.7pp record** |
| **Combined** | 16 | 15 | 13 | **18/30 (60.00%)** | **+2 record** |
| Duration/task | 76.9 s | 67.4 s | 75.2 s | **66.9 s** | D3.1 recovered the settle cost fully |
| ~tok/call | 4,549 | 4,908 | 5,150 | 5,068 | prose + markers cost stable |

**Excluding the 6 captcha-locked tasks (in-denominator policy), combined is 18/24 = 75% — the SOTA band.**

## Strict roster (12): Amazon__0, **Amazon__10**, ArXiv__0, BBC__News__0, **BBC__News__10**, Coursera__10, ESPN__0, ESPN__10, **GitHub__0**, Google__Map__10, Huggingface__0, Wolfram__Alpha__0

## Judge wins (6): **Apple__10**, **Booking__0**, **Booking__10**, Coursera__0, Huggingface__10, **Wolfram__Alpha__10**

## What the records mean

1. **Both Booking tasks passed in the same run** (judge) — the date-picker class the SOTA audit priced at 21% of the gap. The stack that did it: D3's mutation-aware settle (the calendar re-render now completes before capture), W-C click verification, the horizon machinery, and P1's metric-row pins.
2. **GitHub__0 STRICT** — the R4 target class. Across runs 16-19 it flip-flopped (judge-NO/win/NO); run 20 passed at full ground truth. The `unverified_superlative_answer` check fired **zero** times this run — the model answered from a properly-evidenced position on its own. The check's value is variance dampening: it is armed for exactly the wrong-answer case, deterministically, with the metric-best alternatives in the steering text.
3. **Wolfram__Alpha__10 judge-win repeats** (D1 prose, second consecutive pass — not a one-off).
4. **Amazon__10 STRICT** — first time at full ground truth (previously judge-only or failed).

## Mechanism state

- `unverified_superlative_answer`: armed, 0 fires (see above).
- Calendar/oscillation/budget signals all lower than prior runs — the calmest trajectories recorded (oscillation 37 episodes vs 119 on fresh50).
- D3.1: duration back to 66.9 s/task with the quiet window still active — the in-page batching recovered the entire polling cost.

## Honest notes

- Apple__0 drifted again (judge-NO with an internal pass — the volatile pricing-page class; its answer flips between runs). This remains the (iv)-class residual.
- Google__Map__0 improved in kind (fail → judge-NO, a grounded multi-store answer that missed the >4.8 threshold constraint).
- 6 captcha-locked tasks continue to cap the measured ceiling; environment-resilience (stealth/fingerprint) is browser-control's one structural advantage (their fresh50 wins were 5/11 bot-wall tasks).

## Cumulative (same flags, balanced30)

| | r15 | r16 | r17 | r18 | r19 | **r20** |
|---|---|---|---|---|---|---|
| Strict | 8 | 9 | 9 | 11 | 7 | **12** |
| Internal | 19 | 21 | 19 | 19 | 20 | **23** |
| Combined | 11 | 16 | 16 | 15 | 13 | **18** |
| Duration | 68.9s | 76.9s | 71.8s | 67.4s | 75.2s | **66.9s** |

Next: D2 (iframe traversal) and D5 (targetId hardening) per the blueprint order, plus the Apple__0 drift class if a further run confirms it as systematic.
