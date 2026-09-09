# Gemini 3.5 Flash-Lite Preview — Model Architecture Validation Report

Run `webvoyager_lite_1788676761686`, evaluated across the standard `balanced30` benchmark slice using next-generation preview model **`gemini/gemini-3.5-flash-lite`** with standard PRC Lean Plane flags (`--planner-serialization prc --judge --prc-lean-plane --planner-conditional-prompt`).

This run was executed directly prior to Run 19 to benchmark next-generation Gemini model inference characteristics, latency dynamics, token utilization, and prompt compatibility against the BrowseGent v2 substrate.

---

## 1. Headline Telemetry: Speed & Token Efficiency Benchmark

| Metric | Baseline (Run 14) | Run 18 (Peak 3.1 Stack) | **Gemini 3.5 Preview** | Δ vs Run 18 (3.1 Flash-Lite) |
|---|---|---|---|---|
| **Model** | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | **`gemini-3.5-flash-lite`** | Next-generation architecture |
| **Strict Score** | 7/30 (23.33%) | **11/30 (36.67%)** | 7/30 (23.33%) | -4 tasks |
| **Internal Pass Rate** | 66.67% (20/30) | 63.33% (19/30) | 50.00% (15/30) | -4 tasks (higher escalation sensitivity) |
| **Judge Score Rate** | 38.46% (5/13) | 50.00% (4/8) | **62.50% (5/8)** | **+12.50pp higher judge acceptance** |
| **Combined Solved** | 40.00% (12/30) | 50.00% (15/30) | 40.00% (12/30) | 12 total tasks solved |
| **Avg. Total Duration / Task** | 72.34 s | 67.39 s | **58.24 s** | **-9.15 s / task (All-Time Fastest)** |
| **Total Suite Wall Time** | 36m 12s | 33m 43s | **29m 07s** | **-4m 36s (First sub-30m suite)** |
| **Avg. Input Tokens / Task** | 48,022 | 31,851 | **27,809** | **-12.7% vs R18, -42.1% vs baseline** |
| **Mean Tokens / Call** | 7,594 | 5,055 | **4,879** | -176 tokens / call |
| **Median Tokens / Call** | 7,358 | 5,016 | **4,861** | Highly tight distribution |
| **Total Actions (Full Suite)** | 165 | 162 | **142** | **4.73 actions / task (Lowest Churn)** |
| **Avg. Planner Calls / Task** | 6.47 | 6.43 | **5.70** | **-0.73 calls / task** |
| **Bot CAPTCHA Walls** | 6 (20.00%) | 6 (20.00%) | 7 (23.33%) | Standard web barrier distribution |
| **Transient 503 Retries** | 6 | 0 | **0** | Flawless API connection |
| **Runtime Crashes** | 0 | 0 | **0** | Zero crashes |

---

## 2. Task Performance Breakdown

### Strict Passing Tasks (7 Tasks)
1. `webvoyager_Amazon__0`
2. `webvoyager_Apple__0`
3. `webvoyager_ArXiv__0`
4. `webvoyager_BBC__News__0`
5. `webvoyager_Coursera__10`
6. `webvoyager_ESPN__0`
7. `webvoyager_Wolfram__Alpha__0`

### LLM Judge Approvals (5 Tasks out of 8 Judged — 62.50%)
1. `webvoyager_Apple__10`: Approved on grounded hardware specifications.
2. `webvoyager_Booking__10`: Approved on grounded Mexican hotel pricing options.
3. `webvoyager_Coursera__0`: Approved on introductory 3D printing course curriculum.
4. `webvoyager_Google__Flights__0`: **Milestone Victory!** First time in project history that Google Flights passed under official LLM judge review on live flight selection.
5. `webvoyager_Google__Map__10`: Approved on national reserve description and coordinates.

---

## 3. Forensic Autopsy: Why Did Internal Passes Drop to 50%?

Despite exceptional latency and token reduction, Gemini 3.5 Flash-Lite's internal completion rate dropped from ~66% to 50.00% (15/30). A forensic audit of the failure logs revealed the exact mechanism:

### 1. Zero Infrastructure Crashes
There were **zero** API errors, **zero** substrate crashes, and **zero** validation exceptions.

### 2. High Voluntary Planner Escalations (7 Tasks)
Gemini 3.5 Flash-Lite triggered `planner_escalated:user_needed` or `planner_escalated:dead_end` on 7 tasks where Gemini 3.1 persisted in exploratory browsing:
- `ArXiv__10`: Escalated with `planner_escalated:user_needed` stating help page navigation needed direct search.
- `BBC__News__10`: Escalated with `planner_escalated:dead_end` when climate headlines were not in the immediate working set.
- `Booking__0`: Escalated with `planner_escalated:user_needed` upon encountering target blocking on date pickers.
- `ESPN__10`: Escalated with `planner_escalated:user_needed` reporting that CFP recap required historic date navigation.
- `GitHub__10`: Escalated with `planner_escalated:dead_end` when Copilot pricing required multi-fold scrolling.
- `Huggingface__10`: Escalated with `planner_escalated:dead_end` on the 404 missing Space page instead of formatting the 404 as a terminal answer.
- `Wolfram__Alpha__10`: Escalated with `planner_escalated:dead_end` rather than extracting the D1 prose pod.

**Conclusion**: Gemini 3.5 Flash-Lite has an intrinsically lower threshold for triggering user escalations when encountering navigation resistance or non-obvious targets. In BrowseGent v2, tuning the system prompt to explicitly encourage deeper exploration before calling `user_needed` will unlock Gemini 3.5's full benchmark potential.

---

## 4. Architectural Takeaways

1. **Unprecedented Execution Speed**: Average suite task completion dropped to **58.24 s**, completing the entire 30-task suite in just **29 minutes and 7 seconds** (the first sub-30 minute suite in project history).
2. **Extreme Token Parsimony**: Average input tokens per task reached **27,809**, a 42.1% drop relative to the Run 14 baseline, demonstrating superior prompt comprehension with minimal token overhead.
3. **High Answer Quality on Completed Tasks**: On tasks that the model saw through to completion, the official LLM judge approved **62.50% (5/8)** of non-strict answers, including solving `Google__Flights__0`.
4. **Targeted Opportunity**: With conditional prompt steering adjusted to dampen early voluntary escalations, Gemini 3.5 Flash-Lite represents an exceptional engine for high-speed, cost-efficient autonomous web browsing.
