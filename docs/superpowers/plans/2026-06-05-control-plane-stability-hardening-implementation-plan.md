# Control-Plane Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize BrowseGent V2 after the MVR5 hardening run by fixing parser/schema consistency, repeated successful no-progress loops, segment-safe multi-step validation, finalization evidence extraction, and escalation diagnostics without benchmark-specific tuning.

**Architecture:** Keep the Brain1/Brain2/graph architecture. Brain1 exposes action/evidence lanes, Brain2/graph exposes transition and uncertainty signals, runtime enforces tool/ref contracts, and the planner receives compact state. This plan strengthens the control plane around those pieces instead of adding website-specific rules or broad browser bypasses.

**Tech Stack:** TypeScript, Node test runner, `tsx`, BrowseGent V2 planner/runtime/agent loop, existing benchmark harness.

---

## Why This Plan Exists

The latest useful benchmark run is `logs/webvoyager-lite/webvoyager_lite_1780599230288`.

Observed signals:

- Google Maps passed internally with clean trace and no failed-action spiral.
- ArXiv exposed a parser/schema consistency bug: raw planner output had `value`, but validation reported `select requires "value"`.
- Wolfram repeated the same successful click many times and finalization still tried to act.
- GitHub produced a semantically reasonable multi-step plan (`click search launcher`, then `type`) but the validator rejected later steps against the current DOM/action lane before step 1 could execute.
- Allrecipes likely hit bot/security infrastructure; ordinary `dead_end` loses the reason and makes analysis worse.

This plan supersedes `docs/superpowers/plans/2026-06-05-repeated-no-progress-quarantine.md` where the older plan is too broad. In particular, do **not** classify every `structural_local/moderate` transition as no-progress globally. Treat it as no-progress only when it repeats for the same `(tool, ref)` without URL/generation change and without useful evidence change.

## Non-Negotiable Constraints

- No hardcoded website names, benchmark task IDs, task strings, domains, selectors, or WebVoyager-specific behavior in `src/v2` or `src/agent`.
- No broad JS-click fallback as a shortcut for blocked targets.
- No model-specific prompt tuning for Gemini Flash Lite.
- No benchmark rerun until local verification passes.
- Do not commit `new-keys.yaml`, `debug.log`, benchmark logs, or API-key material.
- Benchmark score is a signal, not the optimization target.

