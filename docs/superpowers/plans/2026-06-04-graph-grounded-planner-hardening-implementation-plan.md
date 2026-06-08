# Graph-Grounded Planner Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BrowseGent's Brain1/Brain2/graph pipeline stop repeating failed actions, expose cleaner action/evidence lanes, finalize answers without unnecessary acting, and improve ref/runtime contract reliability without benchmark-specific tuning.

**Architecture:** Keep the existing V2 architecture. Brain1 owns projection and action/evidence lanes, Brain2/graph owns continuity and failure semantics, the planner receives compact task-relevant state, and runtime enforces ref/action contracts. The design deliberately avoids website-specific selectors, WebVoyager task logic, broad JS-click bypasses, and large rewrites.

**Tech Stack:** TypeScript, Node test runner, Playwright-backed V2 harness, BrowseGent V2 planner/graph/runtime modules.

---

## Non-Negotiable Invariants

- No hardcoded website names, benchmark task IDs, selectors, or WebVoyager-specific branches.
- Failed refs must remain visible as recovery evidence, but failed `(tool, ref)` pairs must not remain high-priority action candidates for the same page state.
- Readable evidence must not be treated as an action target unless the ref is also explicitly compatible with the requested tool.
- Finalization mode must not execute or accept more browser actions.
- Runtime may improve diagnostics and scoped resolution, but must not add broad JS-click fallback as a first response to blocked targets.
- Benchmark results are signals only. A change is valid only if it improves a general contract or invariant.

Run this anti-overfit check before final verification:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha|Castle Mountains|climate change data visualization|quantum computing" src/v2 tests/unit/v2
```

Expected: no new site/task-specific logic. Existing benchmark harness/test references outside `src/v2` are allowed only if they already existed or are benchmark infrastructure, not planner/runtime behavior.

## Current Evidence Driving This Plan

- Latest MVR5 run had `traceOk=true` for all tasks, so trace replay/audit is not the next bottleneck.
- Google Maps alternated among blocked or non-clickable refs after failures. The planner kept receiving failed refs as attractive candidates.
- GitHub repeatedly targeted a search ref that runtime resolved ambiguously.
- Wolfram reached useful evidence but finalization returned another `click` plan instead of terminal answer/dead-end behavior.
- ArXiv showed a suspicious `select` validation path: raw output included `value`, yet validation reported `select requires "value"`. This must be inspected with a focused unit test before broader schema edits.

## File Map

- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
  - Separate failure evidence preservation from action candidate scoring.
  - Remove same-tool quarantined refs from action-compatible lanes while preserving them in `workingSet.failedRefs`.
- Modify: `src/v2/planner/workingSetTypes.ts`
  - Add compact quarantine metadata used by the working set, planner prompt, and tests.
- Modify: `src/v2/runtime/RecoveryState.ts`
  - Encode action-specific blocked pairs and clearer next mechanisms for persistent target failures.
- Modify: `src/v2/planner/PlannerPrompt.ts`
  - Align prompt with the stricter invariant: failed refs are evidence, not retry targets, unless page transition is strong.
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
  - Add finalization-mode validation support and focused select normalization diagnostics.
- Modify: `src/v2/planner/V2PlannerClient.ts`
  - Pass validation context including finalization mode when the agent loop requests terminal finalization.
- Modify: `src/v2/agent/V2AgentLoop.ts`
  - Ensure finalization planner calls cannot execute returned plans.
- Modify: `src/v2/runtime/RefService.ts`
  - Improve diagnostic reasons for ambiguous/weak ref resolution without broad fallback behavior.
- Modify: `src/v2/harness/BrowseGentV2Harness.ts`
  - Preserve runtime error details and scoped resolution diagnostics in `V2ToolResult.error.message`.
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Test: `tests/unit/v2/recoveryState.test.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`
- Test: `tests/unit/v2/refService.test.ts`
- Test: `tests/unit/v2/runtimeContracts.test.ts`

---

### Task 1: Failed-Ref Quarantine as Evidence, Not Candidate Boost

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Modify: `src/v2/planner/workingSetTypes.ts`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`

