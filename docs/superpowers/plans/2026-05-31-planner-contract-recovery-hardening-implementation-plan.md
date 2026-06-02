# Planner Contract Recovery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden BrowseGent V2 planner/runtime architecture so the next 5-task WebVoyager Lite smoke run is testing real agent behavior instead of planner-contract, context-bloat, and recovery-control bugs.

**Architecture:** Keep Brain1 projection, Brain2/graph continuity, and the V2 planner boundary intact. Add a V2-specific provider output contract, typed runtime error signals, bounded working-set evidence, deterministic recovery state, and action-compatible ref lanes. Prompt changes come last and only describe behavior implemented in code.

**Tech Stack:** TypeScript, Node test runner, Playwright substrate abstractions, Gemini REST provider, BrowseGent V2 planner/runtime modules.

---

## File Structure

- Modify: `src/providers/index.ts`
  - Add provider call options and allow Gemini calls to use a caller-supplied JSON schema.
  - Preserve legacy default schema for existing V1 paths.

- Create: `src/v2/planner/V2PlannerResponseSchema.ts`
  - Owns the V2 planner JSON schema for provider structured output.
  - Must not contain `sel`, `selector`, `css`, `xpath`, scripts, coordinates, Playwright, or CDP fields.

- Modify: `src/v2/planner/V2PlannerClient.ts`
  - Pass the V2 planner schema to the provider.
  - Track repeated invalid planner output for controlled dead-end behavior in the agent loop.
  - Extend validation context with action-compatible refs.

- Modify: `src/v2/runtime/errors.ts`
  - Add typed operational errors required by the spec.

- Modify: `src/v2/substrate/InputService.ts`
  - Map Playwright wrong-target messages to `target_not_editable` or `target_not_clickable` instead of generic `timeout`.

- Modify: `src/v2/runtime/FailureClassifier.ts`
  - Classify new runtime error codes into target/continuity/timing/environment categories.

- Modify: `src/v2/planner/workingSetTypes.ts`
  - Add `actionSurface`.
  - Replace unbounded `changedRefs: PlannerWorkingSetRef[]` with a compact changed-ref summary.

- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
  - Build action-compatible lanes.
  - Cap changed-ref evidence using the approved priority order.
  - Stop treating initial graph population as meaningful latest-transition change.

- Modify: `src/v2/planner/types.ts`
  - Add `PlannerRecoveryState` and wire it into `PlannerInput`.
  - Add action-surface types if they need to be consumed by validation.

- Create: `src/v2/runtime/RecoveryState.ts`
  - Build deterministic recovery state from last result, failure evidence, uncertainty signals, and trace/progress signals.

- Modify: `src/v2/planner/PlannerInputComposer.ts`
  - Include recovery state in planner input.
  - Keep the recovery payload compact.

- Modify: `src/v2/planner/PlannerOutputSchema.ts`
  - Enforce selected refs as before.
  - Add high-confidence action-compatibility validation.
  - Allow ambiguous refs through validation with warning context where needed.

- Modify: `src/v2/planner/PlannerPrompt.ts`
  - Describe action lanes, recovery state, and expansion/reobserve behavior after the code paths exist.

- Modify: `src/v2/agent/V2AgentLoop.ts`
  - Pass recovery state into planner input.
  - Stop repeated invalid-output cycles with controlled `dead_end` after threshold.
  - Feed loop/recovery signals without site-specific logic.

- Tests:
  - Modify: `tests/unit/providers.test.ts`
  - Modify: `tests/unit/v2/v2PlannerClient.test.ts`
  - Modify: `tests/unit/v2/inputServiceErrorMapping.test.ts`
  - Modify: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
  - Modify: `tests/unit/v2/plannerInputComposer.test.ts`
  - Create: `tests/unit/v2/recoveryState.test.ts`

---

## Task 1: V2 Provider Schema Separation

**Files:**
- Create: `src/v2/planner/V2PlannerResponseSchema.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Test: `tests/unit/providers.test.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Write provider schema tests**

Add tests that capture the required behavior:

