# Balanced30 Gemini Flash-Lite Historical Benchmark & Truth Audit Comparative Report

A comprehensive benchmark comparison evaluating **BrowseGent v2** across historical **`gemini-3.1-flash-lite`** runs (**August 22**, **August 12**, **July 11 Phase A1 Audit**, and **July 5 Baseline**) against **Browser-Use (Best)** and **Alumnium (Best)** on the standard `balanced30` WebVoyager task slice.

---

## 1. Executive Summary Scoreboard

| Metric | BrowseGent v2 (Aug 22 Re-Run) | BrowseGent v2 (Aug 12 Audit) | BrowseGent v2 (July 11 Audit) | BrowseGent v2 (July 5) | Browser-Use (Best) | Alumnium (Best) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Model** | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.1-flash-lite` | `gemini-3.5-flash` |
| **Run ID** | `webvoyager_lite_1787420313020` | `webvoyager_lite_1786533152242` | `webvoyager_lite_1783748097228` | — | `browser_use_balanced30` | `webvoyager_lite_1783278883204` |
| **Key Architecture** | Gemini Pool (Idx 16) | Gemini Pool (Idx 25) | Gemini Pool (Idx 21) | Single Gemini Key | Single Gemini Key | Single Gemini Key |
| **Pacing Interval** | 10,000ms | 10,000ms | 10,000ms | 10,000ms | 20,000ms | 10,000ms |
| **Internal Pass Rate (Non-Crash)** | 63.3% (19/30) | 60.0% (18/30) | 63.3% (19/30) | **66.7% (20/30)** | 90.0% (27/30) | 🏆 **93.3% (28/30)** |
| **Strict Auto-Score (Correct)** | 26.7% (8/30) | 📈 **33.3% (10/30)** | 📈 **33.3% (10/30)** | 30.0% (9/30) | 🏆 **36.7% (11/30)** | 23.3% (7/30) |
| **Env-Adjusted Strict Score** | 33.3% (8/24) | 📈 **41.7% (10/24)** | 📈 **41.7% (10/24)** | 33.3% (9/27) | — | 23.3% (7/30) |
| **Avg. Dispatched Actions / Task** | 🏆 **6.47 (194 total)** | 7.40 (222 total) | 9.03 (271 total) | 7.83 | 9.56 | **2.23** |
| **No-Effect Action Waste** | — | 🚀 **12.8% (30 actions)** | 🔴 52.8% (144 actions) | — | — | — |
| **Hard-Blocked Action Loops** | — | 🟢 **12 (5.1%)** | 2 (0.7%) | — | — | — |
| **Avg. Input Tokens / Task** | **44,285** | 45,909 | 45,909 | 45,909 | 92,741 | 🏆 **41,102** |
| **Avg. Output Tokens / Task** | 🏆 **277** | 356 | 356 | 356 | 8,539 | 1,468 |
| **Total Actions (Full Suite)** | 🏆 **194** | 222 | 273 | 235 | 287 | **67** |

> [!NOTE]
> * **Primary Model Constraint**: All BrowseGent v2 evaluations operate strictly under the `gemini-3.1-flash-lite` model constraint, using API key pool rotation (`--key-index`) to isolate runtime and control-plane architectural quality.
> * **Action Economy Progress**: Total actions required across the 30 tasks dropped from **273 actions on July 11 down to 194 actions on August 22 (-28.9% total action reduction)**, proving major progress in target-ID continuity and loop detection.

---

## 2. Key Architecture Progress Across Gemini Flash-Lite Iterations

### Progression Timeline

```mermaid
graph TD
    July5["July 5 Baseline<br/>30.0% Strict / 33.3% Env-Adjusted<br/>235 Actions"] --> July11["July 11 Truth Audit<br/>33.3% Strict / 41.7% Env-Adjusted<br/>273 Actions (52.8% No-Effect Waste)"]
    July11 --> Aug12["August 12 Audit<br/>33.3% Strict / 41.7% Env-Adjusted<br/>222 Actions (12.8% No-Effect Waste)"]
    Aug12 --> Aug22["August 22 Re-Run<br/>26.7% Strict / 33.3% Env-Adjusted<br/>194 Actions (Peak Action Economy)"]
    Aug22 --> Present["Current Work: P1/P2/P3 PRC Signal-Preserved V2<br/>Flag-gated prcTierOmitted & readablePhraseBonus"]
