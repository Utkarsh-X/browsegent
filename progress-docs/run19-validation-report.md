# Run 19 — Validation Report: D4 Batched Identity + D3 Quiet Window

Run `webvoyager_lite_1788680381229`, balanced30, run-16-identical flags. First run carrying D4 (batched CDP identity) and D3 (mutation-aware stabilization).

## Headline

| Metric | Run 17 | Run 18 | Run 19 | Guard verdict |
|---|---|---|---|---|
| Strict | 9/30 | **11/30** | 7/30 | churn, no mechanism attribution (below) |
| Internal pass | 63.33% | 63.33% | **66.67%** | second-highest ever |
| Combined | 16/30 | 15/30 | 13/30 | judge sampling (13 judged, 46%) |
| backendNodeId coverage | 15% | 15% | **18%** | **D4 working: shadow refs now identified** |
| Capture median / p90 | — | 330 / 958 ms | **286** / 1,073 ms | D4 faster at median; D3 bounded p90 trade |
| Planner calls / duration | 6.80 / 71.8s | 6.43 / 67.4s | 7.23 / 75.2s | D3 settle cost ≈ +8s/task (above the +1.2–2.4% blueprint estimate — polling evaluate RTTs; optimization candidate) |
| Target-error census | — | timeout 28, blocked 6 | timeout 22, blocked 12, loop-blocks 15 | no corruption signature (no clickable/stale/low-confidence spikes) |

## Verdict flips vs run 18

**Up (3):** Apple__10 fail→judge-WIN, Booking__0 + Booking__10 fail→judge-NO (both reached judged answers from last run's honest dead-ends; internal 66.7%). **Down (5):** Apple__0 and ArXiv__0 STRICT→judge-NO with *internal passes and drifted answers* ("the page does not display prices directly" — content-dependent answer variance, not capture damage), BBC__News__0 STRICT→judge-WIN (still solved), BBC__News__10 STRICT→fail (the volatile task), Amazon__10 judge-WIN→fail.

## Guard analysis (the reason this run exists)

1. **D4 batched identity: healthy.** Coverage 15%→18% (shadow-DOM refs gain backendNodeId), median capture duration 330→286 ms (−13%), max 14.5 s is a single outlier (empty-capture wait + W-A recapture stack, not the batched path). No wrong-target/corruption error signature. The live-page marker remains for the legacy fallback path (pages >2,000 elements); full marker removal lands with D2's frame rework.
2. **D3 quiet window: works, costs real time.** p90 capture +12% (bounded wait on busy pages — the intended trade), duration/task +8 s. The polling loop spends one evaluate per 50 ms poll — a batched single-evaluation wait (inject the poll loop in-page) would recover most of it. Queued as D3.1.
3. **Strict churn is content drift, not mechanism damage:** the three dropped strict tasks internal-passed with *different answers* on volatile pages (Apple pricing page without prices, ArXiv listing variance, BBC item rotation). This is the answer-stability class the SOTA audit listed under (iv) synthesis — the next structural lever is R4's substrate-side verification, not more capture work.

## Decision

D4 and D3 **stay** (guards pass, capture faster at median, internal pass near-record). D3.1 polling optimization queued. The strategy shift per the SOTA audit's gap arithmetic: capture-plane work is done for now — the remaining levers are R4 (substrate sort/verification to stop the GitHub__0/Apple__0 flip-flop class) and then D2/D5.

## Cumulative (same flags, balanced30)

| | r15 | r16 | r17 | r18 | r19 |
|---|---|---|---|---|---|
| Strict | 8 | 9 | 9 | **11** | 7 |
| Internal | 19 | **21** | 19 | 19 | **20** |
| Combined | 11 | **16** | 16 | 15 | 13 |
| ~tok/call | 5,153 | 4,549 | 5,060 | 4,908 | 5,150 |
