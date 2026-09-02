# Flash-Lite Benchmark Runs Comparison Report

A rigorous, multi-iteration comparative evaluation report tracking the progression of **`gemini-3.1-flash-lite`** across the standard `balanced30` WebVoyager benchmark slice. This document includes both native **BrowseGent v2** runs and external **Browser-Control** adapter runs, verified with full trace telemetry.

---

## 1. Executive Summary Scoreboard

All decimal scores have been converted to standard percentages (rounded to two decimal places). Token counts, action totals, and durations have been extracted directly from raw benchmark telemetry logs.

| Metric | Baseline (Aug 27 Fresh PRC) | Run 1 (`key-index 1`) | Run 2 (`key-index 20`) | Run 3 (Truthful Typing Fix) | Run 4 (S1 Temporal Fix) | Run 5 (Booking--10 WIP) | Run 6 (Browser-Control Gemini Pool) [Latest] |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Run ID** | `webvoyager_lite_1787773616455` | `webvoyager_lite_1788073716959` | `webvoyager_lite_1788077457042` | `webvoyager_lite_1788083614237` | `webvoyager_lite_1788091487187` | `webvoyager_lite_1788244732279` | `webvoyager_lite_1788360177393` |
| **Adapter** | `browsegent` | `browsegent` | `browsegent` | `browsegent` | `browsegent` | `browsegent` | `browser-control` |
| **Model** | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` |
| **Architectural Focus** | Fresh Signal-Preserved PRC Baseline | Baseline Pool Re-test | Pool Starting Offset 20 | Truthful Typing (`input_not_applied`) | S1 Temporal Ranking Invariant Fix | Ongoing "Booking--10" Task Optimization | External Rust Substrate via Native Gemini Pool |
| **Key Pool Index** | 1 | 1 | 20 | 1 | 1 | 10 | 10 |
| **Pacing Interval** | 10,000ms | 10,000ms | 10,000ms | 10,000ms | 10,000ms | 10,000ms | 10,000ms |
| **Total Runs** | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| **Internal Pass Rate** | 63.33% (19/30) | 60.00% (18/30) | 56.67% (17/30) | 56.67% (17/30) | 70.00% (21/30) | 66.67% (20/30) | 🏆 **100.00% (30/30)** |
| **Raw Auto-Score** | 🏆 **33.33% (10/30)** | 23.33% (7/30) | 23.33% (7/30) | 26.67% (8/30) | 🏆 **33.33% (10/30)** | 30.00% (9/30) | 🏆 **33.33% (10/30)** |
| **Strict Score (Correct)** | 🏆 **33.33% (10/30)** | 23.33% (7/30) | 23.33% (7/30) | 26.67% (8/30) | 🏆 **33.33% (10/30)** | 30.00% (9/30) | 🏆 **33.33% (10/30)** |
| **Manual Corrected Score** | 🏆 **33.33% (10/30)** | 23.33% (7/30) | 23.33% (7/30) | 26.67% (8/30) | 🏆 **33.33% (10/30)** | 30.00% (9/30) | 🏆 **33.33% (10/30)** |
| **Partial Credit Rate** | 35.00% (10.5/30) | 26.67% (8.0/30) | 25.00% (7.5/30) | 30.00% (9.0/30) | 🏆 **36.67% (11.0/30)** | 33.33% (10.0/30) | 35.00% (10.5/30) |
| **Env-Adjusted Strict Score** | 🏆 **41.67% (10/24)** | 28.00% (7/25) | 29.17% (7/24) | 33.33% (8/24) | 🏆 **41.67% (10/24)** | 37.50% (9/24) | 33.33% (10/30) |
| **Avg. Planner Steps / Task** | 6.57 | 6.87 | 6.67 | 6.50 | 6.20 | 7.03 | **8.87** |
| **Avg. Input Tokens / Task** | 39,249 | 45,135 | 40,827 | 38,518 | 37,123 | 48,544 | ⚡ **17,570** (-55%) |
| **Avg. Output Tokens / Task** | 287 | 311 | 302 | 327 | 270 | 275 | **641** |
| **Total Actions (Full Suite)** | 184 | 181 | 179 | 171 | 172 | 179 | **248** |
| **Avg. Total Duration / Task** | 70.64 s | 77.01 s | 72.00 s | 68.12 s | 65.25 s | 73.71 s | **162.17 s** |
| **Environment Blocked Count** | 6 (20.00%) | 5 (16.67%) | 6 (20.00%) | 6 (20.00%) | 6 (20.00%) | 6 (20.00%) | 0 (0.00%) |
| **Manual Review Count** | 11 | 28 | 27 | 28 | 28 | 28 | 27 |
| **Network / Upstream Errors** | **0** | **0** | **0** | **0** | **0** | **0** | **0 (Audited)** |
| **Runtime Crash Count** | **0** | **0** | **0** | **0** | **0** | **0** | **0 (Audited)** |

---

## 2. Rigorous Run 6 Verification & Network Audit

A complete task-by-task trace audit was executed against [`logs/webvoyager-lite/webvoyager_lite_1788360177393/report.json`](file:///d:/BrowseGent/logs/webvoyager-lite/webvoyager_lite_1788360177393/report.json) to verify execution integrity:

1. **Network & Connection Status**:
   - **Zero connection drops**: Scanned for `ECONNRESET`, `ETIMEDOUT`, socket hangs, and proxy failures. Found **0**.
   - **Zero upstream API rate limits**: Scanned for HTTP `429`, `500`, `502`, `503`, and `504` errors across the 56-key Gemini rotation pool. Found **0**.
   - **Zero runtime crashes**: All 30 tasks completed normally without uncaught exceptions or child process aborts (`failureTypes: {}`).
2. **Internal Completion Rate**:
   - Reached **100.00% (30/30)** internal completion rate. Every single task completed its search trajectory, evaluated page elements, and returned a grounded final answer.
3. **Token Efficiency Comparison**:
   - `browser-control` consumed **17,570 input tokens/task**, which is **55% lower token usage** than BrowseGent v2 (39,249 input tokens/task) due to its condensed text accessibility snapshot.
   - Total input tokens for the entire 30-task suite was **527,095 tokens** (compared to 1,177,477 tokens for the BrowseGent baseline).
4. **Duration & Execution Latency**:
   - Average duration was **162.17 seconds/task** (total suite execution: 81 minutes), compared to BrowseGent's ~70 seconds/task, reflecting `browser-control`'s higher average actions per task (8.27 vs 6.13) and sleep intervals between CLI subcommands.

---

## 3. CSV Telemetry Data Exports

All comparative tables and task-level telemetry have been exported into machine-readable CSV files in the dedicated benchmark directory:
📁 [`d:\BrowseGent\progress-docs\benchmark-data-exports\`](file:///d:/BrowseGent/progress-docs/benchmark-data-exports/)

- **`flash-lite-runs-comparison.csv`**: Full multi-run comparison covering all 7 runs across all 21 metric dimensions.
- **`browser-control-run6-tasks-detailed.csv`**: Task-by-task execution audit of Run 6 detailing step counts, action counts, duration, token usage, and final answer previews for all 30 WebVoyager tasks.

---

## 4. Historical Telemetry Logs

### Run 6: Browser-Control Native Gemini Pool (`webvoyager_lite_1788360177393`)
```bash
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browser-control --request-min-interval-ms 10000 --key-index 10 --planner-serialization prc
```
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
  "manualReviewCount": 27,
  "environmentBlockedCount": 0,
  "impossibleTaskCount": 0
}
```

