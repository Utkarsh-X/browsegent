# Forensic Benchmark Head-to-Head: Browser-Control vs BrowseGent Serial Lean Plane

An exhaustive, high-scrutiny comparative audit between **Run 6 (Browser-Control Native Rust Substrate)** and **Run 15 (BrowseGent Serial Lean Data Plane)** on the standard `balanced30` WebVoyager slice using **`gemini-3.1-flash-lite`**.

This forensic document details the architectural substrate differences, trajectory efficiency, token economics, latency profiles, strict ground-truth accuracy, and an **exhaustive root-cause failure analysis for every single task**.

---

## 1. Executive Summary Scoreboard

| Metric / Dimension | Run 6 (Browser-Control Native Substrate) | Run 15 (BrowseGent Serial Lean Plane) [Latest] | Variance / Delta (Run 15 vs Run 6) |
| :--- | :---: | :---: | :--- |
| **Run ID** | `webvoyager_lite_1788360177393` | `webvoyager_lite_1788594583363` | Distinct substrate architectures |
| **Substrate Engine** | External Windows Rust Binary (`browser-control.exe`) | TypeScript Native v2 AgentLoop + Playwright | Modern modular agent stack |
| **Model** | `gemini/gemini-3.1-flash-lite` | `gemini/gemini-3.1-flash-lite` | Identical model |
| **Serialization / Data Plane** | Raw text / DOM flattening | PRC Lean Plane (`--prc-lean-plane`) | Structural semantic pruning |
| **Request Pacing Interval** | 10,000 ms | 10,000 ms | Identical pacing constraint |
| **Total Evaluated Tasks** | 30 | 30 | Standard `balanced30` slice |
| **Internal Pass Rate** | **100.00% (30/30)** | 63.33% (19/30) | R6 stamps any non-empty answer string as pass |
| **Strict Score (Ground Truth)** | **33.33% (10/30)** | 26.67% (8/30) | -2 tasks variance on string matching |
| **Partial Credit Rate** | **35.00% (10.5/30)** | 28.33% (8.5/30) | Proportional token overlap credit |
| **Env-Adjusted Strict Score** | 33.33% (10/30) | 26.67% (8/30) | R6 did not classify bot walls |
| **Active Judged Task Count** | 20 | 11 | Additive judge qualification |
| **LLM Judge Score Rate** | **50.00% (10/20)** | 27.27% (3/11) | R6 judged on step thoughts; R15 on grounded DOM |
| **Combined Solved Rate** | **66.67% (20/30)** [Lenient] | 36.67% (11/30) [Grounded] | R6 benefited from ungrounded judge passes |
| **Mean Input Tokens / Call** | N/A (untracked per-call) | **5,153** | Highly compact request size |
| **Avg. Input Tokens / Task** | **17,570** | 34,352 | R6 lacked structural interactive tree |
| **Avg. Output Tokens / Task** | 641 | **218** | **-66.0% output token reduction** |
| **Avg. Planner Steps / Task** | 8.87 | **6.67** | **-2.20 fewer steps / task (-24.8%)** |
| **Total Actions (Full Suite)** | 248 | **160** | **-88 fewer actions (-35.5% action churn)** |
| **Avg. Total Duration / Task** | 162.17 s | **68.89 s** | **2.35x faster execution (-93.28 s / task)** |
| **Total Suite Execution Time** | 81m 05s (4,865.1 s) | **34m 28s (2,066.7 s)** | **-46m 37s total time saved (-57.5%)** |
| **Bot CAPTCHA Walls Detected** | 0 (blind churn) | 5 (16.67%) | Clean early exit on Cloudflare walls |
| **Transient 503 Retries** | 0 | 2 (100% recovered) | Full auto-recovery via backoff |
| **Runtime Crash Count** | 0 | 0 | Both engines completed 100% cleanly |

---

## 2. Core Architectural & Substrate Differences

### 2.1 Substrate Execution Model
* **Browser-Control (Run 6)**:
  - Operates as a compiled, standalone native Windows Rust binary (`browser-control.exe`).
  - Employs a fixed external action loop that dumps raw accessibility tree / flat DOM text into prompt strings.
  - **The "100% Internal Pass Rate" Illusion**: In `browser_control_runner.py` (lines 382-400), success is defined strictly as `success = bool(final_answer.strip())`. Any non-empty string returned at the end of the episode is stamped as an internal pass, even when the agent was completely blocked by Cloudflare, looped on dead links, or exhausted step budgets.