Run this anti-overfit scan before declaring completion:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha|Castle Mountains|climate change data visualization|quantum computing|vegan chocolate chip" src/v2 src/agent tests/unit
```

Expected: no new planner/runtime/parser logic keyed to those strings. Existing benchmark infrastructure outside these directories is not part of this scan.

## File Map

- Modify: `src/agent/parser.ts`
  - Preserve plan-step `value` fields while still normalizing top-level answer `value` to `val`.
- Modify: `tests/unit/parser.test.ts`
  - Lock parser regression coverage.
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
  - Keep schema defense for `select` `val`/`option` aliases and add segmented action-compatibility mode.
- Modify: `src/v2/planner/V2PlannerClient.ts`
  - Use segmented action-compatibility validation for planner outputs.
- Modify: `src/v2/agent/V2AgentLoop.ts`
  - Refine no-progress detection, preserve escalation reason, and strengthen finalization.
- Modify: `src/v2/planner/PlannerInputComposer.ts`
  - Pass runtime uncertainty signals into working-set selection.
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
  - Quarantine repeated no-progress `(tool, ref)` pairs from action lanes.
- Modify: `src/v2/planner/workingSetTypes.ts`
  - Extend quarantined action reason typing if necessary.
- Modify: `src/v2/runtime/RecoveryState.ts`
  - Ensure repeated no-progress signals produce actionable recovery mechanisms.
- Create: `src/v2/agent/FinalizationEvidence.ts`
  - Build compact finalization evidence from last successful evidence and readable projection text.
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Test: `tests/unit/v2/plannerInputComposer.test.ts`
- Test: `tests/unit/v2/recoveryState.test.ts`

---

### Task 0: Baseline Inventory and Safety Gate

**Files:**
- No source changes.

- [ ] **Step 1: Inspect current dirty state**

Run:

```powershell
git status --short
```

Expected: source/test files may be modified from previous hardening work. `new-keys.yaml` and `debug.log` must remain uncommitted.

- [ ] **Step 2: Run current focused verification**

Run:

```powershell
node --test --import tsx tests/unit/parser.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
npm.cmd run build
```

Expected: if previous work is already correct, these pass. If they fail, fix only the failing area before continuing.

- [ ] **Step 3: Confirm benchmark artifacts exist**

Run:

```powershell
Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name,LastWriteTime
```

Expected: latest useful run includes `webvoyager_lite_1780599230288`.

---

### Task 1: Lock Parser and Select-Value Schema Consistency

**Files:**
- Modify: `src/agent/parser.ts`
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Test: `tests/unit/parser.test.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`

- [ ] **Step 1: Add parser regression tests**

Ensure `tests/unit/parser.test.ts` contains these tests:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize, robustJsonParse } from '../../src/agent/parser';

test('normalize preserves value field inside plan steps for select', () => {
  const result = normalize({
    plan: [
      { tool: 'select', ref: 'v2ref_493', value: 'Submission date (newest first)' },
      { tool: 'click', ref: 'v2ref_1466' },
    ],
    confidence: 'high',
  });

  assert.ok(result);
  const plan = result.plan as Array<Record<string, unknown>>;
  assert.equal(plan[0].value, 'Submission date (newest first)');
  assert.equal(plan[0].val, undefined);
});

test('normalize still maps top-level value to val for done responses', () => {
  const result = normalize({
    done: true,
    value: 'Castle Mountains National Monument',
  });

  assert.ok(result);
  assert.equal(result.val, 'Castle Mountains National Monument');
  assert.equal(result.value, undefined);
});

test('robustJsonParse preserves select value through full pipeline', () => {
  const raw = `{
    "plan": [
      { "tool": "select", "ref": "v2ref_493", "value": "Submission date (newest first)" },
      { "tool": "click", "ref": "v2ref_1466" }
    ],
    "confidence": "high"
  }`;

  const result = robustJsonParse(raw);
  assert.ok(result);
  const plan = result.plan as Array<Record<string, unknown>>;
  assert.equal(plan[0].value, 'Submission date (newest first)');
});
```

- [ ] **Step 2: Run parser tests and confirm failure or pass**

Run:

```powershell
node --test --import tsx tests/unit/parser.test.ts
```

Expected: pass if previous parser fix exists; otherwise fail on `value` being remapped to `val`.

- [ ] **Step 3: Implement parser field-map split if tests fail**

In `src/agent/parser.ts`, keep top-level answer normalization:

```ts
const FIELD_MAP: Record<string, string> = {
  answer: 'val', value: 'val', result: 'val',
  actions: 'plan', steps: 'plan',
  action: 'tool', command: 'tool',
  selector: 'sel', target: 'sel', element: 'sel',
  query: 'text', input: 'text',
  thought: 'reason', thinking: 'reason', explanation: 'reason',
  status: 'confidence',
};
```

Add plan-step normalization that does not map `value`:

```ts
const STEP_FIELD_MAP: Record<string, string> = {
  action: 'tool', command: 'tool',
  selector: 'sel', target: 'sel', element: 'sel',
  query: 'text', input: 'text',
};
```

Use `STEP_FIELD_MAP` only inside plan-step normalization:

```ts
if (Array.isArray(normalized['plan'])) {
  normalized['plan'] = (normalized['plan'] as Record<string, unknown>[]).map(step => {
    if (typeof step !== 'object' || step === null) return step;
    const s: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step)) {
      const nk = STEP_FIELD_MAP[k.toLowerCase()] ?? k;
      s[nk] = v;
    }
    return s;
  });
}
```

- [ ] **Step 4: Add schema defense tests**

