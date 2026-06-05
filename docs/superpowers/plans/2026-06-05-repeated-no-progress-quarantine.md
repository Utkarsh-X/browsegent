# Repeated Successful No-Progress Action Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the planner from repeating the same (tool, ref) pair indefinitely when the action succeeds but produces no meaningful progress.

**Architecture:** Broaden `ActionProgressMemory`'s no-progress classification to include repeated same-action mutations with only local DOM churn (not just `microstate`/`none`). Then extend `buildQuarantinedActions` to quarantine repeated no-progress actions from action lanes, not just failed actions. This makes the existing `same_action_loop` recovery and `avoid_repeating_blocked_action` mechanisms fire correctly.

**Tech Stack:** TypeScript, Node test runner

---

## Root Cause Analysis

In the Wolfram benchmark, the agent clicked `v2ref_50` ("Compute input button") **10 consecutive times**. Each click produced `structural_local`/`moderate` transition evidence (5 refs swapping — minor DOM churn). The no-progress detector (`ActionProgressMemory`) requires `microstate`/`none` transitions, so it never fired. Without the signal, `same_action_loop` recovery never triggered, and quarantine (which only handles failures) was irrelevant. The planner received zero warning.

## File Map

| File | Responsibility |
|------|---------------|
| `src/v2/agent/V2AgentLoop.ts` | `ActionProgressMemory.progressEntryForResult()` — no-progress classification |
| `src/v2/planner/PlannerWorkingSetSelector.ts` | `buildQuarantinedActions()` — quarantine list construction |
| `src/v2/planner/workingSetTypes.ts` | `PlannerQuarantinedAction` type |
| `tests/unit/v2/v2AgentLoop.test.ts` | Agent loop tests |
| `tests/unit/v2/plannerWorkingSetSelector.test.ts` | Working set tests |

---

### Task 1: Broaden No-Progress Classification

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts` (`progressEntryForResult`, around L436-438)
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

The current classification is too strict — it only flags `microstate`/`none`. Repeated `structural_local`/`moderate` mutations on the same ref are also no-progress when they repeat.

- [ ] **Step 1: Write failing test for broadened no-progress detection**

Add to `tests/unit/v2/v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop emits repeated no-progress signal for same-ref structural_local mutations', () => {
  // This test verifies that clicking the same ref repeatedly with only
  // structural_local/moderate transitions (minor DOM churn) is classified
  // as no-progress after REPEAT_SIGNAL_THRESHOLD occurrences.
  
  // Setup: Create an ActionProgressMemory and record 3 identical click results
  // on the same ref with structural_local/moderate evidence.
  // Expected: After the 2nd identical entry, a repeated_no_progress_transition signal is emitted.
  
  // NOTE: ActionProgressMemory is not exported — test through the agent loop
  // by using FakePlanner that returns the same click plan 3 times and
  // FakeHarness that returns structural_local/moderate transition evidence.
  // Assert that the 3rd planner input contains uncertainty signals matching
  // /repeated_no_progress_transition:click:/.
});
```

The exact test code depends on the FakePlanner/FakeHarness patterns already used in the test file. The implementer MUST read the existing test patterns (especially `'V2AgentLoop feeds repeated no-progress mutation evidence into the next planner input'`) and follow the same structure, but with `structural_local`/`moderate` evidence instead of `microstate`/`none`.

- [ ] **Step 2: Run the focused failing test**

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "structural_local"
```

Expected: FAIL because `structural_local`/`moderate` is not classified as no-progress.

- [ ] **Step 3: Broaden classification in `progressEntryForResult`**

In `V2AgentLoop.ts`, find `progressEntryForResult` (around L436-438). The current condition:

```ts
const noProgressMutation = MUTATION_EVIDENCE_KINDS.has(result.kind)
  && result.evidence?.transitionClass === 'microstate'
  && result.evidence.strength === 'none';
```

Change to also detect local-only mutations with weak/moderate strength as no-progress:

```ts
const noProgressMutation = MUTATION_EVIDENCE_KINDS.has(result.kind)
  && (
    (result.evidence?.transitionClass === 'microstate' && result.evidence.strength === 'none')
    || (result.evidence?.transitionClass === 'structural_local' && (result.evidence.strength === 'none' || result.evidence.strength === 'weak' || result.evidence.strength === 'moderate'))
  );
```

This classifies `structural_local` with `none`/`weak`/`moderate` strength as no-progress. Real structural changes produce `structural_major` or `strong` strength, which would NOT be classified as no-progress.

- [ ] **Step 4: Run test to verify it passes**

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "structural_local"
```

Expected: PASS

- [ ] **Step 5: Run all agent loop tests to verify no regressions**

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts
```

Expected: ALL tests pass (the existing `microstate`/`none` test still passes, plus the new one).

---

### Task 2: Fix Tool Assignment Bug in buildQuarantinedActions

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts` (`buildQuarantinedActions`, L279-291)
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

The research found a subtle bug: `lastTool` is taken from `input.lastResult?.kind` and applied to ALL failures. If the last tool was "click" but an earlier failure was from "type", the quarantine incorrectly assigns tool="click" to all entries. Fix: use the failure's own `kind` when `lastResult` refers to a different ref.

- [ ] **Step 1: Write failing test for tool assignment**

Add to `tests/unit/v2/plannerWorkingSetSelector.test.ts`:

```ts
test('PlannerWorkingSetSelector assigns quarantine tool from failure evidence not just lastResult', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_input', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_button', role: 'button', name: 'Submit', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Search for data',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_button',
      error: { code: 'target_blocked', message: 'Blocked.', retryable: false },
      traceStepId: 'step_click',
    },
    failureEvidence: [{
      failureId: 'fail_type_input',
      kind: 'target_not_editable',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Not editable.',
      source: 'test',
      targetRef: 'ref_input',
      signals: ['error:target_not_editable'],
    }],
  });

  // ref_input should NOT be quarantined from click — it failed on 'type', not 'click'
  // The old bug would assign tool='click' (from lastResult) to ALL failures
  const quarantined = selection.workingSet.quarantinedActions;
  const inputQuarantine = quarantined.find(q => q.refId === 'ref_input');
  // With the fix, the tool should be derived from the failure context, not lastResult
  // Since FailureEvidence doesn't carry a 'tool' field, we need to handle this differently
  // See Step 3 for the approach
});
```

NOTE: `FailureEvidence` doesn't carry a `tool` field, so the fix needs a design decision. See Step 3.

- [ ] **Step 2: Run the focused test**

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts --test-name-pattern "assigns quarantine tool"
```

- [ ] **Step 3: Fix the tool assignment**

The `FailureEvidence` type doesn't carry a `tool` field. Two approaches:

**Approach A (minimal):** Only quarantine failures where `targetRef` matches `lastResult.targetRef`. This ensures tool assignment is correct because it comes from the same action.

```ts
function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  const lastTool = input.lastResult?.kind;
  const lastRef = input.lastResult?.targetRef;
  return (input.failureEvidence ?? [])
    .filter(failure => Boolean(failure.targetRef))
    .filter(failure => failure.retryable === false && failure.persistence === 'persistent')
    .filter(failure => failure.targetRef === lastRef)  // Only quarantine the ref that actually failed on this tool
    .map(failure => ({
      refId: failure.targetRef as string,
      tool: lastTool ?? 'unknown',
      failureKind: failure.kind,
      retryable: failure.retryable,
      persistence: failure.persistence,
    }));
}
```

**Choose Approach A** — it's narrow and correct. Failures on other refs from prior steps are not quarantined for the wrong tool.

- [ ] **Step 4: Run tests**

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected: ALL tests pass.

---

