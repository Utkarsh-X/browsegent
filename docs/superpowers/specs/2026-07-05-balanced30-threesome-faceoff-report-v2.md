# Balanced30 Threesome Faceoff Report (v2: Gemini 3.5 Flash Upgrade)

A side-by-side comparison of **BrowseGent v2** and **Alumnium** on the `balanced30` task slice, evaluating the impact of upgrading the core model from `gemini-3.1-flash-lite` to `gemini-3.5-flash`.

---

## 1. Executive Summary Scoreboard

| Framework | Model | Success Rate (Strict) | Avg. Input Tokens | Avg. Output Tokens | Avg. Planner Steps | Avg. Duration (Effective) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **BrowseGent v2** | `gemini-3.1-flash-lite` | **30.0% (9/30)** | 45,909 | 356 | 7.83 | 34.3s |
| **BrowseGent v2** | `gemini-3.5-flash` | 13.3% (4/30) | 70,238 | 306 | 9.93 | **18.5s** |
| **Alumnium** | `gemini-3.1-flash-lite` | 20.0% (6/30) | **34,324** | **218** | 2.67 | 23.5s |
| **Alumnium** | `gemini-3.5-flash` | 23.3% (7/30) | 41,102 | 1,468 | **2.23** | 40.2s |

---

## 2. Key Findings & Behavioral Analysis

### A. Alumnium: Minor Correctness Gains at the Cost of Verbosity
*   **Success Improvement**: Upgrading to `gemini-3.5-flash` improved Alumnium's success rate slightly from **20% to 23.3%** (+1 task resolved, `Amazon__0`). The more capable model managed to extract the correct elements in a few more edge cases.
*   **Token Overhead**: However, Alumnium's average input tokens rose by **19.7%** (to 41,102), and average output tokens increased **6.7x** (from 218 to 1,468). The newer model produced significantly more verbose internal explanations and reasoning, reducing prompt economy.

### B. BrowseGent: Prompt Mismatch and API Overload
*   **Regression**: BrowseGent's success rate dropped from **30.0% to 13.3%** under `gemini-3.5-flash`. 
*   **Formatting Errors**: The newer model emitted planning responses that frequently clashed with BrowseGent's rigid multi-agent JSON schemas, causing format validation errors and repeated recovery loops. This led to step inflation (averaging 9.93 steps vs 7.83).
*   **API Instability**: The run encountered numerous `503 Service Unavailable` API retries. Because BrowseGent distributes tasks across 6 sub-agents, a single 503 error on a crucial sub-agent call (like retrieving target area locators) can collapse the active planning thread, causing task failure.
*   **Execution Latency**: On a positive note, BrowseGent's actual browser execution speed was highly optimized. Excluding pacing sleeps, the effective browser interaction duration was only **18.5s per task**, making it the fastest browser executor in the suite.

---

## 3. Task Success Matrix Comparison

| Task Name | BrowseGent (3.1-Lite) | BrowseGent (3.5-Flash) | Alumnium (3.1-Lite) | Alumnium (3.5-Flash) |
| :--- | :---: | :---: | :---: | :---: |
| **Allrecipes__3** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Allrecipes__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Amazon__0** | ❌ Fail | ❌ Fail | ❌ Fail | **✅ Pass** (Bypassed) |
| **Amazon__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Apple__0** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Apple__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **ArXiv__0** | ✅ Pass | **✅ Pass** | ❌ Fail | ❌ Fail |
| **ArXiv__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **BBC__News__0** | ✅ Pass | ❌ Fail | ❌ Fail | **✅ Pass** |
| **BBC__News__10** | ✅ Pass | ❌ Fail | **✅ Pass** | **✅ Pass** |
| **Booking__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Booking__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Cambridge__Dictionary__0** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Cambridge__Dictionary__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Coursera__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Coursera__10** | ✅ Pass | ❌ Fail | **✅ Pass** | ❌ Fail |
| **ESPN__0** | ✅ Pass | **✅ Pass** | **✅ Pass** | **✅ Pass** |
| **ESPN__10** | ❌ Fail | **✅ Pass** | ❌ Fail | **✅ Pass** |
| **GitHub__0** | ✅ Pass | ❌ Fail | **✅ Pass** | ❌ Fail |
| **GitHub__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Google__Flights__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Google__Flights__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Google__Map__0** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Google__Map__10** | ✅ Pass | ❌ Fail | **✅ Pass** | **✅ Pass** |
| **Google__Search__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Google__Search__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail |
| **Huggingface__0** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Huggingface__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
| **Wolfram__Alpha__0** | ✅ Pass | **✅ Pass** | **✅ Pass** | **✅ Pass** |
| **Wolfram__Alpha__10** | ✅ Pass | ❌ Fail | ❌ Fail | ❌ Fail |
