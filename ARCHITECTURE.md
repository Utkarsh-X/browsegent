# BrowseGent v2 Architecture

Welcome to the technical architecture guide for **BrowseGent v2**. This document explains the core design patterns, structural subsystems, and execution loops that make BrowseGent v2 a highly resilient, deterministic, and cost-effective browser automation engine compared to traditional browser agents.

---

## 1. Executive Summary & Design Philosophy

Existing browser agent frameworks (such as *browser-use*, *Stagehand*, or *TinyFish*) suffer from structural fragility. They delegate mechanical survival concerns—such as waiting for elements, resolving stale DOM structures, generating CSS selectors, and handling action retries—to a Large Language Model (LLM) planner. This results in **planner overload**, causing:
- High token consumption (dumping the entire DOM tree repeatedly).
- Non-deterministic runs (LLM invents selectors that fail randomly).
- High latency and cost due to planner-level compensation.
- Complex runtime bugs that are unreplayable and impossible to audit.

**BrowseGent v2** introduces a clean separation of concerns:
- **Semantic Planner**: A lean, task-oriented planner that reasons about user goals, formulates high-level actions, and selects target element references. It is shielded from raw HTML, CSS selectors, and execution-level failures.
- **Runtime Substrate**: A robust, low-level execution engine that manages session stabilization, resolves target references to physical DOM nodes, tracks state across navigation events, classifies errors, and records fully replayable trace logs.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Semantic Planner                         │
│   (LLM makes high-level decisions; operates on stable Refs)     │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                   [Plan Steps with Ref IDs]
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Runtime Substrate                        │
│   (DOM tracking, Ref resolution, CDP session, input execution)  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                [Direct browser interactions (CDP)]
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Target Browser Page                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Architectural Differences

The following comparison matrix highlights how BrowseGent v2 resolves the fundamental flaws of first-generation selector-based browser agents.

| Capability | Traditional Browser Agents (browser-use, Stagehand) | BrowseGent v2 |
| :--- | :--- | :--- |
| **Operational Identity** | CSS Selectors, XPath, or raw HTML IDs. Breaks immediately when the page rerenders, class names change, or elements shift. | **Stable Refs (`V2Ref`)**. Elements are assigned stable, long-lived IDs that survive rerenders, structural changes, and page transitions. |
| **Identity Resolution** | LLM-generated selectors executed against the DOM. If a selector fails, the planner must rewrite it, causing feedback loops. | **Multi-Candidate Scoring**. The runtime maintains multiple selector fingerprints and matches semantic attributes (role, name, text) to recover identity. |
| **State Tracking** | Context is lost on every DOM update. The planner must rescan the entire page and rebuild its understanding from scratch. | **Continuity Graph**. Tracks element lineage across navigation and structural updates, preserving relations and degradation metrics. |
| **Planner Context Size** | The raw DOM tree or fully rendered interactive HTML is dumped into the context window, causing massive token explosions. | **Smart Working Set Selector**. Curates and compresses only goal-relevant elements (primary, secondary, navigation, readable evidence). |
| **Error Handling** | Raw browser errors flow to the planner. The LLM must determine if an element is obscured, disabled, or missing. | **Operational Error Classification**. Runtime classifies errors (transient vs. persistent, blocked vs. detached) and self-heals before asking the planner. |
| **Replay & Auditability** | Non-deterministic. A run cannot be replayed offline because the environment changes and LLM decisions vary. | **Replayable Traces**. Captures every observation, transition, failure, and planner output. Replay tests assert behavior deterministically. |

---

## 3. Subsystem Breakdown

BrowseGent v2 is divided into six core subsystems, each designed with single-responsibility principles and clean boundaries.

