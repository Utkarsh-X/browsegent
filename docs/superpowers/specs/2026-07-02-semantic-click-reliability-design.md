# Semantic Click Reliability Design

Production-grade click reliability for BrowseGent V2, inspired by agent-browser's `BLOCKER_AT_JS` but adapted to BrowseGent's TypeScript/Playwright substrate.

## 1. What Agent-Browser Does

### Files Inspected

| File | Purpose |
|------|---------|
| [`cli/src/native/element.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs) | Core element resolution, blocker detection, iframe handling, stale-ref recovery |
| [`cli/src/native/interaction.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs) | Click dispatch (CDP `Input.dispatchMouseEvent`), checkbox JS-click fallback |
| [`cli/src/native/actions.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/actions.rs) | Top-level action dispatcher, connects commands to interaction layer |
| [`cli/src/native/snapshot.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/snapshot.rs) | Accessibility tree snapshot, ref-map construction |

### Architecture Summary

Agent-browser uses CDP directly (Rust → WebSocket → Chrome DevTools Protocol). Its click pipeline is:

1. **Resolve ref → backendNodeId** via cached ID or re-query of the full AX tree by `(role, name, nth)`.
2. **Scroll into view** via `DOM.scrollIntoViewIfNeeded`.
3. **Get viewport coordinates** via `DOM.getBoxModel` → center of content quad.
4. **Blocker pre-check** via injected JS (`BLOCKER_AT_JS`) called on the resolved DOM object.
5. **Dispatch mouse events** via `Input.dispatchMouseEvent` (move → press → release).
6. **Checkbox fallback**: if coordinate click didn't toggle state, fall back to `element.click()` via `Runtime.callFunctionOn`.

### The BLOCKER_AT_JS Function

