# Strategy Pivot & Dynamic Form Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dominant balanced30 failures (loop exhaustion, finalization plan leak, autocomplete dropout) via bounded recovery enforcement — no site-specific hacks, no chain-of-thought.

**Architecture:** Hybrid soft/hard loop enforcement in `ActionProgressMemory`, enriched PRC recovery rendering in `PromptLayoutEngine`, finalization plan rejection in `V2PlannerClient`, and mini-plan interruption for combobox/searchbox in `shouldContinueMiniPlan`.

**Tech Stack:** TypeScript, Node test runner, BrowseGent v2

---

## File Structure

| File | Responsibility | Phase |
|------|---------------|-------|
| `src/v2/agent/V2AgentLoop.ts` | `ActionProgressMemory` hard-block + combobox mini-plan interrupt | P1 + P2 |
| `src/v2/runtime/RecoveryState.ts` | `repeated_read_same_value` state + enriched mechanisms | P1 |
| `src/v2/planner/prc/PromptLayoutEngine.ts` | Enriched PRC recovery rendering | P1 |
| `src/v2/planner/PlannerWorkingSetSelector.ts` | `search_page` quarantine regex | P1 |
| `src/v2/planner/V2PlannerClient.ts` | Finalization plan rejection | P1 |
| `src/v2/planner/PlannerPrompt.ts` | Pronunciation + autocomplete guidance | P1 + P2 |
| `tests/unit/v2/v2AgentLoop.test.ts` | Loop hard-block + mini-plan interrupt tests | P1 + P2 |
| `tests/unit/v2/recoveryState.test.ts` | Recovery state + PRC rendering tests | P1 |
| `tests/unit/v2/v2PlannerClient.test.ts` | Finalization plan rejection test | P1 |
| `tests/unit/v2/plannerWorkingSetSelector.test.ts` | search_page quarantine test | P1 |

---

## Phase 1: Loop/Finalization Strategy Pivot

