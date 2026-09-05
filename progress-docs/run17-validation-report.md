# Run 17 — Validation Report: Full Mechanism Stack (F-batch + P1–P6 + R1 + R3)

Run `webvoyager_lite_1788627621459`, balanced30, `gemini/gemini-3.1-flash-lite`, run-16-identical flags (`--prc-lean-plane --planner-conditional-prompt --judge`). First run ever to carry the round-1 F-batch (F1 selectOptions, F3 effect verdict, F7a rank_loss), F2/F7b diff markers, W-D navigate_loop, W-A recapture, the R1 primitives (`pick_option`/`submit_form`), and the R3 plane deletion.

## Headline

| Metric | Run 16 | Run 17 | Δ |
|---|---|---|---|
| Strict | 9/30 | 9/30 | = |
| Judge wins | 7 (58.3%) | 7 (70.0% of 10 judged) | = |
| **Combined** | **16/30** | **16/30** | **=** |
| System bytes mean | 7,371 B | 8,585 B | +16% (new conditional blocks engage widely) |
| User bytes mean | 7,984 B | 8,514 B | +6.6% (markers + names line + effect fields) |
| ~tok/call | 4,549 | ~5,060 | +11% |
| Planner calls/task | 7.4 | 6.8 | −0.6 |
| Duration/task | 76.9 s | 71.8 s | −5.1 s |

## The unvalidation concern is closed

All round-1/2 mechanisms are measurably live in run-17 payloads: `deltaRefs` on **204/204** inputs, `rank_loss` accounting on **183**, `lastResult.effect` on **119**, `selectOptions` on **17** inputs. The providerPayload now self-describes its plane (`prcLeanPlane`/`conditionalSystemPrompt` recorded).

## Verdict flips vs run 16

**Up (3):** `GitHub__0` judge-NO→**judge-WIN** (the sort/grounding class finally passes), `Huggingface__0` judge-NO→**STRICT** (full ground truth), `ArXiv__0` judge-NO→judge-WIN (run-16 loss recovered). `Google__Flights__0` fail→judge-NO (from exhausted-with-nothing to a judged grounded answer).

**Down (4):** `Booking__0` judge-WIN→fail, `BBC__News__0` STRICT→fail, `ArXiv__10` judge-WIN→judge-NO, `Google__Map__0` judge-NO→fail (was failing anyway).

## Regression forensics — no mechanism attribution

- **Booking__0**: the trajectory never invoked `pick_option`/`submit_form` — the planner died on the pre-existing signature (two overlay-blocked types, then ok-but-no-effect day-cell clicks, exhausted with a date-cell label as finalAnswer). This is the **W-C calendar click-verification gap** (still unimplemented), plus run-to-run variance on the model's path choice.
- **BBC__News__0**: **5 click timeouts** this run (environmental; zero in run 16) plus a search_page read loop that hit the loop detector. The P4 guidance engaged but the reads returned nothing — an evidence-starvation tail, not a guidance regression.
- **Tool usage census**: the planner emitted **zero** `pick_option`/`submit_form` plans in 204 episodes — flash-lite ignored the new prompt rows, matching the SOTA audit's compliance-floor finding. Fix shipped post-run: `use_pick_option_primitive` is now the first mechanism of the `repeated_type_same_value` recovery state (the channel flash-lite demonstrably obeys), and the state's guidance names the primitive explicitly.
- The fidelity replay test caught one real boundary: ESPN's 20-league select truncates at the lean renderer's documented 240-char options cap — test expectations now respect the documented caps (serialization itself is lossless).

## Honest read

Combined flat at 16/30 with high per-task churn (±4 flips in both directions) — consistent with the stochastic variance band observed between runs 14/15/16. The token cost of the new machinery (+11%/call) bought no aggregate movement this run; the wins (GitHub__0, Huggingface__0) land in the grounding class the mechanisms target. The direct next levers, in order: W-C calendar-click verification (Booking anchor), the recovery-path pick_option hook (shipped), C1 href-vs-landed advisory, and D1 prose capture (Wolfram/ArXiv class).