### Task 3: Quarantine Repeated No-Progress Actions from Action Lanes

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts` (`buildQuarantinedActions`)
- Modify: `src/v2/planner/workingSetTypes.ts` (`PlannerWorkingSetSelectorInput` — add uncertainty signals)
- Modify: `src/v2/planner/PlannerInputComposer.ts` (pass uncertainty signals to working set selector)
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

Currently `buildQuarantinedActions` only uses `failureEvidence`. It must also parse `repeated_no_progress_transition:{tool}:{ref}:{count}` signals from `uncertaintySignals` and quarantine those `(tool, ref)` pairs.

- [ ] **Step 1: Write failing test for no-progress quarantine**

Add to `tests/unit/v2/plannerWorkingSetSelector.test.ts`:

```ts
test('PlannerWorkingSetSelector quarantines repeated no-progress action from action lanes', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_compute', role: 'button', name: 'Compute', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Calculate derivative',
    projection,
    uncertaintySignals: ['repeated_no_progress_transition:click:ref_compute:3'],
  });

  // ref_compute should be quarantined from clickableRefs
  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_compute'), false);
  // ref_compute should still be in current.refs as evidence
  assert.equal(selection.current.refs.ref_compute?.name, 'Compute');
  // ref_search should still be typeable
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_search'));
  // quarantinedActions should include the no-progress entry
  assert.ok(selection.workingSet.quarantinedActions.some(
    q => q.refId === 'ref_compute' && q.tool === 'click'
  ));
});
```

- [ ] **Step 2: Run the focused failing test**

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts --test-name-pattern "quarantines repeated no-progress"
```

Expected: FAIL because `uncertaintySignals` is not a field on `PlannerWorkingSetSelectorInput`.

- [ ] **Step 3: Add uncertaintySignals to working set selector input**

In `PlannerWorkingSetSelector.ts`, find `PlannerWorkingSetSelectorInput` (around L32-39) and add:

```ts
uncertaintySignals?: readonly string[];
```

- [ ] **Step 4: Extend buildQuarantinedActions to parse no-progress signals**

```ts
function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  const quarantined: PlannerQuarantinedAction[] = [];

  // Source 1: Failed actions (existing logic, with ref-matching fix from Task 2)
  const lastTool = input.lastResult?.kind;
  const lastRef = input.lastResult?.targetRef;
  for (const failure of input.failureEvidence ?? []) {
    if (!failure.targetRef) continue;
    if (failure.retryable !== false || failure.persistence !== 'persistent') continue;
    if (failure.targetRef !== lastRef) continue;
    quarantined.push({
      refId: failure.targetRef,
      tool: lastTool ?? 'unknown',
      failureKind: failure.kind,
      retryable: failure.retryable,
      persistence: failure.persistence,
    });
  }

  // Source 2: Repeated no-progress actions from uncertainty signals
  for (const signal of input.uncertaintySignals ?? []) {
    const match = signal.match(/^repeated_no_progress_transition:(\w+):(.+):(\d+)$/);
    if (!match) continue;
    const [, tool, refId, countStr] = match;
    const count = Number.parseInt(countStr, 10);
    if (count < 2) continue;
    quarantined.push({
      refId,
      tool,
      failureKind: 'no_progress_loop',
      retryable: false,
      persistence: 'persistent',
    });
  }

  return quarantined;
}
```

- [ ] **Step 5: Pass uncertainty signals from PlannerInputComposer**

In `src/v2/planner/PlannerInputComposer.ts`, find where `workingSetSelector.select()` is called. Add `uncertaintySignals` from the `runtimeUncertainty` input:

```ts
const selection = this.workingSetSelector.select({
  // ... existing fields
  uncertaintySignals: input.runtimeUncertainty?.signals,
});
```

- [ ] **Step 6: Run all working set tests**

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected: ALL tests pass.

- [ ] **Step 7: Run full build**

```powershell
npm.cmd run build
```

Expected: TypeScript build passes.

---

### Task 4: Integration Verification

- [ ] **Step 1: Run all unit tests**

```powershell
node --test --import tsx tests/unit/v2/*.test.ts tests/unit/parser.test.ts
```

Expected: ALL tests pass (no regressions).

- [ ] **Step 2: Run anti-overfit scan**

Using grep_search tool, search `src/v2` for:
```
Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha
```

Expected: No matches (clean).

- [ ] **Step 3: Run build**

```powershell
npm.cmd run build
```

Expected: Clean.
