# Semantic Click Reliability Design (v2 — Deep Research)

Production-grade click reliability for BrowseGent V2, inspired by agent-browser's `BLOCKER_AT_JS` but adapted to BrowseGent's TypeScript/Playwright substrate.

> [!NOTE]
> **v2 update**: Incorporates findings from exhaustive deep research — every file in both codebases read, 12 edge cases investigated, all pattern searches completed.

---

## 1. What Agent-Browser Does (Full Architecture)

### Files Inspected

| File | Purpose |
|------|---------|
| [`element.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs) | Core element resolution, blocker detection, iframe handling, stale-ref recovery, checked state, bounding box |
| [`interaction.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs) | Click dispatch with dialog awareness, check/uncheck retry, fill, type, scroll, select |
| [`snapshot.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/snapshot.rs) | AX tree snapshot, ref building, cursor-interactive detection, shadow DOM traversal, frame boundaries |
| [`actions.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/actions.rs) | Top-level action dispatcher, file upload, policy enforcement |

### Architecture Summary

Agent-browser uses CDP directly (Rust → WebSocket → Chrome DevTools Protocol). Its full click pipeline:

1. **Resolve ref → backendNodeId** via cached ID or AX tree re-query by `(role, name, nth)`.
2. **Scroll into view** via `DOM.scrollIntoViewIfNeeded`.
3. **Get viewport coordinates** via `DOM.getBoxModel` → center of content quad.
4. **Blocker pre-check** via `BLOCKER_AT_JS` — injected JS called on the resolved DOM object.
5. **Dialog-aware dispatch** via `dispatch_mouse_or_dialog` — races mouse events against dialog opening.
6. **Checkbox verification**: `check`/`uncheck` commands verify state and fall back to `js_click_checkbox`.

### The BLOCKER_AT_JS Function

Located at [`element.rs:731-761`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs#L731-L761). Core semantic hit-test:

```javascript
(doc, el, x, y) => {
    // 1. Descend through same-origin iframes
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

    // 2. Direct match
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

### Dialog-Aware Click Dispatch

Located at [`interaction.rs:937-988`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs#L937-L988). Uses `tokio::select!` to race the `Input.dispatchMouseEvent` acknowledgment against `Page.javascriptDialogOpening`. If a JS dialog fires during the click:
- During `mouseMoved`: returns immediately (no button held).
- During `mousePressed`: returns `PendingRelease` struct (button logically held; caller releases after dialog resolved).
- During `mouseReleased`: notes the dialog but nothing to clean up.

This prevents the click from hanging indefinitely when `alert()`, `confirm()`, or `prompt()` fires from click handlers.

### Check/Uncheck Retry — The ONLY Fallback

Located at [`interaction.rs:489-655`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs#L489-L655). The only retry/fallback in agent-browser:

1. Coordinate-based CDP click at element center.
2. Verify state changed via `is_element_checked` (4-step JS: native `.checked` → ARIA `aria-checked` → `label.control` → nested input).
3. If state unchanged → `js_click_checkbox` with 4-step follow-label resolution:
   - Native `<input>` → `.click()` directly.
   - Inside `<label>` → `.click()` the label's `.control`.
   - Contains nested `<input>` → `.click()` that input.
   - ARIA role control → `.click()` self.

### Stale Ref Recovery

At [`element.rs:342-378`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs#L342-L378):
- If `backendNodeId` fails `DOM.getBoxModel`, re-queries the full AX tree.
- Matches by `(role, name, nth)`.
- One-shot, not a retry loop.

### Snapshot: How Refs Are Built

At [`snapshot.rs:340-414`](file:///D:/agent-tools/agent-browser-source/cli/src/native/snapshot.rs#L340-L414):
- Interactive AX roles always get refs (`button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, etc.).
- Content roles get refs only if named (`heading`, `cell`, `article`, `region`).
- **Cursor-interactive elements** (`cursor:pointer`, `onclick`, `tabindex`, `contenteditable`) always get refs.
- `RoleNameTracker` adds `nth` disambiguation for duplicate role+name combos.
- **Hidden radio/checkbox promotion** (`snapshot.rs:894-924`): Detects patterns like `<label>` wrapping `display:none` `<input type="radio">` and promotes the label to proper `radio`/`checkbox` role.
- Shadow DOM: traverses `shadowRoots` array via CDP `collect_backend_node_ids`.
- Frames: recurses from main frame, resolves child frame via `contentDocument.frameId`, cross-origin uses dedicated CDP sessions.

### What Agent-Browser Does NOT Do

- No multi-point probing (center only).
- No force-click mechanism.
- No retry in regular click path.
- No pointer-capture handling.
- No CSS transform awareness (relies on `getBoundingClientRect` which handles it natively).
- No z-index/stacking-context logic (relies on `elementFromPoint` which handles it natively).
- No SVG-specific handling (relies on `parentNode` walk which works for SVG nodes).
- No closed shadow root specific handling.
- No opacity:0 transparency check.
- No benchmark-specific heuristics.

---

## 2. What BrowseGent V2 Currently Does (Full Analysis)

### Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| [`InputService.ts`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) | 248 | Click/type/select execution via Playwright |
| [`RefResolver.ts`](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts) | ~470 | Semantic ref resolution with scoring, ordinal disambiguation |
| [`ObservationService.ts`](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts) | 462 | Element discovery, shadow DOM walk, accessible name, visibility |
| [`BrowseGentV2Harness.ts`](file:///d:/BrowseGent/src/v2/harness/BrowseGentV2Harness.ts) | 816 | Mutation orchestration, retry, transition evidence |
| [`RefService.ts`](file:///d:/BrowseGent/src/v2/runtime/RefService.ts) | 121 | Ref identity continuity across generations |
| [`RefSelfHealingPolicy.ts`](file:///d:/BrowseGent/src/v2/runtime/RefSelfHealingPolicy.ts) | 49 | Self-healing decision for weakened refs |
| [`refFingerprint.ts`](file:///d:/BrowseGent/src/v2/runtime/refFingerprint.ts) | 45 | Hard/soft fingerprint computation |
| [`StabilizationService.ts`](file:///d:/BrowseGent/src/v2/runtime/StabilizationService.ts) | 34 | Page stability wait |
| [`RecoveryState.ts`](file:///d:/BrowseGent/src/v2/runtime/RecoveryState.ts) | 140 | Planner-level recovery strategies |
| [`UncertaintySignals.ts`](file:///d:/BrowseGent/src/v2/runtime/UncertaintySignals.ts) | 110 | Uncertainty level computation |
| [`DeadStateDetector.ts`](file:///d:/BrowseGent/src/v2/runtime/DeadStateDetector.ts) | 86 | Dead state detection |
| [`errors.ts`](file:///d:/BrowseGent/src/v2/runtime/errors.ts) | 37 | 18 operational error codes |
| [`FailureClassifier.ts`](file:///d:/BrowseGent/src/v2/runtime/FailureClassifier.ts) | 283 | Error classification into categories/severity/persistence |
| [`refCapabilities.ts`](file:///d:/BrowseGent/src/v2/runtime/refCapabilities.ts) | 59 | Capability derivation from tag/role/ARIA |

### Current Click Pipeline (V2)

```
click(ref, page)                              [InputService.ts:19-62]
  → assertExecutable(ref)                     // visibility, actionability pre-check
  → assertActionCompatible(ref, 'click')      // capabilities.clickable check
  → resolver.resolve(ref, page)               // semantic ref resolution → Locator
  → locator.scrollIntoViewIfNeeded()
  → locator.elementHandle()
  → findUnblockedClickPosition(target)        // 7-point hit-test
  → attach click event listener               // capture:true, once:true on target
  → target.click({ position })                // Playwright click (has own actionability check)
  → collect interactionEvidence               // clickEventObserved, targetConnectedAfterAction
```

### Harness Orchestration Layer

```
executeMutation(kind, refId, run)             [BrowseGentV2Harness.ts:320-439]
  → assertOpened() → before observation
  → refService.resolve(refId, before)         // identity continuity check
  → shouldAttemptWeakenedRefSelfHeal()        // self-healing decision
  → if not resolvable → failureResult (stale_ref / low_confidence_ref)
  → run(ref)                                  // delegates to InputService
  → buildSuccessfulMutationResult()
    → stabilizationService.waitForSettledState()  // 5s domcontentloaded + 75ms quiet
    → captureCurrentObservation()
    → transitionService.compare(before, after)
  → shouldRetrySilentDetachedClick()          // specialized detached detection
    → retryAfterDetachedMutation()            // one-shot re-resolve + re-execute
  → catch: mapExecutionError()
    → if element_detached → retryAfterDetachedMutation()
    → else → failureResult
```

### Ref Identity Continuity System

The `RefService` ([`RefService.ts`](file:///d:/BrowseGent/src/v2/runtime/RefService.ts)) maintains identity across observation generations:

| Match Type | State | Confidence | Execution? |
|------------|-------|------------|------------|
| Hard fingerprint (targetId + backendNodeId + selector + role + name + text + tag + inputType + editableKind) | `live` | 1.0 | ✅ Proceeds |
| Soft fingerprint (role + name + text + actionability + tag + inputType + editableKind) | `weakened` | 0.55 | ⚠️ Requires self-heal |
| No match | New ref (new ID) | 1.0 | ✅ Proceeds |

**Critical threshold**: Execution requires confidence ≥ 0.7. Soft matches (0.55) are always below threshold → always requires self-healing gate. Self-healing requires: `state === 'weakened'`, confidence ≥ 0.5, `visibility === 'visible'`, `actionability === 'ready'`, selector candidates exist.

### Silent Detached Click Detection

At [`BrowseGentV2Harness.ts:714-735`](file:///d:/BrowseGent/src/v2/harness/BrowseGentV2Harness.ts#L714-L735). Triggers retry when ALL conditions hold:
- Action is `click`
- `clickEventObserved === false`
- `targetConnectedAfterAction === false`
- `transitionClass === 'structural_local'`
- `generationChanged === false`, `urlChanged === false`
- No refs appeared or disappeared
- Exactly 1 ref weakened and it's the target ref

This is **superior to agent-browser's** basic AX tree re-query approach.

### Current Hit-Test: `findUnblockedClickPosition`

At [`InputService.ts:149-184`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L149-L184):
- 7 candidate positions: center + 4 corners (inset) + 2 horizontal midpoints.
- Uses `document.elementFromPoint()` at each position.
- Passes if `topElement === targetElement || targetElement.contains(topElement)`.
- Returns `undefined` if none of the 7 points see the target or its descendants.
- **Advantage over agent-browser**: 7 points catches partially-covered targets (agent-browser uses center only).

### Current Problems (Expanded from v1)

#### Problem 1: No Shadow DOM Awareness in Hit-Test
`targetElement.contains(topElement)` uses standard DOM containment. Fails for shadow DOM where the hit element is inside the target's shadow root or where the target is inside a shadow host's tree.

Agent-browser solves with `up()` traversal: `n.parentNode || n.host || n.getRootNode().host`.

**Key insight from edge case research**: This walk works even for **closed shadow roots** — `elementFromPoint()` can return elements inside closed shadow roots (browser hit-testing ignores mode), and once you have a reference, `parentNode` and `getRootNode().host` still work from inside the closed tree.

#### Problem 2: No Label/Control Association in Hit-Test
`<label>` covering checkbox/radio → BrowseGent sees it as a blocker.

**Important**: BrowseGent's `ObservationService` (L293-301) already uses `element.labels` for accessible name computation. The label association logic exists in the observation layer but is NOT applied in the hit-test.

#### Problem 3: Binary Blocked Error — No Soft/Hard Distinction
Single error code `target_blocked` with generic message. No blocker identity, no diagnostic info.

**Concrete impact**: `mapPlaywrightError` at [InputService.ts:199-200](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L199-L200) catches "intercepts pointer events" and produces `V2OperationalError('target_blocked', 'Target was blocked during click.')` — zero diagnostic context. The agent (LLM) cannot decide what to do.

#### Problem 4: No Blocker Diagnostics
Agent-browser produces: `"Element 'Submit' is covered by <div#consent-banner> at its click point. Dismiss or interact with the covering element first (it is often a dialog, banner, or sticky header)."`

BrowseGent produces: `"Target center point is covered by another element."`

#### Problem 5: Zero-Size/Hidden Conflated with Blocked
The hit-test returns `undefined` for zero-size elements (L153-155), conflated with the "covered" error. Different root cause → should be distinct error.

#### Problem 6: `target_blocked` Marked Non-Retryable
At [`InputService.ts:32`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L32) and [`InputService.ts:131`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L131), `target_blocked` is `retryable: false`. Incorrect for transient overlays. Should depend on blocker characteristics.

#### Problem 7: No Iframe Awareness
V2 captures `frameId` via CDP `DOM.describeNode` ([ObservationService.ts:139](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts#L139)) but never uses it for click targeting. The hit-test `elementFromPoint` runs in the main document context only.

#### Problem 8: Redundant Playwright Actionability Check
Playwright's `target.click()` runs its own overlay check. When BrowseGent's precheck passes but Playwright's rejects, the error message is confusing and contains no diagnostic value.

#### Problem 9: opacity:0 False Positive Blocking *(NEW)*
**Critical gap found in edge case analysis.** `elementFromPoint()` returns elements with `opacity: 0` (unlike `pointer-events: none` which is skipped). A fully transparent overlay causes false-positive blocking. Neither agent-browser nor BrowseGent handles this.

BrowseGent's `computeVisibility` (ObservationService.ts:378) correctly marks `opacity: '0'` elements as `hidden` — they won't be refs. But a non-ref `opacity:0` element can still block other elements' hit-tests.

#### Problem 10: No Dialog Handling During Click *(NEW)*
Agent-browser has sophisticated dialog-aware dispatch (racing mouse events against dialog opening). BrowseGent relies on Playwright which does handle JS dialogs (via `page.on('dialog')` auto-dismiss), but there's no explicit design for it. If Playwright's dialog handling behavior changes, clicks could hang.

#### Problem 11: Zero Test Coverage *(NEW)*
**No test files exist** for InputService, RefResolver, or click behavior anywhere in the V2 codebase. No `.test.ts`, `.spec.ts`, or `__tests__/` directories. This is a prerequisite for any modification.

---

## 3. Edge Case Analysis (12 Cases Investigated)

### Verified No Gap — Browser APIs Handle Natively

| Edge Case | Why It Works |
|-----------|-------------|
| **SVG inside buttons** | `parentNode` walks correctly across SVG/HTML boundaries. `contains()` works across SVG/HTML boundaries. |
| **CSS transforms** | `getBoundingClientRect()` returns transformed bounds. `elementFromPoint()` uses visual coordinates. |
| **z-index / stacking contexts** | `elementFromPoint()` returns topmost element in paint order natively. |
| **aria-hidden interactive** | BrowseGent doesn't filter by `aria-hidden` — correct for a visual agent. `aria-hidden` only affects AX tree, not visual interactability. |
| **Web component event retargeting** | Click listener with `capture: true` on the shadow host fires correctly regardless of retargeting. |

### Gaps Requiring Design Attention

#### Gap A: opacity:0 False Positive Blocking (CRITICAL)

`elementFromPoint()` returns elements with `opacity: 0`. A transparent overlay causes false blocking.

**Fix in `semanticHitTest`**: After `elementFromPoint` returns a hit element that's NOT the target, check:
```javascript
const hitStyle = window.getComputedStyle(hit);
if (hitStyle.opacity === '0' || hitStyle.pointerEvents === 'none') {
  // Skip this element — it's transparent or non-interactive
  // Continue checking as if it weren't there
}
```

For `opacity:0`, we cannot simply skip because `elementFromPoint` won't give us the *next* element underneath. **Practical solution**: Temporarily set `pointerEvents = 'none'` on the opacity:0 hit, re-run `elementFromPoint`, then restore. Or: treat opacity:0 hits as `clear_target` (the transparent element won't block the click visually).

> [!IMPORTANT]
> Preferred approach: treat `opacity:0` blocker as a **non-blocker** (return `clear_target`). Rationale: if an element is fully transparent, clicking "through" it is the correct visual behavior. The browser will dispatch the click to the transparent element, but since opacity:0 elements are typically overlays, masks, or transition remnants, this is almost always the intended behavior.

#### Gap B: Closed Shadow Roots (MINOR)

**Observation gap**: BrowseGent's `ObservationService` walks `child.shadowRoot` which is `null` for closed shadow roots → elements inside won't be discovered as refs.

**Hit-test gap**: None. `elementFromPoint()` can return elements inside closed shadow roots, and the proposed `up()` walk (`parentNode || host || getRootNode().host`) works from inside a closed tree.

**Design decision**: Accept the observation gap. Elements inside closed shadow roots are rare, and the agent can interact with the shadow host itself. Document this as a known limitation.

#### Gap C: Native `<dialog>` Elements (MINOR)

`<dialog>` is not in BrowseGent's interactive element list ([ObservationService.ts:346](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts#L346)). When a modal dialog is open:
- `elementFromPoint` correctly sees the dialog/backdrop as blocking
- The dialog's child controls (buttons, inputs) ARE discovered
- But the `<dialog>` element itself isn't a ref

**Design decision**: The blocker diagnostic should identify `<dialog>` elements specifically. This is a presentation/diagnostic issue, not a functional gap.

#### Gap D: position:sticky After Scroll (MODERATE)

Both codebases scroll-then-check: if scrolling into view causes a sticky header to now cover the target, the blocker check detects it, but neither takes corrective action.

**Design decision**: Phase 1 — detect and report. The blocker diagnostic includes `isFixedOrSticky: true`, and the error message suggests "scroll or dismiss". Phase 2 (conditional) — if evidence shows sticky headers are a frequent cause of blocked clicks, add a scroll-offset retry: if blocker `isFixedOrSticky`, compute blocker height and scroll again with padding.

#### Gap E: overflow:hidden Clipping (MINOR)

BrowseGent's 7-point probing is already better than agent-browser's center-only. For elements where the center is clipped by `overflow:hidden`, a corner probe may succeed.

**Design decision**: Current 7-point grid is sufficient. No change needed for Phase 1.

#### Gap F: Playwright force:true as Targeted Fallback (IMPORTANT)

**Finding**: `force: true` on Playwright's `click()` skips ALL actionability checks (visibility, stability, enabled, overlay interception). BrowseGent never uses it.

**Design decision**: Use `force: true` as a **targeted fallback** when:
1. Our `semanticHitTest` returned `semantic_relation` (we verified the relationship).
2. Playwright's `click()` without `force` threw "intercepts pointer events".
3. In this case, our precheck already validated the click is safe — Playwright's duplicate check is a false positive.

Do NOT use `force: true` when `semanticHitTest` returned `clear_target` (Playwright disagreeing with a clear result suggests a race condition, not a false positive — mark as `retryable: true` instead).

---

## 4. Proposed BrowseGent Design (Updated)

### Core Principle

**Semantic precheck + Playwright execution (with `force:true` when semantically verified) + structured fallback only where safe.**

### Hit-Test Result Taxonomy

```typescript
type HitTestVerdict =
  | { outcome: 'clear_target' }
  | { outcome: 'semantic_relation'; relation: SemanticRelation }
  | { outcome: 'soft_ambiguity'; reason: string; clearPosition?: { x: number; y: number } }
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
  isTransparent: boolean;       // opacity:0 check (NEW)
  isNativeDialog: boolean;      // <dialog> element check (NEW)
}
```

### Proposed Click Pipeline (Updated)

```
click(ref, page)
  → assertExecutable(ref)
  → assertActionCompatible(ref)
  → resolver.resolve(ref, page)
  → locator.scrollIntoViewIfNeeded()
  → locator.elementHandle()
  → semanticHitTest(target)                   // NEW: replaces findUnblockedClickPosition
  → decide(verdict):
      clear_target      → Playwright click (normal)
      semantic_relation  → Playwright click with force:true   ← KEY CHANGE
      soft_ambiguity    → Playwright click at clear position, log warning
      hard_blocker      → if transparent: proceed (clear_target)
                           else: throw V2OperationalError with diagnostics
      zero_size_hidden  → throw distinct V2OperationalError
  → attach click event listener
  → locator.click({ position, force? })
  → catch Playwright error:
      if "intercepts pointer events" AND verdict was semantic_relation:
        → already used force:true, should not happen
      if "intercepts pointer events" AND verdict was clear_target:
        → race condition, mark retryable:true
  → collect interactionEvidence
```

### The `semanticHitTest` Function

Replaces `findUnblockedClickPosition`. Runs as a single `evaluate()` call.

```typescript
async function semanticHitTest(
  target: ElementHandle
): Promise<{ verdict: HitTestVerdict; position?: { x: number; y: number } }>;
```

**Implementation (single page.evaluate call):**

```javascript
(element) => {
  const targetElement = element;
  const rect = targetElement.getBoundingClientRect();

  // 1. Zero-size check
  if (rect.width <= 0 || rect.height <= 0) {
    const style = window.getComputedStyle(targetElement);
    return {
      verdict: {
        outcome: 'zero_size_or_hidden',
        detail: style.display === 'none' ? 'Element has display:none'
          : style.visibility === 'hidden' ? 'Element has visibility:hidden'
          : `Element has zero dimensions (${rect.width}×${rect.height})`,
      },
    };
  }

  // 2. Candidate positions (same 7-point grid)
  const insetX = Math.min(8, Math.max(1, rect.width / 4));
  const insetY = Math.min(8, Math.max(1, rect.height / 4));
  const candidates = [
    { x: rect.width / 2, y: rect.height / 2 },
    { x: insetX, y: insetY },
    { x: rect.width - insetX, y: insetY },
    { x: insetX, y: rect.height - insetY },
    { x: rect.width - insetX, y: rect.height - insetY },
    { x: rect.width * 0.25, y: rect.height / 2 },
    { x: rect.width * 0.75, y: rect.height / 2 },
  ];

  // Shadow-including ancestor walk
  const up = (n) => n.parentNode || n.host
                    || (n.getRootNode && n.getRootNode().host) || null;

  function classifyHit(hit) {
    if (!hit || hit === targetElement) return { outcome: 'clear_target' };

    // Shadow-including: is hit a descendant of target?
    for (let n = hit; n; n = up(n)) {
      if (n === targetElement) return { outcome: 'semantic_relation', relation: 'descendant' };
    }

    // Shadow-including: is target a descendant of hit?
    for (let n = targetElement; n; n = up(n)) {
      if (n === hit) return { outcome: 'semantic_relation', relation: 'ancestor' };
    }

    // Label/control association
    const hitLabel = hit.closest ? hit.closest('label') : null;
    if (hitLabel && (hitLabel.control === targetElement || hitLabel.contains(targetElement)))
      return { outcome: 'semantic_relation', relation: 'label_control' };
    const targetLabel = targetElement.closest ? targetElement.closest('label') : null;
    if (targetLabel && targetLabel.contains(hit))
      return { outcome: 'semantic_relation', relation: 'label_control' };

    // Opacity check — transparent elements are non-blockers
    const hitStyle = window.getComputedStyle(hit);
    if (hitStyle.opacity === '0')
      return { outcome: 'clear_target' }; // treat as transparent pass-through

    // No relation → blocker
    return null;
  }

  // 3. Probe all candidates
  let bestClearPosition = undefined;
  let bestRelationResult = undefined;
  let lastBlockerHit = undefined;

  for (const candidate of candidates) {
    const vx = Math.max(0, Math.min(window.innerWidth - 1, rect.left + candidate.x));
    const vy = Math.max(0, Math.min(window.innerHeight - 1, rect.top + candidate.y));
    const hit = document.elementFromPoint(vx, vy);
    const classification = classifyHit(hit);

    if (classification) {
      const position = {
        x: Math.max(0, Math.min(rect.width, vx - rect.left)),
        y: Math.max(0, Math.min(rect.height, vy - rect.top)),
      };
      if (classification.outcome === 'clear_target' && !bestClearPosition) {
        bestClearPosition = position;
        return { verdict: classification, position };
      }
      if (classification.outcome === 'semantic_relation' && !bestRelationResult) {
        bestRelationResult = { verdict: classification, position };
      }
    } else {
      lastBlockerHit = hit;
    }
  }

  // 4. Return best result
  if (bestRelationResult) return bestRelationResult;

  // 5. All points blocked → build diagnostic
  if (lastBlockerHit) {
    const style = window.getComputedStyle(lastBlockerHit);
    const bRect = lastBlockerHit.getBoundingClientRect();
    let desc = lastBlockerHit.tagName.toLowerCase();
    if (lastBlockerHit.id) desc += '#' + lastBlockerHit.id;
    else if (typeof lastBlockerHit.className === 'string' && lastBlockerHit.className.trim())
      desc += '.' + lastBlockerHit.className.trim().split(/\s+/).slice(0, 2).join('.');

    let anchorDescription = undefined;
    if (!lastBlockerHit.id && lastBlockerHit.closest) {
      const anchored = lastBlockerHit.closest('[id]');
      if (anchored && anchored !== lastBlockerHit)
        anchorDescription = anchored.tagName.toLowerCase() + '#' + anchored.id;
    }

    return {
      verdict: {
        outcome: 'hard_blocker',
        blocker: {
          description: desc,
          tagName: lastBlockerHit.tagName.toLowerCase(),
          id: lastBlockerHit.id || undefined,
          classList: lastBlockerHit.className
            ? lastBlockerHit.className.trim().split(/\s+/).slice(0, 3) : undefined,
          anchorDescription,
          isFixedOrSticky: style.position === 'fixed' || style.position === 'sticky',
          coversFullViewport: bRect.width >= window.innerWidth * 0.9
                           && bRect.height >= window.innerHeight * 0.9,
          isTransparent: style.opacity === '0',
          isNativeDialog: lastBlockerHit.tagName === 'DIALOG',
        },
      },
    };
  }

  return { verdict: { outcome: 'zero_size_or_hidden', detail: 'No hit element at any probe point' } };
}
```

---

## 5. Blocker Policies

### Hard Blocker (Error, Agent Must Act)
- All 7 probe points blocked by unrelated opaque elements.
- **Error**: `V2OperationalError('target_blocked', ...)` with full `BlockerDiagnostic`.
- **Retryable**: `true` if `isFixedOrSticky` (transient overlay), `false` if `coversFullViewport` (modal requiring explicit dismissal).
- **Error message**: includes blocker description: `"Target 'Submit' (button) is covered by <div#cookie-consent inside div#app> at its click point. Position: fixed. Dismiss or interact with the covering element first."`

### Semantic Relation (Pass-Through with `force:true`)
- Hit element is descendant, ancestor, shadow-related, or label-associated.
- **Action**: Playwright click with `force: true` at the probe position.
- **Rationale**: We verified the semantic relationship. Using `force:true` prevents Playwright's own overlay check from creating a false positive for legitimate UI patterns (styled checkboxes, icon buttons, shadow components).

### Transparent Blocker (Pass-Through)
- Hit element has `opacity: 0`.
- **Action**: proceed as `clear_target`. Log diagnostic trace.
- **Rationale**: fully transparent elements are overlays, masks, or transition remnants. Clicking "through" them is correct visual behavior.

### Soft Ambiguity (Proceed with Warning)
- Some points clear, some blocked by different elements, or only corners unblocked.
- **Action**: Playwright click at the best available clear position. Log diagnostic warning.

### Zero-Size/Hidden (Distinct Error)
- `width <= 0 || height <= 0` or `display:none` or `visibility:hidden`.
- **Error**: `V2OperationalError('target_hidden', ...)`.
- **Retryable**: `false`. Not a candidate for JS `.click()` fallback.

---

## 6. JS `.click()` Fallback Policy

### When Allowed

1. **Checkbox/radio toggle verification**: After Playwright click, if checked state unchanged, retry with JS `.click()` via label/control resolution chain (mirrors agent-browser's 4-step `js_click_checkbox`):
   - Native `<input>` → `.click()` directly.
   - Inside `<label>` → `.click()` the label's `.control`.
   - Contains nested `<input>` → `.click()` that input.
   - ARIA role control → `.click()` self.

2. **Semantic-relation Playwright rejection**: If precheck says `semantic_relation` but Playwright with `force:true` still rejects (should be extremely rare), retry with JS `.click()` on the target element.

### When NOT Allowed

- Hard blocker: never force-click through genuine overlay.
- Zero-size/hidden: never JS-click a zero-size element.
- Generic "just force it": every JS `.click()` must have clear semantic justification.

---

## 7. Error Enrichment

### Current Error Message
```
"Target was blocked during click."
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
    blockerIsTransparent: diagnostic.isTransparent,
    blockerIsNativeDialog: diagnostic.isNativeDialog,
    blockerAnchor: diagnostic.anchorDescription,
    probePointsTested: 7,
    clearPointsFound: 0,
    semanticRelationChecked: true,
    hitTestOutcome: 'hard_blocker',
  },
});
```

### Enhanced `mapPlaywrightError`

The current `mapPlaywrightError` at [InputService.ts:187-247](file:///d:/BrowseGent/src/v2/substrate/InputService.ts#L187-L247) should be updated to carry through the `semanticHitTest` verdict when Playwright produces its own error. When Playwright throws "intercepts pointer events" after our precheck passed, the enriched error should include both the precheck verdict and Playwright's error for debugging.

---

## 8. Relationship to Playwright's Actionability

**Design decision (updated with `force:true` usage):**

| Precheck Verdict | Playwright Option | Rationale |
|-----------------|-------------------|-----------|
| `clear_target` | `force: false` (default) | Let Playwright's stability/visibility checks run — they add value. |
| `semantic_relation` | `force: true` | Our semantic check verified the relationship. Playwright's overlay check would false-positive on label/shadow patterns. |
| `soft_ambiguity` | `force: false` | Position was found clear — Playwright should agree. If not, `retryable: true`. |

**Why not always `force: true`?**
- `force: true` skips ALL actionability checks: visibility, stability, enabled, overlay.
- We only want to skip the overlay check, not visibility/stability/enabled.
- For `clear_target`, letting Playwright also check provides defense-in-depth.

---

## 9. Integration with BrowseGent V2 Runtime

### How Click Reliability Connects to the Agent Loop

```
Agent (LLM) decides action
  → BrowseGentV2Harness.click(refId)
    → executeMutation()
      → RefService.resolve() — identity continuity check
      → RefSelfHealingPolicy — weakened ref decision
      → InputService.click() — semantic precheck + Playwright execution
        → semanticHitTest() — NEW
    → shouldRetrySilentDetachedClick() — post-click detach detection
    → TransitionService.compare() — evidence production
  → V2ToolResult → FailureClassifier → RecoveryState → UncertaintySignals
  → Agent (LLM) receives error + diagnostics + recovery hints
```

### Impact on Existing Error Codes

No new error codes needed:
- `target_blocked`: enriched with blocker diagnostics
- `target_hidden`: distinguished from blocked for zero-size/hidden cases
- `element_detached`: existing, used by retry mechanism
- `timeout`: existing, for Playwright timeouts

### Impact on Existing Recovery System

`RecoveryState.ts` already handles `target_blocked`:
```typescript
// RecoveryState.ts L111
if (code === 'target_not_clickable' || code === 'target_blocked' || ...)
  return ['avoid_repeating_blocked_action', 'choose_alternative_ref', ...]
```

The enriched diagnostics flow through to the planner via `V2ToolError.diagnostics`, giving the LLM agent actionable context about what's blocking and how to dismiss it.

### Impact on Uncertainty Signals

`UncertaintySignals.ts` already treats `target_blocked` as high uncertainty:
```typescript
// UncertaintySignals.ts L86
if (signals.includes('failure:target_blocked')) return 'high';
```

No changes needed. The enriched diagnostics don't affect the signal level — they improve the agent's decision quality.

---

## 10. Non-Goals

1. **CDP fallback for generic clicks**: BrowseGent uses Playwright. The V1 `domAdapter.ts` CDP path is separate and not part of V2.
2. **pointer-events:none manipulation**: `elementFromPoint()` already skips these. No manual filtering needed.
3. **Benchmark-specific tuning**: No heuristics targeting specific websites.
4. **Automatic overlay dismissal**: Agent decides, not the substrate.
5. **Multi-frame cross-origin iframe hit-test descent**: Rely on Playwright's frame handling for Phase 1.
6. **Force-clicking hard blockers**: Never silently click through a genuine opaque overlay.
7. **Retry loops**: One-shot precheck. Agent loop handles retries.
8. **CSS transform awareness**: Not needed — `getBoundingClientRect()` and `elementFromPoint()` handle transforms natively.
9. **z-index/stacking context logic**: Not needed — `elementFromPoint()` handles natively.
10. **Sticky header scroll compensation**: Phase 1 detects and reports. Phase 2 if evidence shows it's frequent.

---

## 11. Test Plan (Pre-Implementation)

> [!WARNING]
> **BrowseGent V2 currently has ZERO test coverage** for InputService, RefResolver, and click behavior. Tests are a prerequisite for any modification.

### Unit Tests

#### `semanticHitTest.test.ts` — Core Hit-Test Function

| # | Test Case | Expected Verdict |
|---|-----------|-----------------|
| 1 | Element alone in viewport | `clear_target` |
| 2 | `<button><span>Click</span></button>`, probe hits `<span>` | `semantic_relation:descendant` |
| 3 | Custom element with open shadow root, probe hits shadow content | `semantic_relation:descendant` |
| 4 | Shadow host containing target | `semantic_relation:ancestor` |
| 5 | `<label><input type="checkbox"><span>Check</span></label>`, target=`<input>`, probe hits `<span>` | `semantic_relation:label_control` |
| 6 | Target is `<label>`, probe hits nested `<input>` | `semantic_relation:label_control` |
| 7 | `position:fixed` div covering target | `hard_blocker` with `isFixedOrSticky:true` |
| 8 | Full-viewport overlay | `hard_blocker` with `coversFullViewport:true` |
| 9 | `<button style="width:0;height:0">` | `zero_size_or_hidden` |
| 10 | `<button style="display:none">` | `zero_size_or_hidden` |
| 11 | Partially covered: 1 of 7 probes clear | `clear_target` at clear position |
| 12 | Blocker with `opacity:0` | `clear_target` (transparent pass-through) |
| 13 | `<dialog>` blocking target | `hard_blocker` with `isNativeDialog:true` |
| 14 | SVG `<path>` inside `<button>`, probe hits `<path>` | `semantic_relation:descendant` |
| 15 | Element inside closed shadow root as blocker, but target is shadow host | `semantic_relation:ancestor` |
| 16 | Blocker diagnostic: element with `id` | `description` includes `#id` |
| 17 | Blocker diagnostic: element with classes, no id | `description` includes `.class` |
| 18 | Blocker diagnostic: nested element with `[id]` ancestor | `anchorDescription` populated |

#### `InputService.click.test.ts` — Full Click Pipeline

| # | Test Case | Expected Behavior |
|---|-----------|-------------------|
| 1 | Click on clear target | `success:true`, `clickEventObserved:true` |
| 2 | Blocked by opaque overlay | `V2OperationalError('target_blocked')` with diagnostic info |
| 3 | Shadow DOM click-through | `success:true` (force:true used) |
| 4 | Label/control click-through | `success:true` (force:true used) |
| 5 | Zero-size target | `V2OperationalError('target_hidden')`, NOT `target_blocked` |
| 6 | opacity:0 overlay | `success:true` (transparent pass-through) |
| 7 | Playwright mismatch with clear_target precheck | Error with `retryable:true` |
| 8 | Fixed overlay | Error with `retryable:true` |
| 9 | Full-viewport modal | Error with `retryable:false` |

#### `checkboxFallback.test.ts` — Checkbox/Radio State Verification

| # | Test Case | Expected Behavior |
|---|-----------|-------------------|
| 1 | Native checkbox, click changes state | No fallback needed |
| 2 | Hidden input + styled label, click doesn't change state | JS `.click()` via `label.control` |
| 3 | Custom checkbox with ARIA role, click doesn't change state | JS `.click()` on self |
| 4 | State verification after JS click | Error if still unchanged |

### Integration Tests

Run against real pages with Playwright:
1. Cookie consent banner over a button.
2. Custom checkbox (`<label>` wrapping hidden `<input>` + styled `<span>`).
3. Shadow DOM web components (open shadow root).
4. Sticky header partially covering target after scroll.
5. opacity:0 overlay covering interactive elements.
6. Full-viewport modal dialog.

---

## 12. Implementation Phases

### Phase 1: Core Semantic Hit-Test (Primary Deliverable)

**Scope**: Replace `findUnblockedClickPosition` with `semanticHitTest`. Add `force:true` for semantic relations. Add blocker diagnostics.

| Action | File | Change |
|--------|------|--------|
| CREATE | `src/v2/substrate/semanticHitTest.ts` | Core hit-test with shadow DOM + label/control + opacity check + blocker diagnostics |
| MODIFY | `src/v2/substrate/InputService.ts` | Replace `findUnblockedClickPosition`, use `force:true` for `semantic_relation`, enrich error messages |
| CREATE | `tests/v2/substrate/semanticHitTest.test.ts` | 18 unit test cases |
| CREATE | `tests/v2/substrate/InputService.click.test.ts` | 9 integration test cases |

**Estimated**: ~250 lines new code, ~60 lines modified.

### Phase 2: JS `.click()` Fallback for Checkbox/Radio

**Scope**: Post-click state verification for checkbox/radio. JS `.click()` fallback with 4-step label/control resolution.

| Action | File | Change |
|--------|------|--------|
| CREATE | `src/v2/substrate/checkboxFallback.ts` | Label/control resolution chain, state verification |
| MODIFY | `src/v2/substrate/InputService.ts` | Add post-click checkbox verification path |
| CREATE | `tests/v2/substrate/checkboxFallback.test.ts` | 4 test cases |

**Estimated**: ~100 lines new, ~20 lines modified.

### Phase 3: Enhanced Error Context in mapPlaywrightError

**Scope**: When Playwright rejects a click that our precheck approved, carry through the precheck verdict in the error diagnostics.

| Action | File | Change |
|--------|------|--------|
| MODIFY | `src/v2/substrate/InputService.ts` | Pass `semanticHitTest` verdict to `mapPlaywrightError`, enrich diagnostics |

**Estimated**: ~30 lines modified.

### Phase 4 (Conditional): Sticky Header Scroll Compensation

**Only if evidence from real-world usage shows sticky headers are a frequent blocker.**

**Scope**: When blocker `isFixedOrSticky`, compute blocker height, scroll element with additional padding, re-run `semanticHitTest`.

### Phase 5 (Conditional): Iframe-Aware Hit-Testing

**Only if evidence shows Playwright's frame handling is insufficient.**

---

## 13. Summary of Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Hit-test engine** | In-page JS via `evaluate()` | Same approach as agent-browser |
| **Shadow DOM traversal** | `parentNode \|\| host \|\| getRootNode().host` | Proven pattern; works for closed shadow roots |
| **Label/control check** | `closest('label').control` + `contains()` | Covers custom checkbox/radio patterns |
| **Multi-point probing** | Keep 7-point grid | Superior to agent-browser's center-only |
| **opacity:0 handling** | Treat as non-blocker (clear_target) | Transparent elements don't visually interfere |
| **force:true usage** | Only for `semantic_relation` verdicts | Prevents Playwright false positives without losing stability checks |
| **Soft ambiguity** | Proceed with warning | Avoids false blocks from animation/layout races |
| **Hard blocker** | Error with rich diagnostics | Agent must act; no silent force-click |
| **Zero-size** | Distinct `target_hidden` error | Different root cause than blockers |
| **JS `.click()` fallback** | Checkbox verification only + semantic mismatch | Disciplined; no generic force-click |
| **Retryable policy** | Fixed/sticky → retryable; modal → non-retryable | Based on blocker characteristics |
| **Dialog handling** | Rely on Playwright's auto-dismiss | Playwright handles JS dialogs; no CDP-level racing needed |
| **Closed shadow roots** | Accept observation gap; hit-test works | Rare in practice; shadow host is still clickable |
| **Native `<dialog>`** | Detect in diagnostic, not in interactive list | Child controls are discovered; diagnostic identifies the dialog |
| **Sticky headers** | Detect and report Phase 1; compensate Phase 4 | Evidence-driven, not speculative |

---

## Appendix A: Files to Read Before Implementation

Every file that was analyzed for this design. Any implementer should be familiar with all of these:

**BrowseGent V2 (src/v2/):**
- [`substrate/InputService.ts`](file:///d:/BrowseGent/src/v2/substrate/InputService.ts) — 248 lines, current click pipeline
- [`substrate/RefResolver.ts`](file:///d:/BrowseGent/src/v2/substrate/RefResolver.ts) — ~470 lines, semantic resolution
- [`substrate/ObservationService.ts`](file:///d:/BrowseGent/src/v2/substrate/ObservationService.ts) — 462 lines, element discovery + `COLLECT_INTERACTIVE_ELEMENTS_SCRIPT`
- [`harness/BrowseGentV2Harness.ts`](file:///d:/BrowseGent/src/v2/harness/BrowseGentV2Harness.ts) — 816 lines, orchestration
- [`runtime/RefService.ts`](file:///d:/BrowseGent/src/v2/runtime/RefService.ts) — 121 lines, identity continuity
- [`runtime/errors.ts`](file:///d:/BrowseGent/src/v2/runtime/errors.ts) — 37 lines, error codes
- [`runtime/FailureClassifier.ts`](file:///d:/BrowseGent/src/v2/runtime/FailureClassifier.ts) — 283 lines, error classification
- [`runtime/RecoveryState.ts`](file:///d:/BrowseGent/src/v2/runtime/RecoveryState.ts) — 140 lines, recovery strategies
- [`runtime/RefSelfHealingPolicy.ts`](file:///d:/BrowseGent/src/v2/runtime/RefSelfHealingPolicy.ts) — 49 lines, self-healing gate
- [`runtime/refFingerprint.ts`](file:///d:/BrowseGent/src/v2/runtime/refFingerprint.ts) — 45 lines, identity fingerprinting
- [`runtime/StabilizationService.ts`](file:///d:/BrowseGent/src/v2/runtime/StabilizationService.ts) — 34 lines, page stability
- [`runtime/UncertaintySignals.ts`](file:///d:/BrowseGent/src/v2/runtime/UncertaintySignals.ts) — 110 lines, uncertainty computation
- [`runtime/types.ts`](file:///d:/BrowseGent/src/v2/runtime/types.ts) — 119 lines, V2Ref/V2ToolResult types

**Agent-browser (reference):**
- [`element.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/element.rs) — BLOCKER_AT_JS, resolve_element_center, check_node_interception
- [`interaction.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/interaction.rs) — dispatch_click, dispatch_mouse_or_dialog, check/uncheck retry
- [`snapshot.rs`](file:///D:/agent-tools/agent-browser-source/cli/src/native/snapshot.rs) — ref building, cursor-interactive detection, hidden input promotion

## Appendix B: What Agent-Browser Has That BrowseGent Doesn't Need

| Feature | Why Not Needed |
|---------|---------------|
| CDP `Input.dispatchMouseEvent` | Playwright handles mouse dispatch |
| CDP `DOM.getBoxModel` | Playwright's `elementHandle` + `boundingBox()` |
| Dialog racing (`tokio::select!`) | Playwright auto-dismisses JS dialogs |
| Per-frame CDP sessions | Playwright manages frame tree natively |
| `find_cursor_interactive_elements` (cursor:pointer detection) | BrowseGent's `ObservationService` already does this (L368) |
| Hidden radio/checkbox promotion | BrowseGent uses label association for accessible naming |

## Appendix C: What BrowseGent Has That Agent-Browser Doesn't

| Feature | Value |
|---------|-------|
| 7-point multi-position probing | Catches partially-covered targets |
| Silent detached click detection | Sophisticated re-resolve + re-execute |
| Identity continuity (hard/soft fingerprint) | Maintains ref identity across DOM changes |
| Self-healing for weakened refs | Recovers from minor DOM restructuring |
| Transition evidence | Quantifies what changed after each action |
| Failure classification + recovery hints | Structured recovery strategies for planner |
