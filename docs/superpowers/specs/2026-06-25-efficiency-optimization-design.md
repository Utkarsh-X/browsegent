# Design Specification: Compact CRM Serialization & A/B Validation

This document specifies the technical design for introducing a compact, indented text-tree format (**Compact Ref Markup - CRM**) to serialize the page state for the LLM Planner, implemented behind a **Feature Flag** to support side-by-side A/B verification.

---

## 1. Goal & Requirements

* **Primary Goal:** Substantially reduce the input token footprint of the planner prompts (currently element representation and working set duplicates drive 95.8% of prompt tokens).
* **Affordance Preservation:** Maintain semantic partitions ("click target", "readable", "navigable") in the serialization to avoid degrading planner execution quality.
* **Non-Destructive Validation:** Implement the serialization layer behind a feature flag (`plannerSerialization: "json" | "crm"`) so that we can run comparative benchmarks and verify completion rates, accuracy, and error rates before making the compact representation the default.
* **Pipeline Isolation:** Keep `RefService`, `ContinuityGraph`, `ObservationService`, and `PlannerWorkingSetSelector` completely untouched. Only change the prompt serialization contract.

---

## 2. Proposed Format Specification: CRM with Semantic Lanes

We define a revised syntax for **Compact Ref Markup (CRM)** that merges element identity and planning affordance lanes:

### Syntax Rules

1. **Line Structure:**
   `[ref_id] <tag_name [attributes] />`
   * Format: `[v2ref_N] <role name="accessible name" lane="interaction|readable|navigation" [modifiers] />`
2. **Indentation:**
   Each nesting level (regions and regional elements) uses indentation (2 spaces) to reflect spatial relationships.
3. **Attribute Rules:**
   * **`lane`**: Mandatory attribute indicating the semantic lane categorization of the ref (based on whether it resides in the interactions, readables, or navigation projection view).
   * **Only serialize non-default attributes.**
   * Default Assumptions (implicit, not serialized):
     * `visibility: "visible"`
     * `actionability: "actionable"`
     * `state: "live"`
     * `confidence: 1.0`
   * State Modifiers:
     * If `state === 'weakened'`: Add `[weakened]`
     * If `visibility !== 'visible'`: Add `[hidden]` or `[visibility=...]`
     * If `actionability !== 'actionable'`: Add `[disabled]` or `[actionability=...]`
     * If `confidence < 0.7`: Add `[confidence=0.5]`

### Compact WorkingSet Serialization

To prevent duplicating metadata already present in the CRM tree, the `workingSet` lists (`primaryRefs`, `secondaryRefs`, `navigationRefs`, `failedRefs`) will only serialize the reference identity and include reasons:

```json
"primaryRefs": [
  {
    "refId": "v2ref_81",
    "reasons": ["goal_keyword_match", "visible_ready"]
  }
]
```

---

## 3. Proposed Changes

### 3.1. Serialization Flag Configuration
Add `plannerSerialization` to the configuration options in `d:\BrowseGent\src\v2\planner\types.ts` and default it to `"json"`.

```typescript
export interface PlannerWorkingSetOptions {
  plannerSerialization?: 'json' | 'crm';
  // ... other options
}
```

### 3.2. CRM Serializer
Implement `serializeToCRM` in `d:\BrowseGent\src\v2\brain1\serializeProjection.ts` to build the compact tree grouped by regions, adding `lane` attributes for each element based on its category.

### 3.3. Prompt Composer
Update `buildV2PlannerUserMessage` in `d:\BrowseGent\src\v2\planner\PlannerPrompt.ts` to switch representations based on the `plannerSerialization` configuration flag. If `crm` is selected:
- Replace `current` with a compact representation where `elements` is the CRM tree and `refs` is omitted.
- Compact `workingSet.primaryRefs`, `workingSet.secondaryRefs`, etc., to only include `refId` and `reasons`.

---

## 4. Verification & A/B Validation Plan

### Automated Tests
1. **CRM Serializer Unit Tests:**
   * Verify that elements have correct `lane` attributes based on their presence in interactions/readables/navigation views.
   * Verify that default values are omitted and abnormal state modifiers are appended correctly.
2. **Compact Working Set Unit Tests:**
   * Verify that working set reference lists are correctly pruned to contain only `refId` and `reasons`.

### A/B Benchmark Run
We will execute the `balanced30` WebVoyager-lite benchmark run:
1. First, with `plannerSerialization: "json"`. Record success rate, step count, input tokens, and errors.
2. Second, with `plannerSerialization: "crm"`. Record success rate, step count, input tokens, and errors.
3. Compare completion metrics side-by-side. CRM will only be promoted to default if success rate is equal or higher and token size is significantly reduced.
