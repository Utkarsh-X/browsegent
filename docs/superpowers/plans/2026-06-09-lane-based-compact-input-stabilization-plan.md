# Lane-Based Compact Input Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the compact planner boundary so BrowseGent exposes the right actionable controls reliably before running more broad benchmarks.

**Architecture:** Keep Brain1, Brain2, ContinuityGraph, and compact planner mode. Simplify the planner-facing contract by separating typeable, clickable, selectable, and readable lanes, while preserving backward-compatible compact `actions` for the existing planner client during this phase. Do not add a new planner, website-specific logic, selectors, or benchmark-specific tuning.

**Tech Stack:** TypeScript, Node test runner, BrowseGent V2 planner/runtime, WebVoyager-lite MVR5-stable trace artifacts.

---

## Why This Phase Exists

The latest compact-enforced run `webvoyager_lite_1780918177110` failed 0/5, but the failure was diagnostic:

- Cambridge Dictionary had the correct visible ready typeable search input `v2ref_59`, but compact view truncated it out of the top action list.
- Google Maps exposed get-only readable place summaries as `a*` action indexes, and the model tried to click them.
- Two tasks failed from provider `fetch failed`; those should be tracked separately and not treated as architecture evidence.

This phase tests the core architectural hypothesis: BrowseGent's graph/substrate can work if the planner-facing compact state is simple, lane-correct, and action-compatible.

## Non-Goals

- Do not tune for Cambridge, Google Maps, WebVoyager answers, selectors, or URLs.
- Do not increase prompt size to hide ranking mistakes.
- Do not remove strict/manual/partial scoring.
- Do not run Browser Use comparison until Browsegent passes the stable slice more reliably.
- Do not commit unless the user explicitly asks.

## Files

- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPrompt.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPlanner.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerClient.ts`
- Modify: `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowInput.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowPlanner.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerClient.test.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`

---

## Task 1: Add Lane Model to Compact Planner View

**Purpose:** Preserve compactness while making actionability explicit.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`

- [ ] **Step 1: Write failing test for search input preservation**

Add this test to `D:\BrowseGent\tests\unit\v2\compactPlannerView.test.ts`:

```ts
test('buildCompactPlannerView preserves visible typeable search inputs ahead of distractors', () => {
  const distractors = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `ref_distractor_${index}`,
      { refId: `ref_distractor_${index}`, kind: 'button', role: 'button', name: `Dictionary distractor ${index}` },
    ]),
  );
  const input = {
    episodeId: 'episode_cambridge_failure',
    goal: 'Look up the pronunciation and definition of sustainability',
    current: {
      refs: {
        ...distractors,
        ref_search: {
          refId: 'ref_search',
          kind: 'input',
          role: 'textbox',
          name: 'Search',
          tagName: 'input',
          inputType: 'text',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
        },
      },
    },
    workingSet: {
      mode: 'act',
      primaryRefs: Object.values(distractors).slice(0, 32),
      secondaryRefs: [
        ...Object.values(distractors).slice(32),
        { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search', score: 315, reasons: ['form_candidate', 'role_relevant_to_goal', 'visible_ready'] },
      ],
      readableEvidence: [],
      actionSurface: {
        clickableRefs: Object.keys(distractors),
        typeableRefs: ['ref_search'],
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: [],
      },
    },
  };

  const view = buildCompactPlannerView(input as any, { maxActions: 24 });

  assert.equal(view.lanes.typeable.some(ref => ref.refId === 'ref_search'), true);
  assert.equal(view.actions.some(ref => ref.refId === 'ref_search'), true);
  assert.ok(view.actions.findIndex(ref => ref.refId === 'ref_search') < 8);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerView.test.ts
```

Expected: fails because `view.lanes` does not exist or `ref_search` is not promoted.

- [ ] **Step 3: Extend compact view types**

In `D:\BrowseGent\src\v2\planner\CompactPlannerView.ts`, add:

```ts
export interface CompactPlannerLanes {
  typeable: CompactActionRef[];
  clickable: CompactActionRef[];
  selectable: CompactActionRef[];
  readable: CompactReadRef[];
}
```

Add to `CompactPlannerView`:

```ts
lanes: CompactPlannerLanes;
```

- [ ] **Step 4: Build lanes from `workingSet.actionSurface`**

Implement lane construction in `buildCompactPlannerView()`:

```ts
const rankedActionRefs = [
  ...(workingSet?.primaryRefs ?? []),
  ...(workingSet?.secondaryRefs ?? []),
];

const typeableLane = buildActionLane(rankedActionRefs, currentRefs, toolByRef, 'typeable', maxActions);
const clickableLane = buildActionLane(rankedActionRefs, currentRefs, toolByRef, 'clickable', maxActions);
const selectableLane = buildActionLane(rankedActionRefs, currentRefs, toolByRef, 'selectable', maxActions);
const readableLane = buildReadableLane(workingSet?.readableEvidence ?? [], maxReads);
```

Add helpers:

```ts
function buildActionLane(
  refs: any[],
  currentRefs: Record<string, any>,
  toolByRef: Map<string, string[]>,
  requiredTool: string,
  maxRefs: number,
): CompactActionRef[] {
  return refs
    .filter(ref => (toolByRef.get(ref.refId) ?? []).includes(requiredTool))
    .slice(0, maxRefs)
    .map((ref, index) => toCompactAction(index + 1, ref, currentRefs[ref.refId], toolByRef.get(ref.refId) ?? []));
}

function buildReadableLane(refs: any[], maxRefs: number): CompactReadRef[] {
  return refs
    .slice(0, maxRefs)
    .map((ref, index) => ({
      id: index + 1,
      refId: ref.refId,
      text: compactText(ref.text ?? '', 220),
    }));
}
```

- [ ] **Step 5: Compose backward-compatible `actions` from lanes**

Use the lanes to build `actions`, with typeable first for search/form goals:

```ts
const laneOrderedActions = orderCompactActionsForGoal(input.goal ?? '', {
  typeable: typeableLane,
  clickable: clickableLane,
  selectable: selectableLane,
  readable: readableLane,
});
const actions = uniqueCompactActions(laneOrderedActions).slice(0, maxActions);
```

Add helpers:

```ts
function orderCompactActionsForGoal(goal: string, lanes: CompactPlannerLanes): CompactActionRef[] {
  const searchGoal = /(search|find|look up|lookup|query|pronunciation|definition)/i.test(goal);
  if (searchGoal) {
    return [...lanes.typeable, ...lanes.clickable, ...lanes.selectable];
  }
  return [...lanes.clickable, ...lanes.typeable, ...lanes.selectable];
}

function uniqueCompactActions(refs: CompactActionRef[]): CompactActionRef[] {
  const seen = new Set<string>();
  const unique: CompactActionRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.refId)) continue;
    seen.add(ref.refId);
    unique.push(ref);
  }
  return unique;
}
```

- [ ] **Step 6: Run compact view test and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerView.test.ts
```

Expected: all compact planner view tests pass.

---

## Task 2: Stop Exposing Readable-Only Refs as Action Indexes

**Purpose:** Prevent get-only evidence from being presented as `a*` action candidates.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowInput.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowInput.test.ts`

- [ ] **Step 1: Write failing test for get-only action exclusion**

Add this test:

```ts
test('buildCompactShadowInput excludes get-only action entries from action indexes', () => {
  const view: CompactPlannerView = {
    version: 'compact_planner_view.v1',
    goal: 'Read place details',
    actions: [
      { id: 1, refId: 'ref_readonly', label: 'Castle Mountains National Monument details', tools: ['readable'] },
      { id: 2, refId: 'ref_button', label: 'Search', tools: ['clickable'] },
    ],
    reads: [
      { id: 1, refId: 'ref_readonly', text: 'Castle Mountains National Monument 4.4 National reserve Open 24 hours' },
    ],
    lanes: {
      typeable: [],
      clickable: [{ id: 2, refId: 'ref_button', label: 'Search', tools: ['clickable'] }],
      selectable: [],
      readable: [{ id: 1, refId: 'ref_readonly', text: 'Castle Mountains National Monument 4.4 National reserve Open 24 hours' }],
    },
    omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 },
  };

  const { input, indexToRef, refToIndex } = buildCompactShadowInput(view);

  assert.deepEqual(input.actions.map(action => action.index), ['a1']);
  assert.equal(indexToRef.a1, 'ref_button');
  assert.equal(input.reads[0].index, 'r1');
  assert.equal(indexToRef.r1, 'ref_readonly');
  assert.equal(refToIndex.ref_readonly, 'r1');
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts
```

Expected: fails because `ref_readonly` is still assigned an action index.

- [ ] **Step 3: Filter action entries with no mutation tool**

In `buildCompactShadowInput()`, skip actions whose mapped tools contain no `click`, `type`, or `select`:

```ts
const mappedTools = mapTools(action.tools);
const hasActionTool = mappedTools.some(tool => tool === 'click' || tool === 'type' || tool === 'select');
if (!hasActionTool) {
  continue;
}
```

Use `mappedTools` when pushing `actionsInput`.

- [ ] **Step 4: Preserve readable-only refs in reads**

