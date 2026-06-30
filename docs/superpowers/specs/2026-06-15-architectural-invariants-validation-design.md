# Architectural Invariants & Stress Validation Specification

This specification outlines the design for an isolated, high-fidelity **Architectural Invariant and Stress Validation Suite** for BrowseGent v2. The objective is to programmatically verify that the core design patterns—stable references, fingerprint preservation, transition classification, and reference resolution—function reliably under dynamic and adversarial DOM conditions, without LLM or planner noise.

---

## 1. Testing Philosophy & Harness Setup

The suite will operate at the **Substrate & Runtime API level** to validate the core architectural primitives directly.

*   **Test File**: `tests/integration/v2/architecturalInvariants.test.ts`
*   **Infrastructure**: Starts Playwright Chromium headless and loads local HTML fixtures from `tests/fixtures/v2/`.
*   **Execution**: Run via standard Node.js test runner using `npx tsx --test`.

---

## 2. Invariant Test Suite structure

The suite is divided into 5 testing layers, covering a total of 11 architectural invariants:

```
                  ┌─────────────────────────────────────┐
                  │          Observation Layer          │
                  │  (Coverage, Hidden Filter, Afford) │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │              Ref Layer              │
                  │ (Rerenders, Ambiguity, Negative Rec)│
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │       Continuity & Graph Layer      │
                  │   (Transitions, Growth, Pruning)    │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │        Planner Surface Layer        │
                  │      (Affordance Correctness)       │
                  └─────────────────────────────────────┘
```

---

### Layer 1: Observation Invariants

#### 1.1 Observation Coverage Invariant
*   **Fixture**: `static-controls.html` & `form-region.html`
*   **Invariant**: Every standard visible, actionable element (button, textbox, link, dropdown, textarea, combobox) must be successfully captured and represented in `BrowserObservation.refs`.
*   **Assertion**:
    *   Verify that `observation.refs` contains a matching reference for every HTML control, validating that no interactive targets are omitted at the entry point of the pipeline.

#### 1.2 Hidden Element Filtering Invariant
*   **Fixture**: `blocked-overlay.html` & custom mock page
*   **Invariant**: Elements that are invisible due to layout or styling (`display: none`, `visibility: hidden`, `opacity: 0`, `aria-hidden="true"`, or zero bounding box coordinates) must never pollute the active action surface.
*   **Assertion**:
    *   Verify their `visibility` property is marked as `hidden`, and they are excluded from the `PlannerWorkingSetSelector`'s primary action list.

#### 1.3 Actionability Integrity Invariant
*   **Fixture**: `static-controls.html`
*   **Invariant**: The capability flags (`clickable`, `typeable`, `selectable`, `readable`) assigned to a reference must match their physical DOM properties.
*   **Assertion**:
    *   An input element must have `typeable: true`.
    *   A span or div with no handlers must not be labeled as `clickable: true`.
    *   This prevents the planner from attempting invalid actions (e.g. typing into a button).

---

### Layer 2: Reference Invariants

#### 2.1 React Rerender / Element Replacement Invariant
*   **Fixture**: `rerender-replacement.html`
*   **Mutation**: A button click destroys an input element and replaces it with a new input element containing identical semantics (same role, name, placeholder) in a different DOM position.
*   **Assertion**:
    *   `RefService` must recognize the new element as the same reference, preserving the original `refId` with a soft fingerprint match (confidence > 0.7).
    *   `RefResolver.resolve(ref, page)` must successfully resolve the original `refId` to the newly created physical DOM node.

#### 2.2 Bounding Box Layout Shift Invariant
*   **Fixture**: `layout-shift.html`
*   **Mutation**: Pushes an interactive button 200px down, changes its parent container, changes sibling order, and changes its z-index.
*   **Assertion**:
    *   The reference must survive without being marked as stale or degraded, proving that **identity does not equal geometry**.
    *   `RefResolver` must successfully locate the button at its updated screen coordinates.

#### 2.3 Ambiguous Recovery Invariant
*   **Fixture**: `ambiguous-buttons.html` (contains three identical "Search" buttons)
*   **Mutation**: Dynamically appends a fourth "Search" button.
*   **Assertion**:
    *   When linking references across observations, `RefService` must either degrade their `continuityConfidence`, mark the references as ambiguous, or refuse to link them to the wrong target.
    *   It must **never silently succeed** or map elements arbitrarily, preventing mismatched actions on repeating lists.

#### 2.4 Negative Recovery (False Link Prevention) Invariant
*   **Fixture**: Custom mock page containing a "Delete User" button.
*   **Mutation**: Removes the "Delete User" button and replaces it with a similar "Delete All Users" button.
*   **Assertion**:
    *   `RefService` must recognize the semantic shift. It must **not** match the new button to the old button's ref ID.
    *   The old ref ID must transition to `stale`/`invalid`, forcing a new reference ID to be generated for "Delete All Users".

---

### Layer 3: Continuity & Graph Invariants

#### 3.1 State Transitions Invariant
*   **Fixture**: `delayed-load.html`
*   **Mutation**: Triggers a delayed action that reveals a control after a 200ms layout paint.
*   **Assertion**:
    *   `ContinuityInterpreter.interpret(before, after)` must classify the state shift as a local structural change.
    *   The new control must be marked as `appeared` in `refChanges`, and its state must be registered as `present` inside the `ContinuityGraph`.

#### 3.2 Graph Growth & Pruning Bounds Invariant
*   **Fixture**: `local-rerender.html`
*   **Mutation**: Run a stress loop that applies 200 consecutive observation updates with alternating dynamic element mutations.
*   **Assertion**:
    *   The total number of refs in `ContinuityGraph` must remain bounded.
    *   Old `stale` references must be pruned, and transition history length must not exceed the `maxTransitions` limit.
    *   Assert that memory footprint and snapshot processing time do not degrade linearly, preventing resource leaks over long-running sessions.

---

### Layer 4: Planner Surface Invariants

#### 4.1 Planner Affordance Invariant
*   **Fixture**: `static-controls.html` & `form-region.html`
*   **Invariant**: The primary action surface generated by `PlannerWorkingSetSelector` must never advertise tools that are incompatible with the element's current state.
*   **Assertion**:
    *   Verify that a disabled button or hidden input is never included in the clickable/typeable arrays.
    *   Verify that select fields only list the `select` tool, preventing planner tool mismatch failures.

---

## 3. Implementation Plan

1.  **Create Test File**: Save the suite in `tests/integration/v2/architecturalInvariants.test.ts`.
2.  **Add NPM Command**: Update `package.json` to include:
    ```json
    "test:invariants": "tsx --test tests/integration/v2/architecturalInvariants.test.ts"
    ```
3.  **Run and Verify**: Execute the suite to ensure all architectural invariants pass cleanly.

---

## 4. Verification & Audit Criteria

Passing these tests verifies that the core primitives behave correctly under controlled, dynamic conditions. It does not guarantee that the LLM planner will always solve every task, but it guarantees that the planner is provided with a stable, accurate, and actionable representation of the browser state.
