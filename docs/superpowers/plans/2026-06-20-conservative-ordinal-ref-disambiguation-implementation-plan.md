# Conservative Ordinal Ref Disambiguation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve exact duplicate semantic controls by their recorded ordinal without allowing ordinal evidence to create identity, cross frame boundaries, or heal stale refs.

**Architecture:** Preserve `BrowseGentV2Harness` plus `RefService` as the authority for current-observation eligibility. Extend `RefResolver` only at the existing tied-candidate decision point: candidates must have exact normalized role and accessible-name identity, an owner-document live ordinal, and a unique match for the recorded one-based `nthRoleName`. Keep all existing candidate caps and overflow safeguards.

**Tech Stack:** TypeScript, Node test runner, Playwright, BrowseGent V2 substrate/runtime.

---

## File Map

- Modify `tests/unit/v2/refService.test.ts`
  - Lock down the current-observation authority contract already enforced by `RefService.resolve`.
- Modify `src/v2/substrate/ObservationService.ts`
  - Make ordinal grouping use an explicit normalized semantic key.
- Modify `src/v2/substrate/RefResolver.ts`
  - Collect exact semantic identity and owner-document ordinal diagnostics, then apply a conservative tie-break.
  - Do not infer child-frame support from `frameId`; this slice only proves that ordinal groups stay inside each candidate's owner document.
- Modify `tests/unit/v2/refResolver.test.ts`
  - Cover safe ordinal success and every refusal condition without browser overhead.
- Modify `tests/fixtures/v2/repeated-controls.html`
  - Make repeated controls expose observable click outcomes.
- Modify `tests/integration/v2/mvrRuntime.test.ts`
  - Prove current-observation execution and owner-document isolation in a real browser.

Do not modify planner prompts, graph structures, projection lanes, benchmark tasks, provider code, AX support, visual support, or website-specific logic.

### Task 1: Lock Down Current-Observation Eligibility

**Files:**
- Modify: `tests/unit/v2/refService.test.ts`

- [ ] **Step 1: Add the current-observation contract test**

Append this test:

```ts
test('RefService resolve returns only the live ref stored in the active observation', () => {
  const service = new RefService();
  const first = service.assign(makeObservation([
    makeRef({ refId: 'incoming_first', generationId: 1 }),
  ], 1));
  const active = service.assign(makeObservation([
    makeRef({ refId: 'incoming_active', generationId: 2 }),
  ], 2));

  const resolved = service.resolve(active.refs[0].refId, active);

  assert.equal(resolved.state, 'live');
  assert.equal(resolved.ref, active.refs[0]);
  assert.equal(resolved.ref?.generationId, active.generationId);

  const removed = service.resolve(first.refs[0].refId, makeObservation([], 2));
  assert.equal(removed.state, 'invalid');
  assert.equal(removed.ref, undefined);
  assert.equal(removed.reason, 'ref_not_present_in_current_observation');
});
```

- [ ] **Step 2: Run the focused contract test**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/refService.test.ts
```

Expected: PASS. This is a regression test for an existing production boundary, not a reason to add `observationId` to `V2Ref`.

- [ ] **Step 3: Commit the contract test**

```powershell
git add -- tests/unit/v2/refService.test.ts
git commit -m "test(v2): lock current observation ref authority"
```

### Task 2: Implement Exact Semantic Ordinal Resolution

**Files:**
- Modify: `src/v2/substrate/ObservationService.ts`
- Modify: `src/v2/substrate/RefResolver.ts`
- Modify: `tests/unit/v2/refResolver.test.ts`

- [ ] **Step 1: Add failing resolver success and refusal tests**

Add this helper near `makeRef` in `tests/unit/v2/refResolver.test.ts`:

```ts
function semanticCandidate(
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    score: 180,
    identityKey: `button|${index}|open`,
    diagnostics: {
      tagName: 'button',
      role: 'button',
      accessibleName: 'open',
      nameMatched: true,
      textMatched: true,
      semanticOrdinal: index + 1,
      semanticGroupSize: 2,
      semanticScope: 'owner_document',
      ...overrides,
    },
  };
}
```

Append these tests:

```ts
test('RefResolver uses ordinal only to break an exact role and accessible-name tie', async () => {
  const resolver = new RefResolver();
  const locators = [0, 1].map(index => ({
    evaluate: async () => semanticCandidate(index),
  }));
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => locators[index],
    }),
  } as never;

  const result = await resolver.resolve(makeRef({
    selectorCandidates: ['button'],
    role: 'button',
    name: 'Open',
    text: 'Open',
    nthRoleName: 2,
  }), fakePage);

  assert.equal(result.locator, locators[1]);
  assert.equal(result.resolution, 'semantic_selector');
  assert.equal(result.diagnostics?.reason, 'resolved_exact_semantic_ordinal');
  assert.equal(result.diagnostics?.expectedOrdinal, 2);
  assert.equal(result.diagnostics?.semanticGroupSize, 2);
});

