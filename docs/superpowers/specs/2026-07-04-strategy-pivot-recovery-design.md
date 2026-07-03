# Strategy Pivot & Dynamic Form Recovery — Design Spec

**Date:** 2026-07-04
**Status:** Draft for review
**Scope:** Phase 1 (loop/finalization pivot) + Phase 2 (autocomplete discipline)

---

## 1. Evidence Summary

From balanced30 audit (`webvoyager_lite_1783065936525`), 9 non-env failures:

| Pattern | Count | Tasks | Current Behavior |
|---------|-------|-------|------------------|
| Loop on identical action (search_page, get, click-to-get) | 4 | BBC×2, CamDict_10, GMap_10 | Recovery signal fires at count≥2, quarantine at count≥3 — but planner ignores both |
| Autocomplete form not handled | 2 | GFlights×2 | Mini-plan continues after type into combobox; dropdown never selected |
| Booking form navigation failure | 2 | Booking×2 | Date picker + autocomplete combined failure |
| Answer contract format | 1 | CamDict_10 | Pronunciation listed as "in both" instead of "UK: /x/, US: /y/" |

**Key finding:** Recovery signals fire but lack teeth. The PRC renderer shows only `recovery: same_action_loop` — no blockedAction, no mechanisms, no directive text. The planner has no actionable information to change strategy.

---

## 2. Proposed Control-Plane Policy

### 2.1 Hybrid Enforcement (Phase 1)

**Threshold behavior:**

| Repeat Count | Enforcement | What Happens |
|--------------|-------------|-------------|
| 1st occurrence | Normal | Action executes normally |
| 2nd identical | **Soft pivot** | Recovery signal fires. Enriched PRC text warns: "Your last 2 actions were identical. You MUST use a different approach." First legitimate retry is allowed. |
| 3rd identical (attempt after warning) | **Hard block** | The planner was warned at count 2 and still attempted the same signature. Action rejected before execution. Error returned: `action_blocked_by_loop_detector`. |

**"Identical" definition:** Same `(tool, targetKey, valueKey)` tuple from `ActionProgressMemory`.

**Reset conditions for hard block (per-signature):**
- URL changes (`evidence.urlChanged`)
- Generation changes (`evidence.generationChanged`)

When reset triggers, only the hard-block flag for that specific `(tool, targetKey, valueKey)` signature is cleared. Full `ActionProgressMemory` history is preserved for diagnostics and future signal generation. A different action succeeding between repeats does NOT reset the block for the original signature.

### 2.2 Enriched PRC Recovery Rendering (Phase 1)