When processing reads, do not skip a readable ref unless it already has a real action index:

```ts
if (actionRefs.has(refId)) {
  continue;
}
```

Here `actionRefs` must only contain refs that survived the action-tool filter.

- [ ] **Step 5: Run compact shadow input tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowInput.test.ts
```

Expected: all pass.

---

## Task 3: Make Compact Prompt Explain Lanes and Tool Compatibility

**Purpose:** Reduce invalid planner outputs without increasing state payload size.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPrompt.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactShadowPrompt.test.ts`

- [ ] **Step 1: Write failing prompt test**

Add:

```ts
test('compact shadow prompt tells planner not to use read-only refs for mutation tools', () => {
  const prompt = buildCompactShadowSystemPrompt();
  assert.match(prompt, /Only use indexes whose tools include the requested tool/i);
  assert.match(prompt, /Do not click, type, or select read-only evidence/i);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPrompt.test.ts
```

Expected: fails because prompt lacks the exact compatibility instruction.

- [ ] **Step 3: Add minimal compatibility text**

In `buildCompactShadowSystemPrompt()`, add:

```text
Only use indexes whose tools include the requested tool. Do not click, type, or select read-only evidence. If the needed action target is not present, use wait, scroll, search_page, or escalate dead_end with a short reason.
```

- [ ] **Step 4: Run prompt test**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactShadowPrompt.test.ts
```

Expected: pass.

---

## Task 4: Add One Recoverable Compatibility Retry in Compact Planner Client

**Purpose:** Avoid terminating immediately when the model chooses a visible but wrong-lane compact index.

**Files:**

- Modify: `D:\BrowseGent\src\v2\planner\CompactPlannerClient.ts`
- Modify: `D:\BrowseGent\src\v2\planner\CompactShadowPlanner.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\compactPlannerClient.test.ts`

- [ ] **Step 1: Write failing retry test**

Add:

```ts
test('CompactPlannerClient retries once when first compact output fails action compatibility', async () => {
  const calls: string[] = [];
  const client = new CompactPlannerClient({
    provider: async (_system, user) => {
      calls.push(user);
      if (calls.length === 1) {
        return {
          text: JSON.stringify({ plan: [{ tool: 'click', ref: 'a1' }], confidence: 'high' }),
          inputTokens: 10,
          outputTokens: 5,
        };
      }
      return {
        text: JSON.stringify({ plan: [{ tool: 'type', ref: 'a2', text: 'sustainability' }], confidence: 'high' }),
        inputTokens: 11,
        outputTokens: 6,
      };
    },
  });

  const plannerInput = {
    ...mockPlannerInput,
    goal: 'Look up sustainability',
    current: {
      ...mockPlannerInput.current,
      refs: {
        ref_readonly: { refId: 'ref_readonly', kind: 'generic', name: 'Read only text' },
        ref_search: { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search' },
      },
    },
    workingSet: {
      ...mockPlannerInput.workingSet!,
      primaryRefs: [
        { refId: 'ref_readonly', kind: 'generic', name: 'Read only text', score: 100, reasons: ['visible_ready'] },
        { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search', score: 90, reasons: ['form_candidate'] },
      ],
      secondaryRefs: [],
      readableEvidence: [{ refId: 'ref_readonly', text: 'Read only text' }],
      actionSurface: {
        clickableRefs: [],
        typeableRefs: ['ref_search'],
        selectableRefs: [],
        readableRefs: ['ref_readonly'],
        ambiguousRefs: [],
      },
    },
  } as any;

  const result = await client.call({ plannerInput, model: 'mock-model' });

  assert.equal(calls.length, 2);
  assert.deepEqual(result.output.plan, [{ tool: 'type', ref: 'ref_search', text: 'sustainability' }]);
  assert.equal(result.inputTokens, 21);
  assert.equal(result.outputTokens, 11);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerClient.test.ts
```

Expected: fails because `CompactPlannerClient` currently throws after first invalid output.

- [ ] **Step 3: Return machine-readable invalid reason**

In `CompactShadowPlanner.ts`, keep existing result shape but ensure action-compatibility validation errors include the validation text in `errors`.

No new enum is required. Use this helper in `CompactPlannerClient.ts`:

```ts
function isRecoverableCompatibilityError(errors: readonly string[]): boolean {
  return errors.some(error => /not compatible with tool|read-only|action compatibility/i.test(error));
}
```

- [ ] **Step 4: Add one retry with compatibility feedback**

In `CompactPlannerClient.call()`, when result is `invalid_output` and `isRecoverableCompatibilityError(result.errors)` is true:

```ts
const retryInput = {
  ...compactInput,
  recovery: {
    ...(compactInput.recovery ?? {}),
    compactValidation: {
      previousErrors: result.errors.slice(0, 3),
      instruction: 'Choose an index whose tools include the requested tool. Prefer typeable lane for typing and readable lane only for get/inspect_region.',
    },
  },
};
```

Call `callCompactShadowPlanner()` once more with `retryInput`. Sum both attempts' token and duration metrics.

- [ ] **Step 5: Keep non-compatibility invalid outputs terminal**

Add or preserve test:

```ts
test('CompactPlannerClient does not retry unknown compact index errors', async () => {
  let calls = 0;
  const client = new CompactPlannerClient({
    provider: async () => {
      calls += 1;
      return {
        text: JSON.stringify({ plan: [{ tool: 'click', ref: 'a99' }], confidence: 'high' }),
        inputTokens: 10,
        outputTokens: 5,
      };
    },
  });

  await assert.rejects(() => client.call({ plannerInput: mockPlannerInput, model: 'mock-model' }));
  assert.equal(calls, 1);
});
```

- [ ] **Step 6: Run compact planner client tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerClient.test.ts
```

Expected: pass.

---

## Task 5: Keep V2 Agent Loop Classification Honest

**Purpose:** Preserve failure taxonomy after compact compatibility retry.

**Files:**

- Modify: `D:\BrowseGent\src\v2\agent\V2AgentLoop.ts`
- Modify: `D:\BrowseGent\tests\unit\v2\v2AgentLoop.test.ts`

- [ ] **Step 1: Add test for provider error separation**

Add:

```ts
test('V2AgentLoop keeps compact provider errors separate from invalid planner output', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: {
      async call() {
        throw Object.assign(new Error('fetch failed'), {
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 1,
        });
      },
    },
  });

  const result = await loop.run({
    url: 'https://example.test',
    goal: 'Search for something',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_client_error:fetch failed');
});
```

- [ ] **Step 2: Run test**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/v2AgentLoop.test.ts
```

Expected: pass if current behavior already separates provider errors. If it fails, fix only the classification branch in `V2AgentLoop`.

---

## Task 6: Verification and One Controlled Benchmark

**Purpose:** Verify the architectural correction without overfitting or broad benchmark churn.

- [ ] **Step 1: Run focused tests**

```powershell
npx.cmd tsx --test tests/unit/v2/compactPlannerView.test.ts tests/unit/v2/compactShadowInput.test.ts tests/unit/v2/compactShadowPrompt.test.ts tests/unit/v2/compactShadowPlanner.test.ts tests/unit/v2/compactPlannerClient.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full static/runtime checks**

```powershell
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:v2
```

Expected: all pass.

- [ ] **Step 3: Run one Browsegent MVR5-stable compact-enforced benchmark**

Use a fresh key index after the recent runs:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browsegent --request-rpm 8 --key-index 6 --planner-mode compact_enforced
```

Expected interpretation:

- If Cambridge still fails because the search input is absent from compact input, the lane fix is incomplete.
- If Cambridge reaches typing/search but fails later, move to observation/recovery analysis.
- If Google Maps still tries to click get-only evidence, the action/read separation is incomplete.
- If failures are provider `fetch failed`, rerun only those affected tasks with a fresh key before drawing architecture conclusions.

- [ ] **Step 4: Do not run Browser Use yet unless Browsegent stable slice improves**

Only after Browsegent shows repeatable improvement, run Browser Use with the user's preferred key sequence:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5-stable --adapter browser-use-local --request-rpm 8 --key-index 1
```

### Start from index 1 then for each new run increment and use index5 index like after 6 go to 11 then 16 then 21 since there are five task per benchmark run.
---

## Success Gate

This phase is successful only if:

- visible ready typeable search controls are guaranteed into compact action candidates for search-like goals;
- get-only evidence is never exposed as a mutation action index;
- first-step compatibility mismatch gets one controlled retry;
- provider failures remain separate from planner/action failures;
- focused and full unit checks pass;
- one MVR5-stable run shows no recurrence of the Cambridge candidate-loss failure or Google Maps get-only-click failure.

It is not successful merely because token counts are low.

## Self-Review

- Spec coverage: covers compact candidate loss, readable/action separation, brittle invalid-output termination, provider error separation, and controlled benchmark verification.
- Unfinished-marker scan: no unfinished markers are intentionally left.
- Scope check: intentionally excludes broad benchmark expansion, Browser Use reruns, prompt overhauls, and new architecture layers.
- Type consistency: uses existing `CompactPlannerView`, `CompactShadowInput`, `CompactPlannerClient`, and `V2AgentLoop` names.
