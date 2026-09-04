# Flash-Lite Benchmark Runs Comparison Report

A rigorous, multi-iteration comparative evaluation report tracking the progression of **`gemini-3.1-flash-lite`** across the standard `balanced30` WebVoyager benchmark slice. This document includes native **BrowseGent v2** runs, cross-substrate **Browser-Control** adapter runs, official LLM judge integration, and complete trace telemetry.

---

## 1. Executive Summary Scoreboard

All percentages are rounded to two decimal places. Telemetry metrics (planner steps, token counts, total actions, and execution durations) are extracted directly from official task execution traces.

| Metric | Baseline (Fresh PRC) | Run 4 (S1 Temporal Fix) | Run 6 (Browser-Control) [Judged] | Run 7 (Resiliency Re-eval) | Run 8 (Baseline Re-eval) | Run 9 (Stack + Judge) | Run 10 (Compact Plane + Judge) [Latest] |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Run ID** | `webvoyager_lite_1787773616455` | `webvoyager_lite_1788091487187` | `webvoyager_lite_1788360177393` | `webvoyager_lite_1788398756906` | `webvoyager_lite_1788470846884` | `webvoyager_lite_1788525300673` | `webvoyager_lite_1788531291513` |
| **Adapter Substrate** | `browsegent` | `browsegent` | `browser-control` | `browsegent` | `browsegent` | `browsegent` | `browsegent` |
| **Model** | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` |
| **Architectural Focus** | Signal-Preserved Baseline | S1 Ranking Decoupling | Native External Rust Substrate | Provider Resiliency & 503 Auto-Retry | Clean Baseline Re-evaluation | Complete Stack + Active LLM Judge | Compact Data Plane + Active Judge |
| **Flags / Options** | `--planner-serialization prc` | `--planner-serialization prc` | Native Binary Loop | `--planner-serialization prc` | `--planner-serialization prc` | `--planner-serialization prc --judge` | `--planner-serialization prc --judge --compact-data-plane` |
| **Total Runs** | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| **Internal Pass Rate** | 63.33% (19/30) | 70.00% (21/30) | **100.00% (30/30)** | 60.00% (18/30) | 63.33% (19/30) | 50.00% (15/30) | 63.33% (19/30) |
| **Raw Auto-Score** | 33.33% (10/30) | 33.33% (10/30) | 33.33% (10/30) | 26.67% (8/30) | 33.33% (10/30) | **36.67% (11/30)** | 33.33% (10/30) |
| **Strict Score (Correct)** | 33.33% (10/30) | 33.33% (10/30) | 33.33% (10/30) | 26.67% (8/30) | 33.33% (10/30) | **36.67% (11/30)** | 33.33% (10/30) |
| **Manual Corrected Score** | 33.33% (10/30) | 33.33% (10/30) | 33.33% (10/30) | 26.67% (8/30) | 33.33% (10/30) | **36.67% (11/30)** | 33.33% (10/30) |
| **Partial Credit Rate** | 35.00% (10.5/30) | 36.67% (11.0/30) | 35.00% (10.5/30) | 28.33% (8.5/30) | 35.00% (10.5/30) | **38.33% (11.5/30)** | 35.00% (10.5/30) |
| **Env-Adjusted Strict Score** | 41.67% (10/24) | 41.67% (10/24) | 33.33% (10/30) | 33.33% (8/24) | 40.00% (10/25) | **47.83% (11/23)** | 41.67% (10/24) |
| **Env-Adjusted Manual Score** | 41.67% (10/24) | 41.67% (10/24) | 33.33% (10/30) | 33.33% (8/24) | 40.00% (10/25) | **47.83% (11/23)** | 41.67% (10/24) |
| **Judged Task Count** | N/A | N/A | 20 | N/A | N/A | 4 | 9 |
| **Judge Score Rate** | N/A | N/A | 50.00% (10/20) | N/A | N/A | 50.00% (2/4) | **66.67% (6/9)** |
| **Avg. Planner Steps / Task** | 6.57 | **6.20** | 8.87 | 6.50 | 7.60 | 7.17 | 6.37 |
| **Avg. Input Tokens / Task** | 39,249 | 37,123 | **17,570** | 51,204 | 60,415 | 56,548 | 58,248 |
| **Avg. Output Tokens / Task** | 287 | 270 | 641 | **227** | 271 | 268 | **227** |
| **Total Actions (Full Suite)** | 184 | 172 | 248 | 166 | 202 | 183 | **161** |
| **Avg. Total Duration / Task** | 70.64 s | **65.25 s** | 162.17 s | 75.37 s | 87.79 s | 97.22 s | 111.45 s |
| **Environment Blocked Count** | 6 (20.00%) | 6 (20.00%) | 0 (0.00%) | 6 (20.00%) | 5 (16.67%) | 7 (23.33%) | 6 (20.00%) |
| **Manual Review Count** | 11 | 28 | 27 | 28 | 28 | 29 | 28 |
| **Transient 503 Retries** | 0 | 0 | 0 | 1 | 0 | 32 (100% recovered) | 44 (100% recovered) |
| **Runtime Crash Count** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

---

### Early Iterations Reference (Runs 1–3 & 5)

| Metric | Run 1 (Re-test A) | Run 2 (Re-test B) | Run 3 (Truthful Typing Fix) | Run 5 (Booking--10 WIP) |
| :--- | :---: | :---: | :---: | :---: |
| **Run ID** | `webvoyager_lite_1788073716959` | `webvoyager_lite_1788077457042` | `webvoyager_lite_1788083614237` | `webvoyager_lite_1788244732279` |
| **Internal Pass Rate** | 60.00% (18/30) | 56.67% (17/30) | 56.67% (17/30) | 66.67% (20/30) |
| **Strict Score** | 23.33% (7/30) | 23.33% (7/30) | 26.67% (8/30) | 30.00% (9/30) |
| **Partial Credit Rate** | 26.67% (8.0/30) | 25.00% (7.5/30) | 30.00% (9.0/30) | 33.33% (10.0/30) |
| **Env-Adjusted Strict Score** | 28.00% (7/25) | 29.17% (7/24) | 33.33% (8/24) | 37.50% (9/24) |
| **Avg. Input Tokens / Task** | 45,135 | 40,827 | 38,518 | 48,544 |
| **Avg. Output Tokens / Task** | 311 | 302 | 327 | 275 |
| **Total Actions** | 181 | 179 | 171 | 179 |
| **Avg. Total Duration / Task** | 77.01 s | 72.00 s | 68.12 s | 73.71 s |

---

## 2. In-Depth Review of Recent Milestone Runs

### Run 10: Compact Data Plane Optimization + LLM Judge Active (`webvoyager_lite_1788531291513`) [Latest]
* **Execution Command**:
  ```bash
  npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browsegent --request-min-interval-ms 10000 --planner-serialization prc --judge --compact-data-plane
  ```
* **Key Achievements & Telemetry**:
  1. **Trajectory Completion Gain**: Internal pass rate recovered to **63.33% (19/30)** (+13.33% over Run 9).
  2. **Top Judge Score Rate**: **66.67% (6/9)**. Evaluated across 9 qualified non-strict tasks:
     - `webvoyager_BBC__News__0` (SUCCESS): Successfully identified recent renewable energy reports from Northern Ireland.
     - `webvoyager_Booking__0` (SUCCESS): Retrieved real-time available hotels in Mexico for December 25-26 with ratings > 8.5.
     - `webvoyager_Coursera__0` (SUCCESS): Retrieved 1-3 month beginner 3D printing course from UIUC.
     - `webvoyager_GitHub__10` (SUCCESS): Accurately identified GitHub Copilot Pro pricing ($10/mo = $120/yr).
     - `webvoyager_Huggingface__0` (SUCCESS): Successfully identified sentiment analysis model updated in March 2023.
     - `webvoyager_Wolfram__Alpha__10` (SUCCESS): Retrieved exact geomagnetic field strength (51.5 microteslas) for Oslo.
  3. **12% Reduction in Action Churn**: Reduced total suite actions to **161** (5.37 actions/task vs 8.27 in Browser-Control).
  4. **15% Output Token Savings**: Reduced output tokens to **227 tokens/task** (vs 641 in Browser-Control).
  5. **Auto-Recovery Resilience**: Handled 43 transient Google 503s + 1 network drop via exponential backoff with zero unhandled crash aborts.

---

### Run 9: Complete Stack + LLM Judge Active (`webvoyager_lite_1788525300673`)
* **Execution Command**:
  ```bash
  npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browsegent --request-min-interval-ms 10000 --planner-serialization prc --judge
  ```
* **Key Achievements**:
  - **Peak Strict Score**: **36.67% (11/30)** (first iteration breaking the 10-task ceiling).
  - **Peak Environment-Adjusted Score**: **47.83% (11/23)**.
  - 32 transient Google 503 service drops auto-recovered with zero aborted runs.
  - LLM judge evaluated 4 qualifying tasks (50.00% pass rate).

---

### Run 6: Browser-Control Native Rust Substrate (`webvoyager_lite_1788360177393`) [Post-Hoc Judge Evaluated]
* **Execution Setup**: Native external Rust substrate compiled for Windows (`browser-control.exe`) running directly against Gemini API with 10,000ms request pacing.
* **Key Achievements & Judge Telemetry**:
  1. **100% Internal Pass Rate (30/30)**: Every single task completed its search loop and returned a final answer string.
  2. **10 Strict Ground-Truth Wins (33.33%)**: Amazon, ArXiv, BBC News (×2), Coursera, ESPN (×2), GitHub, Google Map, and Wolfram Alpha passed string ground-truth match.
  3. **Official LLM Judge Evaluation (20 Judged Tasks)**:
     - **Judged Task Count**: 20 tasks qualified for official-methodology additive judging (tasks that passed internally with strict score 0 and no environment block).
     - **Judge Score Rate**: **50.00% (10/20)**. 10 out of the 20 evaluated tasks were affirmed by the judge as satisfying user intent under live web conditions:
       - `webvoyager_Amazon__10` (SUCCESS)
       - `webvoyager_Apple__0` (SUCCESS)
       - `webvoyager_ArXiv__10` (SUCCESS)
       - `webvoyager_Cambridge__Dictionary__10` (SUCCESS)
       - `webvoyager_Coursera__0` (SUCCESS)
       - `webvoyager_GitHub__10` (SUCCESS)
       - `webvoyager_Google__Search__0` (SUCCESS)
       - `webvoyager_Google__Search__10` (SUCCESS)
       - `webvoyager_Huggingface__0` (SUCCESS)
       - `webvoyager_Huggingface__10` (SUCCESS)

---

## 3. CSV Telemetry Data Exports

All comparative tables and task-level telemetry have been exported into machine-readable CSV files in the dedicated benchmark directory:
[`d:\BrowseGent\progress-docs\benchmark-data-exports\`](file:///d:/BrowseGent/progress-docs/benchmark-data-exports/)

- **`flash-lite-runs-comparison.csv`**: Full multi-run comparison covering all benchmark iterations across 23 metric dimensions.
- **`browser-control-run6-tasks-detailed.csv`**: Task-by-task execution audit of Run 6 detailing step counts, action counts, duration, token usage, and final answer previews for all 30 WebVoyager tasks.

---

## 4. Historical Telemetry Logs

### Run 10: Compact Data Plane Optimization (`webvoyager_lite_1788531291513`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.6333333333333333,
  "rawAutoScore": 0.3333333333333333,
  "strictScore": 0.3333333333333333,
  "manualCorrectedScore": 0.3333333333333333,
  "partialCreditRate": 0.35,
  "environmentAdjustedStrictScore": 0.4166666666666667,
  "environmentAdjustedManualScore": 0.4166666666666667,
  "judgedCount": 9,
  "judgeScoreRate": 0.6666666666666666,
  "environmentAdjustedJudgeScore": 0.6666666666666666,
  "manualReviewCount": 28,
  "environmentBlockedCount": 6,
  "impossibleTaskCount": 0
}
```

