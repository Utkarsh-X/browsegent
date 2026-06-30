# Spec Audit: Overlay & Dropdown Projection Hardening

We conducted a deep code audit to identify why modern dynamic sort/dropdown menu overlays (specifically GitHub's "Sort by" menu) do not project visible and actionable options to the planner.

---

## 1. Core Findings

Our investigation revealed three distinct architectural gaps that prevent dropdown options from being parsed, capability-mapped, and selected:

### A. DOM Extraction Filtering Gap (Brain1 Observation)
*   **Files:** [ObservationService.ts](file:///D:/BrowseGent/src/v2/substrate/ObservationService.ts#L327) & [RefResolver.ts](file:///D:/BrowseGent/src/v2/substrate/RefResolver.ts#L364)
*   **Behavior:** Both files define an `isInteractiveElement` helper to whitelist elements during DOM traversal. While they check for `role="menuitem"`, they completely omit `role="menuitemradio"` (used by GitHub's sort menu) and `role="menuitemcheckbox"`.
*   **Impact:** Dropdown options are dropped during traversal and never populated in the continuity graph or observation ref list.

### B. Interactive Capabilities Mapping Gap (Continuity Graph)
*   **File:** [refCapabilities.ts](file:///D:/BrowseGent/src/v2/runtime/refCapabilities.ts#L14)
*   **Behavior:** `deriveRefCapabilities` uses a whitelisted set of `CLICKABLE_ROLES` to determine if an element supports clicks. This list includes `menuitem` but omits `menuitemradio` and `menuitemcheckbox`.
*   **Impact:** Even if extracted, dropdown options are compiled with `clickable: false` capabilities, making them invalid targets for click actions.

### C. Ranking & Selection Gaps (Projection & Planner Working Set)
*   **Files:** [rankOperationalItems.ts](file:///D:/BrowseGent/src/v2/brain1/rankOperationalItems.ts#L57) & [PlannerWorkingSetSelector.ts](file:///D:/BrowseGent/src/v2/planner/PlannerWorkingSetSelector.ts#L557)
*   **Behavior:**
    *   `inferProjectionKind` maps `menuitem` to `'button'`, but falls back to `'generic'` for `menuitemradio`/`menuitemcheckbox`, resulting in poor ranking scores.
    *   `isClickableCandidate` in `PlannerWorkingSetSelector.ts` whitelists `menuitem` but omits the radio/checkbox variants.
*   **Impact:** Dropdown options are penalized in ranking or completely filtered out of the planner's active working set.

---

## 2. Refinement Plan

We will resolve these gaps generally (without site-specific hardcoding) by expanding the whitelists across all layers:

1.  **DOM Extraction Whitelist:** Add `menuitemradio`, `menuitemcheckbox`, and `searchbox` to `isInteractiveElement` in `ObservationService.ts` and `RefResolver.ts`.
2.  **Capabilities Whitelist:** Add `menuitemradio` and `menuitemcheckbox` to `CLICKABLE_ROLES` in `refCapabilities.ts`.
3.  **Ranking Whitelist:** Map `menuitemradio` and `menuitemcheckbox` to `'button'` kind in `rankOperationalItems.ts`.
4.  **Working Set Selection Whitelist:** Add `menuitemradio` and `menuitemcheckbox` as valid clickable roles in `PlannerWorkingSetSelector.ts`.
