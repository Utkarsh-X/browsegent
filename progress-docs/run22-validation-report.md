# Run 22 — Brief: Ledger Un-Blinding Validation

Run `webvoyager_lite_1788689024341`, balanced30, same flags. First run with the evidence ledger reading offscreen result rows (S8 closure).

## The one result that matters

**GitHub__0: STRICT**, with the answer naming `resource-watch` — the metric-best card (73 stars) that sat below the fold and invisible to the evidence ledger in every prior run. The superlative steering fired zero times because the model now *sees* the winner in its own evidence snapshot and picks it. Verification-by-data-visibility succeeded: the ledger, the working-set pins, and the model all read the same below-fold-inclusive view.

### Task Rosters

* **Strict Passes (7 Tasks)**: `Amazon__0`, `Coursera__10`, `ESPN__0`, `ESPN__10`, `GitHub__0` (below-fold winner), `Google__Map__10`, `Wolfram__Alpha__0`.
* **Judge Approvals (6 Tasks)**: `BBC__News__0`, `Booking__10` (3rd consecutive pass), `Coursera__0`, `Huggingface__0`, `Huggingface__10`, `Wolfram__Alpha__10` (4th consecutive pass).

## Band status (post-stack, balanced30)

| | r18 | r19 | r20 | r21 | r22 | band |
|---|---|---|---|---|---|---|
| Strict | 11 | 7 | **12** | 9 | 7 | 7–12 |
| Internal | 63.3% | 66.7% | **76.7%** | 73.3% | 66.7% | 63–77% |
| Combined | 15 | 13 | **18** | 14 | 13 | 13–18 |

The swing is dominated by content-dependent answer drift (Apple__0/Amazon__10/ArXiv__10 class) and judge sampling — not mechanism regressions. Every target-class fix landed durably: Booking pair (judge in 20/21), Wolfram__10 (judge in 20, D1 prose), GitHub__0 (strict in 22, un-blinding).

## Campaign assessment — where the remaining gap lives

On balanced30, combined 13–18 with 6 captcha-locked tasks: **ex-captcha the band is 13/24–18/24 (54–75%)**. The residual classes: environment (captcha, ~6 tasks — 20pp), answer drift on volatile pages (2–3 tasks), judge sampling. On fresh50, browser-control's only structural win was bot resistance (5 of its 11 unique wins were walls we escalate honestly).

**The dominant remaining lever is environmental: bot-wall resilience (stealth/fingerprint), not substrate capability.** The second is answer-stability on volatile pages (synthesis-verification class).

**Recommendation:** stop spending balanced30 runs measuring a measured band. The next informative measurements are (a) the fresh50 holdout with the complete current stack (extends the 32%→44% line; the owner's call, as holdout hygiene demands), and (b) an anti-bot campaign (stealth/fingerprint work, the branch's namesake) which is the one lever with ~20pp of headroom on this benchmark class.