Current PRC rendering ([PromptLayoutEngine.ts:55](file:///D:/BrowseGent/src/v2/planner/prc/PromptLayoutEngine.ts#L55)):
```
recovery: same_action_loop
```

**Proposed rendering:**
```
recovery: same_action_loop blocked=search_page:global
  BLOCKED: Do NOT repeat search_page. Try: type in site search box, click navigation links, scroll to find content, or use get on visible elements.
```

For `repeated_read_same_value` (renamed from `zero_result_read_loop` when content is non-empty):
```
recovery: repeated_read_same_value blocked=get:v2ref_308
  BLOCKED: Do NOT repeat get on v2ref_308. The data was already retrieved. Use it to answer with done, or try a different ref.
```

**Implementation:** Extend `renderProblems()` in `PromptLayoutEngine.ts` to render `blockedAction` and `nextMechanisms` as directive text.

### 2.3 search_page Quarantine (Phase 1)

Currently `quarantinedActionsFromUncertainty` in [PlannerWorkingSetSelector.ts:303](file:///D:/BrowseGent/src/v2/planner/PlannerWorkingSetSelector.ts#L303) handles `repeated_no_progress_transition` and `repeated_value_preview:(get|inspect_region)` but **not** `repeated_value_preview:search_page`.

**Fix:** Add `search_page` to the repeated value preview quarantine regex:
```typescript
const repeatedReadMatch = signal.match(
  /^repeated_value_preview:(get|inspect_region|search_page):([^:]+):(\d+)$/
);
```

### 2.4 Repeated successful get → force finalization hint (Phase 1)

When `repeated_value_preview:get:*:N` fires with N≥2, and the last `get` returned non-empty content, use recovery state `repeated_read_same_value` (not `zero_result_read_loop`). This distinguishes "I read the same data again" from "I read and got nothing."

```
nextMechanisms: ['finalize_with_collected_evidence', 'try_different_ref']
```

PRC text:
```
recovery: repeated_read_same_value blocked=get:v2ref_X
  BLOCKED: You already retrieved content from v2ref_X. Formulate your answer from the collected evidence and return done.
```

**RecoveryState naming:**
- `zero_result_read_loop` — preserved for repeated reads returning empty/`__empty__`
- `repeated_read_same_value` — new, for repeated reads returning the same non-empty content

### 2.5 Finalization mode cannot return plan (Phase 1)

In [V2PlannerClient.ts](file:///D:/BrowseGent/src/v2/planner/V2PlannerClient.ts), during output validation:

**When** `mode === 'finalization'` and the planner output contains a `plan`:
- Return a validation-style controlled failure with reason `finalization_attempted_plan`
- Preserve any useful read evidence already in trace — do NOT discard trace artifacts
- Do NOT silently convert to `{ escalate: 'dead_end' }` — the caller (V2AgentLoop `attemptFinalization`) must see the failure and handle it as a non-result, falling through to `max_steps_exhausted` or equivalent
- Do NOT synthesize a `done` value automatically in this phase

**Current state:** The finalization goal text says "Do not return a plan" but there's no hard validation. Booking_10 showed the planner ignoring this instruction.

### 2.6 Pronunciation formatting guidance (Phase 1, low-cost)

Add to system prompt line 44-45:
```
- When reporting pronunciation for words that have regional variants (e.g., UK/US), always list each variant separately with its label, even if they are identical: "UK: /x/, US: /y/".
```

This addresses Cambridge_Dictionary_10 without any runtime machinery.

---

## 3. Dynamic Form Policy (Phase 2)

### 3.1 Combobox/searchbox mini-plan interruption

In `shouldContinueMiniPlan` ([V2AgentLoop.ts:688](file:///D:/BrowseGent/src/v2/agent/V2AgentLoop.ts#L688)):

**Role gate:** After `type` into a ref with role `combobox` or `searchbox`, return `false`. This stops the queued mini-plan and forces re-observation, letting the planner see appeared dropdown suggestions.

```typescript
if (
  input.lastResult.kind === 'type'
  && input.lastResult.target?.role
  && ['combobox', 'searchbox'].includes(input.lastResult.target.role)
) {
  return false;
}
```

**Transition fallback:** Also return `false` after `type` into any field if the transition evidence (from `V2ToolResult.evidence: TransitionEvidence`) shows new appeared refs. The `evidence` field is populated by the runtime after each action via `TransitionEvidence.refChanges.appeared: string[]`.

```typescript
if (
  input.lastResult.kind === 'type'
  && input.lastResult.evidence
  && input.lastResult.evidence.refChanges.appeared.length > 0
) {
  return false;
}
```

**Source:** `input.lastResult.evidence` is `TransitionEvidence | undefined` (defined in [types.ts:79](file:///D:/BrowseGent/src/v2/runtime/types.ts#L79)). The `refChanges.appeared` array is always present when `evidence` is defined — no optional chaining needed.

**Combined effect:** Google Flights' autocomplete fields (role=`combobox`) will always interrupt via role gate. Regular textboxes triggering dropdowns (where new refs appear) will also interrupt via transition fallback. Static form fills with no new refs are unaffected.

### 3.2 System prompt guidance for autocomplete (Phase 2)

Add to system prompt:
```
After typing into a combobox or searchbox, check for appeared suggestion/autocomplete elements before proceeding to the next field. Click the matching suggestion to confirm selection. Do not batch multiple field fills in one plan when earlier fields have combobox/searchbox roles.
```

---

## 4. Non-Goals

- ❌ No site-specific selectors or URL patterns
- ❌ No benchmark-specific hardcoding
- ❌ No generic chain-of-thought / `thought` field
- ❌ No N-item extraction mode (deferred to Phase 3)
- ❌ No broad architecture rewrite
- ❌ No date-picker widget recognition (deferred)

---

## 5. File Changes

### Phase 1: Loop/Finalization Strategy Pivot

#### [MODIFY] [V2AgentLoop.ts](file:///D:/BrowseGent/src/v2/agent/V2AgentLoop.ts)
- Add hard-block check in step execution: when `ActionProgressMemory` count ≥ 3 for same `(tool, targetKey, valueKey)`, return error `action_blocked_by_loop_detector` without executing
- Add reset-on-meaningful-change logic in `ActionProgressMemory`

#### [MODIFY] [RecoveryState.ts](file:///D:/BrowseGent/src/v2/runtime/RecoveryState.ts)
- Enhance `same_action_loop` to include directive text in `nextMechanisms`
- Add new recovery state for `repeated_successful_get` → finalize hint

#### [MODIFY] [PromptLayoutEngine.ts](file:///D:/BrowseGent/src/v2/planner/prc/PromptLayoutEngine.ts)
- Render `blockedAction` and `nextMechanisms` in PRC recovery block

#### [MODIFY] [PlannerWorkingSetSelector.ts](file:///D:/BrowseGent/src/v2/planner/PlannerWorkingSetSelector.ts)
- Add `search_page` to repeated read quarantine regex

#### [MODIFY] [V2PlannerClient.ts](file:///D:/BrowseGent/src/v2/planner/V2PlannerClient.ts)
- Add finalization-mode plan rejection (auto-convert to escalation)

#### [MODIFY] [PlannerPrompt.ts](file:///D:/BrowseGent/src/v2/planner/PlannerPrompt.ts)
- Add pronunciation formatting guidance to system prompt

### Phase 2: Autocomplete Discipline

#### [MODIFY] [V2AgentLoop.ts](file:///D:/BrowseGent/src/v2/agent/V2AgentLoop.ts)
- Modify `shouldContinueMiniPlan`: break after type into combobox/searchbox
- Modify `shouldContinueMiniPlan`: break after type when new refs appeared

#### [MODIFY] [PlannerPrompt.ts](file:///D:/BrowseGent/src/v2/planner/PlannerPrompt.ts)
- Add autocomplete guidance to system prompt

---

## 6. Required Tests

### Phase 1 Tests

1. **ActionProgressMemory hard-block at count 3** — same tool/ref/value 3 times → error returned
2. **ActionProgressMemory reset after URL change** — block clears when URL changes
3. **ActionProgressMemory reset after different action** — block clears when a different action succeeds
4. **PRC recovery rendering includes blockedAction and directive** — verify enriched text
5. **search_page quarantine** — repeated search_page with same value quarantined at count ≥ 3
6. **Finalization plan rejection** — planner output with plan in finalization mode → escalation
7. **Repeated get finalization hint** — after 2 identical gets, recovery hints at finalization
8. **Existing tests pass** — all 555 tests still green

### Phase 2 Tests

9. **Mini-plan interruption after type into combobox** — shouldContinueMiniPlan returns false
10. **Mini-plan interruption after type with appeared refs** — shouldContinueMiniPlan returns false
11. **Mini-plan continues for type into regular textbox** — no interruption for non-combobox fields
12. **Existing tests pass** — all tests still green

---

## 7. Verification Plan

### Automated Tests
```bash
npm run build
npm run test:unit
npm run check:v2
```

### Benchmark Validation (tiered)

**Step 1: Regression gate — mvr5-stable**
```bash
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-min-interval-ms 10000 --key-index 1 --planner-serialization prc
```
Must remain ≥ 4/5 pass (current baseline: 5/5). If regression, stop.

**Step 2: Targeted subset — affected tasks**
Run a targeted subset containing BBC News, Cambridge Dictionary, Google Maps, and Google Flights tasks to verify the specific fixes work. Only proceed to full balanced30 if this subset shows improvement.

**Step 3: Full balanced30 (only after targeted signal is good)**
```bash
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browsegent --request-min-interval-ms 10000 --key-index 21 --planner-serialization prc
```
Target: internal pass rate > 53.3% (current baseline: 16/30).
