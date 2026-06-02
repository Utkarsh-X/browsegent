# Ref Identity Step Execution Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BrowseGent V2 execute refs against the intended live element, classify actions from DOM facts, continue only safe mini-plan steps, and report planner/provider/runtime failures honestly.

**Architecture:** Keep the Brain1/Brain2/graph architecture and harden the runtime contracts underneath it. Observation captures substrate-only identity and DOM facts, Brain1 projects capability-aware refs, the planner receives ref-only action lanes, and execution resolves one verified target before any click/type/select/press.

**Tech Stack:** TypeScript, Node test runner, Playwright, Chrome DevTools Protocol through the existing `CdpBridge`, BrowseGent V2 runtime modules.

---

## Scope Check

This plan covers one coupled runtime contract: observed refs -> Brain1 projection -> planner action lanes -> tool dispatch -> substrate execution. The slices are staged so each one is independently testable, but splitting them into separate feature branches would create false seams because each slice depends on shared `V2Ref` and `ProjectionItem` contracts.

This plan does not add website-specific logic, WebVoyager-specific prompts, stealth/captcha work, screenshot reasoning, or full benchmark tuning. The MVR5 benchmark is only a final smoke signal after synthetic tests pass.

Because the user explicitly asked to avoid unnecessary git work, this plan omits mandatory commit steps. If a checkpoint is needed, ask before staging or committing.

## File Map

### Core Runtime Contracts

- Modify `src/v2/runtime/types.ts`: add DOM facts and capability fields to `V2Ref`, `V2ToolResult`, and related public runtime types.
- Modify `src/v2/runtime/errors.ts`: add `target_not_selectable` and `ambiguous_ref_resolution`.
- Create `src/v2/runtime/refCapabilities.ts`: derive click/type/select/read capabilities from DOM facts.
- Modify `src/v2/runtime/refFingerprint.ts`: include `tagName`, `inputType`, and `editableKind` in hard/soft fingerprints.

### Observation and Substrate

- Modify `src/v2/substrate/types.ts`: add captured DOM facts, `backendNodeId`, `frameId`, `nthRoleName`, and capability evidence.
- Modify `src/v2/substrate/ObservationService.ts`: collect normalized DOM facts and populate backend node ids through a bounded CDP identity pass.
- Reuse `src/v2/substrate/CdpBridge.ts` unchanged as the CDP session boundary.
- Create `src/v2/substrate/RefResolver.ts`: resolve a `V2Ref` to one verified Playwright `Locator`.
- Modify `src/v2/substrate/InputService.ts`: replace blind `page.locator(selector).first()` with `RefResolver`, enforce action-specific errors, and preserve real Playwright interactions.
- Create `src/v2/substrate/KeyboardService.ts`: execute bounded keyboard actions.

### Brain1 and Planner Surface

- Modify `src/v2/brain1/projectionTypes.ts`: carry capability facts on `ProjectionItem` without exposing raw selectors or backend ids.
- Modify `src/v2/brain1/rankOperationalItems.ts`: infer kind from DOM facts/capabilities, not selector text.
- Modify `src/v2/brain1/ProjectionService.ts`: pass through capability-aware projection items.
- Modify `src/v2/planner/PlannerWorkingSetSelector.ts`: build action lanes from capability flags.
- Modify `src/v2/planner/types.ts`: add bounded `press` tool and key enum.
- Modify `src/v2/planner/PlannerOutputSchema.ts`: validate `press` and reject unsupported keys.
- Modify `src/v2/planner/V2PlannerResponseSchema.ts`: expose `press` to provider schema.
- Modify `src/v2/planner/PlannerPrompt.ts`: minimally describe `press` as explicit keyboard submission/navigation.

### Agent Loop and Harness

- Modify `src/v2/agent/V2AgentLoop.ts`: split provider errors from invalid planner output, validate queued mini-plan refs against fresh observations, and stop/continue with explicit transition rules.
- Modify `src/v2/tools/types.ts`: add `press(key)` to `V2ToolRuntime`.
- Modify `src/v2/tools/V2ToolDispatcher.ts`: dispatch bounded `press`.
- Modify `src/v2/harness/BrowseGentV2Harness.ts`: wire `KeyboardService`, trace `press`, and map `target_not_selectable` / `ambiguous_ref_resolution`.

### Tests and Fixtures

- Create `tests/unit/v2/refCapabilities.test.ts`.
- Modify `tests/unit/v2/runtimeContracts.test.ts`.
- Modify `tests/unit/v2/refFingerprint.test.ts`.
- Modify `tests/unit/v2/brain1Projection.test.ts`.
- Modify `tests/unit/v2/plannerWorkingSetSelector.test.ts`.
- Modify `tests/unit/v2/plannerOutputSchema.test.ts`.
- Modify `tests/unit/v2/plannerPrompt.test.ts`.
- Modify `tests/unit/v2/toolDispatcher.test.ts`.
- Modify `tests/unit/v2/inputServiceErrorMapping.test.ts`.
- Modify `tests/unit/v2/v2AgentLoop.test.ts`.
- Modify `tests/integration/v2/mvrRuntime.test.ts`.
- Create `tests/fixtures/v2/ambiguous-buttons.html`.
- Create `tests/fixtures/v2/search-combobox.html`.
- Create `tests/fixtures/v2/keyboard-submit.html`.

## Task 1: Failure Classification Cleanup

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Modify: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing test for provider errors that contain an `errors` array**

Add this test near the existing planner failure tests in `tests/unit/v2/v2AgentLoop.test.ts`:

```ts
test('V2AgentLoop does not classify provider errors with errors arrays as invalid planner output', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: {
      call: async () => {
        throw Object.assign(new Error('fetch failed'), {
          errors: ['network socket closed'],
          inputTokens: 11,
          outputTokens: 0,
          durationMs: 19,
        });
      },
    },
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_client_error:fetch failed');
  assert.equal(result.metrics.inputTokens, 11);
  assert.equal(result.metrics.outputTokens, 0);
  assert.equal(result.metrics.plannerDurationMs, 19);
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts
```

Expected before implementation: the new test fails because `isPlannerInvalidOutputError()` treats any `errors[]` as invalid planner output.

- [ ] **Step 3: Narrow invalid planner-output detection**

In `src/v2/agent/V2AgentLoop.ts`, replace `isPlannerInvalidOutputError()` with:

```ts
function isPlannerInvalidOutputError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { message?: unknown; name?: unknown; code?: unknown };
  if (candidate.code === 'PLANNER_INVALID_OUTPUT') {
    return true;
  }

  if (candidate.name === 'PlannerInvalidOutputError') {
    return true;
  }

  return typeof candidate.message === 'string'
    && candidate.message.includes('Planner output invalid after retry');
}
```

Do not treat a generic `errors` array as planner invalid output. Provider SDKs and network libraries often attach `errors[]`.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all `v2AgentLoop` tests pass.

## Task 2: DOM Facts and Capability Contract

**Files:**
- Create: `src/v2/runtime/refCapabilities.ts`
- Modify: `src/v2/runtime/types.ts`
- Modify: `src/v2/substrate/types.ts`
- Modify: `src/v2/substrate/ObservationService.ts`
- Modify: `src/v2/brain1/projectionTypes.ts`
- Modify: `src/v2/brain1/rankOperationalItems.ts`
- Modify: `src/v2/planner/PlannerWorkingSetSelector.ts`
- Create: `tests/unit/v2/refCapabilities.test.ts`
- Modify: `tests/unit/v2/brain1Projection.test.ts`
- Modify: `tests/unit/v2/plannerWorkingSetSelector.test.ts`
- Modify: `tests/integration/v2/mvrRuntime.test.ts`
- Create: `tests/fixtures/v2/search-combobox.html`

- [ ] **Step 1: Add failing capability tests**

Create `tests/unit/v2/refCapabilities.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveRefCapabilities } from '../../../src/v2/runtime/refCapabilities';
import type { V2Ref } from '../../../src/v2/runtime/types';

function makeRef(overrides: Partial<V2Ref>): V2Ref {
  return {
    refId: 'ref_test',
    generationId: 1,
    targetId: 'target_test',
    selectorCandidates: ['#test'],
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

test('deriveRefCapabilities treats search inputs and searchable comboboxes as typeable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'input',
    inputType: 'search',
    role: 'combobox',
    ariaAutocomplete: 'list',
  })), {
    clickable: true,
    typeable: true,
    selectable: false,
    readable: true,
  });
});

test('deriveRefCapabilities treats submit inputs as clickable and not typeable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'input',
    inputType: 'submit',
    role: 'button',
    name: 'Search',
  })), {
    clickable: true,
    typeable: false,
    selectable: false,
    readable: true,
  });
});

test('deriveRefCapabilities treats native select controls as selectable', () => {
  assert.deepEqual(deriveRefCapabilities(makeRef({
    tagName: 'select',
    role: 'combobox',
  })), {
    clickable: true,
    typeable: false,
    selectable: true,
    readable: true,
  });
});

test('deriveRefCapabilities treats contenteditable as typeable', () => {
  assert.equal(deriveRefCapabilities(makeRef({
    tagName: 'div',
    role: 'textbox',
    isContentEditable: true,
    editableKind: 'contenteditable',
  })).typeable, true);
});
```

- [ ] **Step 2: Run capability tests and verify module is missing**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/refCapabilities.test.ts
```

Expected before implementation: failure because `src/v2/runtime/refCapabilities.ts` does not exist.

- [ ] **Step 3: Extend runtime and substrate types**

In `src/v2/runtime/types.ts`, add these exports above `V2Ref`:

```ts
export type EditableKind = 'none' | 'text' | 'search' | 'contenteditable';

export interface V2RefCapabilities {
  clickable: boolean;
  typeable: boolean;
  selectable: boolean;
  readable: boolean;
}
```

Extend `V2Ref` with:

```ts
  tagName?: string;
  inputType?: string;
  editableKind?: EditableKind;
  ariaAutocomplete?: string;
  ariaHasPopup?: string;
  isContentEditable?: boolean;
  nthRoleName?: number;
  capabilities?: V2RefCapabilities;
```

In `src/v2/substrate/types.ts`, extend `CapturedElement` with the same substrate facts plus `backendNodeId?: number` and `frameId?: string`.

- [ ] **Step 4: Create the capability helper**

Create `src/v2/runtime/refCapabilities.ts`:

```ts
import type { V2Ref, V2RefCapabilities } from './types';

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
]);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'tab']);