In `tests/unit/v2/plannerOutputSchema.test.ts`, include:

```ts
test('PlannerOutputSchema accepts select with exact value when ref is selectable', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'select', ref: 'v2ref_493', value: 'Submission date (newest first)' }],
    confidence: 'high',
  }, {
    allowedRefs: ['v2ref_493'],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: ['v2ref_493'],
      readableRefs: [],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, true);
});

test('PlannerOutputSchema recovers select val alias as value', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'select', ref: 'v2ref_493', val: 'Submission date (newest first)' }],
    confidence: 'high',
  }, {
    allowedRefs: ['v2ref_493'],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: ['v2ref_493'],
      readableRefs: [],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.plan?.[0]?.value, 'Submission date (newest first)');
  }
});
```

- [ ] **Step 5: Implement schema defense if needed**

In `normalizePlannerStep` inside `src/v2/planner/PlannerOutputSchema.ts`, include:

```ts
if (normalized.tool === 'select' && normalized.value === undefined && typeof normalized.option === 'string') {
  normalized.value = normalized.option;
  delete normalized.option;
}

if (normalized.tool === 'select' && normalized.value === undefined && typeof normalized.val === 'string') {
  normalized.value = normalized.val;
  delete normalized.val;
}
```

- [ ] **Step 6: Verify Task 1**

Run:

```powershell
node --test --import tsx tests/unit/parser.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts
```

Expected: all pass.

---

### Task 2: Safer Repeated Successful No-Progress Detection

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Modify: `tests/unit/v2/v2AgentLoop.test.ts`

Design rule: local DOM churn is not automatically no-progress. It becomes no-progress only when the same successful mutation repeats on the same target without URL/generation change and without strong transition or useful result value.

- [ ] **Step 1: Add no-progress tests for structural local churn**

Add to `tests/unit/v2/v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop emits repeated no-progress signal for same-ref structural_local moderate mutations', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_compute' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_compute' }], confidence: 'high' },
    { done: true, val: 'Changed strategy' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_compute',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_spinner_a', 'ref_spinner_b'],
        disappeared: ['ref_spinner_c'],
        weakened: [],
        preserved: ['ref_compute'],
      },
      notes: ['local churn only'],
    },
    traceStepId: 'tool_compute_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/calculator',
    goal: 'Compute result',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.ok(planner.inputs[2].uncertainty.signals.includes('repeated_no_progress_transition:click:ref_compute:2'));
});

test('V2AgentLoop does not emit no-progress signal for repeated strong local mutations', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_load_more' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_load_more' }], confidence: 'high' },
    { done: true, val: 'More content loaded' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_load_more',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'strong',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_new_1', 'ref_new_2', 'ref_new_3', 'ref_new_4'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_load_more'],
      },
      notes: ['new content loaded'],
    },
    traceStepId: 'tool_load_more_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/list',
    goal: 'Load more items',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(planner.inputs[2].uncertainty.signals.some(signal => signal.startsWith('repeated_no_progress_transition:')), false);
});
```