test('RefResolver refuses ordinal when exact accessible name does not match', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async () => semanticCandidate(index, {
          accessibleName: index === 0 ? 'save' : 'delete',
          nameMatched: false,
        }),
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['button'],
      role: 'button',
      name: 'Open',
      nthRoleName: 2,
    }), fakePage),
    (error: unknown) => {
      const candidate = error as { code?: string; diagnostics?: Record<string, unknown> };
      assert.equal(candidate.code, 'ambiguous_ref_resolution');
      assert.equal(candidate.diagnostics?.reason, 'tied_candidates');
      assert.equal(candidate.diagnostics?.ordinalReason, 'exact_semantic_group_missing');
      return true;
    },
  );
});

test('RefResolver refuses missing or out-of-range ordinal metadata', async () => {
  const resolver = new RefResolver();
  const fakePage = {
    locator: () => ({
      count: async () => 2,
      nth: (index: number) => ({
        evaluate: async () => semanticCandidate(index),
      }),
    }),
  } as never;

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['button'],
      role: 'button',
      name: 'Open',
      nthRoleName: undefined,
    }), fakePage),
    (error: unknown) => {
      const candidate = error as { diagnostics?: Record<string, unknown> };
      assert.equal(candidate.diagnostics?.ordinalReason, 'ordinal_metadata_incomplete');
      return true;
    },
  );

  await assert.rejects(
    () => resolver.resolve(makeRef({
      selectorCandidates: ['button'],
      role: 'button',
      name: 'Open',
      nthRoleName: 3,
    }), fakePage),
    (error: unknown) => {
      const candidate = error as { diagnostics?: Record<string, unknown> };
      assert.equal(candidate.diagnostics?.ordinalReason, 'ordinal_out_of_range');
      return true;
    },
  );
});

test('RefResolver refuses duplicate ordinal claims and unstable semantic scope', async () => {
  const resolver = new RefResolver();

  for (const [overrides, expectedReason] of [
    [{ semanticOrdinal: 2 }, 'ordinal_candidate_not_unique'],
    [{ semanticScope: 'unknown' }, 'semantic_scope_unstable'],
  ] as const) {
    const fakePage = {
      locator: () => ({
        count: async () => 2,
        nth: (index: number) => ({
          evaluate: async () => semanticCandidate(index, overrides),
        }),
      }),
    } as never;

    await assert.rejects(
      () => resolver.resolve(makeRef({
        selectorCandidates: ['button'],
        role: 'button',
        name: 'Open',
        nthRoleName: 2,
      }), fakePage),
      (error: unknown) => {
        const candidate = error as { diagnostics?: Record<string, unknown> };
        assert.equal(candidate.diagnostics?.ordinalReason, expectedReason);
        return true;
      },
    );
  }
});
```

Keep the existing test `RefResolver does not award ordinal identity to unrelated same-role candidates`. Update only its expected `ordinalReason` to `exact_semantic_group_missing`; retain top-level `reason: tied_candidates` for audit compatibility.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/refResolver.test.ts
```

Expected: FAIL because tied candidates are still rejected without exact semantic ordinal analysis.

- [ ] **Step 3: Normalize observation ordinal keys explicitly**

Inside `COLLECT_INTERACTIVE_ELEMENTS_SCRIPT` in `ObservationService.ts`, add:

```js
function normalizedSemanticIdentity(text) {
  return normalizedText(text).toLowerCase();
}
```

Replace:

```js
const roleNameKey = (role || 'generic') + '|' + (name || text || '');
```

with:

```js
const roleNameKey =
  normalizedSemanticIdentity(role || 'generic')
  + '|'
  + normalizedSemanticIdentity(name || text || '');
```

Do not change the user-facing `name` or `text` values stored in refs.

- [ ] **Step 4: Add typed semantic diagnostics to `RefResolver`**

Replace the loose diagnostics field on `ScoredCandidate` with:

```ts
interface CandidateDiagnostics {
  tagName: string;
  role: string;
  accessibleName: string;
  nameMatched: boolean;
  textMatched: boolean;
  semanticOrdinal?: number;
  semanticGroupSize: number;
  semanticScope: 'owner_document' | 'unknown';
}

interface ScoredCandidate {
  locator: Locator;
  score: number;
  identityKey: string;
  diagnostics?: CandidateDiagnostics;
}

type OrdinalRefusalReason =
  | 'ordinal_metadata_incomplete'
  | 'exact_semantic_group_missing'
  | 'ordinal_out_of_range'
  | 'ordinal_candidate_not_unique'
  | 'semantic_scope_unstable';
```

Update the `scoreCandidate` return type to use `CandidateDiagnostics`.

- [ ] **Step 5: Make browser-side semantic identity mirror observation rules**

Inside the existing `locator.evaluate` callback in `scoreCandidate`, replace the current role/name extraction with these local helpers and values:

```ts
function normalizedText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedSemanticIdentity(value: string): string {
  return normalizedText(value).toLowerCase();
}

function explicitOrNativeRole(target: Element): string {
  const explicit = target.getAttribute('role');
  if (explicit) return explicit.toLowerCase();

  switch (target.tagName.toLowerCase()) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input':
      switch (String(target.getAttribute('type') || 'text').toLowerCase()) {
        case 'button':
        case 'submit':
        case 'reset':
        case 'image':
          return 'button';
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'search':
          return 'searchbox';
        default:
          return 'textbox';
      }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    default:
      return '';
  }
}

function ariaLabelledByText(target: Element): string | undefined {
  const labelledBy = target.getAttribute('aria-labelledby');
  if (!labelledBy) return undefined;

  const text = labelledBy
    .split(/\s+/)
    .map(id => target.ownerDocument.getElementById(id)?.textContent || '')
    .map(normalizedText)
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

function accessibleName(target: Element): string {
  const direct =
    ariaLabelledByText(target)
    || target.getAttribute('aria-label')
    || target.getAttribute('placeholder')
    || target.getAttribute('title');
  if (direct) return normalizedText(direct);

  if (target instanceof HTMLInputElement && target.value) {
    return normalizedText(target.value);
  }

  if (
    (target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLTextAreaElement)
    && target.labels
    && target.labels.length > 0
  ) {
    const labelText = Array.from(target.labels)
      .map(label => normalizedText(label.textContent || ''))
      .filter(Boolean)
      .join(' ');
    if (labelText) return labelText;
  }

  const formName = target.getAttribute('name');
  if (formName) return normalizedText(formName);
  return normalizedText(target.textContent || '');
}

function isInteractiveElement(target: Element): boolean {
  const tagName = target.tagName.toLowerCase();
  if (['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option'].includes(tagName)) {
    return true;
  }

  const targetRole = target.getAttribute('role')?.toLowerCase();
  if (
    targetRole
    && ['button', 'link', 'tab', 'option', 'menuitem', 'checkbox', 'radio', 'switch', 'textbox', 'combobox']
      .includes(targetRole)
  ) {
    return true;
  }

  if (target.getAttribute('contenteditable') === 'true') return true;
  const tabindex = target.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  if (Array.from(target.getAttributeNames()).some(name => name.startsWith('on'))) return true;
  return window.getComputedStyle(target).cursor === 'pointer';
}

function isVisible(target: Element): boolean {
  const targetStyle = getComputedStyle(target);
  const targetRect = target.getBoundingClientRect();
  return !target.hasAttribute('hidden')
    && targetStyle.display !== 'none'
    && targetStyle.visibility !== 'hidden'
    && targetStyle.opacity !== '0'
    && targetRect.width > 0
    && targetRect.height > 0;
}

function walkOwnerDocument(target: Element): Element[] {
  const found: Element[] = [];
  const walk = (root: Document | ShadowRoot | Element): void => {
    for (const child of Array.from(root.children || [])) {
      found.push(child);
      if (child.shadowRoot) walk(child.shadowRoot);
      walk(child);
    }
  };
  walk(target.ownerDocument);
  return found;
}

const role = normalizedSemanticIdentity(explicitOrNativeRole(element));
const text = normalizedSemanticIdentity(element.textContent || '');
const liveAccessibleName = normalizedSemanticIdentity(accessibleName(element));
const expectedRole = normalizedSemanticIdentity(expected.role || '');
const expectedName = normalizedSemanticIdentity(expected.name || '');
const expectedText = normalizedSemanticIdentity(expected.text || '');
const semanticGroup = walkOwnerDocument(element).filter(candidate =>
  isInteractiveElement(candidate)
  && isVisible(candidate)
  && normalizedSemanticIdentity(explicitOrNativeRole(candidate)) === role
  && normalizedSemanticIdentity(accessibleName(candidate)) === liveAccessibleName
);
const semanticIndex = semanticGroup.indexOf(element);
const semanticOrdinal = semanticIndex >= 0 ? semanticIndex + 1 : undefined;
```