### Task 1: ActionProgressMemory hard-block enforcement

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts` (class `ActionProgressMemory`, lines 580-677)
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing test — hard-block at count 3**

Add test to `tests/unit/v2/v2AgentLoop.test.ts`:

```typescript
test('V2AgentLoop blocks identical action after 3 consecutive repeats', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();

  // Setup: planner returns search_page 3 times with same pattern, then done
  let plannerCallCount = 0;
  const plannerOutputs: PlannerOutput[] = [
    { plan: [{ tool: 'search_page', pattern: 'climate change' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'climate change' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'climate change' }], confidence: 'high' },
    { done: true, val: 'found it' },
  ];

  const loop = new V2AgentLoop({
    plannerClient: {
      call: async () => {
        const output = plannerOutputs[Math.min(plannerCallCount++, plannerOutputs.length - 1)];
        return { output, rawText: JSON.stringify(output), inputTokens: 100, outputTokens: 50, durationMs: 10 };
      },
    },
  });

  const searchPageObs = makeObservation('obs_search', {
    refs: [makeRef({ refId: 'ref_searchbox', role: 'searchbox', name: 'Search' })],
  });

  const harness = new FakeHarness([searchPageObs, searchPageObs]);
  const result = await loop.run({
    goal: 'Find climate change headlines',
    targetUrl: 'https://bbc.test',
    maxSteps: 6,
    harness,
  });

  // The 3rd search_page should have been blocked, forcing the planner to try something else
  // Check that a planner input contained an action_blocked error signal
  const lastInputs = harness.plannerInputs;
  const hasBlockedSignal = lastInputs.some(entry =>
    JSON.stringify(entry.input).includes('action_blocked_by_loop_detector')
  );
  assert.ok(hasBlockedSignal, 'Expected action_blocked_by_loop_detector signal in planner input');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "blocks identical action"`
Expected: FAIL — no `action_blocked_by_loop_detector` exists yet

- [ ] **Step 3: Implement hard-block in ActionProgressMemory**

In `src/v2/agent/V2AgentLoop.ts`, modify `ActionProgressMemory`:

```typescript
// Add to class ActionProgressMemory
private readonly hardBlockedSignatures = new Set<string>();

/**
 * Build an action signature from a planner step (before execution).
 * This avoids constructing a fake V2ToolResult.
 */
static actionSignature(step: { tool: string; ref?: string; text?: string; pattern?: string; url?: string }): string {
  const tool = normalizeSignalToken(step.tool);
  const target = normalizeSignalToken(step.ref ?? 'global');
  const value = step.text ?? step.pattern ?? step.url;
  const valueKey = value ? normalizeProgressValue(value) : '__none__';
  return `${tool}:${target}:${valueKey}`;
}

/** Check whether this action signature is hard-blocked. */
isHardBlocked(step: { tool: string; ref?: string; text?: string; pattern?: string; url?: string }): string | undefined {
  const sig = ActionProgressMemory.actionSignature(step);
  return this.hardBlockedSignatures.has(sig) ? sig : undefined;
}

record(result: V2ToolResult): string[] {
  const entry = progressEntryForResult(result);
  if (!entry) return [];

  this.entries.push(entry);
  if (this.entries.length > PROGRESS_HISTORY_LIMIT) {
    this.entries.shift();
  }

  const signals: string[] = [];

  if (entry.noProgressMutation) {
    const count = this.entries.filter(existing =>
      existing.noProgressMutation
      && existing.kind === entry.kind
      && existing.targetKey === entry.targetKey,
    ).length;
    if (count >= REPEAT_SIGNAL_THRESHOLD) {
      signals.push(`repeated_no_progress_transition:${entry.kind}:${entry.targetKey}:${count}`);
    }
    // Hard-block at count >= 3
    if (count >= 3) {
      const sig = `${entry.kind}:${entry.targetKey}:${entry.valueKey ?? '__none__'}`;
      this.hardBlockedSignatures.add(sig);
    }
  }

  if (entry.valueKey) {
    const count = this.entries.filter(existing =>
      existing.kind === entry.kind
      && existing.targetKey === entry.targetKey
      && existing.valueKey === entry.valueKey,
    ).length;
    if (count >= REPEAT_SIGNAL_THRESHOLD) {
      signals.push(`repeated_value_preview:${entry.kind}:${entry.targetKey}:${count}`);
    }
    // Hard-block at count >= 3
    if (count >= 3) {
      const sig = `${entry.kind}:${entry.targetKey}:${entry.valueKey}`;
      this.hardBlockedSignatures.add(sig);
    }
  }

  return signals;
}

/** Reset hard-block for a specific signature after meaningful page change. */
resetSignatureOnPageChange(evidence: TransitionEvidence | undefined): void {
  if (!evidence) return;
  if (evidence.urlChanged || evidence.generationChanged) {
    this.hardBlockedSignatures.clear();
  }
}
```

Then in the main step execution loop (around line 200-240 where tool results are dispatched), add a pre-execution check using the planner step directly:

```typescript
// Before executing the tool step, check hard-block from the planner step shape
const blockedSig = progressMemory.isHardBlocked(step);
if (blockedSig) {
  lastResult = {
    success: false,
    kind: step.tool,
    targetRef: step.ref,
    error: {
      code: 'action_blocked_by_loop_detector',
      message: `Action ${step.tool} on ${step.ref ?? 'global'} blocked after 3 identical repeats (signature: ${blockedSig}). You MUST choose a different action, ref, or value.`,
      retryable: true,
    },
    traceStepId: `blocked_${stepIndex}`,
  };
  continue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "blocks identical action"`
Expected: PASS

- [ ] **Step 5: Write failing test — hard-block resets after URL change**

```typescript
test('V2AgentLoop resets hard-block after URL change', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  // ... same setup but after 3rd blocked attempt, observation has a different URL
  // causing reset. Then same action should succeed again.
  // (implementation details follow same pattern as above)
});
```

- [ ] **Step 6: Implement reset logic and verify GREEN**

Add `progressMemory.resetSignatureOnPageChange(result.evidence)` after each successful tool execution in the main loop.

- [ ] **Step 7: Run full test suite, commit**

Run: `npm run build && npm run test:unit`
Expected: All tests pass

```bash
git add src/v2/agent/V2AgentLoop.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "feat(v2): add hard-block enforcement in ActionProgressMemory after 3 repeats"
```

---

### Task 2: Enriched PRC recovery rendering + repeated_read_same_value state

**Files:**
- Modify: `src/v2/runtime/RecoveryState.ts` (lines 1-75)
- Modify: `src/v2/planner/prc/PromptLayoutEngine.ts` (line 55, `renderProblems`)
- Test: `tests/unit/v2/recoveryState.test.ts` (new file or add to existing)

- [ ] **Step 1: Write failing test — repeated_read_same_value recovery state**

Create or add to `tests/unit/v2/recoveryState.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryStateBuilder } from '../../../src/v2/runtime/RecoveryState';