- [ ] **Step 2: Run focused failing tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "structural_local|strong local"
```

Expected before implementation: moderate structural-local test fails; strong local test should pass or be added as a guard.

- [ ] **Step 3: Add no-progress helper**

In `src/v2/agent/V2AgentLoop.ts`, replace the inline `noProgressMutation` condition with:

```ts
function isNoProgressMutation(result: V2ToolResult): boolean {
  if (!MUTATION_EVIDENCE_KINDS.has(result.kind) || !result.evidence) {
    return false;
  }

  const evidence = result.evidence;
  if (evidence.urlChanged || evidence.generationChanged) {
    return false;
  }

  if (evidence.strength === 'strong' || evidence.strength === 'negative') {
    return false;
  }

  if (previewResultValue(result.value)) {
    return false;
  }

  if (evidence.transitionClass === 'microstate' && evidence.strength === 'none') {
    return true;
  }

  if (evidence.transitionClass === 'structural_local') {
    return true;
  }

  return false;
}
```

Then in `progressEntryForResult`:

```ts
const noProgressMutation = isNoProgressMutation(result);
```

Rationale: the repeat threshold remains in `ActionProgressMemory`; a single local moderate mutation does not produce a signal by itself.

- [ ] **Step 4: Verify Task 2**

Run:

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all agent-loop tests pass.

---

### Task 3: Quarantine Repeated No-Progress Actions From Action Lanes

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Modify: `src/v2/planner/PlannerInputComposer.ts`
- Modify: `src/v2/planner/workingSetTypes.ts`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Test: `tests/unit/v2/plannerInputComposer.test.ts`

- [ ] **Step 1: Add working-set test for no-progress quarantine**

Add to `tests/unit/v2/plannerWorkingSetSelector.test.ts`:

```ts
test('PlannerWorkingSetSelector quarantines repeated no-progress action from matching action lane', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_compute', role: 'button', name: 'Compute', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_input', role: 'textbox', name: 'Expression', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Calculate derivative',
    projection,
    uncertaintySignals: ['repeated_no_progress_transition:click:ref_compute:3'],
  });

  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_compute'), false);
  assert.equal(selection.current.refs.ref_compute?.name, 'Compute');
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_input'));
  assert.ok(selection.workingSet.quarantinedActions.some(action =>
    action.refId === 'ref_compute'
    && action.tool === 'click'
    && action.failureKind === 'no_progress_loop'
  ));
});
```

- [ ] **Step 2: Add composer propagation test**

In `tests/unit/v2/plannerInputComposer.test.ts`, add a test using an existing projection fixture pattern:

```ts
test('PlannerInputComposer passes repeated no-progress uncertainty into working set quarantine', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_compute', role: 'button', name: 'Compute', visibility: 'visible', actionability: 'ready' }),
  ]));
  const input = new PlannerInputComposer().compose({
    episodeId: 'episode_quarantine_signal',
    goal: 'Compute result',
    projection,
    runtimeUncertainty: {
      level: 'medium',
      signals: ['repeated_no_progress_transition:click:ref_compute:3'],
    },
  });

  assert.ok(input.workingSet?.quarantinedActions.some(action =>
    action.refId === 'ref_compute'
    && action.tool === 'click'
  ));
  assert.equal(input.workingSet?.actionSurface.clickableRefs.includes('ref_compute'), false);
});
```

- [ ] **Step 3: Run focused failing tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/plannerInputComposer.test.ts --test-name-pattern "no-progress|quarantine"
```

Expected before implementation: tests fail because `PlannerWorkingSetSelectorInput` does not consume `uncertaintySignals`.

- [ ] **Step 4: Extend working-set selector input**

In `src/v2/planner/PlannerWorkingSetSelector.ts`, add:

```ts
uncertaintySignals?: readonly string[];
```

to `PlannerWorkingSetSelectorInput`.

- [ ] **Step 5: Parse repeated no-progress signals**

Add helper:

```ts
function quarantinedActionsFromUncertainty(signals: readonly string[] | undefined): PlannerQuarantinedAction[] {
  const actions: PlannerQuarantinedAction[] = [];
  for (const signal of signals ?? []) {
    const match = signal.match(/^repeated_no_progress_transition:([^:]+):([^:]+):(\d+)$/);
    if (!match) continue;
    const [, tool, refId, countText] = match;
    const count = Number.parseInt(countText, 10);
    if (!Number.isFinite(count) || count < 3) continue;
    actions.push({
      refId,
      tool,
      failureKind: 'no_progress_loop',
      retryable: false,
      persistence: 'persistent',
    });
  }
  return actions;
}
```

Update `buildQuarantinedActions` so it combines persistent failures and no-progress actions:

