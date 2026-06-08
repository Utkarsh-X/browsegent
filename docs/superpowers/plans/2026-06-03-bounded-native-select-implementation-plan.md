# Bounded Native Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-safe native `<select>` execution and bounded option evidence to BrowseGent V2 without broad custom-dropdown handling or benchmark-specific tuning.

**Architecture:** V2 already exposes `select` in planner schema and action lanes, but runtime does not execute it. Implement native `<select>` only through verified ref resolution, preserve trace/re-observation semantics through the harness, and expose capped option labels as operational DOM facts so the planner can choose exact visible option text. Non-native combobox/custom dropdowns must remain rejected as `target_not_selectable` until a separate design exists.

**Tech Stack:** TypeScript, Playwright, Node test runner with `tsx`, BrowseGent V2 runtime/planner/harness/test infrastructure.

---

## Context The Implementer Must Read First

- Read `docs/continuation-context-2026-06-02.md`.
- Read `src/v2/tools/V2ToolDispatcher.ts`.
- Read `src/v2/tools/types.ts`.
- Read `src/v2/substrate/InputService.ts`.
- Read `src/v2/harness/BrowseGentV2Harness.ts`.
- Read `src/v2/substrate/ObservationService.ts`.
- Do not commit `new-keys.yaml`.
- Do not commit `debug.log`.

## Non-Goals

- Do not implement broad custom dropdown or ARIA combobox selection.
- Do not use site-specific logic for ArXiv, GitHub, WebVoyager, or any benchmark task.
- Do not weaken `PlannerOutputSchema` compatibility checks.
- Do not allow ambiguous ref execution.
- Do not expose raw selectors, backend node IDs, or CDP IDs to planner input.
- Do not run benchmarks until tests and full verification gates pass.

## File Structure

- Modify `src/v2/runtime/types.ts`: add bounded native select option facts to `V2Ref`.
- Modify `src/v2/substrate/types.ts`: add captured select option facts.
- Modify `src/v2/substrate/ObservationService.ts`: capture capped option labels for native `<select>`.
- Modify `src/v2/brain1/projectionTypes.ts`: carry select option facts on `ProjectionItem`.
- Modify `src/v2/brain1/rankOperationalItems.ts`: preserve select options when ranking operational items.
- Modify `src/v2/brain1/serializeProjection.ts`: serialize capped select options for selected refs only.
- Modify `src/v2/tools/types.ts`: add `select(refId, value)`.
- Modify `src/v2/tools/V2ToolDispatcher.ts`: dispatch `tool: "select"`.
- Modify `src/v2/substrate/InputService.ts`: implement native select execution through `RefResolver`.
- Modify `src/v2/harness/BrowseGentV2Harness.ts`: trace and execute `select`.
- Modify `src/v2/agent/V2AgentLoop.ts`: treat successful `select` as mutation evidence and safe mini-plan continuation similar to `type`.
- Modify `src/v2/planner/PlannerPrompt.ts`: describe `select` minimally and tell planner to use exact visible option labels.
- Test `tests/unit/v2/toolDispatcher.test.ts`.
- Test `tests/unit/v2/refCapabilities.test.ts` if capabilities need tightening.
- Test `tests/unit/v2/brain1Projection.test.ts`.
- Test `tests/unit/v2/plannerOutputSchema.test.ts`.
- Test `tests/unit/v2/v2AgentLoop.test.ts`.
- Test `tests/unit/v2/inputServiceErrorMapping.test.ts`.
- Test `tests/integration/v2/mvrRuntime.test.ts`.
- Create `tests/fixtures/v2/native-select.html`.

---

## Task 1: Add Option Facts To Observation And Projection