```ts
test('callProvider lets callers override the Gemini response schema', async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"done":true,"val":"ok"}' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  process.env.GEMINI_API_KEY = 'secret-current-value';
  process.env.BROWSEGENT_GEMINI_MAX_INPUT_TOKENS = '100000';

  await callProvider('system', 'user', 'gemini/gemini-3.1-flash-lite', {
    responseSchema: {
      type: 'object',
      properties: { done: { type: 'boolean' } },
    },
  });

  const config = requestBody?.generationConfig as { responseJsonSchema?: unknown };
  assert.deepEqual(config.responseJsonSchema, {
    type: 'object',
    properties: { done: { type: 'boolean' } },
  });
});
```

Add a V2 planner client test that asserts provider options are passed:

```ts
test('V2PlannerClient passes the V2 planner response schema to provider', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const providerCalls: Array<{ options?: { responseSchema?: unknown } }> = [];
  const client = new V2PlannerClient({
    provider: async (_system, _user, _model, options) => {
      providerCalls.push({ options });
      return {
        text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
        inputTokens: 5,
        outputTokens: 3,
      };
    },
  });

  await client.call({ plannerInput: makePlannerInput('episode_v2_schema') });

  assert.ok(providerCalls[0].options?.responseSchema);
  assert.doesNotMatch(JSON.stringify(providerCalls[0].options?.responseSchema), /"sel"|"selector"/);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\providers.test.ts tests\unit\v2\v2PlannerClient.test.ts
```

Expected: fail because `callProvider` has no options parameter and `V2PlannerClient` provider type lacks options.

- [ ] **Step 3: Implement the schema seam**

Use these signatures:

```ts
export interface ProviderCallOptions {
  responseSchema?: Record<string, unknown>;
}

export async function callProvider(
  system: string,
  user: string,
  modelOverride?: string,
  options: ProviderCallOptions = {},
): Promise<ProviderResult>
```

Update Gemini:

```ts
const responseSchema = options.responseSchema ?? buildGeminiResponseSchema();
```

Update non-Gemini providers to ignore options without behavior change.

- [ ] **Step 4: Add V2 planner schema**

Create `src/v2/planner/V2PlannerResponseSchema.ts`:

```ts
export function buildV2PlannerResponseSchema(): Record<string, unknown> {
  const plannerStepSchema = {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        enum: ['click', 'type', 'navigate', 'scroll', 'wait', 'get', 'close', 'select', 'search_page', 'find_elements', 'count_elements', 'inspect_region'],
      },
      ref: { type: 'string' },
      text: { type: 'string' },
      value: { type: 'string' },
      url: { type: 'string' },
      direction: { type: 'string', enum: ['down', 'up'] },
      timeout: { type: 'number' },
      pattern: { type: 'string' },
    },
    required: ['tool'],
  };

  return {
    type: 'object',
    properties: {
      plan: { type: 'array', items: plannerStepSchema },
      done: { type: 'boolean' },
      val: { type: 'string' },
      escalate: { type: 'string', enum: ['user_needed', 'captcha', 'dead_end'] },
      reason: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  };
}
```

Update `V2PlannerClient` provider type:

```ts
import type { ProviderCallOptions } from '../../providers';
import { buildV2PlannerResponseSchema } from './V2PlannerResponseSchema';

export type V2PlannerProvider = (
  system: string,
  user: string,
  model?: string,
  options?: ProviderCallOptions,
) => Promise<V2PlannerProviderResult>;
```

Call:

```ts
providerResult = await this.provider(systemPrompt, userMessage, input.model, {
  responseSchema: buildV2PlannerResponseSchema(),
});
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\providers.test.ts tests\unit\v2\v2PlannerClient.test.ts
```

Expected: pass.

---

## Task 2: Runtime Error Taxonomy

**Files:**
- Modify: `src/v2/runtime/errors.ts`
- Modify: `src/v2/substrate/InputService.ts`
- Modify: `src/v2/runtime/FailureClassifier.ts`
- Test: `tests/unit/v2/inputServiceErrorMapping.test.ts`

- [ ] **Step 1: Add failing tests for wrong target mapping**

Add tests:

```ts
test('InputService maps non-editable fill failure to target_not_editable', async () => {
  const locator = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => undefined,
    fill: async () => {
      throw new Error('Element is not an <input>, <textarea>, <select> or [contenteditable] and does not have a role allowing [aria-readonly]');
    },
  };
  const page = { locator: () => ({ first: () => locator }) };

  await assert.rejects(
    () => new InputService().type(makeRef(), 'query', page as never),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'target_not_editable');
      return true;
    },
  );
});
```