```mermaid
sequenceDiagram
    autonumber
    participant Loop as V2AgentLoop
    participant Sub as Runtime Substrate
    participant Graph as ContinuityGraph
    participant Set as WorkingSetSelector
    participant Client as V2PlannerClient
    participant Disp as V2ToolDispatcher
    
    Note over Loop: Loop Iteration Starts
    Loop->>Sub: Capture Observation & CDP node IDs
    Sub-->>Loop: BrowserObservation
    Loop->>Graph: Apply Observation
    Graph-->>Loop: ContinuityGraphSnapshot
    Loop->>Set: Select goal-relevant working set
    Set-->>Loop: PlannerWorkingSetSelection
    Loop->>Client: Send compressed input & validate schema
    Client-->>Loop: PlannerOutput (done or mini-plan steps)
    
    loop For each step in mini-plan
        Loop->>Disp: Dispatch action step (Ref ID)
        Disp->>Sub: Execute input (Ref resolution & click/type/select)
        Sub-->>Disp: Tool execution outcome (V2ToolResult)
        Disp-->>Loop: Result + TransitionEvidence
        Loop->>Graph: Apply transition & update lineages
        Note over Loop: If structural transition or failure occurs, break early to replan
    end
```

### 3.1 The Ref System (Operational Identity)