Use `isVisible(element)` for the existing visibility gate. Score exact role and name with:

```ts
if (expected.tagName && tagName === normalizedSemanticIdentity(expected.tagName)) score += 15;
if (expectedRole && role === expectedRole) score += 15;
if (expectedName && liveAccessibleName === expectedName) score += 30;
if (expectedText && text === expectedText) score += 20;
```

Return these diagnostics:

```ts
diagnostics: {
  tagName,
  role,
  accessibleName: liveAccessibleName,
  nameMatched: Boolean(expectedName && liveAccessibleName === expectedName),
  textMatched: Boolean(expectedText && text === expectedText),
  semanticOrdinal,
  semanticGroupSize: semanticGroup.length,
  semanticScope: element.ownerDocument === document ? 'owner_document' : 'unknown',
},
```

The semantic walk must begin at `element.ownerDocument`; it must not inspect `window.top`, parent frames, sibling frames, or iframe contents. Keep `semanticScope: 'owner_document'` only when that owner-document walk completes. If this logic later runs in a context where the owner document cannot be inspected consistently, return `semanticScope: 'unknown'` and let the tie-breaker fail with `semantic_scope_unstable`.

- [ ] **Step 6: Add the conservative ordinal selector**

Add this function below `RefResolver`:

```ts
function selectExactSemanticOrdinalCandidate(
  candidates: ScoredCandidate[],
  ref: V2Ref,
): {
  candidate?: ScoredCandidate;
  reason?: OrdinalRefusalReason;
  semanticGroupSize?: number;
} {
  const expectedRole = normalizeSemanticIdentity(ref.role);
  const expectedName = normalizeSemanticIdentity(ref.name);
  const expectedOrdinal = ref.nthRoleName;

  if (
    ref.state !== 'live'
    || !expectedRole
    || !expectedName
    || !Number.isInteger(expectedOrdinal)
    || Number(expectedOrdinal) < 1
  ) {
    return { reason: 'ordinal_metadata_incomplete' };
  }

  const exact = candidates.filter(candidate =>
    candidate.diagnostics?.role === expectedRole
    && candidate.diagnostics?.accessibleName === expectedName
    && candidate.diagnostics?.nameMatched === true
  );
  if (exact.length === 0) {
    return { reason: 'exact_semantic_group_missing' };
  }

  if (exact.some(candidate => candidate.diagnostics?.semanticScope !== 'owner_document')) {
    return { reason: 'semantic_scope_unstable' };
  }

  const groupSizes = new Set(exact.map(candidate => candidate.diagnostics?.semanticGroupSize));
  if (groupSizes.size !== 1 || groupSizes.has(undefined)) {
    return { reason: 'semantic_scope_unstable' };
  }

  const semanticGroupSize = exact[0].diagnostics?.semanticGroupSize;
  if (typeof semanticGroupSize !== 'number' || Number(expectedOrdinal) > semanticGroupSize) {
    return { reason: 'ordinal_out_of_range', semanticGroupSize };
  }

  const matches = exact.filter(
    candidate => candidate.diagnostics?.semanticOrdinal === expectedOrdinal,
  );
  if (matches.length !== 1) {
    return { reason: 'ordinal_candidate_not_unique', semanticGroupSize };
  }

  return { candidate: matches[0], semanticGroupSize };
}

function normalizeSemanticIdentity(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
```