### Run 5: Ongoing "Booking--10" Optimization WIP (`webvoyager_lite_1788244732279`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.6666666666666666,
  "rawAutoScore": 0.3,
  "strictScore": 0.3,
  "manualCorrectedScore": 0.3,
  "partialCreditRate": 0.3333333333333333,
  "environmentAdjustedStrictScore": 0.375,
  "environmentAdjustedManualScore": 0.375,
  "manualReviewCount": 28,
  "environmentBlockedCount": 6,
  "impossibleTaskCount": 0
}
```

### Run 4: S1 Temporal Ranking Invariant Fix (`webvoyager_lite_1788091487187`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.7,
  "rawAutoScore": 0.3333333333333333,
  "strictScore": 0.3333333333333333,
  "manualCorrectedScore": 0.3333333333333333,
  "partialCreditRate": 0.36666666666666664,
  "environmentAdjustedStrictScore": 0.4166666666666667,
  "environmentAdjustedManualScore": 0.4166666666666667,
  "manualReviewCount": 28,
  "environmentBlockedCount": 6,
  "impossibleTaskCount": 0
}
```

### Run 3: Truthful Typing Confirmation (`webvoyager_lite_1788083614237`)
```json
{
  "totalRuns": 30,
  "internalPassRate": 0.5666666666666667,
  "rawAutoScore": 0.26666666666666666,
  "strictScore": 0.26666666666666666,
  "manualCorrectedScore": 0.26666666666666666,
  "partialCreditRate": 0.3,
  "environmentAdjustedStrictScore": 0.3333333333333333,
  "environmentAdjustedManualScore": 0.3333333333333333,
  "manualReviewCount": 28,
  "environmentBlockedCount": 6,
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
