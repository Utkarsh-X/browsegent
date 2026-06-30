# PRC v1.1 Fidelity & Action Economy Audit

We conducted a deep audit of the PRC v1.1 benchmark run `logs/webvoyager-lite/webvoyager_lite_1782804152320` to verify whether the new compact tool encoding caused any regressions in task fidelity, and to identify root causes for strict mismatches and loop repetitions.

---

## 1. Task Analysis Summary

### Task 1: GitHub Strict Mismatch (`webvoyager_GitHub__0`)
*   **Task Question:** "Search for an open-source project related to 'climate change data visualization' on GitHub and report the project with the most stars."
*   **Golden Reference:** `resource-watch/resource-watch`
*   **Agent Final Answer:** `"The open-source project 'moriahtaylor1/climate-change-analysis' has 20 stars, which is the highest among the visible results."`
*   **Fidelity Regression Cause:** **Not caused by PRC v1.1 compact tool encoding.**
    *   PRC correctly compiled and displayed the elements.
    *   In Step 4, the agent clicked `Sort by: Best match` to open the sorting dropdown.
    *   In Step 5, the dropdown overlay options (such as "Most stars") did not appear in the projection (they were either offscreen or hidden). Because the options were missing, the agent did not proceed to select "Most stars" and instead immediately finalized the task using the most starred repository visible on the default first page.
    *   **Belongs to:**
        *   **b) Planner prompt/contract:** The agent should verify that sorting has actually been applied before declaring done.
        *   **e) Benchmark/evaluator issue:** Vague task description ("report the project with the most stars") combined with fragile popup overlay element projections on GitHub.

---

### Task 2: Google Maps Strict Mismatch (`webvoyager_Google__Map__10`)
*   **Task Question:** "Search for a park in the state of California called Castle Mountains National Monument and find out it's Basic Information."
*   **Golden Reference:** `located in Barstow, CA 92311; open 24 hours; phone number is (760) 252-6100`
*   **Agent Final Answer:** `"Castle Mountains National Monument is a national reserve located in Barstow, California. It is a protected area featuring rare desert grassland, Joshua tree forests, and the 'Castle Peaks' rock spires. It is open 24 hours."`
*   **Fidelity Regression Cause:** **Not caused by PRC v1.1 compact tool encoding.**
    *   PRC compiled and outputted the address and hours correctly.
    *   The agent stopped prematurely and declared `done` at Step 4. The phone number was not in the projection because it required clicking the "About" or "Overview" tab in the Google Maps sidebar (which the agent did in the longer June 28 run, but skipped here because it was confident it already had "Basic Information").
    *   **Belongs to:**
        *   **c) Finalization/answer contract:** The planner prompt does not instruct the agent that location-based "Basic Information" questions expect a standard set of contact details (address, hours, and phone number).

---

### Task 3: Wolfram Alpha Action Economy Regression (`webvoyager_Wolfram__Alpha__0`)
*   **Symptom:** Task passed, but took 13 steps and performed `get v2ref_587` seven times consecutively.
*   **Fidelity Regression Cause:** **Agent loop recovery gap.**
    *   Each of the seven consecutive reads returned an empty string `{"text":""}`.
    *   `ActionProgressMemory` in `V2AgentLoop.ts` ignores read tool results that return empty or trimmed whitespace strings (`""`).
    *   Because the empty read results were ignored, no `repeated_value_preview` uncertainty signal was generated. As a result, the element `v2ref_587` was never quarantined, and the loop recovery mechanism was never activated.
    *   **Belongs to:**
        *   **d) Loop recovery:** Empty or zero-content read actions should still be recorded in `ActionProgressMemory` (e.g., using a fallback placeholder) to ensure that loops on empty elements trigger uncertainty signals and quarantine.

---

## 2. Recommended Action Plan

| Area | Refinement Description | Target Files |
| :--- | :--- | :--- |
| **d) Loop recovery** | Record zero-content reads (e.g., as `__empty__`) in `ActionProgressMemory` to trigger quarantine on empty read loops. | [V2AgentLoop.ts](file:///D:/BrowseGent/src/v2/agent/V2AgentLoop.ts#L658) |
| **c) Finalization contract** | Instruct the planner in the finalization section to verify standard fields (address, hours, phone number, website) for location/park/business search questions before declaring done. | [PlannerPrompt.ts](file:///D:/BrowseGent/src/v2/planner/PlannerPrompt.ts#L86) |
