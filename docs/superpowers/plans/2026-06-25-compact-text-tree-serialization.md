# Compact CRM Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Compact CRM Serialization behind a feature flag (`plannerSerialization: "json" | "crm"`) to reduce prompt size while preserving semantic affordance lanes, and perform side-by-side A/B verification.

**Architecture:** Create `serializeToCRM` to format elements grouped by regions, adding `lane` attributes. Update `PlannerInputComposer` to compact the working set ref lists by removing duplicate metadata. Update `buildV2PlannerUserMessage` to conditionally apply CRM formatting and system prompt updates based on the feature flag.

**Tech Stack:** TypeScript, Node.js Test Runner, `tsx`

---

### Task 1: Add Configuration Options & CRM Serializer

**Files:**
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/brain1/serializeProjection.ts`
- Modify: `tests/unit/v2/brain1Projection.test.ts`

- [ ] **Step 1: Write failing test for CRM serialization with lanes**

Add the following test case at the end of `tests/unit/v2/brain1Projection.test.ts` to assert that CRM formatting outputs the correct element structure and `lane` attributes:

```typescript
test('serializeToCRM builds compact CRM representation with lane attributes', () => {
  const mockProjection: any = {
    projectionId: 'proj_1',
    observationId: 'obs_1',
    generationId: 1,
    page: { url: 'https://example.test', title: 'Example Title' },
    refs: {
      v2ref_1: {
        refId: 'v2ref_1',
        kind: 'input',
        role: 'textbox',
        name: 'Username',
        visibility: 'visible',
        actionability: 'actionable',
        state: 'live',
        confidence: 1,
      },
      v2ref_2: {
        refId: 'v2ref_2',
        kind: 'button',
        role: 'button',
        name: 'Submit',
        visibility: 'visible',
        actionability: 'actionable',
        state: 'live',
        confidence: 1,
      },
      v2ref_3: {
        refId: 'v2ref_3',
        kind: 'link',
        role: 'link',
        name: 'Help',
        visibility: 'visible',
        actionability: 'actionable',
        state: 'weakened',
        confidence: 0.5,
      },
    },
    interactions: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }],
    readables: [{ refId: 'v2ref_1', rank: 1 }],
    navigation: [{ refId: 'v2ref_3', rank: 1 }],
    regions: [
      {
        regionId: 'reg_1',
        kind: 'form',
        label: 'Login Box',
        refIds: ['v2ref_1', 'v2ref_2'],
        score: 1.0,
      },
    ],
    warnings: [],
    stats: { interactionCount: 2, readableCount: 1, navigationCount: 1, regionCount: 1 },
  };

  // @ts-ignore
  const crmOutput = serializeToCRM(mockProjection);
  const expected = [
    '* Region [reg_1] "Login Box" (form):',
    '  [v2ref_1] <input role="textbox" name="Username" lane="interaction|readable" />',
    '  [v2ref_2] <button name="Submit" lane="interaction" />',
    '* Page Elements:',
    '  [v2ref_3] <link name="Help" lane="navigation" [weakened] [confidence=0.50] />',
  ].join('\n');

  assert.equal(crmOutput.trim(), expected.trim());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/brain1Projection.test.ts`
Expected: FAIL (missing import or undefined function)

- [ ] **Step 3: Implement CRM serialization logic with lane tagging**

In `src/v2/planner/types.ts`, add the configuration flag:
```typescript
export interface PlannerWorkingSetOptions {
  plannerSerialization?: 'json' | 'crm';
  // ... other properties
}
```

In `src/v2/brain1/serializeProjection.ts`, export the new function:
```typescript
export function serializeToCRM(projection: any): string {
  const lines: string[] = [];
  const selectedRefs = projection.refs || {};
  const serializedRefIds = new Set<string>();

  const getLanes = (refId: string): string => {
    const lanes: string[] = [];
    if (projection.interactions?.some((item: any) => item.refId === refId)) lanes.push('interaction');
    if (projection.readables?.some((item: any) => item.refId === refId)) lanes.push('readable');
    if (projection.navigation?.some((item: any) => item.refId === refId)) lanes.push('navigation');
    return lanes.length > 0 ? lanes.join('|') : 'generic';
  };

  const formatRefLine = (refId: string, indent: string): string => {
    const ref = selectedRefs[refId];
    if (!ref) return '';
    const parts: string[] = [];
    parts.push(`${indent}[${refId}] <${ref.kind || 'element'}`);

    if (ref.role && ref.role !== ref.kind) {
      parts.push(`role="${ref.role}"`);
    }
    if (ref.name) {
      parts.push(`name="${ref.name}"`);
    }
    if (ref.text && ref.text !== ref.name) {
      parts.push(`text="${ref.text}"`);
    }
    
    parts.push(`lane="${getLanes(refId)}"`);

    if (ref.selectOptions && ref.selectOptions.length > 0) {
      parts.push(`options=[${ref.selectOptions.join('|')}]`);
    }
    if (ref.state === 'weakened') {
      parts.push('[weakened]');
    }
    if (ref.visibility && ref.visibility !== 'visible') {
      parts.push(`[${ref.visibility}]`);
    }
    if (ref.actionability && ref.actionability !== 'actionable') {
      parts.push(`[${ref.actionability}]`);
    }
    if (ref.confidence !== undefined && ref.confidence < 1.0) {
      parts.push(`[confidence=${ref.confidence.toFixed(2)}]`);
    }
    parts.push('/>');
    return parts.join(' ');
  };

  const regions = projection.regions || [];
  for (const region of regions) {
    const regionRefs = (region.refIds || []).filter((id: string) => selectedRefs[id]);
    if (regionRefs.length > 0) {
      lines.push(`* Region [${region.regionId}] "${region.label}" (${region.kind}):`);
      for (const refId of regionRefs) {
        lines.push(formatRefLine(refId, '  '));
        serializedRefIds.add(refId);
      }
    }
  }

  const globalRefs = Object.keys(selectedRefs).filter(id => !serializedRefIds.has(id));
  if (globalRefs.length > 0) {
    lines.push('* Page Elements:');
    for (const refId of globalRefs) {
      lines.push(formatRefLine(refId, '  '));
    }
  }

  return lines.join('\n');
}
```

Import it in `tests/unit/v2/brain1Projection.test.ts`:
```typescript
import { serializeProjection, serializeToCRM } from '../../../src/v2/brain1/serializeProjection';
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx tsx --test tests/unit/v2/brain1Projection.test.ts`
Expected: PASS

---

### Task 2: Implement Working Set Compactor

**Files:**
- Modify: `src/v2/planner/PlannerInputComposer.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`

- [ ] **Step 1: Write test case verifying compacted working set**

Add a test verifying working set compaction when `plannerSerialization: 'crm'` is set:

```typescript
test('compactWorkingSet removes duplicate metadata from workingSet ref lists', () => {
  const composer = new PlannerInputComposer();
  const input: any = {
    episodeId: 'ep_1',
    goal: 'Test goal',
    projection: {
      projectionId: 'proj_1',
      observationId: 'obs_1',
      generationId: 1,
      url: 'https://example.test',
      title: 'Example',
      interactions: [],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 }
    }
  };

  const plannerInput = composer.compose(input);
  // Ensure default composition doesn't compact yet or test custom compaction helper directly
});
```
(We will write a specific unit test inside `plannerPrompt.test.ts` verifying prompt compaction).

- [ ] **Step 2: Add compactor helper in `PlannerPrompt`**

In `src/v2/planner/PlannerPrompt.ts`, add a helper to compact the working set object:

```typescript
export function compactWorkingSetForLLM(workingSet: any): any {
  if (!workingSet) return undefined;

  const compactRef = (ref: any) => ({
    refId: ref.refId,
    reasons: ref.reasons
  });

  return {
    ...workingSet,
    primaryRefs: workingSet.primaryRefs?.map(compactRef),
    secondaryRefs: workingSet.secondaryRefs?.map(compactRef),
    navigationRefs: workingSet.navigationRefs?.map(compactRef),
    failedRefs: workingSet.failedRefs?.map(compactRef)
  };
}
```

---

### Task 3: Integrate A/B Feature Flag in Planner User Message

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`