- [ ] **Step 1: Write failing tests for action-specific quarantine**

Add tests showing that a persistent failed click ref is preserved in `failedRefs` but removed from `clickableRefs`, while a retryable failure does not quarantine it.

```ts
test('PlannerWorkingSetSelector preserves failed refs as evidence without keeping same-tool target clickable', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_search', role: 'textbox', name: 'Search', visibility: 'visible', actionability: 'ready' }),
    makeRef({ refId: 'ref_bad_button', role: 'button', name: 'Search', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Search for climate data',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_bad_button',
      error: { code: 'target_blocked', message: 'Target center point is blocked.', retryable: false },
      traceStepId: 'step_click_bad_button',
    },
    failureEvidence: [{
      failureId: 'failure_target_blocked_ref_bad_button',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target ref center point is blocked by another element.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_bad_button',
      signals: ['error:target_blocked'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_bad_button'));
  assert.equal(selection.current.refs.ref_bad_button?.name, 'Search');
  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_bad_button'), false);
  assert.ok(selection.workingSet.actionSurface.typeableRefs.includes('ref_search'));
});

test('PlannerWorkingSetSelector does not quarantine retryable transient failures', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit', visibility: 'visible', actionability: 'ready' }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Submit the form',
    projection,
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_submit',
      error: { code: 'timeout', message: 'Target was unstable.', retryable: true },
      traceStepId: 'step_click_submit',
    },
    failureEvidence: [{
      failureId: 'failure_timeout_ref_submit',
      kind: 'timeout',
      category: 'timing',
      severity: 'warning',
      persistence: 'transient',
      retryable: true,
      message: 'Timed out waiting for target.',
      source: 'test',
      observationId: 'obs_working_set',
      targetRef: 'ref_submit',
      signals: ['error:timeout'],
    }],
  });

  assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_submit'));
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_submit'));
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected before implementation: the first new test fails because failed refs remain click-compatible and receive `last_failure` score boosting.

- [ ] **Step 3: Add quarantine metadata and scoring helper**

In `src/v2/planner/workingSetTypes.ts`, add an explicit compact quarantine type:

```ts
export interface PlannerQuarantinedAction {
  refId: string;
  tool: string;
  failureKind: string;
  retryable: boolean;
  persistence: 'transient' | 'persistent' | 'unknown';
}
```

Add this field to `PlannerWorkingSet`:

```ts
quarantinedActions: PlannerQuarantinedAction[];
```

In `src/v2/planner/PlannerWorkingSetSelector.ts`, build action-specific quarantine from failure evidence:

```ts
function buildQuarantinedActions(input: PlannerWorkingSetSelectorInput): PlannerQuarantinedAction[] {
  const lastTool = input.lastResult?.kind;
  return (input.failureEvidence ?? [])
    .filter(failure => Boolean(failure.targetRef))
    .filter(failure => failure.retryable === false && failure.persistence === 'persistent')
    .map(failure => ({
      refId: failure.targetRef as string,
      tool: lastTool ?? 'unknown',
      failureKind: failure.kind,
      retryable: failure.retryable,
      persistence: failure.persistence,
    }));
}
```

- [ ] **Step 4: Stop boosting failed refs as normal candidates**

Change `scoreCandidate` so `last_failure` preserves selection but does not add positive score.

```ts
if (evidence.failedRefs.has(item.refId)) {
  reasons.add('last_failure');
}
```

Do not remove failed refs from `selectedRefIds`; they must remain serializable as failure evidence.

- [ ] **Step 5: Remove quarantined same-tool refs from action surface**

Change `buildActionSurface` signature:

```ts
function buildActionSurface(
  projection: OperationalProjection,
  selectedSet: Set<string>,
  quarantinedActions: PlannerQuarantinedAction[],
): PlannerActionSurface {
```

Add helper:

```ts
function isQuarantinedForTool(refId: string, tool: 'click' | 'type' | 'select', quarantinedActions: PlannerQuarantinedAction[]): boolean {
  return quarantinedActions.some(action =>
    action.refId === refId
    && (action.tool === tool || action.tool === 'close' && tool === 'click')
    && action.retryable === false
    && action.persistence === 'persistent'
  );
}
```

Use it before pushing lanes:

```ts
if (isClickableCandidate(item) && !isQuarantinedForTool(item.refId, 'click', quarantinedActions)) {
  clickableRefs.push(item.refId);
}
if (isTypeableCandidate(item) && !isQuarantinedForTool(item.refId, 'type', quarantinedActions)) {
  typeableRefs.push(item.refId);
}
if (isSelectableCandidate(item) && !isQuarantinedForTool(item.refId, 'select', quarantinedActions)) {
  selectableRefs.push(item.refId);
}
```

When building the return object in `select`, compute once and include:

```ts
const quarantinedActions = buildQuarantinedActions(input);
const actionSurface = buildActionSurface(input.projection, selectedSet, quarantinedActions);
```

And in `workingSet`:

```ts
quarantinedActions,
```

- [ ] **Step 6: Update the old failed-ref test expectation**

The existing test named `PlannerWorkingSetSelector keeps failed target refs with failure reasons for recovery` should continue to assert:

```ts
assert.ok(selection.workingSet.failedRefs.some(ref => ref.refId === 'ref_submit'));
assert.equal(selection.current.refs.ref_submit?.name, 'Search');
assert.equal(selection.workingSet.mode, 'recover');
```

If the failed action was `click`, add:

```ts
assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_submit'), false);
```

- [ ] **Step 7: Verify Task 1**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected: all planner working set tests pass.

---

### Task 2: Recovery State Uses Quarantined Action Pairs

**Files:**
- Modify: `src/v2/runtime/RecoveryState.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Test: `tests/unit/v2/recoveryState.test.ts`
- Test: `tests/unit/v2/plannerPrompt.test.ts`

- [ ] **Step 1: Write tests for persistent target recovery**

Create `tests/unit/v2/recoveryState.test.ts` if it does not exist. Add:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { RecoveryStateBuilder } from '../../../src/v2/runtime/RecoveryState';

test('RecoveryStateBuilder blocks persistent target failure as same action pair', () => {
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'click',
      targetRef: 'ref_bad',
      error: { code: 'target_blocked', message: 'Blocked.', retryable: false },
      traceStepId: 'step_bad',
    },
    failures: [{
      failureId: 'failure_target_blocked_ref_bad',
      kind: 'target_blocked',
      category: 'target',
      severity: 'warning',
      persistence: 'persistent',
      retryable: false,
      message: 'Target blocked.',
      source: 'test',
      targetRef: 'ref_bad',
      signals: ['error:target_blocked'],
    }],
  });

  assert.equal(recovery?.state, 'wrong_target_type');
  assert.equal(recovery?.blockedAction?.tool, 'click');
  assert.equal(recovery?.blockedAction?.ref, 'ref_bad');
  assert.ok(recovery?.nextMechanisms.includes('choose_alternative_ref'));
  assert.ok(recovery?.nextMechanisms.includes('use_readable_evidence_if_goal_is_answerable'));
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
node --test --import tsx tests/unit/v2/recoveryState.test.ts
```

Expected before implementation: fails because `target_blocked`, `ambiguous_ref_resolution`, and `low_confidence_ref` are not all mapped into actionable recovery mechanisms.

- [ ] **Step 3: Expand wrong-target recovery categories**

In `RecoveryState.ts`, change `buildWrongTargetRecovery` to include persistent target/continuity failures:

```ts
const WRONG_TARGET_CODES = new Set([
  'target_not_editable',
  'target_not_clickable',
  'target_blocked',
  'ambiguous_ref_resolution',
  'low_confidence_ref',
  'unselected_ref',
]);
```

Then use:

```ts
if (!code || !WRONG_TARGET_CODES.has(code)) {
  return undefined;
}
```

Return mechanisms:

```ts
nextMechanisms: mechanismsForErrorCode(code),
```

Add:

```ts
function mechanismsForErrorCode(code: string): string[] {
  if (code === 'target_not_editable') {
    return ['choose_typeable_ref', 'click_launcher_then_type', 'expand_or_reobserve'];
  }
  if (code === 'target_not_clickable' || code === 'target_blocked' || code === 'low_confidence_ref') {
    return ['avoid_repeating_blocked_action', 'choose_alternative_ref', 'use_readable_evidence_if_goal_is_answerable', 'expand_or_reobserve'];
  }
  if (code === 'ambiguous_ref_resolution') {
    return ['choose_less_ambiguous_ref', 'inspect_region_or_scope', 'use_current_focus_or_overlay', 'expand_or_reobserve'];
  }
  return ['choose_alternative_ref', 'expand_or_reobserve'];
}
```

- [ ] **Step 4: Update prompt invariant**

In `PlannerPrompt.ts`, replace the recovery instruction with stronger wording:

```ts
If recovery.state is present, change strategy according to recovery.nextMechanisms. Do not repeat recovery.blockedAction for the same ref/tool pair unless transition.strength is strong, the URL changed, or the ref is newly listed in the compatible action lane. Failed refs are evidence first; do not use them as action targets merely because their text matches the goal.
```

Add a planner prompt test assertion:

```ts
assert.match(prompt, /Failed refs are evidence first/i);
assert.match(prompt, /same ref\/tool pair/i);
```

- [ ] **Step 5: Verify Task 2**

Run:

```powershell
node --test --import tsx tests/unit/v2/recoveryState.test.ts tests/unit/v2/plannerPrompt.test.ts
```

Expected: recovery and prompt tests pass.

---

### Task 3: Strict Action/Evidence Lane Semantics

**Files:**
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Write tests for readable-only refs**

Add to `plannerWorkingSetSelector.test.ts`:

```ts
test('PlannerWorkingSetSelector exposes readable generic refs as evidence without action compatibility', () => {
  const projection = new ProjectionService().project(makeObservation([
    makeRef({
      refId: 'ref_answer_row',
      role: 'row',
      kind: 'generic',
      name: 'Castle Mountains National Monument Barstow California',
      text: 'Castle Mountains National Monument Barstow California',
      visibility: 'visible',
      actionability: 'ready',
    }),
    makeRef({
      refId: 'ref_open',
      role: 'link',
      name: 'Castle Mountains National Monument',
      visibility: 'visible',
      actionability: 'ready',
    }),
  ]));

  const selection = new PlannerWorkingSetSelector({ maxPrimaryRefs: 4, maxSecondaryRefs: 4 }).select({
    goal: 'Find where Castle Mountains National Monument is located',
    projection,
  });

  assert.ok(selection.workingSet.readableEvidence.some(evidence => evidence.refId === 'ref_answer_row'));
  assert.equal(selection.workingSet.actionSurface.clickableRefs.includes('ref_answer_row'), false);
  assert.ok(selection.workingSet.actionSurface.clickableRefs.includes('ref_open'));
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected before implementation: if generic ready refs appear in `ambiguousRefs` or action lanes, the test fails.

- [ ] **Step 3: Tighten ambiguous lane semantics**

In `buildActionSurface`, only put refs into `ambiguousRefs` when they are executable but have some interactive signal that is not safely classifiable. Do not put generic readable-only refs there.

Add helper:

```ts
function hasInteractiveSignal(item: ProjectionItem): boolean {
  const role = item.role?.toLowerCase();
  return Boolean(
    item.capabilities?.clickable
    || item.capabilities?.typeable
    || item.capabilities?.selectable
    || role === 'button'
    || role === 'link'
    || role === 'textbox'
    || role === 'searchbox'
    || role === 'combobox'
    || role === 'menuitem'
    || role === 'option'
    || item.kind === 'button'
    || item.kind === 'link'
    || item.kind === 'input'
    || item.kind === 'select'
    || item.kind === 'editable'
  );
}
```

Then:

```ts
if (
  hasInteractiveSignal(item)
  && !isClickableCandidate(item)
  && !isTypeableCandidate(item)
  && !isSelectableCandidate(item)
) {
  ambiguousRefs.push(item.refId);
}
```

- [ ] **Step 4: Make schema reject readable-only click attempts**

Add to `plannerOutputSchema.test.ts`:

```ts
test('PlannerOutputSchema rejects clicking readable-only refs', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'click', ref: 'ref_answer' }],
    confidence: 'high',
  }, {
    allowedRefs: ['ref_answer'],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: ['ref_answer'],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /not compatible with tool "click"/);
});
```

Current validator should already pass this if `ref_answer` is not in `ambiguousRefs`; this test locks the invariant.

- [ ] **Step 5: Verify Task 3**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts
```

Expected: all focused tests pass.

---

### Task 4: Terminal Finalization Mode

**Files:**
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Add validation tests for finalization mode**

Add to `plannerOutputSchema.test.ts`:

```ts
test('PlannerOutputSchema rejects action plans in finalization mode', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'click', ref: 'ref_more' }],
    confidence: 'low',
  }, {
    mode: 'finalization',
    allowedRefs: ['ref_more'],
    actionSurface: {
      clickableRefs: ['ref_more'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Finalization mode cannot return plan/);
});

