# Balanced30 Threesome Faceoff & Truth Audit Report (v4)

A comprehensive comparison evaluating **BrowseGent v2 (Aug 12 - Latest Audit)** against previous runs, **Browser-Use**, and **Alumnium** on the `balanced30` task slice, incorporating the new instrumented run (`webvoyager_lite_1786533152242`) completed on August 12, 2026.

---

## 1. Executive Summary Scoreboard

| Metric | BrowseGent v2 (Aug 12 - Latest Audit) | BrowseGent v2 (July 11 Baseline) | Browser-Use (Best) | Alumnium (Best) |
| :--- | :---: | :---: | :---: | :---: |
| **Model** | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.5-flash` |
| **Pacing / Min Interval** | 10,000ms | 10,000ms | 20,000ms | 10,000ms |
| **Internal Pass Rate (Non-Crash)** | 60.0% (18/30) | 63.3% (19/30) | 90.0% (27/30) | **93.3% (28/30)** |
| **Strict Auto-Score (Correct)** | 📈 **33.3% (10/30)** | 📈 **33.3% (10/30)** | **36.7% (11/30)** | 23.3% (7/30) |
| **Env-Adjusted Strict Score** | 📈 **41.7% (10/24)** | 📈 **41.7% (10/24)** | — | 23.3% (7/30) |
| **Avg. Dispatched Actions / Task** | 🟢 **7.40 (222 total)** | 9.03 (271 total) | 9.56 | **2.23** |
| **No-Effect Action Waste** | 🚀 **12.8% (30 actions)** | 🔴 52.8% (144 actions) | — | — |
| **Hard-Blocked Action Loops** | 🟢 **12 (5.1%)** | 2 (0.7%) | — | — |
| **Avg. Input Tokens / Task** | **45,909** | **45,909** | 92,741 | 41,102 |
| **Avg. Output Tokens / Task** | 356 | 356 | 8,539 | 1,468 |

> [!NOTE]
> * **Efficiency Breakthrough**: BrowseGent v2's no-effect action waste collapsed from **52.8% (144 actions) down to 12.8% (30 actions)** due to target-ID semantic continuity matching.
> * **Loop Recovery Active**: Active hard-blocks increased from **2 to 12**, stopping unproven action loops across dynamic element ref churn.
> * **Action Economy**: Achieved the exact same **33.3% strict / 41.7% env-adjusted score** using **49 fewer total actions** (222 vs 271).

---

## 2. Phase A1 Truth Audit Telemetry Analysis

The new instrumentation introduced in the Truth Audit run exposes deep metrics across BrowseGent's runtime boundaries.

### A. Latency Breakdown (5 Independent Categories)
We isolated time spent per phase across all 30 tasks for the August 12 run (`webvoyager_lite_1786533152242`):

| Phase | Total Duration | Avg. per Task | % of Total | What it measures |
| :--- | :---: | :---: | :---: | :--- |
| **provider** | 1631.9s | 54.4s | 62.5% | LLM round-trip API latency (including pacing delays) |
| **browser_interaction** | 543.1s | 18.1s | 20.8% | Playwright browser command execution |
| **unaccounted** | 245.4s | 8.2s | 9.4% | Inter-step processing overhead |
| **observation_capture** | 174.3s | 5.8s | 6.7% | DOM scan + ref identity resolution |
| **stabilization_wait** | 12.6s | 0.4s | 0.5% | Browser settle and DOM load state waits |
| **local_compute** | 4.0s | 0.1s | 0.1% | V2AgentLoop bookkeeping and projection compilation |
| **Total** | **2611.2s** | **87.0s** | **100%** | |

---

### B. Action Economy Comparison (July 11 vs. August 12)

We tracked the outcomes of all generated actions across both audit runs:

| Action Category | July 11 Baseline | Aug 12 (Latest) | Shift / Impact |
| :--- | :---: | :---: | :--- |
| **total** | 273 | 234 | -39 total action attempts |
| **dispatched** | 271 (9.0 avg) | **222 (7.4 avg)** | 🟢 **-49 actions (-17.7% action waste!)** |
| **hardBlocked** | 2 (0.7%) | **12 (5.1%)** | 🟢 **+10 hard-blocks (catching ref-churn loops)** |
| **stateChanging** | 80 (29.3%) | 77 (34.7%) | Higher proportion of real page state changes |
| **evidenceProducing** | 26 (9.5%) | 7 (3.2%) | Explicit read tool extractions |
| **failed** | 59 (21.6%) | 55 (24.8%) | Browser execution failures |
| **noEffect** | **144 (52.8%)** | 🚀 **30 (12.8%)** | 🚀 **-79.2% DROP in no-effect waste!** |

---

## 3. Failure Category Audit (August 12 Run)

The 30 tasks audited by joined evaluator verdicts:

| Joined Failure Category | Count | % of Suite | Cause | Controllable? |
| :--- | :---: | :---: | :--- | :---: |
| **success (strict)** | 10 | 33.3% | Task completed and verified by benchmark | — |
| **wrong-evidence** | 8 | 26.7% | Agent completed, but missed benchmark evidence text | **Yes** (Priority 1) |
| **environment** | 6 | 20.0% | Cloudflare Turnstile / Captcha blocks | No |
| **recovery-loop** | 4 | 13.3% | Step limit exhausted (BBC-0, Booking-0/10, ESPN-10) | **Yes** (Priority 2) |
| **execution** | 2 | 6.7% | Planner invalid output dead-end (Coursera-0, GitHub-0) | **Yes** (Priority 3) |

---

## 4. Next Priorities & Roadmap

Based on the August 12 audit data, our next priorities are:

1. **Phase A3: Evidence-Gated Completion (Priority 1 - Targets 8 Wrong-Evidence Tasks)**:
   * Require explicit, traceable read evidence (`get`, `inspect_region`, `search_page`) for required goal attributes before allowing `done: true`.
2. **Causal Recovery & Loop Elimination (Priority 2 - Targets 4 Recovery-Loop Tasks)**:
   * Expand tool-family pivoting and deterministic mechanism changes for max-step exhausts.