test('RecoveryStateBuilder returns repeated_read_same_value for non-empty repeated reads', () => {
  const builder = new RecoveryStateBuilder();
  const result = builder.build({
    uncertaintySignals: ['repeated_value_preview:get:v2ref_308:3'],
  });
  assert.ok(result);
  assert.equal(result.state, 'repeated_read_same_value');
  assert.equal(result.severity, 'warning');
  assert.ok(result.blockedAction);
  assert.equal(result.blockedAction.tool, 'get');
  assert.equal(result.blockedAction.ref, 'v2ref_308');
  assert.ok(result.nextMechanisms.includes('finalize_with_collected_evidence'));
});

test('RecoveryStateBuilder preserves zero_result_read_loop for search_page repeats', () => {
  const builder = new RecoveryStateBuilder();
  const result = builder.build({
    uncertaintySignals: ['repeated_value_preview:search_page:global:3'],
  });
  assert.ok(result);
  assert.equal(result.state, 'zero_result_read_loop');
  assert.ok(result.nextMechanisms.includes('try_different_evidence_action'));
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npx tsx --test tests/unit/v2/recoveryState.test.ts`
Expected: FAIL — `repeated_read_same_value` state doesn't exist

- [ ] **Step 3: Add repeated_read_same_value to RecoveryState**

In `src/v2/runtime/RecoveryState.ts`:

1. Add `'repeated_read_same_value'` to `PlannerRecoveryStateKind` type.
2. In `RecoveryStateBuilder.build()`, add a check after the existing `zero_result_read_loop` block:

```typescript
if (signals.some(signal => signal.startsWith('repeated_value_preview:get:') || signal.startsWith('repeated_value_preview:inspect_region:'))) {
  return {
    state: 'repeated_read_same_value',
    severity: 'warning',
    blockedAction: blockedActionFromSignal(signals.find(signal =>
      signal.startsWith('repeated_value_preview:get:') || signal.startsWith('repeated_value_preview:inspect_region:')
    )),
    nextMechanisms: ['finalize_with_collected_evidence', 'try_different_ref', 'stop_if_dead_end_evidence_is_sufficient'],
    signals,
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

- [ ] **Step 5: Write failing test — enriched PRC rendering**

```typescript
test('PromptLayoutEngine renders recovery blockedAction and mechanisms', () => {
  // Import and call PromptLayoutEngine.render() with a PlannerRepresentationIR
  // that has a recovery state with blockedAction and nextMechanisms
  // Assert the rendered output includes "BLOCKED:" directive text
});
```

- [ ] **Step 6: Implement enriched rendering in PromptLayoutEngine**

In `src/v2/planner/prc/PromptLayoutEngine.ts`, replace line 55:

```typescript
// Old:
if (ir.execution.recovery) lines.push(`  recovery: ${ir.execution.recovery.state}`);

// New:
if (ir.execution.recovery) {
  const r = ir.execution.recovery;
  const blockedStr = r.blockedAction
    ? ` blocked=${r.blockedAction.tool}:${r.blockedAction.ref ?? 'global'}`
    : '';
  lines.push(`  recovery: ${r.state}${blockedStr}`);
  if (r.nextMechanisms.length > 0) {
    lines.push(`    BLOCKED: Do NOT repeat the blocked action. Try: ${r.nextMechanisms.join(', ')}.`);
  }
}
```

- [ ] **Step 7: Verify GREEN, run full suite, commit**

```bash
npm run build && npm run test:unit
git add src/v2/runtime/RecoveryState.ts src/v2/planner/prc/PromptLayoutEngine.ts tests/unit/v2/recoveryState.test.ts
git commit -m "feat(v2): add repeated_read_same_value state and enriched PRC recovery rendering"
```

---

### Task 3: search_page quarantine

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts` (line 321)
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [ ] **Step 1: Write failing test — search_page quarantine**

Find or create a test in `tests/unit/v2/plannerWorkingSetSelector.test.ts`:

```typescript
test('quarantinedActionsFromUncertainty quarantines repeated search_page', () => {
  // Call PlannerWorkingSetSelector.select() with uncertainty signals
  // including 'repeated_value_preview:search_page:global:3'
  // Assert the quarantined actions include search_page:global
});
```

- [ ] **Step 2: Run test to verify RED**

- [ ] **Step 3: Fix the regex**

In `src/v2/planner/PlannerWorkingSetSelector.ts`, line 321, change:

```typescript
// Old:
const repeatedReadMatch = signal.match(/^repeated_value_preview:(get|inspect_region):([^:]+):(\d+)$/);

// New:
const repeatedReadMatch = signal.match(/^repeated_value_preview:(get|inspect_region|search_page):([^:]+):(\d+)$/);
```

- [ ] **Step 4: Verify GREEN, run full suite, commit**

```bash
npm run build && npm run test:unit
git add src/v2/planner/PlannerWorkingSetSelector.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "feat(v2): quarantine repeated search_page actions"
```

---

### Task 4: Finalization plan rejection

**Files:**
- Modify: `src/v2/planner/V2PlannerClient.ts` (method `parseAndValidate`, line 230)
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Write failing test — finalization mode rejects plan**

```typescript
test('V2PlannerClient rejects plan output in finalization mode', async () => {
  const { V2PlannerClient } = await import('../../../src/v2/planner/V2PlannerClient');

  const client = new V2PlannerClient({
    provider: async () => ({
      text: JSON.stringify({ plan: [{ tool: 'click', ref: 'ref_1' }], confidence: 'high' }),
      inputTokens: 100,
      outputTokens: 50,
    }),
  });

  // Call with mode='finalization' — should reject the plan output
  await assert.rejects(
    () => client.call({
      plannerInput: makePlannerInput(),
      mode: 'finalization',
    }),
    (error: Error) => {
      assert.ok(error.message.includes('finalization_attempted_plan'));
      return true;
    },
  );
});
```

- [ ] **Step 2: Run test to verify RED**

- [ ] **Step 3: Add finalization plan rejection in parseAndValidate**

In `src/v2/planner/V2PlannerClient.ts`, in `parseAndValidate()` after line 244:

```typescript
// After successful schema validation, check finalization constraint
if (validationContext.mode === 'finalization' && validation.value.plan) {
  return { ok: false, errors: ['finalization_attempted_plan: finalization mode cannot return a plan, only done or escalate'] };
}
```

- [ ] **Step 4: Verify GREEN, run full suite, commit**

```bash
npm run build && npm run test:unit
git add src/v2/planner/V2PlannerClient.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "feat(v2): reject plan output in finalization mode as validation failure"
```

---

### Task 5: System prompt — pronunciation formatting

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts` (line 44-45)
- Test: `tests/unit/v2/v2PlannerClient.test.ts` (existing prompt test)

- [ ] **Step 1: Add pronunciation guidance to system prompt**

In `src/v2/planner/PlannerPrompt.ts`, after line 45 (the "basic information" bullet):

```typescript
`- When reporting pronunciation for words that have regional variants (e.g., UK/US), always list each variant separately with its label, even if they are identical: "UK: /x/, US: /y/".`
```

- [ ] **Step 2: Write test verifying prompt contains the new text**

```typescript
test('buildV2PlannerSystemPrompt includes pronunciation variant guidance', () => {
  const prompt = buildV2PlannerSystemPrompt();
  assert.ok(prompt.includes('regional variants'));
  assert.ok(prompt.includes('UK:'));
});
```

- [ ] **Step 3: Verify GREEN, run full suite, commit**

```bash
npm run build && npm run test:unit && npm run check:v2
git add src/v2/planner/PlannerPrompt.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "feat(v2): add pronunciation variant formatting guidance to planner prompt"
```

---

## Phase 2: Autocomplete Discipline

### Task 6: Mini-plan interruption for combobox/searchbox

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts` (function `shouldContinueMiniPlan`, line 688)
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing test — combobox interrupts mini-plan**

```typescript
test('V2AgentLoop interrupts mini-plan after type into combobox', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();

  // Plan: type "Edinburgh" into combobox, then type "Manchester" into another field
  // After typing into combobox, mini-plan should stop and re-observe
  let plannerCallCount = 0;
  const plannerOutputs: PlannerOutput[] = [
    {
      plan: [
        { tool: 'type', ref: 'ref_origin', text: 'Edinburgh' },
        { tool: 'type', ref: 'ref_dest', text: 'Manchester' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'booked' },
  ];

  const loop = new V2AgentLoop({
    plannerClient: {
      call: async () => {
        const output = plannerOutputs[Math.min(plannerCallCount++, plannerOutputs.length - 1)];
        return { output, rawText: JSON.stringify(output), inputTokens: 100, outputTokens: 50, durationMs: 10 };
      },
    },
  });

  const obs = makeObservation('obs_flights', {
    refs: [
      makeRef({ refId: 'ref_origin', role: 'combobox', name: 'Origin' }),
      makeRef({ refId: 'ref_dest', role: 'textbox', name: 'Destination' }),
    ],
  });

  const harness = new FakeHarness([obs, obs]);
  const result = await loop.run({
    goal: 'Book flight',
    targetUrl: 'https://flights.test',
    maxSteps: 4,
    harness,
  });

  // Planner should have been called at least twice because the mini-plan was interrupted
  assert.ok(plannerCallCount >= 2, `Expected >=2 planner calls but got ${plannerCallCount}`);
});
```

- [ ] **Step 2: Run test to verify RED**

- [ ] **Step 3: Add role gate to shouldContinueMiniPlan**

In `src/v2/agent/V2AgentLoop.ts`, in `shouldContinueMiniPlan`, before the final return statement (line 733):

```typescript
// Break mini-plan after typing into combobox or searchbox — autocomplete needs re-observation
if (
  input.lastResult.kind === 'type'
  && input.lastResult.target?.role
  && (input.lastResult.target.role === 'combobox' || input.lastResult.target.role === 'searchbox')
) {
  return false;
}
```

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Write failing test — transition fallback on appeared refs**

```typescript
test('V2AgentLoop interrupts mini-plan after type when new refs appeared', async () => {
  // Same setup but with a textbox (not combobox). The type action produces
  // transition evidence with appeared refs, indicating a dropdown opened.
  // Mini-plan should still be interrupted.
});
```

- [ ] **Step 6: Add transition fallback to shouldContinueMiniPlan**

```typescript
// Break mini-plan after typing into any field if new refs appeared (dropdown opened)
if (
  input.lastResult.kind === 'type'
  && input.lastResult.evidence
  && input.lastResult.evidence.refChanges.appeared.length > 0
) {
  return false;
}
```

- [ ] **Step 7: Write negative test — regular textbox no interruption**

```typescript
test('V2AgentLoop continues mini-plan after type into regular textbox without new refs', async () => {
  // Type into a regular textbox with no appeared refs
  // Mini-plan should continue (planner called only once for the plan)
});
```

- [ ] **Step 8: Verify all GREEN, commit**

```bash
npm run build && npm run test:unit && npm run check:v2
git add src/v2/agent/V2AgentLoop.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "feat(v2): interrupt mini-plan after type into combobox/searchbox or when new refs appear"
```

---

### Task 7: System prompt — autocomplete guidance

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`

- [ ] **Step 1: Add autocomplete guidance to system prompt**

After the pronunciation line, add:

```typescript
`After typing into a combobox or searchbox, check for appeared suggestion elements before proceeding to the next field. Click the matching suggestion to confirm selection. Do not batch multiple field fills in one plan when earlier fields have combobox or searchbox roles.`
```

- [ ] **Step 2: Write test verifying prompt contains autocomplete text**

- [ ] **Step 3: Verify GREEN, full suite, commit**

```bash
npm run build && npm run test:unit && npm run check:v2
git add src/v2/planner/PlannerPrompt.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "feat(v2): add autocomplete form-fill guidance to planner prompt"
```

---

## Verification

### Task 8: Full verification and benchmark

- [ ] **Step 1: Full build + test + boundary check**

```bash
npm run build
npm run test:unit
npm run check:v2
```

All must pass. Zero regressions.

- [ ] **Step 2: Regression gate — mvr5-stable**

```bash
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-min-interval-ms 10000 --key-index 1 --planner-serialization prc
```

Must remain ≥ 4/5 pass. If regression, stop and diagnose.

- [ ] **Step 3: Targeted subset — affected tasks**

Run BBC News, Cambridge Dictionary, Google Maps, and Google Flights tasks. Verify improvement signal before full balanced30.

- [ ] **Step 4: Full balanced30 (only if targeted subset shows improvement)**

```bash
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice balanced30 --adapter browsegent --request-min-interval-ms 10000 --key-index 21 --planner-serialization prc
```

Target: internal pass rate > 53.3% (current baseline: 16/30).
