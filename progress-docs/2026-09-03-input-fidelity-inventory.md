# Input-Fidelity Inventory — Mutation-Stickiness Forensics Across All Runs

**Date:** 2026-09-03 · **Author:** Agent B (input fidelity) · **Method:** Read-only.
Programmatic mining of ALL `logs/webvoyager-lite/webvoyager_lite_*` run dirs
(135 runs, 115 with traces, 4,268 recorded actions) via an aggregation script over
`action_outcomes.json`, `failures/*.json`, `ref-resolution/*.json`, `observations/*.json`;
source audit of the owned substrate files; competitor contracts read from local
installs: browser-use 0.12.6 site-packages (`C:\Users\Utkarsh\.browser-use-env\Lib\site-packages\browser_use\`)
and Playwright 1.58.2 (`node_modules/playwright-core/types`).
**Purpose:** failure taxonomy for mutations that "report success but don't stick", plus the
implementation plan for `InputService.ts` / `KeyboardService.ts` / `RefResolver.ts` (+ tests only).
Companion to `2026-08-31-booking10-forensic-report.md` (which this doc extends from n=3 to n=115 runs).

---

## 1. Headline conclusions

1. **`input_not_applied` is a single-mechanism class in practice.** All 35 failure files
   are text retained = `""` after a successful `fill()` call: 33 on suggestion-gated ARIA
   comboboxes (`role=combobox`, `aria-autocomplete=list`, `aria-haspopup=listbox`), 2 on an
   email-capture textbox. In every diagnostic-bearing episode `targetConnected=true` and
   `activeElement=button` — the widget's own JS synchronously clears the typed value and
   moves focus. This is the "suggestion-gated" class; retrying the same fill is provably
   futile without the expand→type→pick-suggestion protocol.
2. **The current type path has exactly one read-back with zero retry.** `InputService.type()`
   reads the value once immediately after `fill()` and throws on empty. There is no settle
   delay (widgets that clear on a microtask/next frame are missed → false success), no
   partial-application handling, no concatenation repair, no bounded retry. browser-use
   does all four (§6).
3. **Twin-instance resolution has a structural defect: DOM-order truncation.**
   `RefResolver` caps scoring at the first 5 matches per selector
   (`MAX_CANDIDATES_PER_SELECTOR = 5`). On repeated-control pages (`svg.icon__svg` × N) the
   recorded element is frequently *not* in the first 5 DOM matches, so the true target is
   never scored while 5 unrelated look-alikes tie at 115 → `ambiguous_ref_resolution`
   dead-end (42 occurrences) or a wrong-twin win. Concrete proof in §5.
4. **`stateChanged=false` on a successful type/click is NORMAL, not silent failure.**
   `stateChanged = urlChanged || generationChanged` (`src/v2/trace/ActionOutcomeRecord.ts:13`).
   670/824 successful types had no page re-render — that is expected for plain text entry.
   Do not read it as non-retention. The real retention gate is the in-action read-back;
   cross-turn retention is currently *unverifiable from traces* because observation refs
   do not capture input `value` (verified: obs ref keys are
   `actionability,backendNodeId,box,capabilities,…` — no `value`).
5. **`select` is unverified.** 13/17 selects "succeeded" with no postcondition that the
   requested option is the one actually selected; 4 failures are all ESPN__10 (2 `timeout`,
   2 `target_not_selectable`).
6. **Checkbox clicks are unverified.** `click()` reports `clickEventObserved` +
   `targetConnectedAfterAction` but never whether the toggle actually flipped.

---

## 2. Run inventory (aggregated over all 135 run dirs)

| Metric | Value |
|---|---|
| Run dirs | 135 (115 with trace dirs) |
| Total recorded actions | 4,268 |
| Actions by tool | click 1,477 · type 966 · navigate 550 · press 378 · search_page 441 · get 152 · scroll 128 · wait 99 · inspect_region 60 · select 17 |
| Outcomes by errorCode | timeout 459 · target_blocked 292 · action_blocked_by_loop_detector 116 · ambiguous_ref_resolution 42 · **input_not_applied 44** · low_confidence_ref 21 · target_hidden 4 · target_not_selectable 2 · target_not_editable 1 · stale_ref 1 |
| type outcomes | 966 total → 823 success, **44 input_not_applied** (4.6% of all type actions) |
| click outcomes | 1,477 total → 705 success, 226 target_blocked |
| target_blocked by tool | **click 226 · type 68** |
| select outcomes | 17 total → 13 success, 4 fail (all ESPN__10) |
| Failure files (`failures/*.json`) by kind | timeout 455 · target_blocked 292 · action_blocked_by_loop_detector 62 · **input_not_applied 35** · ambiguous_ref_resolution 42 · unknown 9 · low_confidence_ref 21 · target_hidden 4 · environment_block 4 · target_not_selectable 2 · target_not_editable 1 · stale_ref 1 |

(44 errorCode occurrences vs 35 failure files: the errorCode is also emitted on outcomes
whose failure artifact was deduplicated or superseded; the 35 files are the canonical set.)

---

## 3. Failure taxonomy

| # | Class | Freq | Mechanism hypothesis | Confidence |
|---|---|---|---|---|
| A | `input_not_applied` — suggestion-gated combobox clears fill | 33 events / 16 runs | Widget JS clears value synchronously on non-suggestion input; `activeElement` moves to `button`; `targetConnected=true` (element alive, value destroyed) | Proven (diagnostics) |
| B | `input_not_applied` — email-capture textbox | 2 events / 2 runs | Value (33 chars) not retained; diagnostics predate requestedValue/retainedValue fields; mechanism unproven (validation clear vs re-render) | Symptom proven |
| C | `target_blocked` on **type** | 68 events | Pre-execution actionability=blocked snapshot or pointer-interception error; mostly the combobox's own popup `<p>`/`<div>` covering the input (blocker is widget-internal, non-fixed, not full-viewport) | High |
| D | `target_blocked` on click | 226 events | Mixed: fixed full-viewport overlays (dismissable → retryable) vs page-native partial blockers (nav spans, map controls) | Proven split |
| E | `ambiguous_ref_resolution` from DOM-order truncation | 42 events / 40 trace dirs | Selector matches ≫5 twins; scoring samples only first 5 DOM matches; true target unscored; weak look-alikes tie → honest refusal, planner dead-end (or wrong-twin risk when one weak twin edges ahead) | Proven (§5) |
| F | `select` divergence unmeasured | 13 unverified successes | No postcondition comparing requested label vs actually-selected option | Structural (code audit) |
| G | Checkbox toggle unverified | n/a (no field) | No pre/post `checked` capture on toggle clicks | Structural (code audit) |
| H | Delayed clear → false type success | unmeasurable today | Read-back happens immediately; widget clearing on next frame is invisible; observations carry no input value to cross-check | Structural (code audit) |

---

## 4. Class A evidence — `input_not_applied` (35 failure files, 16 runs)

Distribution: Booking__10 ×30 (14 runs) · Booking__0 ×3 (2 runs) · GitHub__0 ×2 (2 runs).
All 33 Booking events: `targetRole=combobox`, requested `"Paris"` (5 chars), retained `""`.
Both GitHub events: `targetRole=textbox`, `targetName:"you@domain.com"`, 33 chars → retained `""`.

Representative artifacts (newest diagnostics generation):

- `logs/webvoyager-lite/webvoyager_lite_1788207410696/traces/webvoyager_lite_1788207410696_webvoyager_Booking__10_a1/failures/failure_input_not_applied_obs_1_2.json`
  → `{requestedValue:"Paris", retainedValue:"", requestedLength:5, observedLength:0, activeElement:"button", targetConnected:true, targetRole:"combobox", targetName:"जगह डालें"}`
- Same run `ref-resolution/obs_1_1-v2ref_67-type-audit.json` → resolved target carries
  `ariaAutocomplete:"list"`, `ariaHasPopup:"listbox"`, `capabilities.typeable:true`,
  single candidate (`candidateCount:1`) — resolution is CORRECT; the widget destroys the value.
- Run `webvoyager_lite_1788193914828` trace `…_Booking__10_a1` `action_outcomes.json`
  shows the canonical waste loop: step0 type→input_not_applied, step1 click succeeds,
  step2 type→inputApplied=true, step3 press Enter — then `navigate` (Enter committed the
  geo-default destination, not the typed one).
- Older-generation diagnostics (runs ≤ `webvoyager_lite_1788128439841`) lack
  `requestedValue`/`retainedValue`/`activeElement`/`targetConnected`
  (e.g. `…_GitHub__0_a1/failures/failure_input_not_applied_obs_1_3.json` has only
  lengths + names). Enrichment landed in InputService between runs
  `1788128439841` and `1788193914828` — current code
  `src/v2/substrate/InputService.ts:235-261`.

**Cross-run implication:** every retried same-strategy fill on these widgets is a wasted
step; the fix is not "retry harder" but (a) catch the clear reliably (settle + re-read),
(b) attempt the keyboard/suggestion protocol once, (c) fail honestly with mechanism
evidence when the widget refuses.

## 4b. Class C evidence — type blocked

- 68 type→`target_blocked` events, heavily Booking combobox steps
  (e.g. `webvoyager_lite_1788210608490/…_Booking__10_a1/failures/failure_target_blocked_obs_1_2.json`:
  `blockerDescription:"p.da8a6fe12c.fab9d44163"`, `blockerIsFixedOrSticky:false`,
  `blockerCoversFullViewport:false`, `probePointsTested:7` — the widget's own popup layer).
- Retry-taxonomy inconsistency (read-only observation, classifier owned by Agent 1):
  `buildClickErrorFromVerdict` marks fixed/sticky non-full-viewport blockers
  `retryable:true`, while `mapPlaywrightError` maps pointer-interception to
  `target_blocked` with `retryable:false` (`src/v2/substrate/InputService.ts:343-345`)
  and `FailureClassifier.persistenceFor` marks the kind `persistent`
  (`src/v2/runtime/FailureClassifier.ts:230-256`). The blocker being the widget's own
  transient popup argues for a "retry after dismiss/settle" signal rather than
  persistent-dead classification.

---

## 5. Class E evidence — twin mis-resolution by DOM-order truncation

**Smoking gun** (`webvoyager_lite_1788041812580/traces/webvoyager_lite_1788041812580_webvoyager_ESPN__10_a1/`):

- `failures/failure_ambiguous_ref_resolution_obs_1_9.json` → 4 tied candidates, all
  `svg`, score 115 (= base 100 + tag 15), `ordinalReason:"exact_semantic_group_missing"`,
  page = ESPN scoreboard with `semanticGroupSize:337`.
- `observations/obs_1_8.json` ref `v2ref_5855`: `tagName:svg, role:button, name:"Search",
  box:{x:1244,y:79,16×16}`, selectors `["svg.icon__svg","svg:nth-of-type(1)"]`.
- The tied candidates live at x≈194–370 (nav icons); the recorded target is at x=1244 —
  **never scored** because `RefResolver.resolve` evaluates only
  `nth(0..4)` (`src/v2/substrate/RefResolver.ts:6,63-74`) and `svg.icon__svg` matches
  far more than 5 elements in DOM order.
- Secondary mechanism: the projection presents the SVG *as* its wrapper button
  (role/name inherited), but live scoring reads the SVG element itself
  (`role:""`, `accessibleName:""`) → name/role points unreachable → everything ties at 115.

Same signature recurs on Booking__10, Wolfram__Alpha__10, Huggingface__10, Coursera__10,
Google__Flights__0/10, ArXiv__10 (full per-run list in §2 aggregation; e.g.
`webvoyager_lite_1788244732279` hit it on 4 different tasks in one run).

**Generic fix direction (RefResolver, owned):** when a selector's match count exceeds the
cap, score the *whole* match set in one `evaluateAll` pass (same scoring function) instead
of truncating to the first 5 by DOM order; keep the existing overflow weak-selector guard
(`overflow_weak_selectors`) so honesty is unchanged. Optionally, when expected role/name
don't match the element directly, allow the nearest interactive ancestor's role/name to
contribute (projection-inheritance rule), bounded so unrelated elements cannot score.

---

## 6. Competitor contracts (read from local installs)

### browser-use 0.12.6 (`C:\Users\Utkarsh\.browser-use-env\Lib\site-packages\browser_use\`)

| Mechanism | Where | Behavior |
|---|---|---|
| Type read-back | `browser/watchdogs/default_action_watchdog.py` ~1981-1996 | After typing: `sleep(50ms)` → read `this.value ?? this.textContent` → returned as `actual_value` metadata |
| Divergence warning | `tools/service.py` ~738-743 | If `actual_value != text`: "⚠️ the field's actual value … differs from typed text. The page may have reformatted or autocompleted your input." |
| Concatenation auto-retry | `default_action_watchdog.py` ~1989-2050 | If clear was requested and `actual_value` is longer AND starts/ends with `text` → clear + set via **native prototype setter** (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) + dispatch `input`+`change` → re-read → report success/failure honestly |
| First-char dropped retype | `default_action_watchdog.py` ~1918-1941 | After first char on contenteditable: read back; if dropped, retype that char |
| Checkbox/radio postcondition | `default_action_watchdog.py` ~727-760, 950-990 | Pre-click `checked` → click → `sleep(50ms)` → re-read → unchanged ⇒ **JS `element.click()` fallback** → re-read → return `{checked}` |
| Native-prototype direct set | `default_action_watchdog.py` ~1603-1720 | For `date/time/datetime-local/month/week/color/range` + datepicker-detected inputs: set value via native setter + focus/input/change/blur (+jQuery trigger) instead of char typing |
| Clear strategy | `actor/element.py` ~951-1050 | JS `select()` + `value=""` + input/change events, **verify by re-read**, fallback triple-click + Delete |
| Combobox handling | `tools/service.py` ~744-753 | `role=combobox` or `aria-autocomplete` ⇒ 400ms dropdown settle + instruction to click a suggestion rather than press Enter |

### Playwright 1.58.2 `fill()` contract (verified earlier from `node_modules/playwright-core/types/types.d.ts:2659-2662`)

- fill = wait for element + actionability (**visible/enabled/editable — no hit-target
  "receives events" check**, unlike click) → focus → **clear existing text first** → set
  value → trigger `input` event. **No retention verification.**
- Implication 1: a post-fill value of `oldText+newText` is NOT fill's doing (it clears
  first) — concatenation after fill means the widget's JS re-rendered its own state on top.
- Implication 2: "target_blocked during type" cannot come from fill's own checks — it
  comes from our pre-execution actionability snapshot or the click-fallback path.
- `pressSequentially` = per-char keyboard events (the faithful path for
  keystroke-gated widgets).

---

## 7. Constraint inventory (binding for implementation)

1. **Ownership:** only `src/v2/substrate/InputService.ts`, `KeyboardService.ts`,
   `RefResolver.ts` (+ their tests, + fixtures). `errors.ts` is NOT owned —
   `V2OperationalErrorCode` is a closed union
   (`src/v2/runtime/errors.ts:3-25`), so any new failure must reuse an existing honest
   code: `input_not_applied` is the correct umbrella for "mutation accepted but state not
   retained" (type, select divergence, untoggled checkbox).
2. **Construction compatibility:** harness builds `new InputService()` no-args
   (`src/v2/harness/BrowseGentV2Harness.ts:27`) — any new knobs must be optional
   constructor params with current-behavior defaults.
3. **Result-shape compatibility:** `InputExecutionResult` is consumed via
   `BrowseGentV2Harness.executeMutation` → only additive optional fields allowed.
4. **Sensitive values:** diagnostics must keep suppressing password values
   (`isSensitiveInput`, `InputService.ts:517-519`).
5. **No classifier changes:** `FailureClassifier.ts`, `ActionOutcomeRecord.ts`,
   `ObservationService.ts` are read-only for this work.
6. **Unit-test mocking style:** locators are fakes with `evaluate: async (fn, input) =>
   input ? {score…} : <readback>`; RefResolver mocks expose `count()/nth()/evaluate()`.
   Any RefResolver `evaluateAll` path must keep a per-candidate fallback or update the
   owned tests accordingly. Existing test that pins exact `input_not_applied` diagnostics
   deep-equality will be updated to the richer (still honest) shape.
7. **Overfitting firewall:** no site names/selectors/task ids; behavior for pages where
   the mechanism doesn't trigger must be byte-identical (e.g. evaluateAll path only on
   overflow; settle re-read only for suggestion-backed controls; toggle evidence only for
   checkbox/radio targets).

---

## 8. Implementation plan (owned files only)

### 8.1 `InputService.type()` — read-back-verify-retry loop (mirrors browser-use)

1. After `fill(text)`: read value immediately (current behavior) **and** — when the target
   is suggestion-backed (`suggestionState.suggestionBacked`) — re-read after a short
   settle (~120ms) to catch next-frame clears (class H). Non-suggestion targets keep the
   immediate read (zero latency cost).
2. Classification of the first read:
   - `retained === requested` → success (report `retention: 'verified'`).
   - `retained` is a proper **prefix** of requested (partial application) →
     `pressSequentially(requested.slice(retained.length))` to complete, re-read
     (concatenation-completion semantics).
   - `retained` contains requested but is longer / differs → widget state divergence →
     native-setter clear + refill once, re-read (concatenation-repair semantics).
   - `retained === ''` and requested non-empty → bounded retry loop (default max 2
     retries): refocus → clear via fill('') (with verify) → fill(text) → settle → re-read.
3. On final failure throw `input_not_applied` with enriched honest diagnostics:
   existing fields + `attemptCount`, `attemptSummaries[]` (per-attempt retainedLength,
   activeElement), `mechanism` classification
   (`'suggestion_gated_clear' | 'cleared_after_settle' | 'diverged' | 'empty_after_retries'`).
   A failed type stays a failed type — strictly more evidence, never softer.
4. Success result gains optional `value.retainedValue`/`value.requestedValue` (redacted
   for password inputs) so downstream records can audit retention — additive only.

### 8.2 `InputService.click()` — checkbox/radio postcondition (mirrors browser-use)

- When the resolved target is `input[type=checkbox|radio]` (or `[role=checkbox|radio]`
  with `aria-checked`), capture pre-state → click → settle (~50ms) → post-state.
- Unchanged → one JS `element.click()` fallback → re-read.
- Still unchanged → throw `input_not_applied` with
  `{toggleBefore, toggleAfter, clickEventObserved, fallbackUsed}` — an untoggled checkbox
  is a failed mutation and must stop masquerading as success.
- Non-toggle targets: behavior byte-identical to today; result gains optional
  `interactionEvidence.toggle?: {before, after, verified}` when applicable.

### 8.3 `InputService.select()` — postcondition

- After `selectOption({label})`: read back `{value, selectedText}` (already does) and
  **verify** the selected option corresponds to the requested label (normalized equality
  against `selectedText` or the option's `value`).
- Mismatch → one retry with the alternate match strategy (`{label}` then `{value}` when
  they differ) → re-verify → on failure throw `input_not_applied` with
  `{requestedValue, selectedText, selectedValue}`.
- Missing-option Playwright errors keep mapping to `target_not_selectable` (unchanged).

### 8.4 `RefResolver.resolve()` — remove DOM-order truncation on overflow

- When `count > MAX_CANDIDATES_PER_SELECTOR` for a selector: run the existing scoring
  function over **all** matches via a single `evaluateAll` (capped at a generous internal
  bound for pathological pages), merge by `identityKey` keeping the best score, set
  `overflowed` exactly as today.
- ≤ cap: current per-candidate path, byte-identical.
- Keep every guard (`overflow_weak_selectors`, tie→ordinal→semantic-fallback→refuse)
  unchanged; the change only widens *which* elements get scored, so honest refusals
  remain refusals while the true twin now becomes reachable.
- Optional second mechanism (only if tests stay clean): scoring-function amendment to let
  a match inherit role/name points from its nearest interactive ancestor when the element
  itself has none (projection-inheritance). Bounded + firewall-tested.

### 8.5 `KeyboardService.press()` — evidence, not behavior change

- No protocol change (press is focus-relative; commit verification lives in transition
  evidence owned elsewhere). Optionally document the Enter-commits-geo-default hazard in
  the type-result evidence (§8.1 step 4) so the planner can see "retained but the
  subsequent commit discarded it" — without touching classifier files.

### 8.6 Tests + fixtures

- Unit (`tests/unit/v2/inputServiceErrorMapping.test.ts` + new
  `inputServiceRetention.test.ts`): partial-prefix completion, concatenation repair,
  bounded-retry exhaustion (honest failure + attempt evidence), settle-clear catch,
  select divergence, checkbox toggle fallback + untoggled failure, sensitive-value
  redaction, empty-fill clear passthrough.
- Unit (`tests/unit/v2/refResolver.test.ts`): overflow now scores beyond DOM index 5
  (fake page with >5 matches where the true target is last), guard still refuses weak
  overflow, non-overflow path unchanged.
- Integration (`tests/integration/v2/observationRuntime.test.ts` style + real browser):
  new fixtures `tests/fixtures/v2/retention-rerender-input.html` (input whose JS clears
  the value on the next frame), `partial-type-input.html` (drops last chars once),
  `overflowed-icon-buttons.html` (N>5 identical SVG icons, target last in DOM),
  `divergent-select.html` (select whose JS reverts selection),
  `stubborn-checkbox.html` (checkbox whose default is prevented once).
- Gates: `npm run test:unit` all green, `npx tsc --noEmit`, `npm run check:v2`.

---

## 9. Trace evidence index (quick lookup)

| Claim | File(s) |
|---|---|
| Combobox clear w/ full diagnostics | `logs/webvoyager-lite/webvoyager_lite_1788207410696/traces/…_Booking__10_a1/failures/failure_input_not_applied_obs_1_2.json` (+ `ref-resolution/obs_1_1-v2ref_67-type-audit.json`) |
| Waste loop type→click→type→Enter→navigate | `logs/webvoyager-lite/webvoyager_lite_1788193914828/traces/…_Booking__10_a1/action_outcomes.json` (steps 0-4) |
| Email textbox class | `logs/webvoyager-lite/webvoyager_lite_1788099403594/traces/…_GitHub__0_a1/failures/failure_input_not_applied_obs_1_3.json` |
| Twin truncation | `logs/webvoyager-lite/webvoyager_lite_1788041812580/traces/…_ESPN__10_a1/failures/failure_ambiguous_ref_resolution_obs_1_9.json` + `observations/obs_1_8.json` (v2ref_5855) |
| Type blocked by widget popup | `logs/webvoyager-lite/webvoyager_lite_1788210608490/traces/…_Booking__10_a1/failures/failure_target_blocked_obs_1_2.json` |
| Select failures (ESPN) | `webvoyager_lite_1787778258966` step5 timeout · `1787862862418` step6 timeout · `1788041812580` step7 target_not_selectable · `1788073716959` step7 target_not_selectable |
| Observation refs carry no `value` | any `observations/obs_*.json` ref key list |
| `stateChanged` semantics | `src/v2/trace/ActionOutcomeRecord.ts:13` (read-only citation) |

## 10. Non-goals / rejected

- Any site-, task-, locale-, or model-specific logic; selector hardcoding.
- Forcing values via naive `element.value = x` without the native-setter + event protocol
  (breaks controlled widgets — browser-use's own approach exists precisely for this).
- Removing or weakening `input_not_applied` / `ambiguous_ref_resolution` (they are honest
  and necessary; this work only adds evidence and reachability).
- Touching `FailureClassifier`, `ObservationService`, projection, planner, evaluator.
- Global timeout/latency inflation.