```ts
function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  const actions: PlannerQuarantinedAction[] = [];
  const lastTool = input.lastResult?.kind;
  const lastRef = input.lastResult?.targetRef;

  for (const failure of input.failureEvidence ?? []) {
    if (!failure.targetRef) continue;
    if (failure.retryable !== false || failure.persistence !== 'persistent') continue;
    if (failure.targetRef !== lastRef) continue;
    actions.push({
      refId: failure.targetRef,
      tool: lastTool ?? 'unknown',
      failureKind: failure.kind,
      retryable: failure.retryable,
      persistence: failure.persistence,
    });
  }

  actions.push(...quarantinedActionsFromUncertainty(input.uncertaintySignals));

  return uniqueQuarantinedActions(actions);
}
```

Add:

```ts
function uniqueQuarantinedActions(actions: PlannerQuarantinedAction[]): PlannerQuarantinedAction[] {
  const seen = new Set<string>();
  const unique: PlannerQuarantinedAction[] = [];
  for (const action of actions) {
    const key = `${action.tool}:${action.refId}:${action.failureKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }
  return unique;
}
```

- [ ] **Step 6: Pass uncertainty signals from composer**

In `src/v2/planner/PlannerInputComposer.ts`, update `workingSetSelector.select` call:

```ts
const workingSetSelection = this.workingSetSelector.select({
  goal: input.goal,
  projection: input.projection,
  graphSnapshot: input.graphSnapshot,
  transitionEvidence: input.transitionEvidence,
  lastResult: input.lastResult,
  failureEvidence: input.failureEvidence,
  uncertaintySignals: input.runtimeUncertainty?.signals,
});
```

- [ ] **Step 7: Verify Task 3**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/plannerInputComposer.test.ts tests/unit/v2/recoveryState.test.ts
```

Expected: all pass.

---

### Task 4: Segment-Safe Multi-Step Plan Validation

**Files:**
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

Design rule: validate JSON shape and required fields for all steps, but action-lane compatibility only for the first currently executable segment. After a page-changing mutation, the agent loop already re-observes and should re-plan instead of blindly executing stale queued actions.

- [ ] **Step 1: Add schema test for launcher-then-type plan**

Add to `tests/unit/v2/plannerOutputSchema.test.ts`:

```ts
test('PlannerOutputSchema can validate only first action compatibility for queued multi-step plans', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'click', ref: 'ref_search_button' },
      { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
      { tool: 'press', ref: 'ref_search_button', key: 'Enter' },
    ],
    confidence: 'high',
  }, {
    allowedRefs: ['ref_search_button'],
    actionCompatibilityScope: 'first_step',
    actionSurface: {
      clickableRefs: ['ref_search_button'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: ['ref_search_button'],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, true);
});

test('PlannerOutputSchema still rejects incompatible first step in first-step compatibility mode', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
    ],
    confidence: 'high',
  }, {
    allowedRefs: ['ref_search_button'],
    actionCompatibilityScope: 'first_step',
    actionSurface: {
      clickableRefs: ['ref_search_button'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: ['ref_search_button'],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /not compatible with tool "type"/);
});
```

- [ ] **Step 2: Add V2PlannerClient test for segmented validation**

In `tests/unit/v2/v2PlannerClient.test.ts`, add:

```ts
test('V2PlannerClient accepts queued launcher plan when first step is compatible', async () => {
  const plannerInput = makePlannerInput('episode_segmented_validation');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.current.refs = {
    ref_search_button: {
      refId: 'ref_search_button',
      kind: 'button',
      role: 'button',
      name: 'Search or jump to...',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 100,
    },
  };
  plannerInput.current.interactions = [{ refId: 'ref_search_button', rank: 1 }];
  plannerInput.current.readables = [{ refId: 'ref_search_button', rank: 1 }];
  plannerInput.current.navigation = [];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_search_button'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: ['ref_search_button'],
      ambiguousRefs: [],
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 1,
      topRefs: [],
      omittedCount: 0,
    },
    failedRefs: [],
    quarantinedActions: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 1,
      selectedRefCount: 1,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };

  const client = new V2PlannerClient({
    provider: async () => ({
      text: JSON.stringify({
        plan: [
          { tool: 'click', ref: 'ref_search_button' },
          { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
          { tool: 'press', ref: 'ref_search_button', key: 'Enter' },
        ],
        confidence: 'high',
      }),
      inputTokens: 10,
      outputTokens: 10,
    }),
  });

  const result = await client.call({ plannerInput });
  assert.equal(result.output.plan?.length, 3);
});
```