export function deriveRefCapabilities(ref: Pick<V2Ref,
  'tagName' | 'inputType' | 'role' | 'name' | 'text' | 'isContentEditable' | 'editableKind' | 'ariaAutocomplete' | 'ariaHasPopup'
>): V2RefCapabilities {
  const tagName = normalize(ref.tagName);
  const inputType = normalize(ref.inputType);
  const role = normalize(ref.role);
  const autocomplete = normalize(ref.ariaAutocomplete);
  const hasPopup = normalize(ref.ariaHasPopup);
  const contentEditable = ref.isContentEditable === true || ref.editableKind === 'contenteditable';

  const nativeTextInput = tagName === 'textarea'
    || (tagName === 'input' && TEXT_INPUT_TYPES.has(inputType));
  const nativeButtonInput = tagName === 'button'
    || (tagName === 'input' && BUTTON_INPUT_TYPES.has(inputType));
  const nativeSelect = tagName === 'select';
  const searchableCombobox = role === 'combobox'
    && (autocomplete === 'list' || autocomplete === 'both' || autocomplete === 'inline' || nativeTextInput);
  const selectLikeCombobox = role === 'combobox'
    && !searchableCombobox
    && (hasPopup === 'listbox' || nativeSelect);

  const typeable = nativeTextInput
    || contentEditable
    || role === 'textbox'
    || role === 'searchbox'
    || searchableCombobox;
  const selectable = nativeSelect
    || role === 'listbox'
    || selectLikeCombobox;
  const clickable = nativeButtonInput
    || tagName === 'a'
    || nativeSelect
    || searchableCombobox
    || selectLikeCombobox
    || CLICKABLE_ROLES.has(role);
  const readable = Boolean(ref.name?.trim() || ref.text?.trim() || typeable || clickable || selectable);

  return { clickable, typeable, selectable, readable };
}

function normalize(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}
```

- [ ] **Step 5: Populate DOM facts in observation capture**

In `src/v2/substrate/ObservationService.ts`, import `deriveRefCapabilities`.

When mapping captured candidates to `V2Ref`, include:

```ts
      backendNodeId: candidate.backendNodeId,
      frameId: candidate.frameId,
      tagName: candidate.tagName,
      inputType: candidate.inputType,
      editableKind: candidate.editableKind,
      ariaAutocomplete: candidate.ariaAutocomplete,
      ariaHasPopup: candidate.ariaHasPopup,
      isContentEditable: candidate.isContentEditable,
      nthRoleName: candidate.nthRoleName,
      capabilities: deriveRefCapabilities(candidate),
```

Inside `COLLECT_INTERACTIVE_ELEMENTS_SCRIPT`, add normalized fields:

```js
const tagName = element.tagName.toLowerCase();
const inputType = tagName === 'input' ? String(element.getAttribute('type') || 'text').toLowerCase() : undefined;
const isContentEditable = element.getAttribute('contenteditable') === 'true' || element.isContentEditable === true;
const ariaAutocomplete = element.getAttribute('aria-autocomplete') || undefined;
const ariaHasPopup = element.getAttribute('aria-haspopup') || undefined;
const editableKind = isContentEditable
  ? 'contenteditable'
  : tagName === 'textarea'
    ? 'text'
    : tagName === 'input' && inputType === 'search'
      ? 'search'
      : tagName === 'input'
        ? 'text'
        : 'none';
```

Return these fields in each captured element.

- [ ] **Step 6: Carry capabilities through Brain1 projection**

In `src/v2/brain1/projectionTypes.ts`, import `V2RefCapabilities` and extend `ProjectionItem` and `SerializedProjectionRef`:

```ts
  capabilities: V2RefCapabilities;
  tagName?: string;
  inputType?: string;
  editableKind?: import('../runtime/types').EditableKind;
```

In `src/v2/brain1/rankOperationalItems.ts`, import `deriveRefCapabilities` and use:

```ts
const capabilities = ref.capabilities ?? deriveRefCapabilities(ref);
```

Return `capabilities`, `tagName`, `inputType`, and `editableKind` from `toProjectionItem()`.

Replace selector-text kind inference with capability/DOM-fact inference:

```ts
function inferProjectionKind(ref: V2Ref): ProjectionItemKind {
  const role = ref.role?.toLowerCase();
  const tagName = ref.tagName?.toLowerCase();
  const capabilities = ref.capabilities ?? deriveRefCapabilities(ref);

  if (role === 'link' || tagName === 'a') return 'link';
  if (role === 'button' || role === 'tab' || role === 'menuitem') return 'button';
  if (tagName === 'button') return 'button';
  if (tagName === 'input' && ['button', 'submit', 'reset', 'image'].includes(ref.inputType?.toLowerCase() ?? '')) return 'button';
  if (capabilities.typeable) return ref.editableKind === 'contenteditable' ? 'editable' : 'input';
  if (capabilities.selectable) return 'select';
  return 'generic';
}
```

- [ ] **Step 7: Build action lanes from capabilities**

In `src/v2/planner/PlannerWorkingSetSelector.ts`, replace `isClickableCandidate`, `isTypeableCandidate`, and `isSelectableCandidate` logic so each function returns the corresponding `item.capabilities` flag.

Example:

```ts
function isTypeableCandidate(item: ProjectionItem): boolean {
  return item.capabilities.typeable;
}
```

- [ ] **Step 8: Add lane tests for searchable combobox and submit input**

In `tests/unit/v2/plannerWorkingSetSelector.test.ts`, add a test that builds refs with:

```ts
makeRef({
  refId: 'ref_search',
  role: 'combobox',
  tagName: 'input',
  inputType: 'search',
  ariaAutocomplete: 'list',
  capabilities: { clickable: true, typeable: true, selectable: false, readable: true },
})
```

Assert `typeableRefs` includes `ref_search`.

Also add:

```ts
makeRef({
  refId: 'ref_submit',
  role: 'button',
  tagName: 'input',
  inputType: 'submit',
  capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
})
```

Assert `clickableRefs` includes `ref_submit` and `typeableRefs` does not.

- [ ] **Step 9: Add searchable combobox fixture and integration check**

Create `tests/fixtures/v2/search-combobox.html`:

```html
<!doctype html>
<html>
  <head><title>Search Combobox</title></head>
  <body>
    <label for="query">Search place</label>
    <input
      id="query"
      type="search"
      role="combobox"
      aria-label="Search place"
      aria-autocomplete="list"
      aria-controls="suggestions"
    />
    <ul id="suggestions" role="listbox">
      <li role="option">Paris</li>
      <li role="option">Prague</li>
    </ul>
  </body>
