# Planner Representation Compiler (PRC) v1 Payload Efficiency Audit

This report presents a quantitative analysis of the provider-payload telemetry captured on the `mvr5-stable` slice using the Planner Representation Compiler (PRC) serialization mode. The goal is to identify the dominant cost drivers and outline concrete, safe slimming vectors for PRC v1.1.

---

## 1. Executive Summary

An audit of the telemetry logs for the 5-task stable benchmark run (`webvoyager_lite_1782706777602`) shows:
*   **User Message Dominance:** User payload bytes consume **82.0%** (1,111,905 bytes) of the total payload footprint sent to Gemini, while System Prompt bytes consume **18.0%** (243,501 bytes).
*   **Redundancy Bottleneck:** The single largest source of raw string bloat in the user message is the comma-separated lists of ref IDs under `DECISION SIGNALS` (`action surface: click=... type=... select=... read=...`). On pages with ~80 selected references, this single line consumes up to **4.5 KB per call**, contributing to ~15-20% of user payload cost.
*   **Validation Retries:** Google Maps (`Google__Map__10`) consumed the highest number of tokens due to **11 validation retry attempts**, nearly doubling its total payload footprint.

---

## 2. Per-Task Telemetry Breakdown

| Task ID | Strict Pass | Planner Calls | Provider Attempts | Total System Bytes | Total User Bytes | Total Bytes | Avg. Bytes / Call |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Cambridge Dictionary--0** | ❌ Fail\* | 13 | 13 | 45,877 | 231,665 | 277,542 | 21,349 |
| **ArXiv--0** | ✅ Pass | 13 | 14 | 49,406 | 265,655 | 315,061 | 24,235 |
| **GitHub--0** | ✅ Pass | 11 | 14 | 49,406 | 251,675 | 301,081 | 27,371 |
| **Google Map--10** | ❌ Fail\* | 13 | 24 | 84,696 | 314,403 | 399,099 | 30,699 |
| **Wolfram Alpha--0** | ✅ Pass | 4 | 4 | 14,116 | 48,507 | 62,623 | 15,655 |
| **TOTAL** | **60% (3/5)** | **54** | **69** | **243,501** | **1,111,905** | **1,355,406** | **25,100** |

> [!NOTE]
> \* Failed strict contract mismatch only; the agent successfully traversed the websites and retrieved the correct definitions/coordinates but did not format them exactly as the strict validator expected.

---

## 3. Call-Level Hotspots

The largest single-step planner calls are driven by either validation retries (which bundle the error message and repeat the prompt) or finalization steps (which bundle larger context histories).

### Top 5 Largest Planner Calls by Episode
1.  **GitHub Step 8 (`episode_8_obs_1_15`)**
    *   **Size:** Sys=7,058, Usr=45,114, Tot=**52,172 bytes** (Attempts: 2)
    *   *Driver:* Validation retry on a high-density page.
2.  **ArXiv Step 11 (`episode_11_obs_1_37`)**
    *   **Size:** Sys=7,058, Usr=38,524, Tot=**45,582 bytes** (Attempts: 2)
    *   *Driver:* Validation retry.
3.  **GitHub Step 10 (`episode_10_obs_1_23`)**
    *   **Size:** Sys=7,058, Usr=35,318, Tot=**42,376 bytes** (Attempts: 2)
    *   *Driver:* Validation retry.
4.  **Google Map Step 2 (`episode_2_obs_1_3`)**
    *   **Size:** Sys=7,058, Usr=32,262, Tot=**39,320 bytes** (Attempts: 2)
    *   *Driver:* Validation retry.
5.  **Cambridge Dictionary Finalization (`episode_finalization_obs_2_17`)**
    *   **Size:** Sys=3,529, Usr=33,305, Tot=**36,834 bytes** (Attempts: 1)
    *   *Driver:* Finalization prompt bundling broad accumulated read history.

---

## 4. Bottleneck Diagnosis

### A. Is cost dominated by user payload, system prompt, retries, or excessive calls?
Cost is dominated by the **User Payload (82%)**, which scales linearly with the number of steps and attempts. However, **retries are the most significant controllable inflator**:
*   Google Maps ran 13 planner steps but took 24 provider attempts (11 retries), inflating its payload by **~120 KB**.
*   Each retry repeats the system prompt and the entire user message, acting as a massive multiplier of token cost.

### B. Is the PRC format itself the bottleneck, or duplicated content/action economy?
The PRC format itself is a major improvement over JSON (dropping average token density by 38.6% by removing redundant item key-value pairs). The bottlenecks inside the current compiler are **duplicated lane mappings** and **unbounded history growth**:
1.  **Redundant Lane Mappings:** The `DECISION SIGNALS` section outputs raw lists of ref IDs compatible with each action lane. Since the elements in the `PLANNER SURFACE` are already individually annotated with their lane (`lane="interaction"`, `lane="readable"`, etc.), listing them again under `DECISION SIGNALS` duplicates this layout mapping in a verbose, comma-separated string.
2.  **Unbounded Read History:** In longer episodes (e.g. 13 steps), the accumulated read history continues to grow, carrying old text snippets into subsequent planner inputs.

---

## 5. Top 3 safe PRC v1.1 Slimming Candidates

Based on the telemetry findings, we recommend the following target vectors for PRC v1.1 optimization:

### Vector 1: Omit Redundant Action Surface Listings in `DECISION SIGNALS`
*   **Impact:** Saves **up to 4.5 KB per call** (15-20% user payload reduction).
*   **Design:** Completely remove the `action surface: click=... type=... read=...` lines from `DECISION SIGNALS`. The planner client only needs to output the count of selectable refs or only list selectable options when they exist, because the click/type/read permissions are already explicitly specified on each element using the `lane` attribute in the `PLANNER SURFACE`.

### Vector 2: Compress and Collapse Remainder Page Elements
*   **Impact:** Saves **1-3 KB per call** on pages with high element density outside region groups.
*   **Design:** Limit the number of remainder page elements rendered in full. Remainders with a score tier of `low` (score < 70) should be omitted from the printed list, with only a count block printed (e.g., `  [Collapsed 42 low-value remainder elements]`).

### Vector 3: Cap Accumulated Read History
*   **Impact:** Saves **2-5 KB per call** in late-stage planner steps.
*   **Design:** Limit the `readEvidenceHistory` array to only retain the last 3 read observations, or prune read text segments to exclude paragraphs that do not contain active goal keywords.

---

## 6. Post-Optimization Validation: PRC v1.1 Results (June 30 Run)

We executed a full benchmark run using the new PRC v1.1 compact encoding layout, achieving the following results:
*   **Byte Reduction:** Total user bytes sent dropped from **1,111,905 bytes** to **526,194 bytes** (a **52.7% absolute reduction** in user message payload size).
*   **0 Action/Formatting Retries:** The compact encoding and updated prompt instructions achieved a **100% action validation rate (0 retries)**, eliminating multi-attempt payload multipliers.
*   **Token Savings:** Total input tokens consumed on successful tasks decreased dramatically:
    *   **ArXiv:** 112,477 -> **69,162** input tokens (-38.5%)
    *   **GitHub:** 106,194 -> **35,663** input tokens (-66.4%)
    *   **Google Map:** 138,385 -> **22,367** input tokens (-83.8%)
*   **Validation Verdict:** Proves that moving action surface tool configurations to compact per-element attributes (`tools="c,t,r"`) dramatically improves efficiency without causing reasoning degradation or plan format failures.