Add a click wrong-target test if current Playwright message coverage allows it:

```ts
test('InputService maps non-clickable click failure to target_not_clickable', async () => {
  const locator = {
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => undefined,
    evaluate: async () => false,
    click: async () => {
      throw new Error('element is not enabled or does not receive pointer events');
    },
  };
  const page = { locator: () => ({ first: () => locator }) };

  await assert.rejects(
    () => new InputService().click(makeRef(), page as never),
    (error: unknown) => {
      assert.match(String((error as { code?: string }).code), /target_(not_clickable|blocked)/);
      return true;
    },
  );
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\inputServiceErrorMapping.test.ts
```

Expected: fail because `target_not_editable` is not defined/mapped.

- [ ] **Step 3: Add error codes**

Add to `V2_OPERATIONAL_ERROR_CODES`:

```ts
'target_not_editable',
'target_not_clickable',
'unselected_ref',
'element_detached',
'navigation_blocked',
'captcha_or_access_block',
```

- [ ] **Step 4: Map Playwright messages**

In `mapPlaywrightError`, before timeout fallback:

```ts
if (action === 'type' && (
  lowered.includes('not an <input>')
  || lowered.includes('contenteditable')
  || lowered.includes('not editable')
  || lowered.includes('editable')
)) {
  return new V2OperationalError('target_not_editable', `Target was not editable during ${action}.`, { retryable: false });
}

if (action === 'click' && (
  lowered.includes('not enabled')
  || lowered.includes('not clickable')
  || lowered.includes('element is detached')
)) {
  return new V2OperationalError('target_not_clickable', `Target was not clickable during ${action}.`, { retryable: false });
}
```

Keep existing hidden/disabled/blocked mappings before generic timeout.

- [ ] **Step 5: Update FailureClassifier**

Add new codes to `toFailureKind`, `categoryFor`, `persistenceFor`, and `messageFor`. Map `target_not_editable`, `target_not_clickable`, and `element_detached` to target/continuity categories as appropriate.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\inputServiceErrorMapping.test.ts
```

Expected: pass.

---

## Task 3: Compact Changed Refs and Action Surface

**Files:**
- Modify: `src/v2/planner/workingSetTypes.ts`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Modify: `src/v2/planner/types.ts`
- Test: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Test: `tests/unit/v2/plannerInputComposer.test.ts`

- [ ] **Step 1: Write failing working-set tests**

Add tests for:

```ts
test('PlannerWorkingSetSelector does not treat initial graph population as changed refs', () => {
  // Build graph snapshot with refs but no transitions.
  // Assert selection.workingSet.changedRefs.topRefs length is 0.
  // Assert changed counts are 0.
});

test('PlannerWorkingSetSelector caps changed refs by priority order', () => {
  // Build failed ref, recovery-relevant ref, goal-matching appeared ref, and many unrelated appeared refs.
  // Use a tiny maxChangedRefs option.
  // Assert failed/recovery/goal refs are preserved before unrelated refs.
});

