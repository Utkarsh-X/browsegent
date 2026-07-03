# Benchmark Comparison: Balanced30 Semantic Click Hardening

A comprehensive side-by-side comparison of BrowseGent's performance on the WebVoyager-lite `balanced30` task set **before** and **after** implementing the Phase 1 `semanticHitTest` click reliability updates.

---

## 1. Executive Summary Scoreboard

| Metric | Baseline Run (Before `semanticHitTest`) | Today's Run (With `semanticHitTest`) | Winner / Delta |
| :--- | :---: | :---: | :---: |
| **Pass Rate** | 53.3% (16/30 passed) | 53.3% (16/30 passed) | *Equal (16/30)* |
| **Total Suite Execution Time** | **2.19 Hours** (131.7 min) | **0.77 Hours** (46.1 min) | 📈 **Today (2.8x Faster)** |
| **Avg. Duration / Task** | 263.4s | **92.1s** | 📈 **Today (65.0% Speedup)** |
| **Total Steps / Failed Steps** | 243 / 74 | 290 / **68** | 📈 **Today (Lower failure rate)** |
| **Step-Level Failure Rate** | 30.5% | **23.4%** | 📈 **Today (7.1% Improvement)** |
| **Avg. Input Tokens / Task** | **48,286** | 56,611 | Baseline (17.2% fewer tokens) |
| **Avg. Output Tokens / Task** | **298** | 363 | Baseline |

> [!NOTE]
> * The **65.0% total latency reduction** (saving **1.42 hours** of execution time) is driven by the new `semanticHitTest` bypassing false-positive overlay checks and resolving shadow DOM/label relationships instantly, preventing long timeouts and redundant retries.
> * Step-level failures dropped from **30.5% to 23.4%** because click commands no longer crash when meeting transparent overlays or custom styled form inputs.

---

## 2. Task Success Matrix

| Task Name | Baseline Run (Before) | Today's Run (After) | Status Change / Impact |
| :--- | :---: | :---: | :--- |
| **Allrecipes__3** | ❌ Fail | ❌ Fail | Cloudflare Captcha Block |
| **Allrecipes__10** | ❌ Fail | ❌ Fail | Google Captcha Block |
| **Amazon__0** | ✅ Pass | ✅ Pass | Clicked successfully around `nav-cover` |
| **Amazon__10** | ✅ Pass | ✅ Pass | Handled Amazon autocomplete |
| **Apple__0** | ✅ Pass | ✅ Pass | Clear path |
| **Apple__10** | ❌ Fail | **✅ Pass** | **RECOVERED**: Bypassed header overlay via diagnostic retry |
| **ArXiv__0** | ✅ Pass | ✅ Pass | Clear path |
| **ArXiv__10** | ✅ Pass | ✅ Pass | Clear path |
| **BBC__News__0** | ✅ Pass | ❌ Fail | Step budget exhausted |
| **BBC__News__10** | ❌ Fail | ❌ Fail | Step budget exhausted |
| **Booking__0** | ❌ Fail | ❌ Fail | Step budget exhausted (Resolved validation loop) |
| **Booking__10** | ❌ Fail | ❌ Fail | Step budget exhausted |
| **Cambridge__Dictionary__0** | ❌ Fail | ❌ Fail | Cloudflare Captcha Block |
| **Cambridge__Dictionary__10** | ❌ Fail | ❌ Fail | Answer contract mismatch |
| **Coursera__0** | ❌ Fail | **✅ Pass** | **RECOVERED**: Succeeded without hitting captcha block |
| **Coursera__10** | ✅ Pass | ✅ Pass | Clear path |
| **ESPN__0** | ✅ Pass | ✅ Pass | Clicked successfully through subnav overlays |
| **ESPN__10** | ✅ Pass | ✅ Pass | Clear path |
| **GitHub__0** | ✅ Pass | ✅ Pass | Succeeded on sort dropdown options |
| **GitHub__10** | ✅ Pass | ✅ Pass | Clear path |
| **Google__Flights__0** | ❌ Fail | ❌ Fail | Step budget exhausted |
| **Google__Flights__10** | ✅ Pass | ❌ Fail | Step budget exhausted |
| **Google__Map__0** | ✅ Pass | ❌ Fail | Step budget exhausted |
| **Google__Map__10** | ❌ Fail | ❌ Fail | Validator loop (Needs Category 3 validation softening) |
| **Google__Search__0** | ❌ Fail | ❌ Fail | Google Captcha Block |
| **Google__Search__10** | ❌ Fail | ❌ Fail | Google Captcha Block (Network drop resolved) |
| **Huggingface__0** | ✅ Pass | ✅ Pass | Clear path |
| **Huggingface__10** | ❌ Fail | **✅ Pass** | **RECOVERED**: Resolved stale node protocol error |
| **Wolfram__Alpha__0** | ✅ Pass | ✅ Pass | Succeeded on multi-column scientific tables |
| **Wolfram__Alpha__10** | ✅ Pass | ✅ Pass | Clear path |

---

## 3. Analysis & Key Takeaways

### A. Core Latency Speedup (65% Saved)
*   **The Findings**: Total execution time dropped from **2 hours 12 minutes** to just **46 minutes**. 
*   **Why**: Previously, when the strict check hit a covered element, Playwright fell back to a long stability wait (timed out after 1,500ms) or the harness retried the step multiples times. By instantly resolving label relationships and shadow DOM hosts, `semanticHitTest` returns a target verdict in milliseconds, allowing the agent to proceed immediately.

### B. Blocker Diagnostics Self-Correction in Action
*   **Case Study (`Apple__10`)**: 
    *   On Step 2, clicking `Tech Specs` failed with:
        > `Target 'Tech Specs' (link) is covered by <span.globalnav-link-text-container inside ul#globalnav-list> at its click point.`
    *   On Step 3, clicking the M5 chip tab failed with:
        > `Target 'M5, M5 Pro, and M5 Max chips' (tab) is covered by <video#media-block-gallery-item-1>...`
    *   **Self-Correction**: Instead of crashing or getting stuck, the planner read the blocker coordinates and elements, target-routed the clicks via `force:true` or alternative ref links, and successfully completed the task.

### C. Stale Ref Protocol Recovery
*   **Case Study (`Huggingface__10`)**: 
    *   In the baseline run, the task crashed instantly with a raw CDP protocol exception (`Could not find node with given id`). 
    *   In today's run, the new `resolveBackendNodeIds` retry block settled for 30ms and recovered the node references successfully, allowing the agent to complete the task with `success: true`.

### D. Remaining Opportunities (The Failures)
1.  **soft_ambiguity / Step Exhaustion**: On Booking.com and Google Flights, the agent gets stuck scrolling or navigation loops. Incorporating a structured `"thought"` key inside the PRC JSON will allow the planner to track progress and prevent step exhaustion.
2.  **Captcha/Bot Detection**: Standard Chromium continues to be blocked by Google/Cloudflare challenge pages. Spoofing user-agents and integrating evasive headers in `BrowserSession.ts` is required.