</html>
```

In `tests/integration/v2/mvrRuntime.test.ts`, import `ProjectionService` and `PlannerWorkingSetSelector`, then add:

```ts
test('BrowseGentV2Harness observes searchable comboboxes as typeable action-lane refs', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_search_combobox',
    traceDir: await freshTraceDir('search_combobox'),
  });

  try {
    const observation = await harness.open(fixtureUrl('search-combobox.html'));
    const search = observation.refs.find(ref => ref.name === 'Search place');
    assert.ok(search);
    assert.equal(search.capabilities?.typeable, true);

    const projection = new ProjectionService().project(observation);
    const selection = new PlannerWorkingSetSelector().select({
      goal: 'Search for Paris',
      projection,
    });

    assert.ok(selection.workingSet.actionSurface.typeableRefs.includes(search.refId));
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 10: Verify focused capability/projection tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/refCapabilities.test.ts tests/unit/v2/brain1Projection.test.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
```

Expected: all focused tests pass.

## Task 3: Backend Identity, Fingerprints, and CDP Observation Pass

**Files:**
- Modify: `src/v2/substrate/ObservationService.ts`
- Modify: `src/v2/runtime/refFingerprint.ts`
- Modify: `tests/unit/v2/refFingerprint.test.ts`
- Modify: `tests/integration/v2/mvrRuntime.test.ts`

- [ ] **Step 1: Add fingerprint test for same text with different element type**

In `tests/unit/v2/refFingerprint.test.ts`, add:

```ts
test('createSoftRefFingerprint distinguishes text inputs from submit buttons with same label', () => {
  const textInput = makeRef({
    role: 'textbox',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'search',
    editableKind: 'search',
  });
  const submitButton = makeRef({
    role: 'button',
    name: 'Search',
    text: 'Search',
    tagName: 'input',
    inputType: 'submit',
    editableKind: 'none',
  });

  assert.notEqual(createSoftRefFingerprint(textInput), createSoftRefFingerprint(submitButton));
});
```

- [ ] **Step 2: Run fingerprint test and verify failure**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/refFingerprint.test.ts
```

Expected before implementation: soft fingerprints collide because they only include role/name/text/actionability.

- [ ] **Step 3: Update hard and soft fingerprints**

In `src/v2/runtime/refFingerprint.ts`, include facts:

```ts
    normalize(ref.tagName ?? ''),
    normalize(ref.inputType ?? ''),
    normalize(ref.editableKind ?? ''),
```

Add these fields to both hard and soft fingerprints. Keep selector candidates out of the soft fingerprint to avoid selector churn resurrecting wrong refs.

- [ ] **Step 4: Add integration assertion for backend identity capture**

In `tests/integration/v2/mvrRuntime.test.ts`, add a focused observation test:

```ts
test('BrowseGentV2Harness captures substrate-only backend node ids for visible controls when CDP is available', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_backend_identity',
    traceDir: await freshTraceDir('backend_identity'),
  });

  try {
    const observation = await harness.open(fixtureUrl('static-controls.html'));
    const visibleControls = observation.refs.filter(ref => ref.visibility === 'visible');

    assert.ok(visibleControls.length > 0);
    assert.ok(visibleControls.some(ref => typeof ref.backendNodeId === 'number'));
    assert.equal(JSON.stringify(observation).includes('selectorCandidates'), true);
  } finally {
    await harness.close();
  }
});
```

This test checks runtime substrate state only. Planner serialization tests already ensure backend ids and selector candidates do not leak into planner input.

- [ ] **Step 5: Add bounded CDP identity resolution in ObservationService**

In `COLLECT_INTERACTIVE_ELEMENTS_SCRIPT`, before returning mapped elements, store candidates in a page-global array:

```js
const markerPrefix = 'browsegent-v2-' + Math.random().toString(36).slice(2);
const captured = elements
  .filter(isInteractiveElement)
  .map((element, index) => {
    const marker = markerPrefix + '-' + index;
    element.setAttribute('data-browsegent-v2-marker', marker);
    return { element, marker, index };
  });
window.__browsegentV2MarkedElements = captured.map(item => item.element);
```

Return `marker` on each `CapturedElement`. After capture, add a helper in `ObservationService.ts`:

```ts
const MAX_CDP_IDENTITY_ELEMENTS = 150;

export async function resolveBackendNodeIds(
  page: import('playwright').Page,
  count: number,
  createBridge: (page: import('playwright').Page) => Promise<CdpBridge> = CdpBridge.create,
): Promise<Array<{ backendNodeId?: number; frameId?: string }>> {
  const identities = Array.from({ length: count }, () => ({} as { backendNodeId?: number; frameId?: string }));
  const bridge = await createBridge(page).catch(() => undefined);
  if (!bridge) {
    return identities;
  }

  try {
    const documentResult = await bridge.send<{ root?: { nodeId?: number } }>('DOM.getDocument', { depth: 0 });
    const rootNodeId = documentResult.root?.nodeId;
    if (typeof rootNodeId !== 'number') {
      return identities;
    }

    const queryResult = await bridge.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: '[data-browsegent-v2-marker]',
    });
    const nodeIds = (queryResult.nodeIds ?? []).slice(0, MAX_CDP_IDENTITY_ELEMENTS);

    for (const nodeId of nodeIds) {
      try {
        const described = await bridge.send<{
          node?: {
            backendNodeId?: number;
            frameId?: string;
            attributes?: string[];
          };
        }>('DOM.describeNode', { nodeId, depth: 0 });
        const marker = readAttribute(described.node?.attributes, 'data-browsegent-v2-marker');
        const index = markerIndex(marker);
        if (index >= 0 && index < identities.length) {
          identities[index] = {
            backendNodeId: described.node?.backendNodeId,
            frameId: described.node?.frameId,
          };
        }
      } catch {
        continue;
      }
    }
    return identities;
  } finally {
    await page.evaluate(() => {
      for (const element of Array.from((window as any).__browsegentV2MarkedElements ?? [])) {
        if (element instanceof Element) {
          element.removeAttribute('data-browsegent-v2-marker');
        }
      }
      delete (window as any).__browsegentV2MarkedElements;
    }).catch(() => undefined);
    await bridge.dispose();
  }
}

function readAttribute(attributes: string[] | undefined, name: string): string | undefined {
  if (!attributes) return undefined;
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1];
  }
  return undefined;
}

function markerIndex(marker: string | undefined): number {
  const value = marker?.split('-').pop();
  const index = Number(value);
  return Number.isInteger(index) ? index : -1;
}
```

Call the helper immediately after page evaluation and merge by index:

```ts
const identities = await resolveBackendNodeIds(input.page, captured.length);
const refs = captured.map((candidate, index): V2Ref => ({
  ...,
  backendNodeId: identities[index]?.backendNodeId,
  frameId: identities[index]?.frameId,
}));
```

- [ ] **Step 6: Preserve planner privacy**

Add this CDP-unavailable unit test to `tests/unit/v2/observationShape.test.ts`:

```ts
test('resolveBackendNodeIds returns empty identities when CDP bridge is unavailable', async () => {
  const { resolveBackendNodeIds } = await import('../../../src/v2/substrate/ObservationService');
  const page = {
    evaluate: async () => undefined,
  };

  const identities = await resolveBackendNodeIds(page as never, 3, async () => {
    throw new Error('CDP unavailable');
  });

  assert.deepEqual(identities, [{}, {}, {}]);
});
```

Run existing privacy tests:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/brain1Projection.test.ts tests/unit/v2/plannerInputComposer.test.ts
```

Expected: planner JSON still does not include `backendNodeId` or `selectorCandidates`.

- [ ] **Step 7: Verify focused identity tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/refFingerprint.test.ts tests/integration/v2/mvrRuntime.test.ts
```

Expected: fingerprint and integration tests pass.

## Task 4: Verified Ref Resolution and InputService Execution

**Files:**
- Create: `src/v2/substrate/RefResolver.ts`
- Modify: `src/v2/substrate/InputService.ts`
- Modify: `src/v2/runtime/errors.ts`
- Modify: `src/v2/runtime/FailureClassifier.ts`
- Modify: `tests/unit/v2/runtimeContracts.test.ts`
- Modify: `tests/unit/v2/inputServiceErrorMapping.test.ts`
- Modify: `tests/integration/v2/mvrRuntime.test.ts`
- Create: `tests/fixtures/v2/ambiguous-buttons.html`

- [ ] **Step 1: Add runtime error codes**

In `src/v2/runtime/errors.ts`, add:

```ts
  'target_not_selectable',
  'ambiguous_ref_resolution',
```

Add matching contract assertions in `tests/unit/v2/runtimeContracts.test.ts`.

- [ ] **Step 2: Add fixture for generic duplicate selectors**

Create `tests/fixtures/v2/ambiguous-buttons.html`:

```html
<!doctype html>
<html>
  <head>
    <title>Ambiguous Buttons</title>
    <style>
      .hidden { display: none; }
      .button { padding: 8px; }
    </style>
  </head>
  <body>
    <button class="button hidden">Search</button>
    <button class="button">Search</button>
    <button class="button">Cancel</button>
    <p id="status">idle</p>
    <script>
      document.querySelectorAll('button.button')[1].addEventListener('click', () => {
        document.getElementById('status').textContent = 'searched';
      });
    </script>
  </body>
</html>
```

- [ ] **Step 3: Add failing integration tests for hidden-first and ambiguous fallback**

In `tests/integration/v2/mvrRuntime.test.ts`, add:

```ts
test('BrowseGentV2Harness clicks the visible semantic match instead of a hidden first selector match', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_hidden_first_resolution',
    traceDir: await freshTraceDir('hidden_first_resolution'),
  });

  try {
    const observation = await harness.open(fixtureUrl('ambiguous-buttons.html'));
    const search = observation.refs.find(ref => ref.name === 'Search' && ref.visibility === 'visible');
    assert.ok(search);

    assert.equal(search.selectorCandidates[0], 'button.button');
    const result = await harness.click(search.refId);
    const searchResult = await harness.searchPage('searched');

    assert.equal(result.success, true);
    assert.equal(searchResult.value?.matches, 1);
  } finally {
    await harness.close();
  }
});
```

This fails before implementation because `InputService` executes `page.locator('button.button').first()`, which points at the hidden button.

Add a second direct Playwright integration test in the same file:

```ts
test('InputService rejects equivalent visible selector matches as ambiguous', async () => {
  const { chromium } = await import('playwright');
  const { InputService } = await import('../../../src/v2/substrate/InputService');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <button class="button">Search</button>
          <button class="button">Search</button>
        </body>
      </html>
    `);

    await assert.rejects(
      () => new InputService().click({
        refId: 'ref_ambiguous_search',
        generationId: 1,
        targetId: 'target_ambiguous_search',
        selectorCandidates: ['button.button'],
        role: 'button',
        tagName: 'button',
        name: 'Search',
        text: 'Search',
        visibility: 'visible',
        actionability: 'ready',
        continuityConfidence: 1,
        state: 'live',
        capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
      }, page),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'ambiguous_ref_resolution');
        return true;
      },
    );
  } finally {
    await browser.close();
  }
});
```

- [ ] **Step 4: Create RefResolver with verified selector fallback**

Create `src/v2/substrate/RefResolver.ts`:

```ts
import type { Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';

export interface ResolvedRefTarget {
  locator: Locator;
  resolution: 'unique_selector' | 'semantic_selector';
}

export class RefResolver {
  async resolve(ref: V2Ref, page: Page): Promise<ResolvedRefTarget> {
    const candidates: Array<{ locator: Locator; score: number }> = [];

    for (const selector of ref.selectorCandidates) {
      let locator: Locator;
      try {
        locator = page.locator(selector);
      } catch {
        continue;
      }

      const count = await locator.count().catch(() => 0);
    const limit = Math.min(count, MAX_CANDIDATES_PER_SELECTOR);
    for (let index = 0; index < limit; index += 1) {
        const candidate = locator.nth(index);
        const score = await scoreCandidate(candidate, ref).catch(() => -1);
        if (score >= 100) {
          candidates.push({ locator: candidate, score });
        }
      }
    }

    const sorted = candidates.sort((left, right) => right.score - left.score);
    if (sorted.length === 0) {
      throw new V2OperationalError('stale_ref', `Ref "${ref.refId}" no longer resolves to a verified target.`, { retryable: false });
    }

    if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
      throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" resolved to multiple equivalent candidates.`, { retryable: false });
    }

    return {
      locator: sorted[0].locator,
      resolution: sorted[0].score >= 140 ? 'semantic_selector' : 'unique_selector',
    };
  }
}