test('PlannerOutputSchema accepts done in finalization mode', () => {
  const result = new PlannerOutputSchema().validate({
    done: true,
    val: '11.2',
  }, { mode: 'finalization' });

  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Add validation mode type**

In `PlannerOutputSchema.ts`, extend context:

```ts
export interface PlannerOutputValidationContext {
  allowedRefs?: readonly string[];
  regionRefs?: Readonly<Record<string, string>>;
  actionSurface?: PlannerActionSurface;
  mode?: 'normal' | 'finalization';
}
```

In `validate`, before plan validation:

```ts
if (context.mode === 'finalization' && hasPlan) {
  errors.push('Finalization mode cannot return plan');
}
```

This must happen before returning a valid plan.

- [ ] **Step 3: Pass finalization mode through planner client**

In `V2PlannerClient.ts`, add this call input field:

```ts
mode?: 'normal' | 'finalization';
```

Use it in `parseAndValidate`:

```ts
const validation = this.schema.validate(parsed, {
  ...collectValidationContext(plannerInput),
  mode,
});
```

If the existing method signatures make this exact spread awkward, keep the same behavior by passing `mode` as a separate parameter into `parseAndValidate`.

- [ ] **Step 4: Ensure agent loop finalization cannot execute plans**

In `V2AgentLoop.ts`, locate the finalization call that happens after useful evidence at max steps. It must call planner with finalization mode:

```ts
const finalization = await this.plannerClient.call({
  plannerInput: finalizationInput,
  model: input.model,
  mode: 'finalization',
});
```

If finalization returns invalid output or non-terminal output, return max steps exhausted with preserved `result.value`; do not dispatch any finalization plan.

The existing test `V2AgentLoop falls through to max_steps_exhausted when finalization planner refuses to finish` must still pass. Add this assertion if missing:

```ts
assert.equal(dispatcher.steps.length, 2);
```

- [ ] **Step 5: Update prompt for finalization**

Add to `PlannerPrompt.ts`:

```ts
When the input workingSet.mode is extract, verify, or done_candidate and useful evidence is present, prefer done or escalate over more browser actions. In finalization mode, plans are invalid; return only done or escalate.
```

Add prompt test:

```ts
assert.match(prompt, /In finalization mode, plans are invalid/i);
```

- [ ] **Step 6: Verify Task 4**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/plannerPrompt.test.ts
```

Expected: all focused tests pass.

---

### Task 5: Ref Resolution Diagnostics and Scoped Disambiguation

**Files:**
- Modify: `src/v2/runtime/RefService.ts`
- Modify: `src/v2/runtime/refResolution.ts`
- Modify: `src/v2/harness/BrowseGentV2Harness.ts`
- Test: `tests/unit/v2/refService.test.ts`
- Test: `tests/unit/v2/runtimeContracts.test.ts`

- [ ] **Step 1: Write tests for diagnostic resolution reasons**

Add to `refService.test.ts`:

```ts
test('RefService reports weakened refs with execution threshold reason', () => {
  const service = new RefService();
  const observation = makeObservation([
    makeRef({ refId: 'v2ref_1', continuityConfidence: 0.55, state: 'live' }),
  ]);

  const result = service.resolve('v2ref_1', observation);

  assert.equal(result.state, 'weakened');
  assert.equal(result.reason, 'continuity_confidence_below_execution_threshold');
  assert.equal(result.confidence, 0.55);
});
```

Add or keep a test for ambiguous soft matches:

```ts
test('RefService does not resurrect ambiguous soft matches', () => {
  const service = new RefService();
  const first = service.assign(makeObservation([
    makeRef({ targetId: 'target_a', selectorCandidates: ['[data-a]'], name: 'Search' }),
    makeRef({ targetId: 'target_b', selectorCandidates: ['[data-b]'], name: 'Search' }),
  ]));
  const second = service.assign(makeObservation([
    makeRef({ targetId: 'target_c', selectorCandidates: ['[data-c]'], name: 'Search' }),
  ]));

  assert.notEqual(second.refs[0].refId, first.refs[0].refId);
  assert.notEqual(second.refs[0].refId, first.refs[1].refId);
});
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/refService.test.ts tests/unit/v2/runtimeContracts.test.ts
```

Expected: existing tests pass or expose the missing diagnostic behavior.

- [ ] **Step 3: Improve resolution reason payload without fallback execution**

If `src/v2/runtime/refResolution.ts` does not expose enough fields, extend `RefResolution` minimally:

```ts
export interface RefResolution {
  ref?: V2Ref;
  state: RefState;
  confidence: number;
  reason?: string;
}
```

Keep runtime behavior unchanged: low-confidence refs fail; ambiguous soft matches are not resurrected.

- [ ] **Step 4: Preserve diagnostic reason in runtime errors**

In `BrowseGentV2Harness.executeMutation`, when `resolution.state !== 'live'`, map the reason into the error message:

```ts
const mapped = mapResolutionError(resolution.state);
const result = this.failureResult<TValue>(kind, refId, stepId, {
  ...mapped,
  message: resolution.reason ? `${mapped.message} (${resolution.reason})` : mapped.message,
});
```

Do the same in `executeRefRead`.

- [ ] **Step 5: Verify Task 5**

Run:

```powershell
node --test --import tsx tests/unit/v2/refService.test.ts tests/unit/v2/runtimeContracts.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: runtime contract and loop tests pass.

---

### Task 6: Focused Schema Robustness and Select Mismatch Investigation

**Files:**
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Add regression test for valid select with value**

Add to `plannerOutputSchema.test.ts`:

```ts
test('PlannerOutputSchema accepts select with exact value when ref is selectable', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'select', ref: 'v2ref_692', value: 'Announcement date (newest first)' }],
    confidence: 'high',
  }, {
    allowedRefs: ['v2ref_692'],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: ['v2ref_692'],
      readableRefs: [],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.plan?.[0]?.value, 'Announcement date (newest first)');
  }
});
```

- [ ] **Step 2: Add regression test for common option alias only if observed**

If trace inspection shows the provider used `option` or `label` instead of `value`, add only the observed alias. Do not add broad aliasing.

```ts
test('PlannerOutputSchema normalizes select option alias to value', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [{ tool: 'select', ref: 'v2ref_692', option: 'Announcement date (newest first)' }],
    confidence: 'high',
  }, {
    allowedRefs: ['v2ref_692'],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: ['v2ref_692'],
      readableRefs: [],
      ambiguousRefs: [],
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.plan?.[0]?.value, 'Announcement date (newest first)');
  }
});
```

- [ ] **Step 3: Run focused tests before code changes**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts
```

Expected: the valid `value` test should pass. If it fails, fix the validator bug. The alias test should fail until intentional alias normalization is added.

- [ ] **Step 4: Add narrow select alias normalization only when needed**

In `normalizePlannerStep`, after ref normalization:

```ts
if (normalized.tool === 'select' && normalized.value === undefined && typeof normalized.option === 'string') {
  normalized.value = normalized.option;
  delete normalized.option;
}
```

Do not accept CSS selectors, XPath, coordinates, scripts, or low-level browser commands.

- [ ] **Step 5: Verify Task 6**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts
```

Expected: focused tests pass.

---

### Task 7: Integration Verification and One Controlled MVR5 Smoke

**Files:**
- No implementation files.
- Verify: full V2 unit/build gates.
- Benchmark: one BrowseGent MVR5 run only after all local verification passes.

- [ ] **Step 1: Run full local verification**

Run:

```powershell
npm.cmd run check:v2
npm.cmd run build
npm.cmd run test:unit
```

Expected: all commands pass.

- [ ] **Step 2: Run anti-overfit scan**

Run:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha|Castle Mountains|climate change data visualization|quantum computing" src/v2 tests/unit/v2
```

Expected: no new site/task-specific logic in `src/v2`. Unit tests may mention generic examples only; benchmark task names should not appear in planner/runtime unit tests.

- [ ] **Step 3: Run one controlled BrowseGent MVR5 smoke**

Use a fresh key index. Do not run Browser Use comparison yet.

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 32
```

Expected signals:
- Trace complete rate remains 100%.
- Failed refs are not repeatedly selected for the same failed tool/ref pair.
- Google Maps either finalizes from readable evidence or fails with a clearer non-repeated recovery path.
- Wolfram finalization does not return or execute more browser actions.
- Any `select requires "value"` failure is explainable from actual missing/aliased field data.

- [ ] **Step 4: Summarize results without tuning**

Inspect the latest report:

```powershell
Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object Name -Descending | Select-Object -First 1 Name
```

Then inspect:

```powershell
$latest = Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Directory | Sort-Object Name -Descending | Select-Object -First 1
Get-Content (Join-Path $latest.FullName "summary.md")
Get-Content (Join-Path $latest.FullName "webvoyager_evaluation.md")
```

Report:
- strict score
- trace complete rate
- failure types
- repeated action count
- failed step count
- whether any failure points to a new general invariant

Do not implement benchmark-specific fixes based on this single run.

---

## Commit Guidance

Only commit source, tests, and this plan. Do not commit `new-keys.yaml`, `debug.log`, generated benchmark logs, or local API configuration.

Suggested checkpoints:

```powershell
git add src/v2/planner src/v2/runtime tests/unit/v2/plannerWorkingSetSelector.test.ts tests/unit/v2/recoveryState.test.ts tests/unit/v2/plannerPrompt.test.ts
git commit -m "fix(v2): quarantine failed refs from action lanes"
```

```powershell
git add src/v2/planner src/v2/agent tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "fix(v2): enforce terminal finalization and schema contracts"
```

```powershell
git add src/v2/runtime src/v2/harness tests/unit/v2/refService.test.ts tests/unit/v2/runtimeContracts.test.ts
git commit -m "fix(v2): improve ref resolution diagnostics"
```

Use fewer commits if implementation is done in one short session, but keep unrelated files out of the commit.

## Self-Review Checklist for Implementer

- Failed refs are preserved in `workingSet.failedRefs`.
- Persistent non-retryable failed `(tool, ref)` pairs are absent from the same tool lane.
- Readable-only refs are not clickable/typeable/selectable by default.
- Finalization mode rejects plans in validator and agent loop does not dispatch finalization plans.
- Ref resolution diagnostics improve error messages without broad fallback execution.
- Select schema behavior is covered by tests and changed only if the focused regression proves a mismatch.
- All verification commands in Task 7 pass before any benchmark rerun.