- [ ] **Step 3: Run focused failing tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts --test-name-pattern "first action compatibility|launcher plan"
```

Expected before implementation: tests fail because all steps are action-compatibility checked against the current surface.

- [ ] **Step 4: Add schema context field**

In `src/v2/planner/PlannerOutputSchema.ts`, extend `PlannerOutputValidationContext`:

```ts
actionCompatibilityScope?: 'all_steps' | 'first_step';
```

Change `validatePlanSteps` to pass `stepNumber` into action compatibility:

```ts
validateRequiredFields(tool, candidateStep, stepNumber, errors, context);
```

Inside `validateActionCompatibility`, add:

```ts
if (context.actionCompatibilityScope === 'first_step' && stepNumber > 1) {
  return;
}
```

Keep required field validation and allowed-ref validation for every step.

- [ ] **Step 5: Use first-step compatibility in planner client**

In `src/v2/planner/V2PlannerClient.ts`, when building validation context:

```ts
const validationContext = {
  ...collectValidationContext(input.plannerInput),
  mode: input.mode,
  actionCompatibilityScope: input.mode === 'finalization' ? 'all_steps' : 'first_step',
};
```

Finalization still rejects plans before compatibility matters.

- [ ] **Step 6: Verify queued actions are not blindly executed after page change**

Add to `tests/unit/v2/v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop replans after page-changing first step instead of executing stale queued steps', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'click', ref: 'ref_search_button' },
        { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Replanned after launcher click' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_search_button',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_search_input'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_search_button'],
      },
      notes: ['launcher opened input'],
    },
    traceStepId: 'tool_click_launcher',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test',
    goal: 'Search repository',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.equal(dispatcher.steps.length, 1);
  assert.equal(dispatcher.steps[0].tool, 'click');
});
```

- [ ] **Step 7: Verify Task 4**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all pass.

---

### Task 5: Finalization Evidence Builder

**Files:**
- Create: `src/v2/agent/FinalizationEvidence.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Test: `tests/unit/v2/finalizationEvidence.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

Design rule: finalization should not depend only on the last tool value. It should receive compact readable evidence from the current projection, so it can answer from visible text instead of trying more actions.

- [ ] **Step 1: Create finalization evidence tests**

Create `tests/unit/v2/finalizationEvidence.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalizationEvidence } from '../../../src/v2/agent/FinalizationEvidence';
import type { OperationalProjection } from '../../../src/v2/brain1/projectionTypes';

function makeProjection(): OperationalProjection {
  return {
    projectionId: 'projection_finalization',
    observationId: 'obs_finalization',
    generationId: 1,
    url: 'https://example.test',
    title: 'Calculator',
    interactions: [],
    readables: [
      {
        refId: 'ref_result',
        kind: 'generic',
        role: 'text',
        name: 'Result',
        text: 'Derivative is 11.2',
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        score: 100,
        continuityConfidence: 1,
      },
      {
        refId: 'ref_noise',
        kind: 'button',
        role: 'button',
        name: 'Step-by-step solution',
        text: 'Step-by-step solution',
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        score: 20,
        continuityConfidence: 1,
      },
    ],
    navigation: [],
    regions: [],
    warnings: [],
    stats: {
      interactionCount: 0,
      readableCount: 2,
      navigationCount: 0,
      regionCount: 0,
    },
  };
}