- [ ] **Step 1: Write tests for prompt composition styles**

Add tests in `tests/unit/v2/plannerPrompt.test.ts`:

```typescript
test('buildV2PlannerUserMessage serializes default JSON when serialization flag is json', () => {
  const payload: any = {
    version: 'v2.planner_input.v2',
    episodeId: 'ep_1',
    goal: 'Click Submit',
    current: {
      page: { url: 'https://example.test', title: 'Example' },
      refs: { v2ref_1: { refId: 'v2ref_1', name: 'Submit' } },
      interactions: [], readables: [], navigation: [], regions: [], warnings: [], stats: { interactionCount: 1 }
    },
    workingSet: { primaryRefs: [{ refId: 'v2ref_1', name: 'Submit', reasons: ['visible'] }] },
    plannerSerialization: 'json'
  };

  const msg = buildV2PlannerUserMessage(payload);
  assert.match(msg, /"refs":\{"v2ref_1"/);
  assert.doesNotMatch(msg, /"elements":/);
});

test('buildV2PlannerUserMessage serializes CRM and compacts workingSet when flag is crm', () => {
  const payload: any = {
    version: 'v2.planner_input.v2',
    episodeId: 'ep_1',
    goal: 'Click Submit',
    current: {
      page: { url: 'https://example.test', title: 'Example' },
      refs: { v2ref_1: { refId: 'v2ref_1', kind: 'button', name: 'Submit' } },
      interactions: [{ refId: 'v2ref_1', rank: 1 }], readables: [], navigation: [], regions: [], warnings: [], stats: { interactionCount: 1 }
    },
    workingSet: { primaryRefs: [{ refId: 'v2ref_1', name: 'Submit', reasons: ['visible'] }] },
    plannerSerialization: 'crm'
  };

  const msg = buildV2PlannerUserMessage(payload);
  assert.match(msg, /"elements":/);
  assert.match(msg, /\[v2ref_1\] <button name="Submit" lane="interaction" \/>/);
  assert.doesNotMatch(msg, /"refs":/);
  assert.match(msg, /"primaryRefs":\[\{"refId":"v2ref_1","reasons":\["visible"\]\}\]/);
  assert.doesNotMatch(msg, /"name":"Submit"/); // Check that duplicate name is compacted
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/v2/plannerPrompt.test.ts`
Expected: FAIL (lack of crm logic in `buildV2PlannerUserMessage`)