### Run 9: Complete Stack + LLM Judge Active (`webvoyager_lite_1788525300673`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.5,
  "rawAutoScore": 0.36666666666666664,
  "strictScore": 0.36666666666666664,
  "manualCorrectedScore": 0.36666666666666664,
  "partialCreditRate": 0.38333333333333336,
  "environmentAdjustedStrictScore": 0.4782608695652174,
  "environmentAdjustedManualScore": 0.4782608695652174,
  "judgedCount": 4,
  "judgeScoreRate": 0.5,
  "environmentAdjustedJudgeScore": 0.5,
  "manualReviewCount": 29,
  "environmentBlockedCount": 7,
  "impossibleTaskCount": 0
}
```

### Run 8: Clean Baseline Re-evaluation (`webvoyager_lite_1788470846884`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.6333333333333333,
  "rawAutoScore": 0.3333333333333333,
  "strictScore": 0.3333333333333333,
  "manualCorrectedScore": 0.3333333333333333,
  "partialCreditRate": 0.35,
  "environmentAdjustedStrictScore": 0.4,
  "environmentAdjustedManualScore": 0.4,
  "manualReviewCount": 28,
  "environmentBlockedCount": 5,
  "impossibleTaskCount": 0
}
```

### Run 7: Provider Resiliency Re-evaluation (`webvoyager_lite_1788398756906`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.6,
  "rawAutoScore": 0.26666666666666666,
  "strictScore": 0.26666666666666666,
  "manualCorrectedScore": 0.26666666666666666,
  "partialCreditRate": 0.2833333333333333,
  "environmentAdjustedStrictScore": 0.3333333333333333,
  "environmentAdjustedManualScore": 0.3333333333333333,
  "manualReviewCount": 28,
  "environmentBlockedCount": 6,
  "impossibleTaskCount": 0
}
```

### Run 6: Browser-Control Native Substrate (`webvoyager_lite_1788360177393`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 1.0,
  "rawAutoScore": 0.3333333333333333,
  "strictScore": 0.3333333333333333,
  "manualCorrectedScore": 0.3333333333333333,
  "partialCreditRate": 0.35,
  "environmentAdjustedStrictScore": 0.3333333333333333,
  "environmentAdjustedManualScore": 0.3333333333333333,
  "judgedCount": 20,
  "judgeScoreRate": 0.5,
  "environmentAdjustedJudgeScore": 0.5,
  "manualReviewCount": 27,
  "environmentBlockedCount": 0,
  "impossibleTaskCount": 0
}
```