Instead of passing fragile selectors to the planner, BrowseGent v2 tags elements with stable operational identities known as **Refs** (`V2Ref`).
- **Fingerprinting**: Refs are fingerprinted when first encountered using two mechanisms in [refFingerprint.ts](file:///d:/BrowseGent/src/v2/runtime/refFingerprint.ts):
  - **Hard Fingerprint**: Combines structural selectors, tag names, roles, accessible names, text contents, and Chrome DevTools Protocol (CDP) `backendNodeId`s.
  - **Soft Fingerprint**: Ignores raw DOM selectors and node IDs, relying solely on semantic variables (role, accessible name, text, input type, actionability).
- **Tracking**: The [RefService.ts](file:///d:/BrowseGent/src/v2/runtime/RefService.ts) maintains a database of all assigned references. During page updates, elements are compared against existing fingerprints. If only a soft match occurs, the reference's `continuityConfidence` degrades, and its state is updated to `weakened`.
- **Thresholds**: If an element's confidence drops below `0.7`, the system flags it as weakened. If it disappears completely, it is marked as `stale` or `invalid`, preventing the planner from targeting a dead control.

> [!NOTE]
> Soft ref matching allows elements to maintain their identity even if a React rerender completely changes their class names or target IDs, as long as their semantic role and labels remain stable.

---

### 3.2 The Runtime Substrate

The Substrate layer interacts directly with Playwright and the Chrome DevTools Protocol (CDP) to drive the browser.
- [BrowserSession.ts](file:///d:/BrowseGent/src/v2/substrate/BrowserSession.ts): Encapsulates low-level page navigation, headless launch profiles, page lifecycle, and window dimensions.
- [CdpBridge.ts](file:///d:/BrowseGent/src/v2/substrate/CdpBridge.ts): Wraps Playwright's `CDPSession` to send raw CDP commands, bypassing high-level automation wrappers when querying low-level document nodes.
- [ObservationService.ts](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts):
  - Injects a DOM-crawling script that gathers all interactive elements, computes their accessible names, roles, bounding boxes, visibility, and actionability.
  - Temporarily tags elements with random runtime markers and resolves their true `backendNodeId` and `frameId` using CDP's `DOM.getDocument` and `DOM.describeNode`.
- [InputService.ts](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) & [RefResolver.ts](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts):
  - Executes interactions (clicks, keyboard entry, option selections).
  - Resolves ref IDs back to physical locators by testing all recorded selector candidates and evaluating their semantic resemblance using a scoring function (`scoreCandidate`).
  - Implements **pre-action checks**, including center-point pointer interception checking using `document.elementFromPoint`, preventing click failures before they occur.
  - Automatically translates browser exceptions to structured [errors.ts](file:///d:/BrowseGent/src/v2/runtime/errors.ts) codes (e.g., `target_hidden`, `target_blocked`, `element_detached`).

---

### 3.3 Continuity & Stabilization

Pages are highly dynamic during user interaction. The Continuity and Stabilization layer ensures that actions are only executed when the browser state is settled.
- [StabilizationService.ts](file:///d:/BrowseGent/src/v2/runtime/StabilizationService.ts): Waits for the page's `'domcontentloaded'` status, followed by an adjustable quiet window (typically `75ms`) to ensure layout paints and asynchronous JavaScript execution have finished.
- [TransitionService.ts](file:///d:/BrowseGent/src/v2/runtime/TransitionService.ts): Analyzes page updates by comparing observations before and after an action. It classifies transitions into:
  - `microstate`: Minor layout shifts (e.g., hover effects, style shifts) with no structural element updates.
  - `structural_local`: Elements appeared, disappeared, or weakened, but the URL and page generation index remain identical.
  - `structural_macrostate`: Major page changes, such as full-page navigation, URL updates, or server-side routing events.
- [ContinuityGraph.ts](file:///d:/BrowseGent/src/v2/graph/ContinuityGraph.ts): Maintains a running snapshot of the DOM topology. It tracks which elements exist, flags their last seen status, maps them to specific physical screen regions, and traces their stability across recorded transitions.

---

### 3.4 The Planning Layer

The planning layer presents the LLM with a clean representation of the browser state and guides it to correct errors.
- [V2PlannerClient.ts](file:///d:/BrowseGent/src/v2/planner/V2PlannerClient.ts): Handles client communications with the LLM. It includes **self-correction mechanisms**: if the planner suggests an action that violates schema rules (such as typing into a non-editable element or targeting an invalid ref), the client catches the validation error and retries. It provides the planner with detailed guidance, listing compatible ref alternatives.
- [PlannerWorkingSetSelector.ts](file:///d:/BrowseGent/src/v2/planner/PlannerWorkingSetSelector.ts): Performs smart DOM pruning to prevent token bloat.
  - Elements are scored based on visibility, actionability, goal keyword relevance, and role matching (e.g., prioritizing links for navigation, inputs for query goals).
  - High-scoring elements are placed in the **Primary Working Set**, while lower-priority elements go into the **Secondary Working Set**.
  - Irrelevant or hidden generic elements with no textual labels are dropped completely.
  - Failed or blocked elements are quarantined (ignored) if they repeatedly result in loops or failures, forcing the planner to try alternate paths.
- [PlannerInputComposer.ts](file:///d:/BrowseGent/src/v2/planner/PlannerInputComposer.ts): Builds the final compressed [types.ts](file:///d:/BrowseGent/src/v2/planner/types.ts) payload sent to the LLM, containing the compressed working set, active failures, current uncertainty levels, and the task's action lineage (history).

---

### 3.5 Trace & Auditability

BrowseGent v2 treats audibility and replayability as primary design requirements.
- [TraceStore.ts](file:///d:/BrowseGent/src/v2/trace/TraceStore.ts): Serializes all run data to disk under a structured directory named after a unique `runId`. It captures:
  - Exact `BrowserObservation` structures.
  - Planner inputs, compact views, and JSON outputs.
  - Transition evidence logs.
  - Continuity graph snapshots.
  - Action steps, execution statuses, and failure reports.
- [TraceReplayAuditor.ts](file:///d:/BrowseGent/src/v2/trace/TraceReplayAuditor.ts): Reviews trace files to ensure their integrity. It verifies that:
  - The runtime operated in the correct agent mode.
  - Observations were successfully recorded.
  - Every mutating step (e.g., click, type) was followed by subsequent observation frames and valid transition evidence.

> [!TIP]
> Fully replayable traces make it possible to reproduce bugs offline. Developers can write tests that ingest recorded traces to check edge cases without running live network requests.

---

### 3.6 V2 Agent Loop Orchestrator

The [V2AgentLoop.ts](file:///d:/BrowseGent/src/v2/agent/V2AgentLoop.ts) brings all the subsystems together in an orchestrator.

```
       ┌──────────────────────────────────────────────────────────┐
       │                Initialize Agent & Browser                │
       └────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
 ┌────►│              Capture & Project Observation               │
 │     └────────────────────────────┬─────────────────────────────┘
 │                                  │
 │                                  ▼
 │     ┌──────────────────────────────────────────────────────────┐
 │     │            Compose Input & Call Planner Client           │
 │     └────────────────────────────┬─────────────────────────────┘
 │                                  │
 │                                  ▼
 │     ┌──────────────────────────────────────────────────────────┐
 │     │             Is Plan Finished (done/escalate)?            │
 │     └──────────────────────┬─────────────┬─────────────────────┘
 │                            │             │
 │                     [No]   │             │   [Yes]
 │                            │             └───────────────────────────┐
 │                            ▼                                         │
 │     ┌──────────────────────────────────────────────────────────┐     │
 │     │            Execute Mini-Plan Actions (1 to N)            │     │
 │     └──────────────────────┬───────────────────────────────────┘     │
 │                            │                                         │
 │                [For each action step in plan]                        │
 │                            │                                         │
 │                            ▼                                         │
 │     ┌──────────────────────────────────────────────────────────┐     │
 │     │           Dispatch Tool & Collect Post-Observation       │     │
 │     └──────────────────────┬───────────────────────────────────┘     │
 │                            │                                         │
 │                            ▼                                         │
 │     ┌──────────────────────────────────────────────────────────┐     │
 │     │         Should plan continue? (check errors,             │     │
 │     │          detached refs, or macrostate transition)        │     │
 │     └──────────────────────┬─────────────┬─────────────────────┘     │
 │                            │             │                           │
 │                   [Yes]    │             │   [No / Break]            │
 │                            │             └─────────────────────┐     │
 │                            ▼                                   │     │
 └────────────────────────────┴───────────────────────────────────┼─────┼──┐
                                                                  │     │  │
                                                                  ▼     ▼  │
                                                ┌────────────────────────┐ │
                                                │    Validate Answer &   │◄┘
                                                │      Return Result     │
                                                └────────────────────────┘
```

1. **Start**: Opens the target URL, captures the initial observation, and registers elements in the continuity graph.
2. **Planner Execution**: Composes the working set, gets a plan (a sequence of steps) from the LLM.
   - If the planner returns `done: true`, the loop verifies the output against the goal's `AnswerContract` to prevent hallucinations.
3. **Execution & Early-Break**: Loops through the mini-plan steps. After each tool dispatch:
   - Takes a new page observation and updates the continuity graph.
   - Evaluates early-break conditions via `shouldContinueMiniPlan`. The execution loop is broken immediately if:
     - The tool failed.
     - A major layout transition occurred (e.g., page navigation, URL change, page generation bump).
     - The target reference for the next planned action is no longer live or visible.
     - The tool was a `navigate` or a mutating `click`/`press` action that caused a layout transition.
   - Breaking early prevents the runner from executing actions against outdated element structures, redirecting control back to the planner to adjust its course.

---

## 4. Fail-Safe, Recovery, & Quarantining

BrowseGent v2 does not crash or loop indefinitely when page layouts change. It isolates and resolves failures automatically.

### 4.1 Failure Classification
When an action fails, the [FailureClassifier.ts](file:///d:/BrowseGent/src/v2/runtime/FailureClassifier.ts) categorizes the error:
- **Category**: Classifies failures under `target` (obscured, disabled), `continuity` (stale ref, detached element), `navigation`, `timing` (timeouts), or `environment` (CAPTCHA, access blocks).
- **Persistence**:
  - **Transient**: The action is retryable (e.g., page navigation timeout or temporary load block).
  - **Persistent**: The action is not retryable without plan adjustments (e.g., target is disabled, hidden, or blocked by another element).

### 4.2 Uncertainty & Dead State Detection
- [UncertaintySignals.ts](file:///d:/BrowseGent/src/v2/runtime/UncertaintySignals.ts) evaluates the stability of the current environment, checking for weakened refs, consecutive no-progress transitions, empty interaction projections, or CAPTCHA indicators.
- [DeadStateDetector.ts](file:///d:/BrowseGent/src/v2/runtime/DeadStateDetector.ts) assesses these signals. If a critical blockade is detected, it raises a `dead_state` flag. This halts execution, prevents token-wasting retries, and escalates the issue to the caller with clear diagnostics.

### 4.3 Action Quarantining
If an action on a specific element results in a persistent error or a no-progress loop, the working set selector places that action in quarantine:
```typescript
// From PlannerWorkingSetSelector.ts
function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  // Adds failed, non-retryable actions and repeated no-progress transitions to the quarantine list.
}
```
Quarantined actions are removed from the `actionSurface` sent to the planner. The LLM is forced to find alternative paths (e.g., clicking a parent tab or using a keyboard shortcut) instead of retrying the same broken button.

---

## 5. Developer Guide: Extending BrowseGent v2

### 5.1 How to Add a New Tool
To introduce a new browser interaction (such as `hover` or `drag`):
1. **Define the Tool Action**: Add the tool definition schema to the typescript types in [types.ts](file:///d:/BrowseGent/src/v2/planner/types.ts).
2. **Implement the Action in the Substrate**: Open [InputService.ts](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) and add the lower-level execution and capability checks.
3. **Register in Tool Dispatcher**: Update [V2ToolDispatcher.ts](file:///d:/BrowseGent/src/v2/tools/V2ToolDispatcher.ts) to translate the planner action to the substrate method:
   ```typescript
   case 'hover':
     return this.dispatchRefTool(step, 'hover', ref => this.runtime.hover(ref));
   ```
4. **Update the Planner Schema**: Update `PlannerOutputSchema.ts` and prompt files to declare the new tool and validate its properties.

### 5.2 How to Register a Custom LLM Provider
If you want to use an alternative inference endpoint:
1. Implement the `V2PlannerProvider` interface:
   ```typescript
   export type V2PlannerProvider = (
     system: string,
     user: string,
     model?: string,
     options?: ProviderCallOptions,
   ) => Promise<V2PlannerProviderResult>;
   ```
2. Pass the provider to the `V2PlannerClient` or `V2AgentLoop` configuration:
   ```typescript
   const runner = new BrowserAgentRunner({
     v2RuntimeMode: 'agent',
     plannerClient: new V2PlannerClient({ provider: myCustomLLMProvider })
   });
   ```

---

## 6. Directory Map (src/v2)

For easy onboarding, here is where key abstractions reside:

- [/src/v2/agent/](file:///d:/BrowseGent/src/v2/agent/): Outer loop execution orchestrator (`V2AgentLoop.ts`).
- [/src/v2/substrate/](file:///d:/BrowseGent/src/v2/substrate/): Low-level Playwright and CDP connectors (`BrowserSession.ts`, `CdpBridge.ts`, `InputService.ts`, `ObservationService.ts`).
- [/src/v2/runtime/](file:///d:/BrowseGent/src/v2/runtime/): Operational reference tracking, stabilization, transitions, and failure classifications.
- [/src/v2/planner/](file:///d:/BrowseGent/src/v2/planner/): Planner client, input selectors, token compression utilities, and system prompts.
- [/src/v2/graph/](file:///d:/BrowseGent/src/v2/graph/): Topology tracking and DOM relation structures (`ContinuityGraph.ts`).
- [/src/v2/trace/](file:///d:/BrowseGent/src/v2/trace/): Offline log stores and trace replay auditors (`TraceStore.ts`, `TraceReplayAuditor.ts`).