async function scoreCandidate(locator: Locator, ref: V2Ref): Promise<number> {
  return locator.evaluate((element, expected) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      element.hasAttribute('hidden')
      || style.display === 'none'
      || style.visibility === 'hidden'
      || style.opacity === '0'
      || rect.width <= 0
      || rect.height <= 0
    ) {
      return -1;
    }

    let score = 100;
    const tagName = element.tagName.toLowerCase();
    const role = (element.getAttribute('role') || '').toLowerCase();
    const ariaLabel = normalize(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('title') || '');
    const text = normalize(element.textContent || '');
    const name = normalize(expected.name || '');
    const expectedText = normalize(expected.text || '');

    if (expected.tagName && tagName === normalize(expected.tagName)) score += 15;
    if (expected.role && role === normalize(expected.role)) score += 15;
    if (name && (ariaLabel === name || text === name)) score += 30;
    if (expectedText && text === expectedText) score += 20;

    return score;

    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }
  }, {
    tagName: ref.tagName,
    role: ref.role,
    name: ref.name,
    text: ref.text,
  });
}
```

Use this constant near the top of `src/v2/substrate/RefResolver.ts`:

```ts
const MAX_CANDIDATES_PER_SELECTOR = 5;
```

If a selector has more than 5 matches and the resolver cannot prove a unique semantic winner from the bounded candidates or a later more specific selector, return `ambiguous_ref_resolution`. Do not scan dozens of generic matches.

Keep the initial resolver intentionally narrow: it verifies visible semantic selector candidates. Backend node ids improve continuity and fingerprinting in this slice; they do not require unsafe CDP click execution.

- [ ] **Step 5: Replace InputService blind selector execution**

In `src/v2/substrate/InputService.ts`, construct a resolver:

```ts
private readonly resolver = new RefResolver();
```

Replace `locatorForRef()` calls with:

```ts
const { locator } = await this.resolver.resolve(ref, page);
```

Delete the old `.first()` loop after tests pass.

Add action-specific checks before execution:

```ts
if (action === 'type' && ref.capabilities?.typeable === false) {
  throw new V2OperationalError('target_not_editable', 'Target is not a typeable control.', { retryable: false });
}
if (action === 'click' && ref.capabilities?.clickable === false) {
  throw new V2OperationalError('target_not_clickable', 'Target is not a clickable control.', { retryable: false });
}
```

- [ ] **Step 6: Map new errors through FailureClassifier**

In `src/v2/runtime/FailureClassifier.ts`, classify:

```ts
case 'ambiguous_ref_resolution':
  return 'target';
