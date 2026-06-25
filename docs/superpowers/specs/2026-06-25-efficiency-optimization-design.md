# Design Specification: Compact Text Tree Serialization for BrowseGent v2

This document specifies the technical design for transitioning BrowseGent's representation layer from JSON dictionary serialization to a compact, indented text-tree format. This design aims to reduce input tokens by $\ge 75\%$ while preserving stable reference tracking (`v2ref_N` IDs) and spatial layout context.

---

## 1. Goal & Requirements

* **Primary Goal:** Minimize the token footprint of the serialized page state sent to the LLM Planner.
* **Functional Preservation:** The Planner must still identify elements using stable `v2ref_N` IDs and accurately comprehend their spatial relationships (parent-child hierarchy and sibling ordering).
* **State Awareness:** The Planner must remain aware of abnormal element states (such as weakened confidence or disabled/hidden states) without serializing redundant default states.

---

## 2. Proposed Format Specification: Compact Ref Markup (CRM)

We define a new serialization format, **Compact Ref Markup (CRM)**, structured line-by-line using HTML/XML-like syntax combined with indentation for hierarchy.

### Syntax Rules

1. **Line Structure:**
   `[ref_id] <tag_name [attributes]>[text]</tag_name>` or a self-closing variant if there is no text.
   * Format: `[v2ref_N] <role name="accessible name" [modifiers] />`
2. **Indentation:**
   Each nesting level (parent-child relationship) adds 2 spaces of indentation.
3. **Attribute Serialization:**
   * **Only serialize non-default attributes.**
   * Default Assumptions (implicit, not serialized):
     * `visibility: "visible"`
     * `actionability: "actionable"`
     * `state: "live"`
     * `confidence: 1.0`
   * Abnormal states are appended as modifiers:
     * If `state === 'weakened'`: Add `[weakened]`
     * If `visibility !== 'visible'`: Add `[hidden]` or `[visibility=...]`
     * If `actionability !== 'actionable'`: Add `[disabled]` or `[actionability=...]`
     * If `confidence < 0.7`: Add `[confidence=0.5]`
4. **Options List (Select Elements):**
   * If a select box has options, serialize them inline in brackets, capped at 10 items: `options=[Option1|Option2|Option3]`

### Example Serialization

#### Before (JSON):
```json
{
  "v2ref_1": {
    "refId": "v2ref_1",
    "kind": "input",
    "role": "textbox",
    "name": "Search",
    "visibility": "visible",
    "actionability": "actionable",
    "state": "live",
    "confidence": 1.0
  },
  "v2ref_2": {
    "refId": "v2ref_2",
    "kind": "button",
    "role": "button",
    "name": "Submit",
    "visibility": "visible",
    "actionability": "actionable",
    "state": "live",
    "confidence": 1.0
  }
}
```

#### After (CRM):
```text
[v2ref_1] <input role="textbox" name="Search" />
[v2ref_2] <button name="Submit" />
```

---

## 3. Proposed Changes

### 3.1. Serializer Implementation
We will add `serializeToCRM` in `d:\BrowseGent\src\v2\brain1\serializeProjection.ts` (or in a new helper module).

```typescript
export function serializeToCRM(projection: SerializedProjection): string {
  let output = '';
  // Traverse and format the elements hierarchically
  // Filter and format based on selected working set
  return output;
}
```

### 3.2. Planner Prompt Updates
We will modify `buildV2PlannerSystemPrompt()` in `d:\BrowseGent\src\v2\planner\PlannerPrompt.ts` to instruct the Planner on how to read CRM.

```diff
- Planner input shape: current.refs contains selected ref facts only.
+ Planner input shape: current.elements contains elements serialized in Compact Ref Markup (CRM) format:
+ [ref_id] <role name="accessible name" [modifiers] />
+ Target elements using their exact [ref_id] (e.g. v2ref_5).
```

---

## 4. Verification Plan

### Automated Tests
1. **Serialization Unit Tests:**
   * Create a mock `SerializedProjection` containing standard and abnormal elements.
   * Call `serializeToCRM` and assert that the generated string matches the expected CRM syntax, including indentation and modifier flags.
   * Verify that default attributes (e.g. `visibility: "visible"`) are correctly omitted.
2. **Planner Prompt Tests:**
   * Run the Planner with the new prompt on a mock CRM input and verify that it parses ref IDs and issues correct tool calls.

### Manual Verification
* Execute sequential benchmarks on the `balanced30` WebVoyager-lite slice using the CRM serialization adapter to ensure the pass rate remains stable.