test('PlannerWorkingSetSelector emits action-compatible ref lanes', () => {
  // Use button, link, textbox, select, generic readable refs.
  // Assert actionSurface.clickableRefs/typeableRefs/selectableRefs/readableRefs are populated correctly.
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts tests\unit\v2\plannerInputComposer.test.ts
```

Expected: fail because `changedRefs` is still an unbounded array and `actionSurface` does not exist.

- [ ] **Step 3: Update working-set types**

Add:

```ts
export interface PlannerActionSurface {
  clickableRefs: string[];
  typeableRefs: string[];
  selectableRefs: string[];
  readableRefs: string[];
  ambiguousRefs: string[];
}

export interface PlannerChangedRefsSummary {
  appearedCount: number;
  weakenedCount: number;
  preservedCount: number;
  topRefs: PlannerWorkingSetRef[];
  omittedCount: number;
}
```

Change `PlannerWorkingSet`:

```ts
actionSurface: PlannerActionSurface;
changedRefs: PlannerChangedRefsSummary;
```

Add option:

```ts
maxChangedRefs?: number;
```

- [ ] **Step 4: Implement action-surface builder**

Rules:

```ts
typeable = kind input/select/editable OR role textbox/searchbox/combobox OR state suggests editable
selectable = kind select OR role combobox/listbox
clickable = kind button/link/input/select/editable OR role button/link/menuitem/option/checkbox/radio/tab
readable = selected refs with name/text OR readables
ambiguous = visible ready refs not confidently classified
```

- [ ] **Step 5: Implement compact changed refs**

Use only meaningful latest transition evidence:

```ts
const latestGraphTransition = graphTransitions[graphTransitions.length - 1];
const hasMeaningfulTransition = Boolean(latestGraphTransition);
```

Priority order:

1. failed refs
2. recovery refs
3. goal-matching appeared refs
4. goal-matching weakened refs
5. other appeared refs
6. other weakened refs

Do not include all preserved refs. Report preserved count only.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\plannerWorkingSetSelector.test.ts tests\unit\v2\plannerInputComposer.test.ts
```

Expected: pass.

---

## Task 4: Recovery State Builder

**Files:**
- Create: `src/v2/runtime/RecoveryState.ts`
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerInputComposer.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Test: `tests/unit/v2/recoveryState.test.ts`
- Test: `tests/unit/v2/plannerInputComposer.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing recovery tests**

Create tests:

```ts
test('RecoveryStateBuilder detects wrong target type', () => {
  const recovery = new RecoveryStateBuilder().build({
    lastResult: {
      success: false,
      kind: 'type',
      targetRef: 'ref_search_button',
      error: { code: 'target_not_editable', message: 'not editable', retryable: false },
      traceStepId: 'step_1',
    },
    failures: [],
    uncertaintySignals: [],
  });

  assert.equal(recovery.state, 'wrong_target_type');
  assert.deepEqual(recovery.nextMechanisms.includes('choose_typeable_ref'), true);
});

test('RecoveryStateBuilder detects repeated read loop from uncertainty signals', () => {
  const recovery = new RecoveryStateBuilder().build({
    failures: [],
    uncertaintySignals: ['repeated_value_preview:search_page:global:3'],
  });

  assert.equal(recovery.state, 'zero_result_read_loop');
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\recoveryState.test.ts
```

Expected: fail because `RecoveryStateBuilder` does not exist.

- [ ] **Step 3: Implement recovery types**

In `types.ts`:

```ts
export type PlannerRecoveryStateKind =
  | 'none'
  | 'wrong_target_type'
  | 'same_action_loop'
  | 'zero_result_read_loop'
  | 'unselected_ref'
  | 'invalid_output_repeat'
  | 'max_step_risk';

export interface PlannerRecoveryState {
  state: PlannerRecoveryStateKind;
  severity: 'info' | 'warning' | 'critical';
  blockedAction?: {
    tool: string;
    ref?: string;
  };
  nextMechanisms: string[];
  signals: string[];
}
```

Add `recovery?: PlannerRecoveryState` to `PlannerInput`.

- [ ] **Step 4: Implement RecoveryStateBuilder**

Create a small deterministic builder:

```ts
export class RecoveryStateBuilder {
  build(input: RecoveryStateBuilderInput): PlannerRecoveryState | undefined {
    // target_not_editable/type or target_not_clickable/click => wrong_target_type
    // repeated_no_progress_transition => same_action_loop
    // repeated_value_preview/search_page => zero_result_read_loop
    // invalid planner output signal => invalid_output_repeat
    // otherwise undefined
  }
}
```

- [ ] **Step 5: Wire recovery into composer/loop**

Use runtime uncertainty signals and last failure evidence to build recovery before composing planner input. Pass the compact object into `PlannerInputComposer`.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\recoveryState.test.ts tests\unit\v2\plannerInputComposer.test.ts tests\unit\v2\v2AgentLoop.test.ts
```

Expected: pass.

---

## Task 5: Planner Validation and Prompt Updates

**Files:**
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`
- Test: `tests/unit/v2/plannerPrompt.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add tests:

```ts
test('V2PlannerClient rejects high-confidence type action against known non-typeable ref', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_wrong_lane');
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_submit'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: [],
    },
    changedRefs: { appearedCount: 0, weakenedCount: 0, preservedCount: 0, topRefs: [], omittedCount: 0 },
    failedRefs: [],
    regionSummaries: [],
    omitted: { observedRefCount: 1, selectedRefCount: 1, droppedRefCount: 0, droppedByReason: {} },
  };

  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"plan":[{"tool":"type","ref":"ref_submit","text":"hello"}],"confidence":"high"}',
      inputTokens: 1,
      outputTokens: 1,
    }),
  });

  await assert.rejects(() => client.call({ plannerInput }), /not compatible with tool "type"/);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2PlannerClient.test.ts tests\unit\v2\plannerPrompt.test.ts
```

Expected: fail because validation does not inspect action lanes.

- [ ] **Step 3: Extend validation context**

Add to `PlannerOutputValidationContext`:

```ts
actionSurface?: PlannerActionSurface;
```

Update `collectValidationContext` in `V2PlannerClient` to pass `input.workingSet?.actionSurface`.

- [ ] **Step 4: Enforce high-confidence compatibility**

Implement:

```ts
function validateToolCompatibility(tool, ref, context, errors) {
  if (!context.actionSurface || !ref) return;
  if (context.actionSurface.ambiguousRefs.includes(ref)) return;
  if (tool === 'type' && !context.actionSurface.typeableRefs.includes(ref)) {
    errors.push(`Step ${stepNumber} ref "${ref}" is not compatible with tool "type"`);
  }
  // same pattern for select/click
}
```

- [ ] **Step 5: Update prompt**

Add compact language:

```text
workingSet.actionSurface lists refs compatible with click/type/select/read operations. Prefer tool-compatible refs. If a needed ref is omitted or only mentioned in recovery state, gather evidence with search_page, inspect_region, scroll, or wait instead of inventing stale refs.
```

Also describe `recovery`:

```text
If recovery.state is not none, change strategy according to recovery.nextMechanisms. Do not repeat blockedAction unless the page changed strongly.
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2PlannerClient.test.ts tests\unit\v2\plannerPrompt.test.ts
```

Expected: pass.

---

## Task 6: Agent Loop Invalid Output Control

**Files:**
- Modify: `src/v2/planner/V2PlannerClient.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing agent-loop test**

Add a test where the planner client repeatedly throws `V2PlannerClientError` with validation errors. The agent loop should return:

```ts
assert.equal(result.success, false);
assert.match(result.failureReason ?? '', /planner_invalid_output_dead_end/);
```

- [ ] **Step 2: Implement controlled failure policy**

Keep `V2PlannerClient` retry behavior at two provider calls per planner turn. In `V2AgentLoop`, count consecutive planner validation failures. If threshold is reached, complete with:

```ts
failureReason: 'planner_invalid_output_dead_end'
```

Use a small threshold such as `1` planner-turn failure for now because each planner turn already includes the bounded retry.

- [ ] **Step 3: Run tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\v2\v2AgentLoop.test.ts tests\unit\v2\v2PlannerClient.test.ts
```

Expected: pass.

---

## Task 7: Verification and Smoke Readiness

**Files:**
- No source files unless tests expose an issue.

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
npx.cmd tsx --test tests\unit\providers.test.ts tests\unit\v2\v2PlannerClient.test.ts tests\unit\v2\inputServiceErrorMapping.test.ts tests\unit\v2\plannerWorkingSetSelector.test.ts tests\unit\v2\plannerInputComposer.test.ts tests\unit\v2\recoveryState.test.ts tests\unit\v2\v2AgentLoop.test.ts tests\unit\v2\plannerPrompt.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full unit suite**

Run:

```powershell
npm.cmd run test:unit
```

Expected: pass.

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: pass.

- [ ] **Step 4: Run V2 architecture checks**

Run:

```powershell
npm.cmd run check:v2
```

Expected: pass.

- [ ] **Step 5: Run diff hygiene**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Existing LF/CRLF warnings are acceptable if they are non-failing warnings.

- [ ] **Step 6: Optional 5-task smoke benchmark**

Only run if tests/build pass and a Gemini key pool is configured:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root C:\tmp\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 4 --key-index 6
```

Expected readiness signals:

- No V2 planner output using `sel`.
- Reduced max planner input, especially `workingSet.changedRefs`.
- Wrong-target failures classified as typed target errors.
- Repeated action markers reduced or accompanied by recovery state.
- Trace complete rate remains 100 percent.

Do not use smoke benchmark results to add site-specific changes. If a new failure appears, classify it as a general root cause before changing code.