**Files:**
- Modify: `src/v2/runtime/types.ts`
- Modify: `src/v2/substrate/types.ts`
- Modify: `src/v2/substrate/ObservationService.ts`
- Modify: `src/v2/brain1/projectionTypes.ts`
- Modify: `src/v2/brain1/rankOperationalItems.ts`
- Modify: `src/v2/brain1/serializeProjection.ts`
- Test: `tests/unit/v2/brain1Projection.test.ts`
- Test: `tests/integration/v2/mvrRuntime.test.ts`
- Create: `tests/fixtures/v2/native-select.html`

- [ ] **Step 1: Create native select fixture**

Create `tests/fixtures/v2/native-select.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Native select fixture</title>
  </head>
  <body>
    <main>
      <h1>Native select</h1>
      <label for="sort-select">Sort order</label>
      <select id="sort-select" name="sort">
        <option value="">Choose sort</option>
        <option value="newest">Announcement date (newest first)</option>
        <option value="oldest">Announcement date (oldest first)</option>
        <option value="relevance">Relevance</option>
      </select>
      <p id="result" aria-live="polite">selected:none</p>
    </main>
    <script>
      document.getElementById('sort-select').addEventListener('change', (event) => {
        const selected = event.target.selectedOptions[0]?.textContent || '';
        document.getElementById('result').textContent = `selected:${selected}`;
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Add failing integration assertion for captured select options**

In `tests/integration/v2/mvrRuntime.test.ts`, add this test near the existing observation tests:

```ts
test('BrowseGentV2Harness observes native select option labels as bounded operational facts', async () => {
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_native_select_options',
    traceDir: await freshTraceDir('native_select_options'),
  });

  try {
    const observation = await harness.open(fixtureUrl('native-select.html'));
    const select = observation.refs.find(ref => ref.name === 'Sort order');

    assert.ok(select);
    assert.equal(select.tagName, 'select');
    assert.equal(select.capabilities?.selectable, true);
    assert.deepEqual(select.selectOptions, [
      'Choose sort',
      'Announcement date (newest first)',
      'Announcement date (oldest first)',
      'Relevance',
    ]);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 3: Run failing integration test**

Run:

```powershell
node --test --import tsx tests/integration/v2/mvrRuntime.test.ts --test-name-pattern "native select option labels"
```

Expected: FAIL because `selectOptions` is not present.

- [ ] **Step 4: Add `selectOptions` type fields**

In `src/v2/runtime/types.ts`, add this optional field to `V2Ref`:

```ts
  selectOptions?: string[];
```

In `src/v2/substrate/types.ts`, add this optional field to `CapturedElement`:

```ts
  selectOptions?: string[];
```

In `src/v2/brain1/projectionTypes.ts`, add this optional field to `ProjectionItem`:

```ts
  selectOptions?: string[];
```

- [ ] **Step 5: Capture capped native select labels**

In `src/v2/substrate/ObservationService.ts`, inside the browser evaluation script, add a helper:

```ts
  function selectOptions(element) {
    if (!(element instanceof HTMLSelectElement)) {
      return undefined;
    }

    return Array.from(element.options)
      .map(option => normalizedText(option.textContent || option.label || option.value || ''))
      .filter(Boolean)
      .slice(0, 20);
  }
```

When building each captured element, include:

```ts
        selectOptions: selectOptions(element),
```

When mapping `captured` to `V2Ref`, include:

```ts
      selectOptions: candidate.selectOptions,
```

- [ ] **Step 6: Preserve select options through Brain1 projection**

In `src/v2/brain1/rankOperationalItems.ts`, when constructing a `ProjectionItem`, copy:

```ts
    selectOptions: ref.selectOptions,
```

In `src/v2/brain1/serializeProjection.ts`, when serializing selected ref facts, include a bounded list:

```ts
    if (item.selectOptions?.length) {
      serialized.selectOptions = item.selectOptions.slice(0, 20);
    }
```

If the serializer uses a different local variable name than `serialized`, apply this exact behavior to the object emitted for each selected ref.

- [ ] **Step 7: Add unit test for serialized option facts**

In `tests/unit/v2/brain1Projection.test.ts`, add:

```ts
test('serializeProjection includes bounded native select option labels for selected refs', () => {
  const observation = buildObservation([
    makeRef({
      refId: 'ref_sort',
      role: 'combobox',
      tagName: 'select',
      name: 'Sort order',
      selectorCandidates: ['#sort-select'],
      capabilities: { clickable: true, typeable: false, selectable: true, readable: true },
      selectOptions: [
        'Choose sort',
        'Announcement date (newest first)',
        'Announcement date (oldest first)',
        'Relevance',
      ],
    }),
  ]);
  const projection = new ProjectionService().project(observation);
  const serialized = serializeProjection(projection);

  assert.deepEqual(serialized.refs.ref_sort.selectOptions, [
    'Choose sort',
    'Announcement date (newest first)',
    'Announcement date (oldest first)',
    'Relevance',
  ]);
});
```

If this test file uses different helper names, adapt only the helper calls; keep the assertion identical.

- [ ] **Step 8: Run Task 1 tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/brain1Projection.test.ts tests/integration/v2/mvrRuntime.test.ts
```

Expected: PASS.

---

## Task 2: Dispatch `select(ref, value)` Through Runtime Contract

**Files:**
- Modify: `src/v2/tools/types.ts`
- Modify: `src/v2/tools/V2ToolDispatcher.ts`
- Test: `tests/unit/v2/toolDispatcher.test.ts`
- Test: `tests/unit/v2/plannerOutputSchema.test.ts`

- [ ] **Step 1: Add failing dispatcher test**

In `tests/unit/v2/toolDispatcher.test.ts`, update `FakeToolRuntime` with a method that records select calls:

```ts
  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>> {
    this.calls.push({ method: 'select', args: [refId, value] });
    return { success: true, kind: 'select', targetRef: refId, value: { value }, traceStepId: 'fake_select' };
  }
```

Add a `select` step to the successful dispatch test:

```ts
{ tool: 'select', ref: 'v2ref_1', value: 'Announcement date (newest first)' },
```

Add this expected call:

```ts
{ method: 'select', args: ['v2ref_1', 'Announcement date (newest first)'] },
```

Add malformed select coverage in the malformed test:

```ts
const missingValue = await dispatcher.dispatch({ tool: 'select', ref: 'v2ref_1' }, { goal: 'Sort results' });
assert.equal(missingValue.success, false);
assert.equal(missingValue.error?.code, 'missing_value');
```

- [ ] **Step 2: Run failing dispatcher test**

Run:

```powershell
node --test --import tsx tests/unit/v2/toolDispatcher.test.ts
```

Expected: FAIL because dispatcher does not route `select`.

- [ ] **Step 3: Extend runtime interface**

In `src/v2/tools/types.ts`, add:

```ts
  select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>>;
```

- [ ] **Step 4: Add dispatcher case**

In `src/v2/tools/V2ToolDispatcher.ts`, add this case before `search_page`:

```ts
      case 'select':
        if (!isNonEmptyString(step.ref)) {
          return failure(step.tool, 'missing_ref', 'Ref is required for this v2 tool.', step.ref);
        }
        if (!isNonEmptyString(step.value)) {
          return failure(step.tool, 'missing_value', 'Value is required for this v2 tool.', step.ref);
        }
        return this.runtime.select(step.ref, step.value);
```

- [ ] **Step 5: Verify schema still rejects missing select value**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/toolDispatcher.test.ts
```

Expected: PASS.

---

## Task 3: Implement Native Select Execution In InputService

**Files:**
- Modify: `src/v2/substrate/InputService.ts`
- Test: `tests/unit/v2/inputServiceErrorMapping.test.ts`

- [ ] **Step 1: Add unit tests for native select compatibility**

In `tests/unit/v2/inputServiceErrorMapping.test.ts`, add a fake locator test for non-selectable refs:

```ts
test('InputService maps select on non-selectable refs to target_not_selectable', async () => {
  const service = new InputService();
  await assert.rejects(
    () => service.select({
      refId: 'ref_text',
      generationId: 1,
      targetId: 'target_text',
      selectorCandidates: ['#text'],
      role: 'textbox',
      tagName: 'input',
      inputType: 'text',
      name: 'Query',
      visibility: 'visible',
      actionability: 'ready',
      continuityConfidence: 1,
      state: 'live',
      capabilities: { clickable: false, typeable: true, selectable: false, readable: true },
    }, 'Newest', fakePage()),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'target_not_selectable');
      return true;
    },
  );
});
```

If this test file already has a different fake page helper shape, reuse its existing helper. The required assertion is that `error.code === 'target_not_selectable'`.

- [ ] **Step 2: Run failing unit test**

Run:

```powershell
node --test --import tsx tests/unit/v2/inputServiceErrorMapping.test.ts
```

Expected: FAIL because `InputService.select` does not exist.

- [ ] **Step 3: Extend `InputExecutionResult` kind**

In `src/v2/substrate/InputService.ts`, change:

```ts
  kind: 'click' | 'type';
```

to:

```ts
  kind: 'click' | 'type' | 'select';
```

- [ ] **Step 4: Add `select` method**

In `src/v2/substrate/InputService.ts`, add this method after `type`:

```ts
  async select(ref: V2Ref, value: string, page: Page): Promise<InputExecutionResult<{ value: string; selectedText: string }>> {
    this.assertExecutable(ref);
    this.assertActionCompatible(ref, 'select');
    const { locator } = await this.resolver.resolve(ref, page);
    await locator.scrollIntoViewIfNeeded({ timeout: 1_500 });

    const isNativeSelect = await locator.evaluate((element) => element instanceof HTMLSelectElement);
    if (!isNativeSelect) {
      throw new V2OperationalError('target_not_selectable', 'Target is not a native select control.', { retryable: false });
    }

    try {
      await locator.selectOption({ label: value }, { timeout: 1_500 });
    } catch (error) {
      throw mapPlaywrightError(error, 'select');
    }

    const selected = await locator.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const selectedOption = select.selectedOptions[0];
      return {
        value: select.value,
        selectedText: selectedOption?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });

    return {
      kind: 'select',
      value: selected,
    };
  }
```

- [ ] **Step 5: Extend compatibility check**

In `src/v2/substrate/InputService.ts`, change:

```ts
  private assertActionCompatible(ref: V2Ref, action: 'click' | 'type'): void {
```

to:

```ts
  private assertActionCompatible(ref: V2Ref, action: 'click' | 'type' | 'select'): void {
```

Add:

```ts
    if (action === 'select' && ref.capabilities?.selectable === false) {
      throw new V2OperationalError('target_not_selectable', 'Target is not a selectable control.', { retryable: false });
    }
```

- [ ] **Step 6: Extend Playwright error mapping**

In `src/v2/substrate/InputService.ts`, change:

```ts
function mapPlaywrightError(error: unknown, action: 'click' | 'type'): V2OperationalError {
```

to:

```ts
function mapPlaywrightError(error: unknown, action: 'click' | 'type' | 'select'): V2OperationalError {
```

Add before the timeout branch:

```ts
  if (
    action === 'select'
    && (
      lowered.includes('not a <select>')
      || lowered.includes('did not find some options')
      || lowered.includes('option')
    )
  ) {
    return new V2OperationalError('target_not_selectable', `Target could not select the requested option during ${action}.`, { retryable: false });
  }
```

- [ ] **Step 7: Run InputService tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/inputServiceErrorMapping.test.ts
```

Expected: PASS.

---

## Task 4: Wire Select Through Harness, Trace, And Agent Loop

**Files:**
- Modify: `src/v2/harness/BrowseGentV2Harness.ts`
- Modify: `src/v2/agent/V2AgentLoop.ts`
- Modify: `tests/unit/v2/v2AgentLoop.test.ts`
- Test: `tests/integration/v2/mvrRuntime.test.ts`

- [ ] **Step 1: Add integration test for select execution**

In `tests/integration/v2/mvrRuntime.test.ts`, add:

```ts
test('BrowseGentV2Harness selects a native option and records transition evidence', async () => {
  const traceDir = await freshTraceDir('native_select_execute');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_native_select_execute',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('native-select.html'));
    const select = observation.refs.find(ref => ref.name === 'Sort order');
    assert.ok(select);

    const result = await harness.select(select.refId, 'Announcement date (newest first)');
    const searchResult = await harness.searchPage('selected:Announcement date (newest first)');
    const manifest = await harness.flushTrace();

    assert.equal(result.success, true);
    assert.equal(result.kind, 'select');
    assert.equal(result.targetRef, select.refId);
    assert.deepEqual(result.value, {
      value: 'newest',
      selectedText: 'Announcement date (newest first)',
    });
    assert.ok(result.evidence?.afterObservationId);
    assert.equal(searchResult.value?.matches, 1);
    assert.ok(manifest.steps.find(step => step.kind === 'select')?.afterObservationId);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run failing integration test**

Run:

```powershell
node --test --import tsx tests/integration/v2/mvrRuntime.test.ts --test-name-pattern "selects a native option"
```

Expected: FAIL because `BrowseGentV2Harness.select` does not exist.

- [ ] **Step 3: Add harness method**

In `src/v2/harness/BrowseGentV2Harness.ts`, add this method after `type`:

```ts
  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string; selectedText: string }>> {
    return this.executeMutation('select', refId, async (ref) => this.inputService.select(ref, value, this.session.currentPage()));
  }
```

Change `executeMutation` kind type:

```ts
    kind: 'click' | 'type',
```

to:

```ts
    kind: 'click' | 'type' | 'select',
```

`executeMutation` already traces, waits, re-observes, compares transitions, records failure evidence, and maps `V2OperationalError`, so do not duplicate that logic.

- [ ] **Step 4: Update agent loop mutation evidence**

In `src/v2/agent/V2AgentLoop.ts`, add `select` to mutation evidence:

```ts
const MUTATION_EVIDENCE_KINDS = new Set(['click', 'type', 'select', 'press', 'navigate']);
```

In `shouldContinueMiniPlan`, include `select` in safe no-progress continuation with `type`:

```ts
  return input.lastResult.kind === 'type'
    || input.lastResult.kind === 'select'
    || input.lastResult.kind === 'get'
    || input.lastResult.kind === 'search_page'
    || input.lastResult.kind === 'inspect_region'
    || input.lastResult.kind === 'wait'
    || input.lastResult.kind === 'scroll';
```

- [ ] **Step 5: Update fake harness in agent loop tests**

In `tests/unit/v2/v2AgentLoop.test.ts`, add to `FakeHarness`:

```ts
  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>> {
    return { success: true, kind: 'select', targetRef: refId, value: { value }, traceStepId: 'fake_select' };
  }
```

- [ ] **Step 6: Run harness and agent loop tests**

Run:

```powershell
node --test --import tsx tests/integration/v2/mvrRuntime.test.ts tests/unit/v2/v2AgentLoop.test.ts
```

Expected: PASS.

---

## Task 5: Planner Prompt And Recovery Signal Clarity

**Files:**
- Modify: `src/v2/planner/PlannerPrompt.ts`
- Modify: `tests/unit/v2/plannerPrompt.test.ts`
- Modify: `tests/unit/v2/v2PlannerClient.test.ts` only if existing prompt assertions require update

- [ ] **Step 1: Add prompt test for native select**

In `tests/unit/v2/plannerPrompt.test.ts`, add:

```ts
test('buildV2PlannerSystemPrompt describes bounded native select use', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /select: requires ref and exact visible option value/i);
  assert.match(prompt, /Use select only for refs listed as selectable/i);
});
```

- [ ] **Step 2: Run failing prompt test**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerPrompt.test.ts
```

Expected: FAIL because prompt does not describe bounded select.

- [ ] **Step 3: Update prompt**

In `src/v2/planner/PlannerPrompt.ts`, add this valid tool line:

```text
- select: requires ref and exact visible option value; use only for refs listed as selectable
```

Add this sentence after the action-surface paragraph:

```text
For select actions, use exact visible option labels from current.refs[ref].selectOptions when present. If option labels are missing or uncertain, inspect the region or read the page before selecting.
```

- [ ] **Step 4: Run prompt and planner-client tests**

Run:

```powershell
node --test --import tsx tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/v2PlannerClient.test.ts
```

Expected: PASS.

---

## Task 6: Focused Verification

**Files:**
- No new implementation files.

- [ ] **Step 1: Run focused select verification**

Run:

```powershell
node --test --import tsx tests/unit/v2/toolDispatcher.test.ts tests/unit/v2/inputServiceErrorMapping.test.ts tests/unit/v2/brain1Projection.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/integration/v2/mvrRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run V2 architecture gate**

Run:

```powershell
npm.cmd run check:v2
```

Expected:

```text
v2 boundary checks passed
v2 cognition leakage checks passed
```

- [ ] **Step 3: Run TypeScript build**

Run:

```powershell
npm.cmd run build
```

Expected: PASS with `tsc --noEmit`.

- [ ] **Step 4: Run full unit suite**

Run:

```powershell
npm.cmd run test:unit
```

Expected: all unit tests pass.

- [ ] **Step 5: Run V2 integration suite**

Run:

```powershell
node --test --import tsx tests/integration/v2/mvrRuntime.test.ts
```

Expected: all V2 runtime integration tests pass.

- [ ] **Step 6: Run whitespace and anti-overfit scans**

Run:

```powershell
git diff --check
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\\.google|arxiv\\.org|wolframalpha" src/v2
```

Expected:

- `git diff --check` exits `0`.
- `rg ... src/v2` exits `1` with no matches. Exit `1` is expected for no matches.

---

## Task 7: Optional Single MVR5 Smoke After User Approval

**Files:**
- No code changes.

- [ ] **Step 1: Ask user before spending API budget**

Ask:

```text
Native select support is implemented and verified. Do you want one BrowseGent MVR5 smoke run now? I will use one fresh key index and request-rpm 8.
```

- [ ] **Step 2: Run one benchmark only if approved**

Use a fresh key index provided by the user. Example with key index 21:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 21
```

- [ ] **Step 3: Interpret result without overfitting**

Read latest report:

```powershell
Get-ChildItem -Path "D:\BrowseGent\logs\webvoyager-lite" -Recurse -Filter "report.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  ForEach-Object { Get-Content $_.FullName | ConvertFrom-Json | ConvertTo-Json -Depth 8 }
```

Evaluate:

- Did ArXiv still fail with `ambiguous_ref_resolution`?
- Did any `select` action execute successfully?
- Did any `target_not_selectable` failure occur?
- Did planner switch mechanisms after incompatible refs?
- Was any failure network/API related?

Do not tune prompts or code to the benchmark task directly.

---

## Completion Criteria

The implementation is complete only when:

- Native `<select>` refs expose capped `selectOptions`.
- `select(ref, value)` dispatches through `V2ToolDispatcher`.
- `InputService.select` executes only native `<select>` controls through `RefResolver`.
- Non-selectable refs fail as `target_not_selectable`.
- Harness records select as a traced mutation with transition evidence.
- Planner prompt accurately describes bounded select behavior.
- Full verification gates pass.
- No WebVoyager/site-specific strings appear in `src/v2`.

## Stop Conditions

Stop and ask the user before continuing if:

- Native select implementation requires broad custom dropdown handling.
- Verification requires weakening ref/action compatibility checks.
- Fixing a failure requires site-specific assumptions.
- More than three fix attempts fail for the same issue.
- A benchmark rerun is desired but no fresh key index is provided.