- [ ] **Step 7: Integrate tie-breaking without bypassing overflow checks**

Replace the direct tie throw with selection logic:

```ts
let selected = sorted[0];
let resolutionReason = 'resolved_unique_top_candidate';
let ordinalDiagnostics: Record<string, unknown> = {};

if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
  const tied = sorted.filter(candidate => candidate.score === sorted[0].score);
  const ordinal = selectExactSemanticOrdinalCandidate(tied, ref);

  if (!ordinal.candidate) {
    throw new V2OperationalError(
      'ambiguous_ref_resolution',
      `Ref "${ref.refId}" resolved to multiple equivalent candidates.`,
      {
        retryable: false,
        diagnostics: {
          candidateCount: sorted.length,
          reason: 'tied_candidates',
          ordinalReason: ordinal.reason,
          expectedOrdinal: ref.nthRoleName,
          semanticGroupSize: ordinal.semanticGroupSize,
          topScore: sorted[0].score,
          topCandidates: sorted.slice(0, 5).map(candidate => ({
            score: candidate.score,
            identityKey: candidate.identityKey,
            diagnostics: candidate.diagnostics,
          })),
        },
      },
    );
  }

  selected = ordinal.candidate;
  resolutionReason = 'resolved_exact_semantic_ordinal';
  ordinalDiagnostics = {
    expectedOrdinal: ref.nthRoleName,
    semanticGroupSize: ordinal.semanticGroupSize,
  };
}
```

Run the existing overflow guard against `selected`, not unconditionally against `sorted[0]`. Return:

```ts
return {
  locator: selected.locator,
  resolution: selected.score >= 140 ? 'semantic_selector' : 'unique_selector',
  diagnostics: {
    reason: resolutionReason,
    candidateCount: sorted.length,
    topScore: selected.score,
    topIdentityKey: selected.identityKey,
    ...ordinalDiagnostics,
  },
};
```

Do not raise `MAX_CANDIDATES_PER_SELECTOR` and do not weaken `MIN_SINGLE_OVERFLOW_CANDIDATE_SCORE`.

- [ ] **Step 8: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests/unit/v2/refResolver.test.ts tests/integration/v2/observationRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit semantic ordinal resolution**

```powershell
git add -- src/v2/substrate/ObservationService.ts src/v2/substrate/RefResolver.ts tests/unit/v2/refResolver.test.ts
git commit -m "fix(v2): resolve exact semantic duplicate refs"
```

### Task 3: Prove Real-Browser and Owner-Document Behavior

**Files:**
- Modify: `tests/fixtures/v2/repeated-controls.html`
- Modify: `tests/integration/v2/mvrRuntime.test.ts`

- [ ] **Step 1: Make repeated-control clicks observable**

Replace each button in `repeated-controls.html` with a card label:

```html
<button class="open-card" data-card="Alpha">Open</button>
<button class="open-card" data-card="Beta">Open</button>
<button class="open-card" data-card="Gamma">Open</button>
```

Add after `</main>`:

```html
<p id="selection" aria-live="polite"></p>
<script>
  for (const button of document.querySelectorAll('.open-card')) {
    button.addEventListener('click', () => {
      document.querySelector('#selection').textContent =
        `Selected ${button.getAttribute('data-card')}`;
    });
  }
</script>
```

- [ ] **Step 2: Replace the old ambiguous integration expectation**

Replace `InputService rejects equivalent visible selector matches as ambiguous` in `mvrRuntime.test.ts` with:

```ts
test('BrowseGentV2Harness clicks the requested exact semantic duplicate ordinal', async () => {
  const traceDir = await freshTraceDir('semantic-ordinal');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_semantic_ordinal',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('repeated-controls.html'));
    const openButtons = observation.refs.filter(ref => ref.name === 'Open');

    assert.deepEqual(openButtons.map(ref => ref.nthRoleName), [1, 2, 3]);

    const result = await harness.click(openButtons[1].refId);
    const selection = await harness.searchPage('Selected Beta');

    assert.equal(result.success, true);
    assert.equal(selection.value?.matches, 1);
  } finally {
    await harness.close();
  }
});
```

