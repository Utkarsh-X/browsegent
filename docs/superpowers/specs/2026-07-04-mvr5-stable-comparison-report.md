# mvr5-stable Benchmark Run Comparison

A detailed side-by-side comparison of three `mvr5-stable` benchmark runs on BrowseGent v2:
1.  **Baseline Run** (`1783061401349`): Done before state/Plus code patches and implementation tasks.
2.  **100% Run** (`1783065180443`): Achieved a perfect 5/5 score.
3.  **Latest Run** (`1783155174004`): Done after implementing the 7 task changes, achieving 3/5.

---

## 1. Executive Summary Telemetry

| Metric | Baseline Run (`1783061401349`) | 100% Run (`1783065180443`) | Latest Run (`1783155174004`) |
| :--- | :---: | :---: | :---: |
| **Pass Rate** | 60.0% (3/5) | **100.0% (5/5)** | 60.0% (3/5) |
| **Cambridge Dictionary** | ❌ Blocked (Captcha) | **✅ Passed** | ❌ Blocked (Captcha) |
| **ArXiv** | ✅ Passed | ✅ Passed | ✅ Passed |
| **GitHub** | ✅ Passed | ✅ Passed | ✅ Passed |
| **Google Maps** | ❌ Failed (Regex) | **✅ Passed** | ❌ Failed (Dead End) |
| **Wolfram Alpha** | ✅ Passed | ✅ Passed | ✅ Passed |
| **Total Duration** | 497.3s | 493.0s | 504.6s |
| **Total Input Tokens** | 284,079 | 260,799 | 326,390 |
| **Total Output Tokens** | 1,886 | 1,770 | 1,724 |

---

## 2. Detailed Task-by-Task Metrics

### 1. `webvoyager_Cambridge__Dictionary__0`
*   **Baseline**: ❌ Blocked (Duration: 37.6s, Steps: 5, Input Tokens: 19,976) — Cloudflare Turnstile CAPTCHA.
*   **100% Run**: **✅ Passed** (Duration: 83.8s, Steps: 10, Input Tokens: 49,863) — The CAPTCHA did not trigger, and the agent completed dictionary lookups successfully.
*   **Latest Run**: ❌ Blocked (Duration: 52.3s, Steps: 5, Input Tokens: 22,622) — Cloudflare Turnstile CAPTCHA blocked the browser session again.

### 2. `webvoyager_ArXiv__0`
*   **Baseline**: ✅ Passed (Duration: 70.3s, Steps: 8, Input Tokens: 34,767)
*   **100% Run**: ✅ Passed (Duration: 109.2s, Steps: 8, Input Tokens: 41,088)
*   **Latest Run**: ✅ Passed (Duration: 49.9s, Steps: 5, Input Tokens: 27,906) — **Speedup**: Completed 54% faster and used 32% fewer input tokens than the 100% run due to streamlined planning.

### 3. `webvoyager_GitHub__0`
*   **Baseline**: ✅ Passed (Duration: 130.4s, Steps: 12, Input Tokens: 80,418)
*   **100% Run**: ✅ Passed (Duration: 130.6s, Steps: 12, Input Tokens: 80,242)
*   **Latest Run**: ✅ Passed (Duration: 167.9s, Steps: 15, Input Tokens: 81,576)

### 4. `webvoyager_Google__Map__10`
*   **Baseline**: ❌ Failed (Duration: 139.2s, Steps: 5, Input Tokens: 85,933) — Failed the final regex check due to state abbreviation formatting mismatch in the answer text.
*   **100% Run**: **✅ Passed** (Duration: 39.4s, Steps: 3, Input Tokens: 18,825) — Search submitted in a single mini-plan (`[type, press Enter]`), leading immediately to success.
*   **Latest Run**: ❌ Failed (Duration: 230.5s, Steps: 11, Input Tokens: 120,533) — Failed with `planner_invalid_output_dead_end` (detailed root-cause below).

### 5. `webvoyager_Wolfram__Alpha__0`
*   **Baseline**: ✅ Passed (Duration: 119.8s, Steps: 11, Input Tokens: 62,985)
*   **100% Run**: ✅ Passed (Duration: 130.0s, Steps: 13, Input Tokens: 70,781)
*   **Latest Run**: ✅ Passed (Duration: 166.6s, Steps: 12, Input Tokens: 73,653)

---

## 3. Google Maps Regression Analysis

### The Root Cause
In today's run, the `Google__Map__10` task failed because it entered a dead-end planning loop on `get` reads:
1.  **Mini-Plan Interrupt (Task 6)**: Task 6 introduced a rule in `shouldContinueMiniPlan` to interrupt mini-plans after typing in a `combobox` or `searchbox` to allow the agent to re-observe autocomplete dropdowns.
2.  **Search Submission Discarded**: Because Google Map search inputs are `combobox` elements, typing the query immediately broke the mini-plan. The second planned step—`{"tool":"press","key":"Enter"}`—was **discarded**.
3.  **Read Loop**: The search was never submitted. The agent remained on the autocomplete list dropdown. The planner got stuck reading the dropdown suggestions (`get v2ref_211` and `get v2ref_212` repeatedly).
4.  **Quarantine & Compatibility Block**: The loop quarantine persistence locked `v2ref_211` and `v2ref_212` for reads. The planner then tried to `click` them, but because they are read-only and no longer in the readable set (due to quarantine), the validator failed compatibility checks and rejected the plan, triggering a validation dead-end.

### Proposed Refinement
To prevent this regression, we must allow the agent to complete `press` Enter submit actions immediately after typing, even inside comboboxes/searchboxes. If the next planned step is a `press` tool, the mini-plan should **not** be interrupted.
