# BrowseGent v2 System Gaps and Broken Behaviors Report

This report presents a detailed diagnostic analysis of the core defects, failures, and architectural bottlenecks identified in the BrowseGent v2 system. It synthesizes logs, telemetry data, and source code behaviors to map out what is broken, why it is failing, and how to remediate each gap.

---

## 1. Ref Failures (Stale & Blocked Coordinates)

### A. Symptoms & Behaviors
During execution, the runner frequently throws exceptions such as `stale_ref`, `target_stale`, or `target_blocked`, causing immediate action aborts and task losses.
* **Coordinate Occlusion**: Clicks fail because sticky header menus, consent banners, or absolute overlays intercept the click event at the center coordinates.
* **React/DOM Mutation Staleness**: React rerenders recreate DOM nodes, invalidating Playwright handles and active references, resulting in detached node exceptions.

### B. Technical Root Cause & Call Path
* **Location**: [InputService.ts](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) and [RefResolver.ts](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts)
* **Call Path**:
  ```text
  V2AgentLoop.ts (execute step)
    ↓
  RefResolver.resolve(refId) → retrieves active DOM handle
    ↓
  InputService.click(element) → dispatches coordinate click
    ↓
  Playwright throws Target Blocked or Stale Reference Exception
  ```
The system currently lacks **out-of-band self-healing**. When a click fails due to coordinate blocking or detached elements, the execution loop does not attempt to scroll the element into view, shift the click offsets, or perform a fast selector-based re-match.

### C. Remediation Strategy
1. **Out-of-Band Healing Interceptor**: Add a try-catch handler in [RefResolver.ts](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts). If an interaction throws a stale/blocked error:
   * Pause execution and run a fast observer capture scan.
   * Re-match the stale element based on class, sibling structure, or text content.
   * If a new live element matches, update the ref mapping and retry the action.
2. **Scroll-Into-View Enforcement**: Force scroll-to-center actions before dispatching coordinates to clear sticky header overlays.

---

## 2. Unbounded Reference Graph Growth (`ARCH-001`)

### A. Symptoms & Behaviors
During long browser sessions with hundreds of page interactions and mutations (e.g. infinite scroll lists), the active graph accumulates dead historical reference pointers, leading to unbounded index sizes.
* **Stress Test Findings**: A 200-cycle stress test with dynamic control insertions/removals resulted in historical ref counts growing to **102 references** even though active present elements remained at `0`.

### B. Technical Root Cause
* **Location**: [ContinuityGraph.ts](file:///d:/BrowseGent/src/v2/graph/ContinuityGraph.ts)
* **Mechanism**:
  ```typescript
  // Inside ContinuityGraph.ts:
  // Historical references are appended to the main index but never cleaned up
  this.refs.set(refId, node);
  ```
While the transition history array is correctly capped at `maxTransitions = 5` in the continuity interpreter, the underlying map of nodes in the graph contains no eviction logic for historical references that are no longer active and have fallen out of the recent transition window.

### C. Remediation Strategy
1. **Graph Purge Policy**: Implement a periodic pruning routine in `ContinuityGraph.ts` to evict references that:
   * Have been marked `stale` or `detached`.
   * Are older than the `maxTransitions` limit.
2. **Reference Garbage Collection**: When a macro-state navigation transition is detected, flush all historical graph keys and start fresh.

---

## 3. Observation Gaps (Shadow Roots & Custom Controls)

### A. Symptoms & Behaviors
Core interactive elements (search textboxes, autocomplete overlays, pagination selectors) on modern sites (Amazon, Reddit, Cambridge Dictionary) are completely omitted from the observed DOM tree, preventing the planner from seeing or interacting with them.
* **Amazon Results**: The pagination "Next" button is not observed because it uses styled spans rather than standard links/buttons.
* **Cambridge Dictionary**: The dynamic autocomplete drop-down options are omitted.
* **Reddit**: Search input is hidden inside nested shadow host hierarchies and omitted.

### B. Technical Root Cause
* **Location**: [ObservationService.ts](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts) and [refCapabilities.ts](file:///d:/BrowseGent/src/v2/runtime/refCapabilities.ts)
* **Mechanism**: The observation scraper relies on standard HTML5 tag matchers (`button`, `a`, `input`, `select`) and standard ARIA role mappings. It fails to traverse:
  1. Nested, closed, or complex open shadow DOM boundaries that do not expose standard accessibility hierarchies.
  2. Custom styled controls that rely on dynamic JavaScript event handlers instead of semantic interactive roles.

### C. Remediation Strategy
1. **Shadow Root Traversal Expansion**: Harden the shadow DOM crawling logic inside `ObservationService.ts` to recursively scan all open shadow hosts.
2. **Interactive Event Sniffing Heuristics**: Detect element interactivity by checking for event listeners (e.g. `onclick`, `onmousedown`) or inline pointer styles (`cursor: pointer`), assigning them a generic clickable capability fallback.

---

## 4. Recovery Engine Loops (0% Recovery Rate)

### A. Symptoms & Behaviors
When an action fails (e.g. clicking on a blocked button coordinate), the planner enters a loop, issuing the exact same tool, reference ID, and parameters repeatedly until it exhausts the maximum step budget.
* **Audit Statistics**: BrowseGent exhibited a **0% recovery rate** across 19 audited recovery scenarios, wasting an average of **9.4 steps** per failed run.

### B. Technical Root Cause
* **Location**: [V2AgentLoop.ts](file:///d:/BrowseGent/src/v2/agent/V2AgentLoop.ts) and [RecoveryState.ts](file:///d:/BrowseGent/src/v2/runtime/RecoveryState.ts)
* **Mechanism**: The planner's context window contains only the current page observation and working set. When an action fails, the subsequent observation is identical to the previous one. Because the planner has no memory of its prior action or the resulting error (as they are not injected into the prompt context), it assumes it is acting on a fresh page and clicks the same target ref.

### C. Remediation Strategy
1. **Execution History Injection**: Append the last 3 executed actions and their outcomes (success vs. exception code) to the planner's input sequence.
2. **Automated Loop Interceptor**: Inside `RecoveryState.ts`, detect when the exact same `(tool, targetRef, value)` tuple is generated 3 times consecutively. If flagged:
   * Block the planned action.
   * Inject a forced fallback action (e.g. page refresh, back navigation, or scrolling) to reset page state.
   * Provide explicit loop feedback to the planner (e.g. *"Action click on v2ref_18 has failed 3 times consecutively. Please try a different approach."*).