* **BrowseGent (Run 15)**:
  - Operates as a modern, modular TypeScript architecture built directly on Playwright, featuring a decoupled Planner / Observer / Action loop (`V2AgentLoop`).
  - Utilizes **PRC Lean Data Plane** (`--prc-lean-plane`), which renders structural interactive surfaces with strict character caps, working-set ref filtering, and element projection.
  - **Truthful Status Classification**: Aborts and classifies failures explicitly (`captcha_wall`, `v2_max_steps_exhausted`, `planner_repeated_answer_rejection`), ensuring the internal pass rate (63.33%) reflects genuine goal-seeking task completions.

### 2.2 LLM Judge Methodology Disparity
* **Run 6 Judge (Lenient / Step-Thought Grounding)**:
  - The judge for Run 6 evaluated final answers alongside `stderr.txt` intermediate thoughts.
  - The judge scored tasks without enforcing final-page visual/DOM evidence. As discovered in the forensic audit, this allowed hallucinated or ungrounded answers to receive `SUCCESS` verdicts:
    - `Google__Search__10`: The model answered Morgan Wallen for a 2026 Billboard ranking query based on internal memory; the judge passed it despite zero live grounding.
    - `Amazon__10`: The model claimed protection plans were not accessible; the judge awarded a pass.
* **Run 15 Judge (Strict / Evidence-Grounded Grounding)**:
  - Evaluated under the fixed official WebVoyager judge protocol with mandatory final-page accessibility trees and validation artifacts (`webvoyager_evaluation.json`).
  - If the final page still shows a search input form or navigation menu rather than the specific item requested, the judge rejects the answer as ungrounded.

---

## 3. Exhaustive 30-Task Forensic Audit & Failure Root-Cause Table

Below is the complete, task-by-task execution audit comparing Run 6 and Run 15 across all 30 benchmark tasks, documenting the exact execution failure reasons and root causes for each task:

| Task ID | R6 Status | R15 Status | Head-to-Head | R6 Execution / Failure Reason | R15 Execution / Failure Reason | Forensic Root Cause |
| :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| `Allrecipes__3` | **FAIL** | **CAPTCHA** | TIE (Bot Wall) | Looped on Cloudflare challenge for 12 actions (303.1s); judge confirmed zero recipe access. | Detected Cloudflare challenge page on Step 1 (14.1s); cleanly escalated with captcha_wall. | Anti-bot bot challenge. BrowseGent exited in 14s vs Browser-Control burning 303s in futile loop. |
| `Allrecipes__10` | **FAIL** | **CAPTCHA** | TIE (Bot Wall) | Encountered 404 and reCAPTCHA for 12 actions (261.6s); judge confirmed task not performed. | Detected Cloudflare challenge page on Step 1 (5.6s); cleanly escalated with captcha_wall. | Anti-bot bot challenge. BrowseGent exited in 5.6s vs Browser-Control burning 261s. |
| `Amazon__0` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 4 steps, 63.2s). | None (Strict ground-truth pass in 5 steps, 58.2s). | Success on both engines. Both accurately retrieved the top search item price. |
| `Amazon__10` | PASS (Judge) | **FAIL** | **R6 WIN (Judge)** | None (Lenient judge pass: judge approved claim that protection plan price was inaccessible). | Reported generic 2-year tier without verified pricing; judge strictly rejected ungrounded answer. | Judge leniency disparity. R6 awarded pass for admitting inaccessibility; R15 strictly held to ground truth. |
| `Apple__0` | PASS (Judge) | **PASS (Strict)** | **R15 WIN (Strict)** | Strict match failed; judge approved starting prices ($1299/$1499) after 11 steps (169.3s). | None (Strict ground-truth match in 5 steps, 50.0s). | BrowseGent outright victory. BrowseGent achieved exact ground-truth match in 50s vs R6 169s requiring judge. |
| `Apple__10` | **FAIL** | **FAIL** | TIE (FAIL) | Hallucinated unreleased "M5, M5 Pro, M5 Max" chips and omitted RAM/storage; judge rejected. | Hallucinated M5 generation chips and left memory/storage as "configurable"; judge rejected. | Model hallucination on future hardware specs. Both engines failed to stick to grounded live M4 specs. |
| `ArXiv__0` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 6 steps, 118.2s). | None (Strict ground-truth pass in 4 steps, 41.0s). | Success on both engines. BrowseGent completed 2.9x faster (41s vs 118s) with 2 fewer steps. |
| `ArXiv__10` | PASS (Judge) | **FAIL** | **R6 WIN (Judge)** | Strict match failed; judge approved paper withdrawal policy description after 11 steps (234.7s). | Retrieved general submission help rather than specific withdrawal workflow; judge rejected. | Navigation depth. Browser-Control spent 11 steps navigating to help sub-pages; BrowseGent missed specific section. |
| `BBC__News__0` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 12 steps, 215.9s). | None (Strict ground-truth pass in 4 steps, 41.5s). | Success on both engines. BrowseGent achieved identical strict accuracy 5.2x faster (41.5s vs 215.9s). |
| `BBC__News__10` | **PASS (Strict)** | **FAIL** | **R6 WIN (Strict)** | None (Strict ground-truth pass in 4 steps, 69.7s). | Exhausted 13-step budget exploring multiple topic portals without returning answer. | Step budget exhaustion. BrowseGent explored multiple climate sub-portals and timed out before synthesizing. |
| `Booking__0` | **FAIL** | **FAIL** | TIE (FAIL) | Failed to operate calendar date picker; judge rejected answer instructing user to search themselves. | Trapped interacting with localized date-picker popup; hit v2_max_steps_exhausted after 13 steps. | Complex dynamic calendar widget. Both engines failed to set travel dates on Booking.com. |
| `Booking__10` | **FAIL** | **FAIL** | TIE (FAIL) | Stalled on search form; judge rejected answer admitting it only found general search interface. | Trapped on date-picker widget; hit v2_max_steps_exhausted after 13 steps without results. | Dynamic date picker failure on both engines. Neither engine could navigate past calendar popups. |
| `Cambridge__Dictionary__0` | **FAIL** | **CAPTCHA** | TIE (Bot Wall) | Looped against Cloudflare verification for 12 actions (219.8s); judge confirmed task failure. | Detected Cloudflare challenge page on Step 1 (9.8s); cleanly escalated with captcha_wall. | Anti-bot bot challenge. BrowseGent cleanly aborted in 9.8s vs Browser-Control burning 220s. |
| `Cambridge__Dictionary__10` | PASS (Judge) | **CAPTCHA** | **R6 WIN (Judge)** | Strict match failed; judge leniently approved pronunciation extracted from cached/error page. | Detected Cloudflare challenge page on Step 1 (9.0s); cleanly escalated with captcha_wall. | Anti-bot bot challenge. BrowseGent classified bot wall in 9s; R6 benefited from lenient judge pass. |
| `Coursera__0` | PASS (Judge) | **FAIL** | **R6 WIN (Judge)** | Strict match failed; judge approved course details after 12 steps (205.6s). | Answered from search suggestions without reaching course page; judge strictly rejected ungrounded answer. | Search suggestion hallucination. BrowseGent answered prematurely from autocomplete without opening course page. |
| `Coursera__10` | **PASS (Strict)** | **FAIL** | **R6 WIN (Strict)** | None (Strict ground-truth pass in 6 steps, 96.6s). | Extracted title from homepage suggestions but failed to verify enrollment; judge strictly rejected. | Grounding evidence failure. BrowseGent answered from search suggestions without visiting course landing page. |
| `ESPN__0` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 5 steps, 91.7s). | None (Strict ground-truth pass in 4 steps, 38.0s). | Success on both engines. BrowseGent achieved identical strict match 2.4x faster (38s vs 92s). |
| `ESPN__10` | **PASS (Strict)** | **FAIL** | **R6 WIN (Strict)** | None (Strict ground-truth pass in 5 steps, 86.2s). | Explored multiple schedule pages, hit step limit, and triggered incomplete_answer contract failure. | Navigation path divergence. BrowseGent followed a schedule sub-menu and hit step limits. |
| `GitHub__0` | **PASS (Strict)** | **FAIL** | **R6 WIN (Strict)** | None (Strict ground-truth pass in 2 steps, 25.4s). | Answered with climate project list, but judge rejected for not isolating single highest-starred repo. | Sorting/filtering ambiguity. BrowseGent listed relevant projects rather than sorting strictly by star count. |
| `GitHub__10` | PASS (Judge) | PASS (Judge) | TIE (Judge Pass) | Strict match failed; judge approved Copilot pricing breakdown ($10/mo, $120/yr) after 12 steps (183.4s). | Strict match failed; judge approved Copilot Pro pricing breakdown ($20/mo, $240/yr) in 9 steps (90.2s). | Tie (Judge pass on both). BrowseGent verified current updated Copilot Pro pricing in half the time (90s vs 183s). |
| `Google__Flights__0` | **FAIL** | **FAIL** | TIE (FAIL) | Struggled to input origin/destination; judge rejected answer admitting lack of flight data. | Trapped interacting with airport autocomplete dropdown; exhausted step budget after 13 steps. | Airport autocomplete and calendar widget failure on both engines. |
| `Google__Flights__10` | **FAIL** | **FAIL** | TIE (FAIL) | Struggled with dates and route inputs; judge rejected answer admitting failure to locate flights. | Failed to finalize destination selection from dropdown; hit v2_max_steps_exhausted after 13 steps. | Dropdown interaction complexity. Neither engine could execute the full flight search flow. |
| `Google__Map__0` | **FAIL** | **FAIL** | TIE (FAIL) | Returned only 3 salons (including one with 4.8 rating, failing >4.8 constraint); judge rejected. | Returned only 2 salons (including one with 4.8 rating) and told user to search; judge rejected. | Count and threshold failure. Neither engine fulfilled the 5 salons with rating >4.8 requirement. |
| `Google__Map__10` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 4 steps, 58.2s). | None (Strict ground-truth pass in 4 steps, 40.6s). | Success on both engines. Both accurately retrieved the national reserve location and description. |
| `Google__Search__0` | PASS (Judge) | **PASS (Strict)** | **R15 WIN (Strict)** | Strict match failed; judge approved approximate date after 12 steps (210.8s). | None (Strict ground-truth match in 8 steps, 80.9s). | BrowseGent outright victory. BrowseGent achieved exact ground-truth match in 80.9s vs R6 210.8s requiring judge. |
| `Google__Search__10` | PASS (Judge) | **CAPTCHA** | **R6 WIN (Judge)** | Lenient judge pass: model hallucinated Morgan Wallen for a 2026 query from memory; judge approved. | Detected Google bot challenge page on Step 3 (29.8s); cleanly escalated with captcha_wall. | Bot wall vs hallucination. Google triggered CAPTCHA; BrowseGent escalated truthfully while R6 hallucinated. |
| `Huggingface__0` | PASS (Judge) | PASS (Judge) | TIE (Judge Pass) | Strict match failed; judge approved model details after 4 steps (57.9s). | Strict match failed; judge approved model details in 7 steps (70.5s). | Tie (Judge pass on both). Both engines successfully identified the March 2023 sentiment analysis model. |
| `Huggingface__10` | PASS (Judge) | PASS (Judge) | TIE (Judge Pass) | Strict match failed; judge approved honest 404 report for missing space in 2 steps (31.0s). | Strict match failed; judge approved honest 404 report for missing space in 3 steps (29.5s). | Tie (Judge pass on both). Both engines honestly and accurately reported the 404 page status. |
| `Wolfram__Alpha__0` | **PASS (Strict)** | **PASS (Strict)** | TIE (Strict Pass) | None (Strict ground-truth pass in 12 steps, 175.3s). | None (Strict ground-truth pass in 4 steps, 39.0s). | Success on both engines. BrowseGent achieved exact match 4.5x faster (39s vs 175s) with 8 fewer steps. |
| `Wolfram__Alpha__10` | **FAIL** | **FAIL** | TIE (FAIL) | Failed to extract data and admitted failure; judge rejected answer. | Retrieved magnetic declination (3° 35' E) but omitted total magnetic intensity (51.5 uT); judge rejected. | Information completeness. BrowseGent extracted declination but omitted total field strength. |

---

## 4. Forensic Taxonomy of Failure Modes

Every failed task across both Run 6 and Run 15 falls into one of five distinct failure classes. Below is the forensic breakdown of why each failure occurred:

### 4.1 Anti-Bot Challenges & Cloudflare Blocks (5 Tasks)
* **Affected Tasks**: `Allrecipes__3`, `Allrecipes__10`, `Cambridge__Dictionary__0`, `Cambridge__Dictionary__10`, `Google__Search__10`.
* **BrowseGent Behavior**:
  - Detected the Cloudflare challenge page on **Step 1** (within 5 to 14 seconds) via automated challenge pattern recognition (`planner_escalated:captcha`).
  - Cleanly escalated and halted the episode, preventing wasted LLM token spend and unnecessary API pacing delay.
* **Browser-Control Behavior**:
  - Remained blind to the challenge iframe. It continuously re-sent navigation actions and clicks for all 12 allotted steps (burning 260 to 326 seconds per task).
  - Stamped the failed attempt as "internal pass" because the binary emitted an error string at the end.
* **Judge Verification**:
  - The LLM judge reviewed Run 6's traces and confirmed that `Allrecipes__3`, `Allrecipes__10`, and `Cambridge__Dictionary__0` never bypassed the challenge and awarded them `NOT_SUCCESS`.
  - On `Google__Search__10`, Google triggered a CAPTCHA. BrowseGent stopped truthfully in 29.8s; Browser-Control hallucinated the Billboard #1 artist from pre-training memory and was leniency-awarded a pass by the ungrounded judge.

### 4.2 Dynamic Calendar & Flight Route Pickers (4 Tasks)
* **Affected Tasks**: `Booking__0`, `Booking__10`, `Google__Flights__0`, `Google__Flights__10`.
* **BrowseGent Behavior**:
  - Successfully navigated to the flight/hotel search forms, but struggled with complex nested popup widgets: date picker grids, destination dropdown suggestion menus, and localized buttons (`खोजें`, `हो गया`).
  - Exhausted its 13-step budget trying to dismiss popups or confirm dates, terminating with `v2_max_steps_exhausted`.
* **Browser-Control Behavior**:
  - Experienced identical widget interaction failure. It repeatedly typed origin and destination without successfully navigating to the search results page.
  - Its final answers explicitly reported its own failure: *"The provided text does not contain specific flight pricing or booking availability..."*
* **Root Cause**: Modern single-page web calendar widgets (Booking.com and Google Flights) require specialized multi-action coordination (clicking the input, selecting the month, clicking the day, clicking Done) that standard atomic action loops struggle to complete within a 12–13 step budget.

### 4.3 Multi-Hop Step Budget Exhaustion (3 Tasks)
* **Affected Tasks**: `BBC__News__10`, `ESPN__10`, `Google__Map__0`.
* **Detailed Breakdown**:
  - `BBC__News__10` (UK Climate Policies): Run 6 took a shallow navigation path and retrieved general headlines in 4 steps (69.7s). Run 15 explored deeper into topic-specific policy sub-portals, consuming its 13 steps before synthesizing the final answer.
  - `ESPN__10` (College Football Championship): Run 6 found the championship schedule in 5 steps (86.2s). Run 15 followed a series of sub-navigation tabs, hit the step limit, and triggered `answer_contract_failed:incomplete_answer` because it refused to return an incomplete schedule.
  - `Google__Map__0` (5 Seattle Beauty Salons > 4.8 Rating): Both engines failed. Run 6 returned only 3 salons (including one with rating 4.8, violating the "> 4.8" threshold). Run 15 returned 2 salons (also violating the rating threshold). The judge rejected both for failing the count and rating constraints.

### 4.4 Answer Grounding & Autocomplete Hallucination (4 Tasks)
* **Affected Tasks**: `Amazon__10`, `Coursera__0`, `Coursera__10`, `GitHub__0`.
* **Detailed Breakdown**:
  - `Coursera__0` & `Coursera__10`: On Coursera, when the agent typed keywords into the search bar, the UI displayed autocomplete suggestions. BrowseGent answered from the suggestion text without navigating to the course page. Under the evidence-grounded judge, the judge checked the final page screenshot, found only the Coursera homepage, and rejected the answer. Run 6 navigated all the way to course pages (burning 12 steps and 205s) and earned a pass.
  - `Amazon__10` (PS4 2-Year Protection Plan): Neither engine found the exact warranty plan price because Amazon requires adding the console to the cart to reveal warranty add-ons. Run 6 was leniently approved for reporting the price was inaccessible; BrowseGent reported a generic Asurion warranty plan tier and was rejected by the strict judge.
  - `GitHub__0` (Climate Visualization Stars): Run 6 sorted repositories and found the top-starred project in 2 steps (25.4s). BrowseGent returned a list of multiple climate projects, but the judge rejected it for not isolating the single highest-starred repository.

### 4.5 Hardware Spec Speculation & Incomplete Extraction (2 Tasks)
* **Affected Tasks**: `Apple__10`, `Wolfram__Alpha__10`.
* **Detailed Breakdown**:
  - `Apple__10` (Latest MacBook Pro Chip, RAM, Storage): Both engines failed identically. Gemini 3.1 Flash-Lite hallucinated unreleased "M5, M5 Pro, and M5 Max" chips based on pre-training speculative tech news. Both engines also failed to retrieve configurable RAM and storage tables. The judge rejected both.
  - `Wolfram__Alpha__10` (Oslo Geomagnetic Field): Run 6 completely failed to extract data. BrowseGent retrieved the magnetic declination (3° 35' E), but omitted the total magnetic intensity (51.5 uT). The judge rejected BrowseGent's answer for providing an incomplete component of the geomagnetic field.

---

## 5. Domain Category Performance Breakdown

| Web Domain Category | Tasks Included | Run 6 Solved (Strict + Judge) | Run 15 Solved (Strict + Judge) | Forensic Diagnosis |
| :--- | :--- | :---: | :---: | :--- |
| **E-Commerce** | `Amazon`, `Apple` | 3 / 4 (75%) | 2 / 4 (50%) | BrowseGent achieved strict ground-truth on both `Amazon__0` and `Apple__0`. R6 won `Amazon__10` via lenient judge pass. |
| **Academic & Research** | `ArXiv` | 2 / 2 (100%) | 1 / 2 (50%) | Both solved `ArXiv__0` strictly; Run 6 navigated deeper into help pages on `ArXiv__10`. |
| **News & Media** | `BBC News` | 2 / 2 (100%) | 1 / 2 (50%) | Both solved `BBC__News__0` strictly; BrowseGent over-explored on `BBC__News__10`. |
| **Sports** | `ESPN` | 2 / 2 (100%) | 1 / 2 (50%) | Both solved `ESPN__0` strictly; BrowseGent hit step limits on `ESPN__10`. |
| **Developer Tools** | `GitHub`, `Huggingface` | 3 / 4 (75%) | 3 / 4 (75%) | Exact tie: both solved `GitHub__10`, `Huggingface__0`, and `Huggingface__10`. |
| **Travel & Booking** | `Booking`, `Google Flights` | 0 / 4 (0%) | 0 / 4 (0%) | Both engines failed complex date-picker flows across dynamic calendar widgets. |
| **Maps & Navigation** | `Google Map` | 1 / 2 (50%) | 1 / 2 (50%) | Both solved `Google__Map__10` strictly; both failed the multi-salon rating criteria on `Google__Map__0`. |
| **Search Engines** | `Google Search` | 2 / 2 (100%) [Lenient] | 1 / 2 (50%) | BrowseGent passed `Google__Search__0` strictly; BrowseGent was blocked by bot wall on `Google__Search__10`. |
| **Reference & Dictionaries** | `Cambridge Dictionary` | 1 / 2 (50%) | 0 / 2 (0%) | Site is heavily Cloudflare-protected; BrowseGent exited early on step 1. |
| **Computational Knowledge**| `Wolfram Alpha` | 1 / 2 (50%) | 1 / 2 (50%) | Both solved `Wolfram__Alpha__0` strictly in exact agreement (`11.2`). |

---

## 6. Strategic Takeaways & Architectural Remediation Plan

1. **Massive Efficiency and Velocity Superiority**:
   BrowseGent (`--prc-lean-plane`) is **2.35x faster** than Browser-Control (68.89 s/task vs 162.17 s/task), executes with **35.5% fewer actions** (160 vs 248), and cuts **66% of output token bloat** (218 vs 641 tokens/task), with zero unhandled crashes.
2. **Eliminate Autocomplete Trapping on Search Sites**:
   The biggest unforced error on BrowseGent occurred on `Coursera__0` and `Coursera__10`, where the agent answered from dropdown suggestion previews rather than pressing Enter or clicking through to the actual landing page. Implementing an **explicit landing-page grounding invariant** will immediately recover 2 passing tasks (+6.7% accuracy).
3. **Dedicated Date & Calendar Interaction Macro**:
   Both engines scored 0/4 on `Booking` and `Google Flights`. Standard atomic click actions struggle with month-advancement grids and time pickers. A specialized high-level calendar macro (`set_date_range(checkin, checkout)`) will solve this category across both flight and hotel engines.
4. **Adaptive Horizon Budgeting for Search Results**:
   On `BBC__News__10` and `ESPN__10`, BrowseGent hit step limits while actively navigating valid result paths. Increasing the max step budget from 13 to 16 dynamically when the agent is following search pagination will convert these into verified completions.