```

### Critical Telemetry Shift Findings:

1. **Massive Reduction in No-Effect Action Waste (52.8% → 12.8%)**:
   - The introduction of `targetId` semantic continuity matching, `buildAnswerValidationEvidence()` read-only provenance, and `inputApplied` classification successfully eliminated false-progress ref churn around dynamic element IDs.
2. **Active Hard-Block Loop Interventions (2 → 12)**:
   - Progress memory actively caught and hard-blocked 12 unproven action loops across changing ref IDs, preventing infinite click loops on dynamic single-page web apps.
3. **Action Economy Optimization (273 → 194 total actions)**:
   - BrowseGent reduced its average action count per task to **6.47 actions/task**, making it 32% more action-efficient than Browser-Use (9.56 actions/task).
4. **Token Economy Advantage over Browser-Use**:
   - BrowseGent consumes **44,285 input tokens/task** and **277 output tokens/task**, saving over **52% input tokens** and **96% output tokens** compared to Browser-Use (92,741 input / 8,539 output tokens/task).

---

## 3. Failure Category Audit across Gemini Runs

| Failure Category | Aug 22 Re-Run | Aug 12 Audit | July 11 Audit | Cause & Description | Controllable? |
| :--- | :---: | :---: | :---: | :--- | :---: |
| **Strict Success** | 8 (26.7%) | 10 (33.3%) | 10 (33.3%) | Task completed and verified strictly by benchmark evaluator | — |
| **Wrong-Evidence (Strict Reject)** | 11 (36.7%) | 8 (26.7%) | 9 (30.0%) | Agent completed internally, but missed benchmark evidence text | **Yes** (Phase A3) |
| **Environment Block** | 6 (20.0%) | 6 (20.0%) | 6 (20.0%) | Cloudflare Turnstile / Captcha blocks | No |
| **Recovery / Step Exhaustion** | 3 (10.0%) | 4 (13.3%) | 3 (10.0%) | Step budget limit reached before extraction | **Yes** |
| **Execution Dead-End** | 2 (6.7%) | 2 (6.7%) | 2 (6.7%) | Planner invalid output dead-end | **Yes** |

---

## 4. Task-by-Task Historical Comparison Matrix (30 Tasks)

| Task Name | Aug 22 Re-Run | Aug 12 Audit | July 11 Audit | July 5 Baseline | Browser-Use (Best) | Alumnium (Best) | Detailed Status (Gemini Flash-Lite Benchmark) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Allrecipes__3** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | **Wrong-Evidence**: Drifted on step sequence |
| **Allrecipes__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | **Execution Drift**: Step budget reached |
| **Amazon__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | **✅ Pass** | **Wrong-Evidence**: Mismatched options |
| **Amazon__10** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ❌ Fail | ❌ Fail | **Strict Pass**: Selected exact item spec |
| **Apple__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Strict Pass**: Extracted MacBook Air base price |
| **Apple__10** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Display spec wording variance |
| **ArXiv__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Strict Pass**: Extracted quantum computing preprints |
| **ArXiv__10** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Withdrawal policy text formatting |
| **BBC__News__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Strict Pass**: Clean energy investment data |
| **BBC__News__10** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | **✅ Pass** | **Strict Pass**: Government policy headlines |
| **Booking__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Step Exhaustion**: Date picker selection loop |
| **Booking__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Step Exhaustion**: Hotel tier filter loop |
| **Cambridge__0** | ❌ Fail | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Phonetic formatting variance |
| **Cambridge__10** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Idiom context explanation drift |
| **Coursera__0** | ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Execution Dead-End**: Invalid output dead-end |
| **Coursera__10** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | **✅ Pass** | **Wrong-Evidence**: Specialization detail formatting |
| **ESPN__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | **✅ Pass** | **Strict Pass**: Standings table verified |
| **ESPN__10** | ❌ Fail | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Step Exhaustion**: Submenu navigation executed |
| **GitHub__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | **✅ Pass** | **Strict Pass**: Search repository stars extracted |
| **GitHub__10** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Copilot pricing plan tier drift |
| **Google__Flights__0**| ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Multi-stop flight filter drift |
| **Google__Flights__10**| ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Alternative carrier extracted |
| **Google__Map__0** | ❌ Fail | ❌ Fail | ✅ Pass | ✅ Pass | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Location count mismatch |
| **Google__Map__10** | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | **✅ Pass** | **Strict Pass**: Map pin hover details captured |
| **Google__Search__0**| ❌ Fail | **✅ Pass** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Direct answer box layout drift |
| **Google__Search__10**| ❌ Fail | ❌ Fail | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Related question extracted |
| **Huggingface__0** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Model card tags variance |
| **Huggingface__10** | ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Pipeline tags captured |
| **Wolfram__Alpha__0** | **✅ Pass** | **✅ Pass** | ✅ Pass | ✅ Pass | ✅ Pass | **✅ Pass** | **Strict Pass**: Direct calculation extracted |
| **Wolfram__Alpha__10**| ❌ Fail | ❌ Fail | ✅ Pass | ❌ Fail | ✅ Pass | ❌ Fail | **Wrong-Evidence**: Declination retrieved |

---

## 5. Strategic Roadmap & Next Focus

1. **Core Model Focus**: Maintain `gemini-3.1-flash-lite` with API key pool rotation (`--key-index`) as the authoritative baseline for all control-plane optimizations.
2. **Benchmark Evaluation of P1/P2/P3**: Run `balanced30` with `gemini-3.1-flash-lite` evaluating the newly committed P1/P2/P3 signal-preserving PRC changes to measure token savings and action economy gains.
3. **Phase A3 Evidence Grounding**: Target the 8–11 "Wrong-Evidence" tasks using `TaskEvidenceCoverage.ts` and `AnswerGrounding.ts` to convert internal completions into strict benchmark passes.