case 'target_not_selectable':
  return 'target';
```

Ensure both are persistent and non-retryable unless runtime result marks otherwise.

- [ ] **Step 7: Verify focused resolver/input tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/runtimeContracts.test.ts tests/unit/v2/inputServiceErrorMapping.test.ts tests/unit/v2/failureClassifier.test.ts tests/integration/v2/mvrRuntime.test.ts
```

Expected: hidden-first, ambiguous, and current input mapping tests pass.

## Task 5: Safe Mini-Plan Continuation and Fresh Ref Validation

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Modify: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Add test for continuing `type -> click` when refs stay live**

In `tests/unit/v2/v2AgentLoop.test.ts`, add:

```ts
test('V2AgentLoop continues safe mini-plan after type when the next ref is live in the fresh observation', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_submit', text: 'Ada' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Submitted' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'type',
    targetRef: 'ref_submit',
    value: { inputValue: 'Ada' },
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_type',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Enter name and submit',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(dispatcher.steps?.length, 2);
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type', 'click']);
});
```

- [ ] **Step 2: Add test for stopping queued action when next ref disappears**

Add:

```ts
test('V2AgentLoop stops queued mini-plan step when the next ref is stale after re-observe', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const staleObservation = makeObservation('obs_after_stale', { refs: [] });
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_submit', text: 'Ada' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    { escalate: 'dead_end', reason: 'next ref stale' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'type',
    targetRef: 'ref_submit',
    value: { inputValue: 'Ada' },
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_type',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness([makeObservation('obs_initial'), staleObservation]),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Enter name and submit',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_escalated:dead_end');
  assert.equal(dispatcher.steps?.length, 1);
});
```

- [ ] **Step 3: Implement mini-plan step policy**

In `src/v2/agent/V2AgentLoop.ts`, replace the unconditional `shouldInterruptMiniPlan(lastResult)` check with a next-step decision:

```ts
const nextStep = plan[plan.indexOf(plannedStep) + 1];
// observation is the fresh post-action observation. Use it to validate queued refs.
if (!shouldContinueMiniPlan({ lastResult, nextStep, freshObservation: observation })) {
  break;
}
```

Use an index-based loop instead of `for...of`:

```ts
for (let planIndex = 0; planIndex < plan.length; planIndex += 1) {
  const plannedStep = plan[planIndex];
  ...
  const nextStep = plan[planIndex + 1];
  if (!shouldContinueMiniPlan({ lastResult, nextStep, observation })) {
    break;
  }
}
```

Add:

```ts
function shouldContinueMiniPlan(input: {
  lastResult: V2ToolResult;
  nextStep: NonNullable<PlannerOutput['plan']>[number] | undefined;
  freshObservation: BrowserObservation;
}): boolean {
  if (!input.lastResult.success || !input.nextStep) return false;
  if (input.lastResult.evidence?.urlChanged || input.lastResult.evidence?.generationChanged) return false;
  if (input.lastResult.evidence?.transitionClass === 'structural_macrostate') return false;

  if (input.nextStep.ref && !input.freshObservation.refs.some(ref => ref.refId === input.nextStep.ref && ref.state === 'live')) {
    return false;
  }

  if (input.lastResult.kind === 'navigate') return false;
  if (input.lastResult.kind === 'click' && input.lastResult.evidence && input.lastResult.evidence.strength !== 'none') return false;
  if (input.lastResult.kind === 'press' && input.lastResult.evidence && input.lastResult.evidence.strength !== 'none') return false;

  return input.lastResult.kind === 'type'
    || input.lastResult.kind === 'get'
    || input.lastResult.kind === 'search_page'
    || input.lastResult.kind === 'inspect_region'
    || input.lastResult.kind === 'wait'
    || input.lastResult.kind === 'scroll';
}
```

Import `BrowserObservation` and `PlannerOutput` types as needed.

- [ ] **Step 4: Verify focused mini-plan tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts
```

Expected: all agent loop tests pass and old repeated evidence tests remain valid.

## Task 6: Explicit Press Tool

**Files:**
- Modify: `src/v2/planner/types.ts`
- Modify: `src/v2/planner/PlannerOutputSchema.ts`
- Modify: `src/v2/planner/V2PlannerResponseSchema.ts`
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `src/v2/tools/types.ts`
- Modify: `src/v2/tools/V2ToolDispatcher.ts`
- Create: `src/v2/substrate/KeyboardService.ts`
- Modify: `src/v2/harness/BrowseGentV2Harness.ts`
- Modify: `tests/unit/v2/plannerOutputSchema.test.ts`
- Modify: `tests/unit/v2/toolDispatcher.test.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`
- Modify: `tests/integration/v2/mvrRuntime.test.ts`
- Create: `tests/fixtures/v2/keyboard-submit.html`

- [ ] **Step 1: Add planner schema tests for bounded press keys**

In `tests/unit/v2/plannerOutputSchema.test.ts`, add:

```ts
test('PlannerOutputSchema accepts bounded press tool keys', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [{ tool: 'press', key: 'Enter' }],
    confidence: 'high',
  });

  assert.equal(result.ok, true);
});

test('PlannerOutputSchema rejects unsupported press keys', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [{ tool: 'press', key: 'Control+L' }],
    confidence: 'high',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /press key/);
});
```

- [ ] **Step 2: Extend planner output types and schema**

In `src/v2/planner/types.ts`, add:

```ts
export type PlannerPressKey = 'Enter' | 'Escape' | 'Tab' | 'ArrowDown' | 'ArrowUp';
```

Add `'press'` to `PlannerOutputTool` and add `key?: PlannerPressKey` to `PlannerOutputStep`.

In `src/v2/planner/PlannerOutputSchema.ts`, add `'press'` to `VALID_TOOLS`, define:

```ts
const VALID_PRESS_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']);
```

Validate:

```ts
if (tool === 'press' && !VALID_PRESS_KEYS.has(String(step.key))) {
  errors.push(`Step ${stepNumber} press key must be Enter, Escape, Tab, ArrowDown, or ArrowUp`);
}
```

In `src/v2/planner/V2PlannerResponseSchema.ts`, add `press` to tool enum and `key` property with the same enum.

- [ ] **Step 3: Wire dispatcher and runtime interface**

In `src/v2/tools/types.ts`, add:

```ts
press(key: import('../planner/types').PlannerPressKey): Promise<V2ToolResult<{ key: import('../planner/types').PlannerPressKey }>>;
```

In `src/v2/tools/V2ToolDispatcher.ts`, add:

```ts
case 'press':
  if (!isValidPressKey(step.key)) {
    return failure(step.tool, 'invalid_key', 'Press key must be Enter, Escape, Tab, ArrowDown, or ArrowUp.');
  }
  return this.runtime.press(step.key);
```

Use the same key enum list as `PlannerOutputSchema`.

- [ ] **Step 4: Add KeyboardService**

Create `src/v2/substrate/KeyboardService.ts`:

```ts
import type { Page } from 'playwright';
import type { PlannerPressKey } from '../planner/types';

export interface KeyboardExecutionResult {
  kind: 'press';
  value: { key: PlannerPressKey };
}