Located at [`element.rs:731-761`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs#L731-L761). This is the core semantic hit-test:

```javascript
(doc, el, x, y) => {
    // 1. Descend through same-origin iframes to find the actual hit element
    let d = doc, lx = x, ly = y;
    let hit = d.elementFromPoint(lx, ly);
    while (hit && (hit.tagName === 'IFRAME' || hit.tagName === 'FRAME')
           && hit.contentDocument && hit !== el) {
        const r = hit.getBoundingClientRect();
        lx -= r.x + hit.clientLeft;
        ly -= r.y + hit.clientTop;
        d = hit.contentDocument;
        hit = d.elementFromPoint(lx, ly);
    }

    // 2. Direct match: hit IS the target
    if (!hit || hit === el) return null;

    // 3. Shadow-including ancestor walk (hit is descendant of el)
    const up = (n) => n.parentNode || n.host
                      || (n.getRootNode && n.getRootNode().host) || null;
    for (let n = hit; n; n = up(n)) { if (n === el) return null; }

    // 4. Shadow-including descendant walk (el is descendant of hit)
    for (let n = el; n; n = up(n)) { if (n === hit) return null; }

    // 5. Label/control association
    const hitLabel = hit.closest ? hit.closest('label') : null;
    if (hitLabel && (hitLabel.control === el || hitLabel.contains(el))) return null;
    const elLabel = el.closest ? el.closest('label') : null;
    if (elLabel && elLabel.contains(hit)) return null;

    // 6. Blocker: return diagnostic description
    let desc = hit.tagName.toLowerCase();
    // ... build human-readable identifier
    return desc;
}
```

**Key design decisions in agent-browser:**
- **Binary outcome**: returns `null` (safe) or a blocker description string (blocked).
- **No soft/hard distinction**: any blocker is a hard error — the agent must dismiss the covering element first.
- **No multi-point probing**: single center-point hit-test only.
- **No retry**: failure is immediate, no automatic fallback to JS `.click()` for generic clicks.
- **Checkbox exception**: `check`/`uncheck` commands verify state and fall back to `js_click_checkbox` if the coordinate click didn't toggle it ([`interaction.rs:489-655`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs#L489-L655)).
- **Iframe descent**: walks through same-origin iframes during hit-test.
- **Shadow DOM traversal**: uses `parentNode || host || getRootNode().host` to cross shadow boundaries in both directions.
- **Label/control**: checks `<label>.control` and `<label>.contains()` for custom checkbox/radio patterns.

### Stale Ref Recovery

At [`element.rs:342-378`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs#L342-L378):
- If cached `backendNodeId` fails `DOM.getBoxModel`, re-queries the full accessibility tree.
- Matches by `(role, name, nth)` — same data that built the ref map during snapshot.
- This is a one-shot recovery, not a retry loop.

### What Agent-Browser Does NOT Do

- No multi-point candidate probing (only center).
- No pointer-events:none logic (browser `elementFromPoint` already skips those).
- No force-click on blockers.
- No CDP fallback for generic clicks (only for checkbox verification).
- No benchmark-specific heuristics.

---

## 2. What BrowseGent Currently Does

### Files Analyzed

| File | Purpose |
|------|---------|
| [`InputService.ts`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) | Click/type/select execution via Playwright |
| [`RefResolver.ts`](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts) | Semantic ref resolution with scoring, ordinal disambiguation |
| [`refCapabilities.ts`](file:///d:/BrowseGent/src/v2/runtime/refCapabilities.ts) | Derive clickable/typeable/selectable from tag/role/ARIA |
| [`BrowseGentV2Harness.ts`](file:///d:/BrowseGent/src/v2/harness/BrowseGentV2Harness.ts) | Mutation orchestration, retry logic, transition evidence |
| [`errors.ts`](file:///d:/BrowseGent/src/v2/runtime/errors.ts) | Operational error codes and V2OperationalError class |
| [`FailureClassifier.ts`](file:///d:/BrowseGent/src/v2/runtime/FailureClassifier.ts) | Error classification into categories/severity/persistence |
| [`domAdapter.ts`](file:///d:/BrowseGent/src/adapters/domAdapter.ts) | V1 CDP-based click with occlusion detection (separate path) |

### Current Click Pipeline (V2)

```
click(ref, page)
  → assertExecutable(ref)           // pre-check: visibility, actionability
  → assertActionCompatible(ref)     // pre-check: capabilities.clickable
  → resolver.resolve(ref, page)     // semantic ref resolution → Locator
  → locator.scrollIntoViewIfNeeded()
  → locator.elementHandle()
  → findUnblockedClickPosition(target)  // 7-point hit-test
  → attach click event listener
  → target.click({ position })
  → collect interactionEvidence
```

### Current Hit-Test: `findUnblockedClickPosition`

At [`InputService.ts:149-184`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L149-L184):
- Probes 7 candidate positions (center + 4 corners inset + 2 horizontal midpoints).
- Uses `document.elementFromPoint()` to find what's at each position.
- Passes if `topElement === targetElement || targetElement.contains(topElement)`.
- Returns `undefined` (blocked) if none of the 7 points see the target or its descendants.

### Current Problems

#### Problem 1: No Shadow DOM Awareness in Hit-Test
The current `findUnblockedClickPosition` only checks `targetElement.contains(topElement)` — standard DOM containment. This **fails for shadow DOM** where the hit element may be inside the target's shadow root (not a DOM descendant in the `contains()` sense) or where the target is inside a shadow host's tree.

Agent-browser solves this with its `up()` traversal: `n.parentNode || n.host || n.getRootNode().host`.

#### Problem 2: No Label/Control Association
If a `<label>` covers a checkbox/radio input, clicking the label is semantically equivalent to clicking the input. BrowseGent's hit-test doesn't recognize this — it sees the label as a blocker.

Agent-browser explicitly checks `hit.closest('label').control === el`.

#### Problem 3: Binary Blocked Error (No Soft/Hard Distinction)
When `findUnblockedClickPosition` returns `undefined`, the result is a single error code `target_blocked` with message "Target center point is covered by another element." No information about:
- What element is covering it (modal? sticky header? sibling label?).
- Whether the covering element is semantically related (safe to click through).
- Whether a retry after dismissal would help vs. a non-retryable layout issue.

#### Problem 4: No Blocker Diagnostics
The error message gives zero information about the blocker identity. The agent (LLM) cannot make an informed decision about what to do next — dismiss a modal? scroll? click a different element?

Agent-browser returns a human-readable description like `div#cookie-banner` or `header.sticky-nav inside div#app`.

#### Problem 5: Zero-Size/Hidden Conflated with Blocked
The hit-test returns `undefined` for zero-size elements (line 153-155), but this is conflated with the "covered by another element" error. A zero-size element is a fundamentally different problem (CSS issue, not an overlay issue) and should produce a distinct error.

#### Problem 6: `target_blocked` Marked Non-Retryable
At [`InputService.ts:32`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L32), `target_blocked` is `retryable: false`. This is incorrect for transient overlays (cookie banners, loading spinners) that may disappear. It should depend on the blocker classification.

#### Problem 7: No Iframe Awareness in Hit-Test
The `elementFromPoint` call happens in the target's document context, but if the target is inside an iframe, the hit-test doesn't descend through iframe boundaries the way agent-browser does.

#### Problem 8: Playwright's Own Actionability Check is Redundant
Playwright's `locator.click()` has its own actionability checks (visible, enabled, stable, receives pointer events). BrowseGent runs `findUnblockedClickPosition` *before* Playwright's click, but then Playwright runs its own interception check. If they disagree, the behavior is confusing. The design should clarify the relationship.

---

## 3. Proposed BrowseGent Design

### Core Principle

**Semantic precheck + Playwright execution + structured fallback only where safe.**

The semantic precheck replaces the current `findUnblockedClickPosition` with a richer analysis that:
1. Classifies the hit-test result into a 5-way taxonomy (see below).
2. Provides blocker diagnostics when blocked.
3. Decides whether Playwright execution should proceed, retry, or abort.

### Hit-Test Result Taxonomy

```typescript
type HitTestVerdict =
  | { outcome: 'clear_target' }
  | { outcome: 'semantic_relation'; relation: SemanticRelation }
  | { outcome: 'soft_ambiguity'; reason: string }
  | { outcome: 'hard_blocker'; blocker: BlockerDiagnostic }
  | { outcome: 'zero_size_or_hidden'; detail: string };

type SemanticRelation =
  | 'descendant'        // hit is DOM/shadow descendant of target
  | 'ancestor'          // hit is DOM/shadow ancestor of target
  | 'label_control'     // label/control association
  | 'shadow_host'       // hit is target's shadow host
  | 'shadow_content';   // hit is inside target's shadow root

interface BlockerDiagnostic {
  description: string;          // e.g. "div#cookie-banner"
  tagName: string;
  id?: string;
  classList?: string[];
  anchorDescription?: string;   // e.g. "inside div#app"
  isFixedOrSticky: boolean;     // computed position check
  coversFullViewport: boolean;  // heuristic for modals
}
```

### Proposed Click Pipeline

```
click(ref, page)
  → assertExecutable(ref)
  → assertActionCompatible(ref)
  → resolver.resolve(ref, page)         // existing semantic resolution
  → locator.scrollIntoViewIfNeeded()
  → locator.elementHandle()
  → semanticHitTest(target)              // NEW: replaces findUnblockedClickPosition
  → decide(verdict):
      clear_target     → proceed with Playwright click at position
      semantic_relation → proceed with Playwright click at position
      soft_ambiguity   → proceed with Playwright click (best effort), log warning
      hard_blocker     → throw V2OperationalError with diagnostics
      zero_size_hidden → throw distinct V2OperationalError
  → attach click event listener
  → locator.click({ position })          // Playwright handles its own actionability
  → collect interactionEvidence
```

### The `semanticHitTest` Function

Replaces `findUnblockedClickPosition`. Runs as a single `evaluate()` call on the element handle.

```typescript
async function semanticHitTest(
  target: ElementHandle
): Promise<{ verdict: HitTestVerdict; position?: { x: number; y: number } }>;
```

**Implementation strategy:**

1. **Get target bounding rect.** If `width ≤ 0 || height ≤ 0`, return `zero_size_or_hidden`.

2. **Probe candidate positions** (same 7-point grid as current). For each position:
   - Call `document.elementFromPoint(viewportX, viewportY)`.
   - Run the semantic relationship check (below).
   - If any position yields `clear_target` or `semantic_relation`, return that position.

3. **Semantic relationship check** (adapted from agent-browser's `BLOCKER_AT_JS`):
   ```javascript
   function isSemanticRelation(hit, target) {
     // Direct match
     if (hit === target) return { outcome: 'clear_target' };

     // Shadow-including ancestor walk: is hit a descendant of target?
     const up = (n) => n.parentNode || n.host
                       || (n.getRootNode && n.getRootNode().host) || null;
     for (let n = hit; n; n = up(n)) {
       if (n === target) return { outcome: 'semantic_relation', relation: 'descendant' };
     }

     // Shadow-including descendant walk: is target a descendant of hit?
     for (let n = target; n; n = up(n)) {
       if (n === hit) return { outcome: 'semantic_relation', relation: 'ancestor' };
     }

     // Label/control association
     const hitLabel = hit.closest ? hit.closest('label') : null;
     if (hitLabel && (hitLabel.control === target || hitLabel.contains(target)))
       return { outcome: 'semantic_relation', relation: 'label_control' };
     const targetLabel = target.closest ? target.closest('label') : null;
     if (targetLabel && targetLabel.contains(hit))
       return { outcome: 'semantic_relation', relation: 'label_control' };

     // No relation found
     return null;
   }
   ```

4. **If all 7 points are blocked**, classify the blocker from the center-point hit:
   - Build `BlockerDiagnostic` from the hit element.
   - Check `position: fixed | sticky` via `getComputedStyle`.
   - Check viewport coverage for modal detection.
   - Return `hard_blocker`.

### Blocker Diagnostic Builder

Runs inside `evaluate()`, returns a serializable diagnostic:

```javascript
function buildBlockerDiagnostic(hit) {
  const style = window.getComputedStyle(hit);
  const rect = hit.getBoundingClientRect();
  let desc = hit.tagName.toLowerCase();
  if (hit.id) desc += '#' + hit.id;
  else if (typeof hit.className === 'string' && hit.className.trim())
    desc += '.' + hit.className.trim().split(/\s+/).slice(0, 2).join('.');

  let anchorDescription = undefined;
  if (!hit.id && hit.closest) {
    const anchored = hit.closest('[id]');
    if (anchored && anchored !== hit)
      anchorDescription = anchored.tagName.toLowerCase() + '#' + anchored.id;
  }

  return {
    description: desc,
    tagName: hit.tagName.toLowerCase(),
    id: hit.id || undefined,
    classList: hit.className ? hit.className.trim().split(/\s+/).slice(0, 3) : undefined,
    anchorDescription,
    isFixedOrSticky: style.position === 'fixed' || style.position === 'sticky',
    coversFullViewport: rect.width >= window.innerWidth * 0.9
                     && rect.height >= window.innerHeight * 0.9,
  };
}
```

---

## 4. Soft vs. Hard Blocker Policy

### Hard Blocker (Error, Agent Must Act)
- All 7 probe points blocked by the same unrelated element.
- The blocking element has no semantic relationship to the target.
- **Action**: throw `V2OperationalError('target_blocked', ...)` with full `BlockerDiagnostic` in `diagnostics`.
- **Retryable**: `true` if blocker `isFixedOrSticky` (transient overlays often dismissed), `false` if `coversFullViewport` (modal that requires explicit dismissal).
- **Agent guidance**: error message includes blocker description so the LLM can decide to dismiss/scroll/click elsewhere.

### Semantic Relation (Pass-Through, No Error)
- Hit element is a descendant, ancestor, shadow-related, or label-associated with the target.
- **Action**: proceed with Playwright click at the probe position. No error, no warning.
- **Rationale**: clicking a label that targets an input, or clicking visible text inside a button, is correct behavior.

### Soft Ambiguity (Proceed with Warning)
- Hit-test is unstable across probe points (some clear, some blocked by different elements).
- Or: single point cleared but score is marginal (e.g., only a corner pixel is unblocked).
- **Action**: proceed with Playwright click at the best available position. Log a diagnostic warning in the trace, but do not error.
- **Rationale**: layout races and animation transitions can cause momentary instability. If a clear position exists, use it.

> [!IMPORTANT]
> The key insight from agent-browser is that the *semantic check itself* is the value — not the enforcement. By checking ancestor/descendant/label/shadow relationships, we avoid false-positive blocks on legitimate UI patterns (styled checkboxes, icon buttons, shadow-DOM components) while still catching genuine overlays.

---

## 5. Zero-Size/Hidden Target Policy

**Distinct from blocked.** A zero-size or hidden element is not covered by another element; it has no renderable area at all.

### Detection
```javascript
const rect = target.getBoundingClientRect();
if (rect.width <= 0 || rect.height <= 0) {
  const style = window.getComputedStyle(target);
  return {
    outcome: 'zero_size_or_hidden',
    detail: rect.width <= 0 && rect.height <= 0
      ? `Element has zero dimensions (${rect.width}×${rect.height})`
      : style.display === 'none' ? 'Element has display:none'
      : style.visibility === 'hidden' ? 'Element has visibility:hidden'
      : `Element has collapsed dimensions (${rect.width}×${rect.height})`,
  };
}
```

### Error Code
New or reused code: `target_hidden` (already exists in BrowseGent's error codes).

### Retryable
`false`. Zero-size elements are typically a DOM structure issue, not a transient overlay.

### Not a Candidate for JS `.click()` Fallback
A zero-size element should not be force-clicked. If it's hidden, clicking it is unlikely to produce the intended UI effect.

---

## 6. JS `.click()` Fallback Policy

### When Allowed

JS `.click()` via `element.click()` bypasses the browser's hit-testing entirely. It is allowed **only** under these conditions:

1. **Checkbox/radio toggle verification**: After a Playwright positional click on a checkbox or radio, if the checked state did not change, retry with `element.click()` on the associated native `<input>`.
   - This mirrors agent-browser's `js_click_checkbox` pattern ([`interaction.rs:600-655`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs#L600-L655)).
   - Must follow the label/control resolution chain: direct input → label.control → nested input → self.
   - Must verify state changed after JS click, or error.

2. **Semantic-relation cover where Playwright's own actionability check rejects**: If our semantic precheck says `semantic_relation` (label/shadow/descendant) but Playwright's `click()` throws "element is intercepted by another element", we may retry with JS `.click()` on the *target element itself* (not on the covering element).
   - This is safe because we have already verified the semantic relationship.
   - Log a diagnostic trace entry when this happens.

### When NOT Allowed

- **Hard blocker**: never force-click through a genuine overlay. The agent must dismiss it.
- **Zero-size/hidden**: never JS-click a zero-size element.
- **Soft ambiguity where no clear position found**: do not bypass Playwright; error to the agent.
- **Generic "just force it"**: no blanket fallback. Every JS `.click()` must have a clear semantic justification.

> [!CAUTION]
> Agent-browser does NOT use JS `.click()` as a generic fallback for blocked elements. It only uses it for checkbox/radio state verification. BrowseGent should follow the same discipline.

---

## 7. Error Enrichment

### Current Error Message
```
"Target center point is covered by another element."
```

### Proposed Error Message
```
"Target 'Submit' (button) is covered by <div#cookie-consent-banner inside div#app>
at its click point. The covering element has position:fixed and appears to be a
dismissable overlay. Interact with or dismiss the covering element first."
```

### Error Structure
```typescript
throw new V2OperationalError('target_blocked', message, {
  retryable: diagnostic.isFixedOrSticky && !diagnostic.coversFullViewport,
  diagnostics: {
    blockerDescription: diagnostic.description,
    blockerTagName: diagnostic.tagName,
    blockerId: diagnostic.id,
    blockerIsFixedOrSticky: diagnostic.isFixedOrSticky,
    blockerCoversFullViewport: diagnostic.coversFullViewport,
    blockerAnchor: diagnostic.anchorDescription,
    probePointsTested: 7,
    clearPointsFound: 0,
    semanticRelationChecked: true,
  },
});
```

---

## 8. Relationship to Playwright's Actionability

Playwright's `locator.click()` performs its own actionability checks:
1. Element is visible (non-zero size, not hidden).
2. Element is stable (not animating).
3. Element is enabled.
4. Element receives pointer events (no interception).

**Design decision**: BrowseGent's semantic precheck runs *before* Playwright's click. If the precheck passes (`clear_target` or `semantic_relation`), we call Playwright's click. If Playwright then throws its own interception error, we have a mismatch.

**Policy for mismatch**:
- If our precheck found a `semantic_relation`, Playwright's interception error is expected (it doesn't understand shadow/label relationships). Apply the JS `.click()` fallback as described in Section 6.
- If our precheck found `clear_target`, Playwright's error indicates a race condition (element moved between our check and Playwright's). Mark as `retryable: true`.
- Log all mismatches in the trace for debugging.

**Why not skip our precheck and rely on Playwright?**
- Playwright's error message is generic ("element X intercepts pointer events") and gives no blocker identity.
- Playwright doesn't understand shadow DOM or label/control relationships.
- Playwright cannot distinguish hard blockers from semantic relations.
- Our precheck produces rich diagnostics that help the LLM agent make informed decisions.

---

## 9. Non-Goals

These are explicitly out of scope for this design:

1. **CDP fallback for generic clicks**: BrowseGent uses Playwright, not CDP. We will not add `Input.dispatchMouseEvent` unless Playwright is proven unable to handle a specific case. The V1 `domAdapter.ts` CDP path is separate and pre-existing.

2. **pointer-events:none manipulation**: `document.elementFromPoint()` already skips elements with `pointer-events: none`. No need to filter them manually.

3. **Benchmark-specific tuning**: No heuristics targeting specific websites (e.g., "if the blocker is a Google consent banner, auto-dismiss it").

4. **Automatic overlay dismissal**: The agent (LLM) decides what to do with blockers, not the substrate. We provide diagnostics; the agent acts.

5. **Multi-frame/cross-origin iframe hit-test descent**: Agent-browser does this because it uses CDP which has per-frame sessions. Playwright handles cross-origin iframes through its own frame tree. For Phase 1, we rely on Playwright's frame handling. If evidence shows gaps, we add frame-aware hit-testing in Phase 2.

6. **Force-clicking hard blockers**: Never silently click through a genuine overlay. This would make the agent unreliable on sites with consent banners, cookie notices, or modal dialogs.

7. **Retry loops**: The semantic precheck is a one-shot analysis. If it fails, we error immediately. The agent loop (LLM) handles retries at a higher level.

---

## 10. Test Plan

### Unit Tests (Before Implementation)

#### `semanticHitTest.test.ts`
Tests for the core hit-test function using Playwright's `page.evaluate()` with synthetic DOM:

1. **Clear target**: element alone in viewport → `clear_target`.
2. **Standard descendant**: `<button><span>Click</span></button>`, probe hits `<span>` → `semantic_relation:descendant`.
3. **Shadow DOM descendant**: custom element with shadow root, probe hits shadow content → `semantic_relation:descendant`.
4. **Shadow DOM host**: probe hits shadow host that contains target → `semantic_relation:ancestor`.
5. **Label/control**: `<label><input type="checkbox"><span>Check</span></label>`, probe on label hits `<span>`, target is `<input>` → `semantic_relation:label_control`.
6. **Reverse label/control**: target is the `<label>`, probe hits the `<input>` inside it → `semantic_relation:label_control`.
7. **Hard blocker (fixed header)**: `<div style="position:fixed;top:0;width:100%;height:60px;z-index:999">` covering target → `hard_blocker` with `isFixedOrSticky:true`.
8. **Hard blocker (modal)**: full-viewport overlay → `hard_blocker` with `coversFullViewport:true`.
9. **Zero-size element**: `<button style="width:0;height:0">` → `zero_size_or_hidden`.
10. **display:none element**: `<button style="display:none">` → `zero_size_or_hidden`.
11. **Soft ambiguity**: partially covered target where 1 of 7 probes sees the target → returns the clear position with `clear_target`.
12. **Blocker diagnostic quality**: verify `description`, `id`, `classList`, `anchorDescription` fields are populated correctly.

#### `InputService.click.test.ts`
Integration tests for the full click pipeline:

1. **Successful click on clear target**: verify `clickEventObserved: true`.
2. **Blocked by overlay**: verify `V2OperationalError` with `code: 'target_blocked'` and diagnostic blocker info.
3. **Shadow DOM click-through**: click element inside shadow root, expect success.
4. **Label/control click-through**: click label, expect checkbox state change.
5. **Zero-size error**: verify distinct `target_hidden` error, not `target_blocked`.
6. **Playwright mismatch recovery**: semantic precheck passes but Playwright rejects → JS `.click()` fallback → success.

#### `blockerDiagnostic.test.ts`
Tests for the diagnostic builder:

1. **Element with id**: `div#my-banner` → description includes `#my-banner`.
2. **Element with classes**: `div.sticky.header` → description includes classes.
3. **Nested element with anchor**: `span` inside `div#app` → `anchorDescription: 'div#app'`.
4. **Fixed position detection**: `position: fixed` → `isFixedOrSticky: true`.
5. **Full-viewport coverage**: 90%+ viewport coverage → `coversFullViewport: true`.

### Integration Tests

Run against real pages to verify the system works end-to-end:

1. A page with a cookie consent banner over a button.
2. A page with a custom checkbox (hidden `<input>` + styled `<label>`).
3. A page with shadow DOM web components.
4. A page with a sticky header partially covering a target.

---

## 11. Implementation Phases

### Phase 1: Core Semantic Hit-Test (Primary Deliverable)

**Scope**: Replace `findUnblockedClickPosition` with `semanticHitTest`.

**Files to modify/create:**

| Action | File | Change |
|--------|------|--------|
| CREATE | `src/v2/substrate/semanticHitTest.ts` | The core hit-test function with shadow DOM + label/control + blocker diagnostics |
| MODIFY | `src/v2/substrate/InputService.ts` | Replace `findUnblockedClickPosition` with `semanticHitTest`, enrich error messages |
| MODIFY | `src/v2/runtime/errors.ts` | No new codes needed; existing `target_blocked`, `target_hidden` suffice |
| CREATE | `tests/v2/substrate/semanticHitTest.test.ts` | Unit tests for all verdict outcomes |
| MODIFY | `tests/v2/substrate/InputService.test.ts` | Update existing click tests for new diagnostic format |

**Estimated complexity**: ~200 lines of new code (primarily the `evaluate()` JS function), ~50 lines of modifications.

### Phase 2: JS `.click()` Fallback for Semantic Relations

**Scope**: Add controlled JS `.click()` fallback when Playwright rejects a click that our precheck approved via `semantic_relation`.

**Files to modify:**

| Action | File | Change |
|--------|------|--------|
| MODIFY | `src/v2/substrate/InputService.ts` | Catch Playwright interception error, check if precheck was `semantic_relation`, retry with JS `.click()` |
| CREATE | `tests/v2/substrate/InputService.fallback.test.ts` | Tests for fallback scenarios |

**Estimated complexity**: ~40 lines.

### Phase 3: Checkbox/Radio State Verification

**Scope**: After positional click on checkbox/radio, verify state changed. If not, fall back to label/control-aware JS `.click()`.

**Files to modify:**

| Action | File | Change |
|--------|------|--------|
| MODIFY | `src/v2/substrate/InputService.ts` | Add checkbox/radio post-click verification |
| CREATE | `src/v2/substrate/checkboxFallback.ts` | Label/control resolution chain for JS `.click()` |
| CREATE | `tests/v2/substrate/checkboxFallback.test.ts` | Tests for checkbox fallback |

**Estimated complexity**: ~80 lines.

### Phase 4 (Conditional): Iframe-Aware Hit-Testing

**Only if evidence from real-world usage shows Playwright's frame handling is insufficient.**

**Scope**: Add iframe descent to the hit-test JS, similar to agent-browser's iframe traversal in `BLOCKER_AT_JS`.

---

## 12. Summary of Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Hit-test engine** | In-page JS via `evaluate()` | Same approach as agent-browser, works with Playwright |
| **Shadow DOM traversal** | `parentNode \|\| host \|\| getRootNode().host` | Proven pattern from agent-browser |
| **Label/control check** | `closest('label').control` + `contains()` | Covers custom checkbox/radio patterns |
| **Multi-point probing** | Keep 7-point grid | More robust than agent-browser's center-only; catches partially covered targets |
| **Soft ambiguity** | Proceed with warning | Avoids false-positive blocks from animation/layout races |
| **Hard blocker** | Error with rich diagnostics | Agent must act; no silent force-click |
| **Zero-size** | Distinct error (`target_hidden`) | Different root cause than blockers |
| **JS `.click()` fallback** | Only for semantic_relation mismatch + checkbox verification | Disciplined; no generic force-click |
| **CDP fallback** | Not in Phase 1 | Playwright covers our use cases |
| **Retryable policy** | Based on blocker characteristics | Fixed/sticky → retryable; full-viewport → non-retryable |
| **Iframe handling** | Rely on Playwright Phase 1, conditional Phase 4 | Evidence-driven, not speculative |