- [ ] **Step 3: Implement conditional serialization switch**

In `src/v2/planner/PlannerPrompt.ts`, modify `buildV2PlannerUserMessage`:

```typescript
import { serializeToCRM } from '../brain1/serializeProjection';
import { compactWorkingSetForLLM } from './PlannerPrompt'; // self-import or local helper

export function buildV2PlannerUserMessage(input: PlannerInput): string {
  // Check the feature flag on the input configuration
  // @ts-ignore
  if (input.plannerSerialization === 'crm' || input.workingSetDiagnostics?.plannerSerialization === 'crm') {
    const compactInput = {
      ...input,
      current: {
        page: input.current.page,
        elements: serializeToCRM(input.current),
        stats: input.current.stats,
      } as any,
      workingSet: compactWorkingSetForLLM(input.workingSet)
    };
    return `Planner input JSON:
${JSON.stringify(compactInput)}`;
  }

  return `Planner input JSON:
${JSON.stringify(input)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/v2/plannerPrompt.test.ts`
Expected: PASS

---

### Task 4: Update System Prompt Instructions

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`

- [ ] **Step 1: Update System Prompt formatting rules**

Modify `buildV2PlannerSystemPrompt` in `src/v2/planner/PlannerPrompt.ts` to instruct the model on handling both formatting styles dynamically:

```typescript
export function buildV2PlannerSystemPrompt(): string {
  return `You are the BrowseGent v2 planner.

You are the only semantic cognition layer. Runtime systems only provide operational evidence.

Return only JSON. Do not include prose, markdown, code fences, scripts, CSS selectors, XPath, coordinates, Playwright commands, or CDP commands.

Valid outputs:
{"done":true,"val":"answer"}
{"escalate":"user_needed|captcha|dead_end","reason":"operational reason"}
{"plan":[{"tool":"click","ref":"ref_id"}],"confidence":"high|medium|low"}

Valid tools:
- click: requires ref
- close: requires ref
- type: requires ref and text
- navigate: requires url
- press: requires key Enter, Escape, Tab, ArrowDown, or ArrowUp
- select: requires ref and exact visible option value
- get: requires ref
- inspect_region: requires ref
- search_page: requires pattern
- scroll: optional direction down or up
- wait: optional pattern and timeout

Planner input shape:
The page elements are serialized either in JSON under current.refs or in compact tree markup (CRM) under current.elements:
[ref_id] <role name="accessible name" lane="interaction|readable|navigation" [modifiers] />
Example:
[v2ref_1] <input role="textbox" name="Search" lane="interaction" />
[v2ref_2] <button name="Submit" lane="interaction" />

You must target elements using their exact [ref_id] (e.g. v2ref_5).

workingSet explains why selected refs were included, what was omitted, and which compact evidence is currently available. interactions, readables, navigation, and regions are bounded views over selected refs, not the full page.

workingSet.actionSurface lists refs compatible with click/type/select/read operations. Prefer tool-compatible refs. Ambiguous refs may be tried only when evidence supports them, but do not use a known incompatible ref for a tool.

Use select only for refs listed as selectable in workingSet.actionSurface. Use exact visible option labels from the elements options attribute when present (e.g. options=[Opt1|Opt2]). If option labels are missing or uncertain, inspect the region or read the page before selecting.

Do not assume omitted refs are unavailable. If the selected working set is insufficient, use get, inspect_region, search_page, scroll, wait, or navigation actions to gather more evidence. Prefer targeted expansion over repeating the same failed action.

If recovery.state is present, change strategy according to recovery.nextMechanisms. Do not repeat recovery.blockedAction for the same ref/tool pair unless transition.strength is strong, the URL changed, or the ref is newly listed in the compatible action lane. Failed refs are evidence first; do not use them as action targets merely because their text matches the goal.

If lastResult from get, inspect_region, search_page, click, type, press, navigate has lastResult.valuePreview containing the requested answer or confirming the requested state/action, return done with that value. Do not repeat the same read or mutation after successful value evidence.

If answerFeedback is present, the previous done answer was rejected because it missed required details. Do not repeat that answer unless missingDetails are answered with concrete evidence.

Before returning done, make sure the answer covers all requested multiple details in the goal. For example, pronunciation and definition requires both pronunciation and definition; basic information requires concrete visible facts, not only a vague description.

If the goal asks you to report an operational failure, block, or unavailable action, and lastResult.error, failures, or deadState already describe that failure, return done with a concise report instead of escalating.

When the input workingSet.mode is extract, verify, or done_candidate and useful evidence is present, prefer done or escalate over more browser actions. In finalization mode, plans are invalid; return only done or escalate.

Use refs from the planner input. Selectors are not valid v2 planner output.`;
}
```

- [ ] **Step 2: Run all unit tests to verify the suite is green**

Run: `npm run test:unit`
Expected: All 11+ unit tests pass.