test('buildFinalizationEvidence includes last value and compact readable evidence', () => {
  const evidence = buildFinalizationEvidence({
    goal: 'Calculate derivative of x^2 when x=5.6',
    projection: makeProjection(),
    lastSuccessfulEvidenceValue: 'Compute input button',
  });

  assert.match(evidence, /Last successful evidence:/);
  assert.match(evidence, /Compute input button/);
  assert.match(evidence, /Readable evidence:/);
  assert.match(evidence, /Derivative is 11\.2/);
});
```

- [ ] **Step 2: Implement finalization evidence builder**

Create `src/v2/agent/FinalizationEvidence.ts`:

```ts
import type { OperationalProjection, ProjectionItem } from '../brain1/projectionTypes';

export interface FinalizationEvidenceInput {
  goal: string;
  projection: OperationalProjection;
  lastSuccessfulEvidenceValue?: string;
  maxReadableItems?: number;
  maxTextLength?: number;
}

export function buildFinalizationEvidence(input: FinalizationEvidenceInput): string {
  const maxReadableItems = input.maxReadableItems ?? 12;
  const maxTextLength = input.maxTextLength ?? 180;
  const sections: string[] = [];

  if (input.lastSuccessfulEvidenceValue?.trim()) {
    sections.push(`Last successful evidence: ${compactText(input.lastSuccessfulEvidenceValue, maxTextLength)}`);
  }

  const readableItems = input.projection.readables
    .filter(item => item.visibility === 'visible')
    .filter(item => Boolean(item.name?.trim() || item.text?.trim()))
    .sort((left, right) => scoreReadable(right, input.goal) - scoreReadable(left, input.goal))
    .slice(0, maxReadableItems);

  if (readableItems.length > 0) {
    sections.push([
      'Readable evidence:',
      ...readableItems.map(item => `- ${item.refId}: ${compactText([item.name, item.text].filter(Boolean).join(' '), maxTextLength)}`),
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function scoreReadable(item: ProjectionItem, goal: string): number {
  const text = `${item.name ?? ''} ${item.text ?? ''}`.toLowerCase();
  let score = item.score;
  for (const token of goal.toLowerCase().split(/[^a-z0-9]+/).filter(part => part.length >= 3)) {
    if (text.includes(token)) score += 25;
  }
  if (item.visibility === 'visible') score += 20;
  return score;
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}
```

- [ ] **Step 3: Use builder in finalization**

In `src/v2/agent/V2AgentLoop.ts`, import:

```ts
import { buildFinalizationEvidence } from './FinalizationEvidence';
```

In `attemptFinalization`, after projection:

```ts
const finalizationEvidence = buildFinalizationEvidence({
  goal,
  projection,
  lastSuccessfulEvidenceValue: evidenceValue,
});
```

Change finalization goal:

```ts
goal: `${goal}

Finalization evidence:
${finalizationEvidence}

Return done with the best answer if the evidence answers the goal. Otherwise escalate with a concise reason. Do not return a plan.`,
```

- [ ] **Step 4: Add agent-loop assertion**

In `tests/unit/v2/v2AgentLoop.test.ts`, extend `V2AgentLoop attempts finalization when useful evidence exists at max steps`:

```ts
assert.match(planner.inputs[2].goal, /Finalization evidence:/);
assert.match(planner.inputs[2].goal, /Readable evidence:/);
```

- [ ] **Step 5: Verify Task 5**

Run:

```powershell
node --test --import tsx tests/unit/v2/finalizationEvidence.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all pass.

---

### Task 6: Escalation Reason Preservation and Environment Classification

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Add escalation reason test**

Add to `tests/unit/v2/v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop preserves planner escalation reason in failureReason', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { escalate: 'dead_end', reason: 'page shows security check and no useful controls' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/security',
    goal: 'Find recipe',
    maxSteps: 1,
  });

  assert.equal(result.success, false);
  assert.equal(
    result.failureReason,
    'planner_escalated:dead_end:page shows security check and no useful controls',
  );
});
```

- [ ] **Step 2: Implement reason preservation**

In `src/v2/agent/V2AgentLoop.ts`, replace:

```ts
failureReason: `planner_escalated:${plannerResult.output.escalate}`,
```

with:

```ts
failureReason: formatPlannerEscalation(plannerResult.output.escalate, plannerResult.output.reason),
```

Add helper:

```ts
function formatPlannerEscalation(kind: string, reason: string | undefined): string {
  const compactReason = reason?.replace(/\s+/g, ' ').trim();
  return compactReason ? `planner_escalated:${kind}:${compactReason}` : `planner_escalated:${kind}`;
}
```

- [ ] **Step 3: Verify Task 6**

Run:

```powershell
node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/agentSmokeRunner.test.ts tests/unit/v2/benchmarkScoring.test.ts
```

Expected: update existing tests that assert exact `planner_escalated:dead_end` only where they intentionally check old formatting. New expected format includes reason when reason exists.

---

### Task 7: Full Verification and One Controlled Smoke

**Files:**
- No implementation files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test --import tsx tests/unit/parser.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/plannerInputComposer.test.ts tests/unit/v2/recoveryState.test.ts tests/unit/v2/finalizationEvidence.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full gates**

Run:

```powershell
npm.cmd run check:v2
npm.cmd run build
npm.cmd run test:unit
```

Expected: all pass.

- [ ] **Step 3: Run anti-overfit scan**

Run:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha|Castle Mountains|climate change data visualization|quantum computing|vegan chocolate chip" src/v2 src/agent tests/unit
```

Expected: no new behavioral logic tied to benchmark/site strings.

- [ ] **Step 4: Inspect git status before any commit**

Run:

```powershell
git status --short
```

Expected: source/tests/docs only. Do not stage `new-keys.yaml`, `debug.log`, or benchmark logs.

- [ ] **Step 5: Run one BrowseGent MVR5 smoke only after local gates pass**

Use a fresh key index chosen by the user.

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 37
```

Expected analysis targets:

- Trace complete rate stays 100%.
- Wolfram repeated action count drops from 9 or the no-progress quarantine appears in planner input.
- ArXiv no longer fails with `select requires "value"` if the raw plan includes `value`.
- GitHub gets at least one executable launcher click instead of failing at pre-execution validation.
- Google Maps remains non-regressed.
- Allrecipes failure reason preserves useful escalation/environment context.

Do not implement a benchmark-specific fix from this single smoke. If the smoke reveals a new general invariant, write a short follow-up plan.

## Commit Guidance

If committing, use targeted commits and exclude sensitive/local files.

Suggested commits:

```powershell
git add src/agent/parser.ts src/v2/planner/PlannerOutputSchema.ts tests/unit/parser.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "fix(v2): preserve select values through planner parsing"
```

```powershell
git add src/v2/agent/V2AgentLoop.ts src/v2/planner/PlannerInputComposer.ts src/v2/planner/PlannerWorkingSetSelector.ts src/v2/planner/workingSetTypes.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/plannerInputComposer.test.ts
git commit -m "fix(v2): quarantine repeated no-progress actions"
```

```powershell
git add src/v2/planner/PlannerOutputSchema.ts src/v2/planner/V2PlannerClient.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "fix(v2): allow segment-safe multi-step planning"
```

```powershell
git add src/v2/agent/FinalizationEvidence.ts src/v2/agent/V2AgentLoop.ts tests/unit/v2/finalizationEvidence.test.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "fix(v2): enrich finalization with readable evidence"
```

Never commit:

```text
new-keys.yaml
debug.log
logs/
```

## Self-Review Checklist

- Parser preserves plan-step `value`.
- Schema can recover select `val` and `option` only for `select`.
- Repeated local churn triggers no-progress only through repeated same `(tool, ref)` behavior.
- Strong transitions do not become no-progress.
- No-progress quarantine removes matching action/ref from action lanes but preserves the ref as evidence.
- Planner client validates first executable step compatibility while still validating required fields for all steps.
- Agent loop does not blindly execute queued stale steps after page-changing actions.
- Finalization receives compact readable evidence and still rejects plans.
- Escalation reason is preserved.
- Full verification passes before benchmark.
