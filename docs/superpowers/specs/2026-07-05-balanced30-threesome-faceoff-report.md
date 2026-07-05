# Balanced30 Threesome Faceoff Report

A comprehensive side-by-side benchmark evaluation comparing **BrowseGent v2** (our system), **Browser-Use**, and **Alumnium** (WebVoyager SOTA leaderboard leader) on the full `balanced30` 30-task slice, using the same **`gemini-3.1-flash-lite`** model.

---

## 1. Executive Summary Scoreboard

| Metric | BrowseGent v2 (Today) | Browser-Use (Best) | Alumnium (New) | Winner |
| :--- | :---: | :---: | :---: | :---: |
| **Internal Pass Rate (Non-Crash)** | 66.7% (20/30 passed) | 90.0% (27/30 passed) | **93.3% (28/30 passed)** | **Alumnium** |
| **Strict Auto-Score (Correct)** | 30.0% (9/30 passed) | **36.7% (11/30 passed)** | 20.0% (6/30 passed) | **Browser-Use** |
| **Avg. Planner Steps / Task** | 7.83 | 9.56 | **2.67** | **Alumnium** |
| **Avg. Input Tokens / Task** | 45,909 | 92,741 | **34,324** | **Alumnium** |
| **Avg. Output Tokens / Task** | 356 | 8,539 | **218** | **Alumnium** |
| **Avg. Effective Duration / Task** | 34.3s | 53.3s | **23.5s** | **Alumnium** |
| **Paced Wall-Clock Time / Task** | 109.0s | 205.3s | **23.5s** | **Alumnium** |

---

## 2. Telemetry and Efficiency Analysis

### A. The Token Footprint
*   **Alumnium's Token Efficiency**: Alumnium is the most token-efficient framework, consuming only **34,324 input tokens** and **218 output tokens** per task. This represents a **25% saving** over BrowseGent v2 and a **63% saving** over Browser-Use.
*   **Why?**: Alumnium parses page accessibility trees (which are significantly smaller than raw HTML DOM strings) and executes far fewer steps per task.

### B. Execution Speed
*   **Alumnium's Speed**: Alumnium is the fastest, executing in **23.5s** per task. It does not pace/sleep between actions internally, and its runs are very short because it frequently halts on search pages without attempting actions.

### C. The Crash / Completion Paradox
*   **Why Alumnium has a 93.3% non-crash rate**: Alumnium completed 28/30 runs without throwing errors or timing out. However, this is a "completion paradox": instead of navigating complex multi-step forms, Alumnium's planner often gave up on the first page, declaring *"Information not found on page"*. The client exited cleanly with `success: true` and 0 action steps, yielding a high completion rate but low correctness (20.0% strict score).

---

## 3. Head-to-Head Task Matrix

| Task Name | BrowseGent v2 | Browser-Use | Alumnium | Status Analysis |
| :--- | :---: | :---: | :---: | :--- |
| **Allrecipes__3** | ❌ Fail | ❌ Fail | ❌ Fail | **CAPTCHA Block**: Alumnium failed with a Python `RecursionError` on Turnstile. |
| **Allrecipes__10** | ❌ Fail | ❌ Fail | ❌ Fail | **CAPTCHA Block**: Alumnium failed with a Python `RecursionError` on Turnstile. |
| **Amazon__0** | ❌ Fail | ❌ Fail | ❌ Fail | **CAPTCHA Block**: Alumnium hit Amazon's robot check page. |
| **Amazon__10** | ✅ Pass | ❌ Fail | ❌ Fail | **CAPTCHA Block**: Alumnium hit Amazon's robot check page. |
| **Apple__0** | ✅ Pass | ✅ Pass | ❌ Fail | **Mismatched**: Alumnium returned starting price text, not MacBook spec price. |
| **Apple__10** | ✅ Pass | ✅ Pass | ❌ Fail | **Mismatched**: Alumnium returned starting price text. |
| **ArXiv__0** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search, saying "task is to retrieve info". |
| **ArXiv__10** | ✅ Pass | ✅ Pass | ❌ Fail | **Mismatched**: Alumnium got help URL instead of unsubmit icon. |
| **BBC__News__0** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **BBC__News__10** | ✅ Pass | ✅ Pass | **✅ Pass** | Bypassed step budget. |
| **Booking__0** | ❌ Fail | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Booking__10** | ❌ Fail | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Cambridge__Dictionary__0** | ✅ Pass | ✅ Pass | ❌ Fail | **CAPTCHA Block**: Alumnium hit Cloudflare verification. |
| **Cambridge__Dictionary__10** | ❌ Fail | ✅ Pass | ❌ Fail | **CAPTCHA Block**: Alumnium hit Cloudflare verification. |
| **Coursera__0** | ❌ Fail | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Coursera__10** | ✅ Pass | ✅ Pass | **✅ Pass** | Stable. |
| **ESPN__0** | ✅ Pass | ✅ Pass | **✅ Pass** | Stable. |
| **ESPN__10** | ❌ Fail | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **GitHub__0** | ✅ Pass | ✅ Pass | **✅ Pass** | Stable. |
| **GitHub__10** | ✅ Pass | ✅ Pass | ❌ Fail | **CAPTCHA Block**: Alumnium got stuck on GitHub sign-in. |
| **Google__Flights__0** | ❌ Fail | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Google__Flights__10** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Google__Map__0** | ✅ Pass | ✅ Pass | ❌ Fail | **Mismatched**: Alumnium got wrong viewport salons. |
| **Google__Map__10** | ✅ Pass | ✅ Pass | **✅ Pass** | Stable. |
| **Google__Search__0** | ❌ Fail | ✅ Pass | ❌ Fail | **CAPTCHA Block**: Alumnium hit Google unusual traffic page. |
| **Google__Search__10** | ❌ Fail | ✅ Pass | ❌ Fail | **CAPTCHA Block**: Alumnium hit Google unusual traffic page. |
| **Huggingface__0** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Huggingface__10** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |
| **Wolfram__Alpha__0** | ✅ Pass | ✅ Pass | **✅ Pass** | Stable. |
| **Wolfram__Alpha__10** | ✅ Pass | ✅ Pass | ❌ Fail | **Planning Failure**: Alumnium refused to search/click. |

---

## 4. Key Behavioral Takeaways

1.  **Search & Navigation Planning Blocker**: 
    Alumnium's core weakness on WebVoyager is its strict distinction between **Action** (`al.do`) and **Retrieval** (`al.get`). For information extraction goals that require search (like ArXiv, Coursera, Google Flights, Huggingface, Wolfram declination), the planner looks at the starting search page and immediately decides: *"The task is to extract information, not perform action. Therefore, no action is needed."* The agent loops are aborted, leaving it stuck on search pages.
2.  **Anti-bot Captcha Vulnerability**: 
    Alumnium does not have a cookie-consent banner handler or IP/stealth evasions. It gets immediately blocked by Cloudflare verification pages (Cambridge Dictionary), Google "Unusual Traffic" reCAPTCHAs, and Amazon robot checks.
3.  **The Playwright/Selenium Speed Advantage**:
    Alumnium's integration with Playwright is highly performant. Viewport configurations are identical, ensuring the benchmark environments are fully matched.