### Baseline: Fresh PRC Baseline (`webvoyager_lite_1787773616455`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.6333333333333333,
  "rawAutoScore": 0.3333333333333333,
  "strictScore": 0.3333333333333333,
  "manualCorrectedScore": 0.3333333333333333,
  "partialCreditRate": 0.35,
  "environmentAdjustedStrictScore": 0.4166666666666667,
  "environmentAdjustedManualScore": 0.4166666666666667,
  "manualReviewCount": 11,
  "environmentBlockedCount": 6,
  "impossibleTaskCount": 0
}
```

---

## 5. Integrity & Efficiency Audit (2026-09-04)

Post-run audit of Runs 9 and 10 (and the Run 6 cross-adapter comparison) with the fixes that came out of it. Every number below is measured from stored run artifacts (`report.json`, `planner/*-output.json`, `webvoyager_evaluation.json`).

### 5.1 Judge evidence bug (fixed) and corrected official scores

The in-run judge collected final-page evidence by joining the trace **file** path with `observations/`, which always threw `ENOTDIR` and silently produced **empty page evidence** for every judged BrowseGent task. The judge was therefore scoring answers blind (it says so in stored reasons: "Final Page Evidence is empty/missing"). Fixed in `e621823`; both runs were then re-judged offline with real final-page evidence (`scripts/webvoyager_rejudge.ts`, originals backed up as `webvoyager_evaluation.prejudge.json`):

| Run | Blind-judge result | Evidence-grounded rejudge | Official total (strict + judge SUCCESS) |
| :--- | :---: | :---: | :---: |
| Run 9 (complete stack) | 2/4 judged (50%) | **2/4 judged (50%)** — composition changed (BBC__News__0 flipped to NOT_SUCCESS) | **13/30 (43.3%)** |
| Run 10 (compact plane) | 6/9 judged (66.7%) | **3/9 judged (33.3%)** — Booking__0, Coursera__0, Wolfram__Alpha__10 flipped to NOT_SUCCESS; BBC__News__0 to SUCCESS | **13/30 (43.3%)** |

The blind judge rewarded answers that merely sounded right. With real evidence, unsupported claims are rejected — e.g. Run 10 Booking__0 named hotels with ratings while the final page still showed the search form (dates never completed), and Coursera__0 answered from search suggestions without ever reaching the course page. **The honest cross-run headline: both runs land at 13/30 (43.3%) under the official methodology.**

Run 6 (browser-control) judge numbers are **not directly comparable**: its judge read `stderr.txt` step thoughts (lenient — it rewarded a hallucinated answer on Google Search--10 and a 404 report on Huggingface--10), while BrowseGent is judged against final-page accessibility evidence (strict).

### 5.2 Strict false positives and the answer-hygiene fix

The Run 9 audit found 2 inflated strict passes: `Amazon--0` echoed search-autocomplete strings containing internal ref tokens (`v2ref_1216`) and passed on token overlap; `Amazon--10` reported hardware price tiers as warranty costs. Fixes landed:

- **`src/v2/agent/AnswerHygiene.ts`** (`d876adf`): internal ref identifiers are stripped from every accepted answer value (main-loop done, finalization done, grounding reconciliation, max-steps fallback). Byte-identical for leak-free values.
- **Evaluator tightening** (`d876adf`): matching runs on ref-stripped text, so a leak can never create overlap credit; leaked values get `internal_ref_leak` reason + manual-review flag.
- Known residual: the string matcher alone cannot detect an answer built from autocomplete content — the evidence-grounded judge is the arbiter for that class (it rejected both in Run 10's judging).

### 5.3 Input-token autopsy (the 3.3x gap vs browser-control)

Per planner call (mean over 228/191 calls): **verbose 16.6 KB user + 9.1 KB system ≈ 8.0K tokens; ~7.6 calls/task ≈ 60K/task**. Composition of the user message: PLANNER SURFACE ~12 KB, WORKING SET ~5 KB, other control-plane sections <1 KB combined. System prompt is ~35% of every request and is paid on all ~7 calls.

- **Compact data plane was a regression as implemented**: across all 228 stored run-8 inputs, compact rendered **+19.6% larger** than verbose (the `W:` section inlined 160-char readable-evidence excerpts and 120-char region labels the verbose baseline omits, plus an extra system-prompt paragraph). Measured effect in the live A/B: run 10 median tokens/call 9,487 vs run 8's 7,876. Capped those excerpts (48/32 chars, `36cee29`) → now **+13.4%**; full SURFACE/W: dedup is future work. **Until then, verbose PRC is the recommended mode for all runs.**
- Validation retries are not a factor (4–5% of calls have >1 attempt).
- Biggest remaining levers (in order): (1) system-prompt diet (careful dedupe, quality-gated A/B), (2) SURFACE element truncation (name/text caps), (3) working-set ref+reason list compaction, (4) fewer planner calls (seek macros already cut this).
- Tokenizer note: tokens/byte varies ~3–11x by page content (Devanagari/CJK pages tokenize densely) — run 9's single heaviest call was 49.3K tokens.

### 5.4 Environment-block denominator symmetry (fixed)

All `environment_block` tags across runs 8–10 were `planner_escalated:captcha` bot walls (Cloudflare/Google CAPTCHA) — no infrastructure failures. Excluding them from the denominator was asymmetric with browser-control, which reports the wall and stays in the denominator. As of `36cee29`, captcha escalations are tagged **`captcha_wall`** and **stay in the scored denominator** (official WebVoyager methodology). Env-adjusted scores from earlier runs were computed under the old exclusion policy and are not comparable to post-fix runs.

---

## 6. Fresh50-Stable Holdout Baseline (2026-09-05, `webvoyager_lite_1788550095257`)

First run on the 50-task never-tuned holdout slice (`--slice fresh50-stable --judge`). Full detail: `d:\k\fresh50_runs_comparison.md`.

| Metric | Value |
| :--- | :---: |
| Combined solved (strict + judge) | **16/50 (32.0%)** |
| Accessible-task solved rate (excl. bot walls) | **44.4% (16/36)** |
| Internal completion on accessible tasks | 66.7% (24/36) |
| Strict score | 14.0% (7/50 — 6 partial + 1 exact... 2 exact) |
| Judge score rate | 52.9% (9/17) |
| Bot CAPTCHA walls (in-denominator) | **13/50 (26%)** — Allrecipes 3/3, Cambridge 4/4, Google Search 3/4, Booking 2x502, ESPN 1 |
| Avg. input tokens / task | 54,499 |
| Crashes | 0 (20 transient 503s auto-recovered) |

**Generalization verdict: the stack holds on unseen tasks** — accessible-task rates match the balanced30 profile, no overfit signature.

**Holdout failure taxonomy (36 accessible tasks, 20 non-passes):**
1. **Max step budget exhausted — 10 tasks** (GitHub__14, ArXiv__6, Google Search__21, Apple__26, Booking__24, Coursera__15, Flights__4/14, Huggingface__13/14): the dominant failure mode on longer multi-hop flows. Next forensics target.
2. **Judge-rejected answers — 8 tasks**: incomplete multi-part answers (ESPN__15 reported 1 of 5 games; Coursera__19 missed instructor + hours), ungrounded answers (GitHub__18 answered from a nav menu), delegation phrasing (Flights__19 "click on the date for details"), semantic mismatch (Apple__12), wrong locale (Amazon__24 INR vs USD), math error (Wolfram__15).
3. **Planner/ref errors — 2** (GitHub__8, BBC__5 ref type mismatch); validation error 1 (BBC__25).

**Response landed same day:** answer-contract item-count + multi-detail checks (`f1cb064`) and the requirement-completion gate (`next commit`) target classes 2a/2c/2d. Step-budget exhaustion (class 1) is the next investigation priority.