export class KeyboardService {
  async press(key: PlannerPressKey, page: Page): Promise<KeyboardExecutionResult> {
    // This intentionally presses the currently focused element. No-progress presses
    // are detected through transition evidence and recovered by the agent loop.
    await page.keyboard.press(key, { delay: 10 });
    return { kind: 'press', value: { key } };
  }
}
```

- [ ] **Step 5: Wire press into harness tracing**

In `src/v2/harness/BrowseGentV2Harness.ts`, create `keyboardService = new KeyboardService()`.

Add method:

```ts
async press(key: PlannerPressKey): Promise<V2ToolResult<{ key: PlannerPressKey }>> {
  const before = this.assertOpened();
  const stepId = this.traceStore.recordActionStart({
    kind: 'press',
    beforeObservationId: before.observationId,
    input: { key },
  });

  try {
    const execution = await this.keyboardService.press(key, this.session.currentPage());
    await this.stabilizationService.waitForSettledState(this.session.currentPage());
    const after = await this.captureCurrentObservation();
    const evidence = this.transitionService.compare(before, after);
    const result: V2ToolResult<{ key: PlannerPressKey }> = {
      success: true,
      kind: 'press',
      value: execution.value,
      evidence,
      traceStepId: stepId,
    };
    this.traceStore.recordActionEnd(stepId, result, { afterObservationId: after.observationId });
    return result;
  } catch (error) {
    const result = this.failureResult<{ key: PlannerPressKey }>('press', undefined, stepId, mapExecutionError(error));
    this.traceStore.recordActionEnd(stepId, result);
    return result;
  }
}
```

- [ ] **Step 6: Add keyboard-submit fixture and integration test**

Create `tests/fixtures/v2/keyboard-submit.html`:

```html
<!doctype html>
<html>
  <head><title>Keyboard Submit</title></head>
  <body>
    <input id="query" type="search" aria-label="Search query" />
    <p id="result">idle</p>
    <script>
      document.getElementById('query').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          document.getElementById('result').textContent = 'submitted:' + event.target.value;
        }
      });
    </script>
  </body>
</html>
```

In `tests/integration/v2/mvrRuntime.test.ts`, add:

```ts
test('BrowseGentV2Harness supports explicit Enter after typing', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_keyboard_submit',
    traceDir: await freshTraceDir('keyboard_submit'),
  });

  try {
    const observation = await harness.open(fixtureUrl('keyboard-submit.html'));
    const query = observation.refs.find(ref => ref.name === 'Search query');
    assert.ok(query);

    const typeResult = await harness.type(query.refId, 'alpha');
    const pressResult = await harness.press('Enter');
    const searchResult = await harness.searchPage('submitted:alpha');

    assert.equal(typeResult.success, true);
    assert.equal(pressResult.success, true);
    assert.equal(searchResult.value?.matches, 1);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 7: Verify focused press tests**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/toolDispatcher.test.ts tests/unit/v2/plannerPrompt.test.ts tests/integration/v2/mvrRuntime.test.ts
```

Expected: bounded press is schema-valid, unsupported keys are rejected, dispatcher routes `press`, and harness emits transition evidence.

## Task 7: Full Verification and MVR5 Readiness Gate

**Files:**
- Modify only files touched by Tasks 1-6 if verification shows regressions.

- [ ] **Step 1: Run V2 type/static check**

Run:

```powershell
npm.cmd run check:v2
```

Expected: exit code 0.

- [ ] **Step 2: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: exit code 0.

- [ ] **Step 3: Run full unit suite**

Run:

```powershell
npm.cmd run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 4: Run V2 integration test**

Run:

```powershell
npm.cmd exec -- node --test --import tsx tests/integration/v2/mvrRuntime.test.ts
```

Expected: all V2 integration tests pass.

- [ ] **Step 5: Run diff hygiene**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Inspect for benchmark-specific logic**

Run:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\\.google|arxiv\\.org|wolframalpha" src/v2 tests/unit/v2 tests/integration/v2
```

Expected: no matches in `src/v2`. Matches in benchmark loaders or docs are acceptable only outside the runtime changes.

- [ ] **Step 7: Optional MVR5 smoke command after user approval**

Use only after Tasks 1-6 pass and the user confirms a key index:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root C:\tmp\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 4 --key-index <chosen-key-index>
```

Success criteria for this smoke are not just pass rate. Inspect the report and trace for:

- No repeated hidden-first click timeout on a valid visible ref.
- Searchable combobox/input refs appear in `typeableRefs`.
- Provider/network errors are reported as `planner_client_error:*`, not `planner_invalid_output_dead_end`.
- Mini-plan queued actions stop when refs go stale and continue only when next refs remain live.
- Planner input remains free of `backendNodeId` and `selectorCandidates`.

## Self-Review

Spec coverage:

- Ref execution identity is covered by Tasks 2, 3, and 4.
- Verified ref resolution is covered by Task 4.
- Visibility/actionability/error mapping is covered by Tasks 2 and 4.
- Action semantics and lanes are covered by Task 2.
- Safe mini-plan execution is covered by Task 5.
- Explicit keyboard/submit path is covered by Task 6.
- Failure classification is covered by Task 1.
- No benchmark-specific tuning is guarded by Task 7.

Scope risk:

- Backend node id is populated and used for identity/fingerprinting first. Direct CDP action execution is intentionally not added because Playwright does not expose a safe public `Locator` conversion from `backendNodeId`; verified selector resolution gives the immediate correctness win without JS-click shortcuts.
- The resolver is intentionally narrow. It rejects ambiguity rather than guessing.
- Prompt changes are limited to the new `press` tool and must reflect runtime behavior.

Execution order:

1. Task 1 first because bad classification corrupts diagnosis.
2. Task 2 second because Brain1/planner lanes must know real capabilities before execution is judged.
3. Task 3 third because identity/fingerprint facts stabilize refs before resolver changes.
4. Task 4 fourth because execution target correctness depends on previous facts.
5. Task 5 fifth because queued-step safety depends on live ref validation.
6. Task 6 last because adding an action tool before action semantics are fixed expands planner surface too early.
7. Task 7 after all implementation slices.