This test exercises the approved Current Observation Contract because the harness resolves the action ref from its active observation immediately before calling `InputService`.

- [ ] **Step 3: Add an owner-document frame isolation test**

Append:

```ts
test('InputService ordinal groups do not include equal controls inside child frames', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <button class="duplicate" data-target="outer-1">Open</button>
          <button class="duplicate" data-target="outer-2">Open</button>
          <iframe srcdoc="
            <button class='duplicate' data-target='inner-1'>Open</button>
            <button class='duplicate' data-target='inner-2'>Open</button>
          "></iframe>
          <script>
            for (const button of document.querySelectorAll('.duplicate')) {
              button.addEventListener('click', () => {
                document.body.dataset.selected = button.dataset.target;
              });
            }
          </script>
        </body>
      </html>
    `);

    await new InputService().click({
      refId: 'ref_outer_second',
      generationId: 1,
      targetId: 'target_outer_second',
      selectorCandidates: ['button.duplicate'],
      role: 'button',
      tagName: 'button',
      name: 'Open',
      text: 'Open',
      nthRoleName: 2,
      visibility: 'visible',
      actionability: 'ready',
      continuityConfidence: 1,
      state: 'live',
      capabilities: { clickable: true, typeable: false, selectable: false, readable: true },
    }, page);

    assert.equal(await page.locator('body').getAttribute('data-selected'), 'outer-2');
    assert.equal(
      await page.locator('iframe').contentFrame().locator('button.duplicate').count(),
      2,
    );
  } finally {
    await browser.close();
  }
});
```

This test proves the current implementation's actual boundary: `page.locator('button.duplicate')` and the resolver's owner-document semantic group do not include equal controls inside the child frame. It does not claim child-frame execution support.

- [ ] **Step 4: Run the focused real-browser tests**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "semantic duplicate ordinal|child frames" tests/integration/v2/mvrRuntime.test.ts
```

Expected: 2 matching tests PASS.

- [ ] **Step 5: Run all V2 integration tests**

Run:

```powershell
npx.cmd tsx --test tests/integration/v2/observationRuntime.test.ts tests/integration/v2/mvrRuntime.test.ts tests/integration/v2/v1Compatibility.test.ts tests/integration/v2/publicAgentMode.test.ts
```

Expected: PASS with no regression in stale, blocked, or detached recovery.

- [ ] **Step 6: Commit browser-level validation**

```powershell
git add -- tests/fixtures/v2/repeated-controls.html tests/integration/v2/mvrRuntime.test.ts
git commit -m "test(v2): verify owner-document ordinal refs"
```

### Task 4: Verify the Production Gate

**Files:**
- Verify only; do not add benchmark-specific changes.

- [ ] **Step 1: Run static type checking**

```powershell
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 2: Run all unit tests**

```powershell
npm.cmd run test:unit
```

Expected: PASS.

- [ ] **Step 3: Run V2 governance checks**

```powershell
npm.cmd run check:v2
```

Expected: both boundary and cognition-leakage checks PASS.

- [ ] **Step 4: Run the complete V2 integration suite**

```powershell
npx.cmd tsx --test tests/integration/v2/observationRuntime.test.ts tests/integration/v2/mvrRuntime.test.ts tests/integration/v2/v1Compatibility.test.ts tests/integration/v2/publicAgentMode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Check the patch and scope**

```powershell
git diff --check
git status --short
git diff --stat HEAD~3..HEAD
```

Expected:

- no whitespace errors;
- only the files named in this plan are changed by this slice;
- unrelated pre-existing untracked files remain untouched;
- no benchmark, planner, graph, AX, visual, or provider files appear.

- [ ] **Step 6: Record verification**

If verification required no fixes, do not create an empty commit. Report the exact passing command counts and retain the three task commits as the restore points.

## Acceptance Gate

Do not run WebVoyager or tune benchmark behavior as part of this implementation. This slice is accepted only when:

- the harness executes an exact duplicate control using its current live observation ref;
- same-role or different-name candidates remain ambiguous;
- missing, out-of-range, duplicate, or unstable ordinal evidence fails closed;
- semantic groups remain inside the candidate's owner document;
- child-frame controls cannot alter main-document ordinal position;
- current candidate and overflow bounds remain unchanged;
- build, unit, governance, and V2 integration checks pass.
