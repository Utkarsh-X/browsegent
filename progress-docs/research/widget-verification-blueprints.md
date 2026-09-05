# Widget & Verification Layer — Implementation Blueprints (Core-Architecture Round 2)

**Worktree**: `D:\BrowseGent-arch-research2`, detached at mainline tip `3c91567` (`feat/openrouter-stealth-benchmark`).
Correction to the run instructions: the literal `main` branch (7d24344) predates run 16 and contains **none** of the
round-1 implementation (`git log main --grep "round 1"` is empty; `main` is 171 commits behind the mainline), so
"current main branch" resolves to the development mainline where round 1 and run 16 actually landed. Source
study is confined to `src/v2/**` + `scripts/check_v2_boundaries.ts`; artifacts are READ-ONLY from
`D:\BrowseGent\logs\webvoyager-lite\{webvoyager_lite_1788594583363 (run 15), webvoyager_lite_1788612821955 (run 16)}`.

**Round-1 verification (done items, confirmed in this worktree's source)**: F1 `selectOptions` now copied in
`PlannerWorkingSetSelector.serializeSelectedProjection` (line 746); F3 `effect?: 'page'|'local'|'none'` on
`PlannerLastResultSummary` (`planner/types.ts:191`), computed at `PlannerInputComposer.ts:253`, rendered as
`ok (no observable effect)` / `effect=none` (`PromptLayoutEngine.ts:67,270-274`) with the prompt rule at
`PlannerPrompt.ts:102`; F7a `rank_loss` counted in `PlannerWorkingSetSelector.ts:902` (`workingSetTypes.ts:42`);
F14 dead files deleted (`trace/Brain1SurfaceOverlap.ts`, `brain1/serializeProjection.ts`, `extractSurfaceEvidence`);
`v2-no-v1-imports` boundary rule (`scripts/check_v2_boundaries.ts:142,204`); `robustJsonParse` vendored at
`src/v2/planner/robustJsonParse.ts`. **Important dating note**: run 16 predates these commits — its 222 planner
inputs contain no `effect` field, no `selectOptions`, no `rank_loss` — so both runs are clean pre-F1/F3 baselines
for the replay counts below. P3 is also already wired (`V2AgentLoop.ts:129-134` emits `budget_low:N`; prompt block
`PlannerPrompt.ts:24,100,146`), which shrinks round-1 F12 to its recovery-state half (§4.2).

**Run-16 headline (from `progress-docs/run16-validation-report.md`, verified in `summary.md`)**: combined
16/30, strict 9/30, 4,549 tok/call (−11.7%), system 7,371 B (−30.3%), 222 planner calls, 195 dispatched+guarded
actions, 70% internal pass.

---

## 1. BLUEPRINT 1 — F4 deterministic post-action verification suite (with W-A/W-D integration)

### 1.1 Check catalog: exact touchpoints, signals, routing

All checks run **substrate-side after dispatch**, before the next planner input is composed. Signals ride the
existing pipelines: failure-ish signals → `FailureClassifier` evidence → `failures[]` → PROBLEMS; informational
signals → `UncertaintySignals` via `V2AgentLoop`'s `extraSignals`; steering → `RecoveryStateBuilder` states.
Advisory vs hard is decided once, centrally: new checks enter `ADVISORY_REASON_PREFIXES`-style advisory
routing and never hard-reject a `done` (honest-escalation invariant preserved).

| Check | Where implemented | Signal / evidence | Routing | Default severity |
|---|---|---|---|---|
| **C1 href-vs-landed-URL** | `InputService.click` already returns `interactionEvidence.clickEventObserved`; extend it to also return the resolved `href` (it has the element handle: `element.getAttribute('href')` — `href` is already parsed into `selectorCandidates` by the walk, `ObservationService.ts:449-451`, so no schema change needed). Compare at the harness mutation-result layer: `BrowseGentV2Harness.buildSuccessfulMutationResult` (post `transitionService.compare`) — before vs after URL are both in scope there. | `link_no_navigation` on `V2ToolResult.evidence.notes` + a `FailureEvidence(kind='link_no_navigation', retryable=false, targetRef)` when: click success ∧ clickEventObserved ∧ href is http(s) ∧ **normalize(href-path) ≠ normalize(before-path)** ∧ **normalize(after-path) = normalize(before-path)** (i.e., a real link was clicked and the page did not move). | **Advisory**: inject as `lastResult.effect`-adjacent note + one PROBLEMS line; never blocks; escalates to `wrong_target_type` recovery only after 2 fires on the same ref (reuse `repeated_persistent_target` counting). | advisory |
| **C2 combobox-open verification** | `InputService.type`/`click` on suggestion-backed controls (`inspectSuggestionControl` already counts visible options, `InputService.ts:393-459` — its result is currently discarded for clicks). Capture `visibleOptionCount` before/after into `InputExecutionResult`; compare in the harness mutation layer. | `suggestion_surface_did_not_open` advisory note when: suggestion-backed control ∧ success ∧ optionCount(before)==0 ∧ optionCount(after)==0 ∧ the plan's remaining steps contain no `press Enter` (suppress-with-lookahead, see FP analysis). | advisory only; steers via the existing COMBOBOX_GUIDANCE block (add one strippable sentence). | advisory |
| **C3 result-surface loading check** (result-count delta / empty landing) | `V2AgentLoop` post-observation (it already computes `hasObservableEffect`); needs only `observation.stats.visibleRefCount` (already on every observation) + before/after URL. | `empty_results_landing` when: URL-path changed ∧ after `visibleRefCount` < 15 ∧ goal is not a report-failure goal. The Google `/sorry` class is already caught by `environment_block` — C3 must **skip when a captcha signal exists** to avoid double-reporting. | advisory; suggests `wait_for_hydration` → `reobserve` → `search_page` via one PROBLEMS sentence (reuses `empty_navigation_surface` mechanisms, `RecoveryState.ts:152-180`). | advisory |
| **C4 URL query-echo of goal requirements** | New pure function beside `GoalProgressTracker` (`parseGoalRequirements` already extracts destination/dates); evaluated in `V2AgentLoop` right after a **successful submit-class action** (click on a `submitControlRefs` ref — the set already exists, `PlannerInputComposer.ts:176-187` — or `press Enter` with a form present). Echo test: landed URL query (decoded) must contain a normalized token of the typed destination value or a date in the parsed requirement range. | `submit_requirements_not_echoed` when a submit succeeded but the landed URL carries **no** query at all (Booking city-page case) or lacks every requirement echo. **Degrade honestly**: when the URL param is opaque (base64 `tfs=` on Google Flights — both runs' final URLs), the check reports `results_surface_unverified` instead of guessing values. | advisory; pairs with the F10 `submit_form` refusal (§2.3) which prevents the class pre-dispatch. | advisory |
| **C5 form-submit results-triad** | Same evaluation point as C4; triad = URL-path change ∨ generation change (already `stateChanged`) ∧ non-empty interactive surface (`interactionCount > 0`). This is `stateChanged=false` + C4's URL knowledge combined into one honest verdict on the submit action itself. | Submit action's `V2ToolResult.value` gains `{ resultsSurface: 'loaded' \| 'unchanged' \| 'empty' }`. | feeds C3/C4; no separate signal. | — |

**W-A integration — the empty-capture recapture loop.** Touchpoint: `BrowseGentV2Harness.captureAfterMutationObservation`
and `captureCurrentObservation` (the run-15/16 W-A evidence: 6 empty obs in run 15 — `Booking__0 obs_1_13`,
`obs_1_21`, `Booking__10 obs_1_16`, `ArXiv__0 obs_1_5`, `Google__Search__0/10 obs_1_3` — and 4 in run 16:
`Booking__0 obs_1_15`, `Amazon__10 obs_2_12`, `Google__Search__0/10 obs_1_3`).
Design (three steps, all in the harness):
1. **Recapture**: after any mutation, if `captured.refs.length === 0`, run the bounded wait-retry that
   `ObservationService.waitForInteractiveNavigationState` already implements for the *empty-navigation* case
   (`ObservationService.ts:136-158`, up to 6 s) — currently applied only when `retryEmptyNavigationCapture`
   is set (navigate path only, `BrowseGentV2Harness.ts:168`); extend the flag to **all** post-mutation captures
   (`executeMutation` → `buildSuccessfulMutationResult` → capture call, `BrowseGentV2Harness.ts:503-510`).
2. **Pre-submit URL memory**: record `before.url` into the mutation result (one field on
   `V2ToolResult.value`), so even when the post-capture is empty, the next planner input states
   "submit dispatched from `<url>`; the post-submit capture was empty" instead of silence.
3. **Honest surface**: if still empty after recapture, the existing `empty_navigation_surface` recovery fires
   unchanged (it already renders "wait once, then re-observe, escalate honestly"); add its state to the
   conditional-prompt keep-list so the guidance survives `--planner-conditional-prompt`.

**W-D integration — navigate-loop suppression.** Touchpoint: the same-URL-navigation guard block
(`V2AgentLoop.ts:376-408`) and `RecoveryStateBuilder`.
Design: count `same_url_navigation` pre-execution rejections per run (the guard site is the natural counter);
at the **second** rejection set `recovery.state = 'navigate_loop'` (new `PlannerRecoveryStateKind`) with
`blockedAction: {tool: 'navigate'}` and mechanisms
`['press_enter_on_last_typed_field', 'click_visible_submit_control', 'act_on_visible_controls', 'stop_if_dead_end_evidence_is_sufficient']`.
Enforcement stays with the existing machinery — the guard already refuses the dispatch, and
`shouldPrioritizeRecoveryControls`-style promotion keeps submit controls visible. Optional hardening behind a
flag: while `navigate_loop` is active, pre-execution-reject any further `navigate` whose URL normalizes equal
to the current page (the planner kept issuing navigates after the signal in run 15; the state makes the
refusal self-documenting instead of a bare guard error).
**Run-15 receipt**: `Google__Flights__0` spent steps 3–11 — nine consecutive attempts, all pre-execution
rejections (4× `same_url_navigation` GUARD + 5× `action_blocked_by_loop_detector` hard-block; `action_outcomes.json`)
— on a flow the substrate had already refused. Run-16 receipts: `Flights__0` 1 dispatched navigate (recovered),
`Flights__10` 1 guard at step 12, `Booking__10` 3 same-url guards. C-wiring cost is one counter + one state.

### 1.2 False-positive analysis (replayed against real traces)

Replay method: for every successful click on a `role=link` ref, resolve `href` from `selectorCandidates`
(`a[href="…"]`), compare path-normalized (host, path; query kept for echo checks) before/after URLs from
`trace.json` before/after observation IDs.

**C1 href-vs-landed.** Run 15: 14 link clicks with real hrefs → 1 navigated OK, **12 fires**; run 16: 4 → 1 OK, **2 fires**. Fire classification:

| Fire class | Instances | Verdict | Guard that absorbs it |
|---|---|---|---|
| Card-link bleed (click never navigates; the exact P5-class waste) | Coursera__10 run-15 steps 3–7 (5 fires, `/learn/…` card hrefs, URL stuck on `/search?query=…`) | **True positive** — this is the 8-click bleed | none needed; this is the target |
| Premature portal click (true no-navigation, recovered later) | ESPN__0 run-15 `step_2 /nba/` from `espn.in`; run-16 `step_2 /nba/` | True positive (signal correct; task later passed by clicking standings) | compose-time re-check downgrades once the URL catches up |
| **Late navigation** (URL changed *after* the post-action capture) | ArXiv__0 `step_2 href=/search` (both runs; `arxiv.org/archive/quant-ph` unchanged in the after-obs, task passed anyway) | **False positive at dispatch time** | **Compose-time re-check**: evaluate C1 when composing the *next* input against the fresh observation URL, not at dispatch; if the fresh URL now matches the href, downgrade to no-op. This re-check is free — the loop already holds the fresh observation |
| Redirector/new-tab links (click is "wasted" but mechanism is a non-top-level navigation) | Google__Search__0 run-15 steps 3–7: 5 fires on `/url?sa=i&…` image-redirect hrefs | Factually true ("page did not navigate") but repetitive | (a) once-per-`(refId, before-URL)` cap — collapses the 5 to 1; (b) advisory-only; (c) message phrased neutrally: "the page did not navigate; the link may open elsewhere, redirect, or be inert — do not repeat it" |
| Fragment / javascript hrefs | 2 skipped in run 15 (`#…`) | excluded by construction | href-class filter |

Net after guards (re-run of the numbers): run 15 → **6 net signals** (Coursera__10 ×5, ESPN__0 ×1; ArXiv/Google absorbed),
run 16 → **1 net signal** (ESPN__0). Zero of these are on tasks that passed *because* the click navigated —
no false block; all fires are advisory.

**C2 combobox-open.** Run 15: 18 suggestion-control interactions → 12 opened, 3 no-option fires
(Amazon__0 `type "Search Amazon"`, Amazon__10 same, Booking__10 `type` into `जगह डालें`); run 16: 24 → 16 opened, 2 fires (Amazon×2).
**False-positive class**: Amazon's search box is suggestion-backed (`aria-autocomplete=list`) but the passing
flow typed + pressed Enter without ever clicking an option (Amazon__0 passed strict in both runs). Guard:
**plan-lookahead suppression** — do not fire when the same plan contains a `press Enter`/submit step (the
Amazon plans did); otherwise advisory-only. Residual true-positive: Booking__10's destination type produced no
suggestions and the value was never committed — exactly the class `repeated_type_same_value` recovery targets;
C2 gets it 3 episodes earlier (step 3 vs the recovery threshold).

**C3 empty-landing.** Run 15: 1 (Google `/sorry` — already captcha-classified, suppressed); run 16: 3
(2× `/sorry` suppressed + **Amazon__10 step_9: navigate → 6-visible-ref Asurion results page** — the page the
task then failed on for missing price detail). Net run 16: **1 true fire** on a failed task → wait/reobserve
steering had material room to act.

**C4 query-echo.** Run-15 Booking__0 and Booking__10 both executed submits while `goalProgress.dates` was
`NOT_SET`/focused (verified in inputs: `goalProgress entries [{destination, typed:"Mexico"}, {dates, NOT_SET}], focus=dates`)
and landed on parameterless city pages (`booking.com/city/mx/mexico.hi.html`, refs 3,068/2,889) — C4 fires in
both. Run-16 Booking__0 (the win) submitted only after both date cells were clicked and landed on a results
surface — C4 stays silent (no false fire on the winning trajectory). Google Flights lands on an opaque
`tfs=CBwQ…` blob in all four widget episodes — C4 degrades to "results surface loaded" (C5), never invents
decoded values.

### 1.3 Which tasks plausibly flip

| Task | Evidence | Mechanism with most credit |
|---|---|---|
| Booking__10 (strict 0 both runs) | 15 episodes, premature city-page submit, empty tail | C4 + submit_form refusal (§2.3) + W-A recapture |
| Google__Flights__0 (0 both runs) | run 15: 9 wasted navigate attempts; run 16: 5 uncommitted types | W-D state + pick_option (§2.2) |
| Coursera__10 (strict in run 16; 8-click bleed in run 15) | C1 fires 5× on run-15 card clicks | C1 (already partially covered by P5; C1 fires earlier and names the href) |
| Booking__0 (judge-win run 16) | already flipped; C-checks are protective | guards against regression to the run-15 trajectory |
| Amazon__10 (judge-NO run 16) | 6-visible-ref landing | C3 |
| ArXiv__0, ESPN__0, Google__Search__0 | passes; fires were absorbed by guards | confirms no-regress |

---

## 2. BLUEPRINT 2 — F10 seek-family widget primitives

### 2.1 Evidence base (both runs, reconstructed)

**seek itself is never used explicitly** (`"seek"` appears in 0 planner outputs in either run), but the
**implicit-seek continuation** fired in run-16 Booking__0 (step 5: the planner's manual click on the
recommended `अगले महीने` control was substrate-continued for 1 iteration, `stopReason: target_reachable`,
`action_outcomes.json`) — the seek contract's "planner decides WHAT, substrate owns iterations" design is
proven in production.

**Run-16 Booking__0 win path** (11 dispatched actions; judge-win): dismiss (steps 0–2) → `type v2ref_67 "Mexico"`
(3) → search (4) → 3× `अगले महीने` next-month (5–7; implicit seek +1 month) → **both December cells** `शुक्रवार, 25
दिसंबर 2026` + `शनिवार, 26 दिसंबर 2026` (8–9; role=checkbox, offscreen, picked from the P1-boosted pinned rows) →
`खोजें` submit (10; `stateChanged=true` → results surface) → hotel link (11) → done with two hotel names.
**Run-15 Booking__0 waste map**: 1× next-month (5) → submit (10) landed the *city deals page* with `dates:
NOT_SET` still focused → 4 wandering clicks → second submit (15) → **two empty captures** (obs_1_13/obs_1_21) →
exhausted with `finalAnswer: "खोजें button"` (a button label, not an answer). Run-15 Booking__10: 3× next-month
(steps 4–6) → submit at step 7 (`stateChanged=true`) onto `city/fr/paris.html` — again with `dates` unsatisfied.
**Flights type-churn**: run-16 Flights__0 typed into `Where from?`/`Where to?`/date fields **6 times** across 13
episodes (216×2, 236×2, 4435×2, 253, 8492…) without committed selections; run-15 Flights__10 typed 6× as well.

### 2.2 `pick_option` — contract

```json
{"tool": "pick_option", "ref": "v2ref_236", "text": "Manchester", "expect": "committed"}
```
Semantics: one substrate-side suggestion-commit transaction against a suggestion-backed control
(role combobox/searchbox ∧ aria-autocomplete ∈ {list,both,inline} ∨ aria-haspopup=listbox — the exact
predicate already coded in `visibleSuggestionOptionRefs`, `PlannerWorkingSetSelector.ts:385-403`, and
`inspectSuggestionControl`): click-open if collapsed (reuse `tryOpenSuggestionWithKeyboard`,
`InputService.ts:488-499`) → `fill(text)` → bounded wait for options (`waitForSuggestionState`, 750 ms,
`InputService.ts:461-486`) → click the option whose normalized label contains/equals `text` (deterministic
matcher; ambiguity = refuse, below) → verify retention (`inputValue` non-empty, existing check
`InputService.ts:235-261`) → re-observe. **Loop body is ≤2 dispatches + 1 capture**, mirroring `seek`
(`V2ToolDispatcher.ts:87-135`).

Guardrails and honest stop reasons (same shape as `seekResult`, `V2ToolDispatcher.ts:138-159`):
`no_matching_option` (list opened, no label match — value is informational: the observed option labels go into
`value.options[]` so the planner can re-pick), `suggestion_surface_did_not_open` (→ C2 signal), `ambiguous_match`
(≥2 options match the normalized text — **refuse**; return the candidate labels), `input_not_applied` (existing
code), `stale_ref`. Hard cap 3 internal retries (open→type→wait) then refuse. The primitive **never** presses
Enter as a fallback (that is a different commitment semantics the planner must choose explicitly).

**Does `pick_option` subsume the type→suggestion-click flow?** Partially and deliberately: it subsumes the
*mechanical* part (the 2-episode type→re-observe→click-suggestion cycle) but **not** free-text-then-Enter
flows (Amazon passed by Enter; the planner must retain that choice). Decision: keep `type` and `press Enter`
unchanged; `pick_option` is additive. `repeated_type_same_value` recovery keeps its prompt guidance but gains
one mechanism name — `use_pick_option_primitive` — inserted at the head of `nextMechanisms`
(`RecoveryState.ts:101-118`). The planner-facing rule: "when a suggestion-backed control must be committed
from its list, prefer one pick_option call over type-then-click sequences."

**Episode replacement map (from both runs' reconstructions)**:
- run-16 Flights__0: 6 `type` episodes + the ep_8 navigate detour → `pick_option(216,"Edinburgh")`,
  `pick_option(236,"Manchester")`, 1 date `type` + submit ≈ **5 planner episodes replaced** (13 → ~8).
- run-15 Flights__10: 6 types + scroll/wait tail → 2 pick_option + submit_form ≈ **5 replaced**.
- run-15/16 Amazon flows: **0 replaced** (Enter flow stays legal; primitives must not be forced).
- Booking destination (`type v2ref_67 "Mexico"`): optional pick_option on the destination combobox
  (`data-testid`-free, suggestion-backed) — replaces the blocked-first-type + dismiss dance only when the
  suggestion surface exists; refuse honestly otherwise (Booking's destination widget opened a suggestion list
  in neither run — the primitive would return `suggestion_surface_did_not_open` in ~1 dispatch and the planner
  falls back to plain `type`).

### 2.3 `submit_form` — contract

```json
{"tool": "submit_form", "ref": "v2ref_92", "expect": "results_surface"}
```
Semantics: click the submit control (must be in `submitControlRefs` — the commit-phase set
`PlannerInputComposer.findSubmitControls`, `HorizonDetector.findSubmitControls`, already wired into the
working set at `PlannerInputComposer.ts:176-187` and force-included at score +160) → stabilize → observe →
grade the results-triad (C5): URL-path change ∨ generation change, ∧ non-empty surface. Value returns
`{ resultsSurface, url }`; on `unchanged`/`empty` it returns **success=false** with an honest error code so
the planner re-plans (a wasted submit then costs 1 episode, not 3).

**Refusal conditions (pre-dispatch, deterministic; the planner keeps the decision, the substrate refuses the
obviously destructive ones)**:
1. `goalProgress.focus` is set (a focused requirement exists) **and** the focused requirement's state is
   `NOT_SET` / `partial:*` — refuse `requirements_unmet` and list the unmet requirement keys in the error.
   *Receipt*: this refusal fires at run-15 Booking__0 step 10 and Booking__10 step 7 (both submits happened
   with `dates` focused and `NOT_SET`) — the exact premature-submit class that turned both runs into
   `v2_max_steps_exhausted`.
2. The ref is not a submit-class control (not in `submitControlRefs` and not `inForm` submit/button kind) —
   refuse `not_a_submit_control`.
3. A same-URL submit was already refused once this run (`submit_refused_repeat`) — mirrors the W-D counter so
   a stubborn planner cannot burn episodes on refusals.
Refusals render through the normal failure path (`failures[]` + `wrong_target_type` mechanisms extended with
`complete_focused_requirement_first`), so steering, not silence, reaches the model.

**Interaction with the commit phase**: `findSubmitControlRefs` currently promotes submit controls *only when
every parsed requirement is addressed and no press happened* (`PlannerInputComposer.ts:176-187`). `submit_form`
reads the same predicate as its guard #1 — one source of truth: extract the predicate into a shared helper
(`commitPhaseReady(goalProgress, goalLineage)`) used by both, so the promotion and the refusal can never
disagree. After any successful `submit_form`, `lastCompletedSamePageMutation` is set as for a click (the
same-URL-navigation guard at `V2AgentLoop.ts:376-408` then protects the post-submit surface from reset).

### 2.4 Planner-facing prompt text (conditional, strippable) and cost

Add one conditional block to `PlannerPrompt.ts` (keep-list predicate: the surface contains a suggestion-backed
control ∨ `submitControlRefs` non-empty — both already computable in the compiler's execution IR):

> `PICK_OPTION: for a suggestion-backed control (aria-autocomplete or aria-haspopup=listbox), one
> {"tool":"pick_option","ref":…,"text":"<requested value>"} call opens the control, types, clicks the matching
> option, and verifies the commit — prefer it over type-then-click sequences. If it returns no_matching_option
> or ambiguous_match, use the returned option labels to re-decide; never retype the same value.
> SUBMIT_FORM: submit with {"tool":"submit_form","ref":…} when the form's requirements are satisfied; it refuses
> with requirements_unmet when GOAL PROGRESS still shows a focused unsatisfied requirement — then complete that
> requirement first. A refused submit is steering, not a failure to retry.`

Cost: ~530 B system bytes **only when engaged** (conditional strip; engaged on 4 widget tasks + Amazon/Coursera
search episodes of 30 — replay estimate ≈ 30–40% of balanced30 calls ≈ ~180 B mean/call amortized); tool-table
addition `pick_option: requires ref and text / submit_form: requires ref` ≈ 90 B when stripped (single line in
the valid-tools list). Output-side: one JSON key, ~0. Output tokens unchanged.

---

## 3. BLUEPRINT 3 — F2 + F7b diff-first rendering (markers + names line)

### 3.1 The appeared-inflation problem, and the marker-source decision

Round-1's naive design ("mark `refChanges.appeared`") is **unsafe at page scale**: the replay shows same-page
episodes have a **median of 654 (run 15) / 574 (run 16) "appeared" refs when >0** — because `targetId` hashes
the element's **index** (`ObservationService.ts:569`: `hash(selectorCandidates[0] | name | text | index)`), so
any DOM insertion renumbers successors and wholesale "appears" them. The reliable, already-prioritized source
is `workingSet.changedRefs.topRefs` (cap 16, priority = failed → goal-matching-appeared → appeared → weakened,
`PlannerWorkingSetSelector.ts:683-717,777-807`): in run 16, **160/222 episodes** have non-empty topRefs,
2,279 refs total, **2,161 (94.9%) carry accessible names** — a names line is viable on exactly the episodes
where something changed. (Substrate follow-up, optional, behind flag: make `targetId` index-independent by
hashing `role|name|text|box-quantized` with ordinal tie-breaking via `nthRoleName`; that is a separate change
with regression surface on duplicate-label pages — not required for BP3.)

### 3.2 Byte-exact design

**Markers (F2)** — on the element line, inside the existing anomaly mechanism so no new attribute is parsed:
`normalizeElement` (`PlannerRepresentationCompiler.ts:137-170`) gains one anomaly token `new` prepended to
`anomalies` when `refId ∈ changedTopRefIds ∩ appeared/weakened` (distinguished: `new` for appeared, `chg` for
weakened/changed-only). Rendered by the existing `state="…"` join (`PromptLayoutEngine.ts:417`):
`[v2ref_2142] <select … state="new" tools="c,s,r" />` — +5 B/line for appeared, +5 for changed.
**Bounds**: markers apply to at most the first **8** `topRefs` that are also on the rendered surface (replay:
cap-8 cost 8.9 B/call mean, 17.4 B at cap 16 — measured over run-16's 222 episodes; markers are effectively
free). Marked lines are **exempt from the 12,000-char cap trim**: `renderSurface`'s budget check
(`PromptLayoutEngine.ts:372-381`) must push pinned+marked lines before tail lines (order already favors
groups/pinned; add marked refs to the pinned set in `buildPinnedRefIds`, `PlannerRepresentationCompiler.ts:217-242`).

**Names line (F7b)** — one line appended to RECENT EVENTS (rendered only when `topRefs` non-empty):
`  changed: v2ref_12872 "शुक्रवार, 25 दिसंबर 2026" | v2ref_12874 "शनिवार, 26 दिसंबर 2026" | …` — ≤8 entries,
name gist ≤48 chars (`compactValue(name,48)`), refId + quoted gist; entries without names render refId only.
Replay estimate (run-16 topRefs, 48-char gists, ≤8 entries): **261 B/call mean over all 222 episodes**
(57,894 B total) — i.e., ~150–260 B/call on the ~72% of episodes where anything changed, 0 elsewhere. The
names must come from `current.refs` when the ref is still present (94.9% case) and from `topRefs[].name`
(working-set ref objects already carry `name`, `PlannerWorkingSetSelector.ts:458-468`) otherwise.

**Interplay rules (byte-exact)**:
- With `effect=none` (F3, live): when `last.effect === 'none'` **and** the names line is rendered, RECENT
  EVENTS gains a three-fact read: action ok + no state change + *these* surface facts moved (the Booking
  calendar-advance signature: `stateChanged=false` with box-only movement — precisely the case where the model
  needs to know the click DID advance the calendar, run-16 steps 5–7 all read `ok, stateChanged=False,
  observableEffect=True`). No extra bytes; the co-occurrence is left for the model to read, with one
  strippable prompt sentence: "changed: lists surface facts that moved even when the action had no page-level
  effect."
- With P1 `result_row` pins: a pinned metric row that is also a topRef gets both the pin (position) and the
  `new` marker — no conflict; marker joins the anomaly list, pin governs ordering.
- With conditional prompt: the one explainer sentence lives in a new `CHANGED_GUIDANCE` fragment, stripped
  when no names line was rendered in the compiled IR (predicate: `topRefs.length === 0`).
- JSON mode: markers ride `refs[refId].state`-adjacent anomalies; the names data is already in
  `workingSet.changedRefs.topRefs` — JSON consumers unchanged.

### 3.3 Touchpoints (complete list)

1. `PlannerInputComposer.compose`: pass `changedTopRefIds` (set of ≤16 topRef IDs with their kind
   appeared/changed) into the working-set selection result — already available on
   `workingSetSelection.workingSet.changedRefs.topRefs`; no new computation.
2. `PlannerRepresentationCompiler.buildSurface` / `normalizeElement`: thread the set; prepend `new`/`chg`
   anomaly; add marked IDs to `buildPinnedRefIds`.
3. `PlannerRepresentationCompiler.compile`: expose `execution.changedNames = topRefs.slice(0,8)` for the
   layout engine.
4. `PromptLayoutEngine.renderRecentEvents`: append the `changed:` line (new `renderChangedNames`).
5. `PlannerPrompt.ts`: `CHANGED_GUIDANCE` fragment + conditional-strip predicate.
6. Tests: byte-identity test for `topRefs=[]` episodes (run-16 replay: 62/222 episodes unchanged); marker unit
   test against the run-16 Booking__0 episode_8/9 inputs (both date cells were topRefs? — verify at
   implementation; the December cells entered the working set via `target_value` force-include).

---

## 4. Smaller items

### 4.1 F11 prose-coverage alarm — threshold math

`bodyTextLength` is computed on every capture (`ObservationService.ts:593-598`) but **not persisted on the
observation artifact** (both runs' `obs_*.json` keys confirm), so the true ratio cannot be replayed. Two-step
blueprint: (a) persist `stats.bodyTextLength` in `buildBrowserObservation` (one field, additive; observation
artifacts grow by ~10 B); (b) until a probe run exists, calibrate the alarm on the measurable numerator —
total ref-text chars per observation, replayed on both runs:

| Distribution | run 15 (n=209) | run 16 |
|---|---|---|
| median ref-text chars | 28,755 | 24,410 |
| p10 / p90 | 1,915 / 125,333 | 1,533 / 122,336 |
| genuinely-empty pages (captcha walls) | 21–86 (Allrecipes, Cambridge) | 21–86 |
| **prose-poor but alive pages** | Google Map 2,150–2,349; **Wolfram__Alpha__10 3,590** | Map 2,159; Wolfram 3,590 |
| content pages | 20K–125K | 20K–122K |

The natural gap sits between ~4K and ~20K: **provisional threshold `refTextChars < 4,000`**, gated to
extract-mode goals (`workingSet.mode === 'extract'`) with zero successful tool reads — fires exactly on the
Wolfram__Alpha__10 class (whose answer pod values live in non-interactive prose, the S2/S3 silence) and never
on captcha pages already escalated (`environment_block` suppresses, like C3). After (a) ships, the ratio form
`refTextChars / max(1, bodyTextLength) < 0.25` replaces the absolute threshold; keep both behind the same
signal name `prose_poor_surface` (advisory, UncertaintySignals).

### 4.2 F12 — residual scope after P3

P3 already covers the prompt layer (`budget_low:N` emitted at remaining ≤2, `V2AgentLoop.ts:129-134`;
BUDGET_GUIDANCE conditional block, `PlannerPrompt.ts:24,100,146`). The declared-but-unbuilt half is
`max_step_risk` (`RecoveryState.ts:20` — in the kind union, no builder). Blueprint: in `RecoveryStateBuilder.build`,
when the uncertainty signals contain `budget_low:` **and** `evidenceCoverage` reaches the composer as
`status != 'ready'` **and** the last result was a rejection/block (`lastResult.success === false` or
`answerFeedback` present), return
`{ state: 'max_step_risk', severity: 'warning', nextMechanisms: ['finalize_with_collected_evidence',
'stop_if_dead_end_evidence_is_sufficient', 'avoid_opening_new_surfaces'] }` — placed **last** in the builder's
priority chain so it never masks a blocker state. Requires threading `evidenceCoverage` into
`RecoveryStateBuilderInput` (one field). Cost: ~150 B on the final 2 episodes of tasks that end under
uncertainty; zero elsewhere. Must-not-regress: the 9 `slow_but_alive` tasks from the exhaustion forensics —
guard by requiring a rejection/block in the last episode (clean progress runs never see it).

### 4.3 `responseJsonSchema` removal — verdict: remove behind a flag, test once

Re-validation against both runs: **422 planner calls, 10 attempt-2 retries (2.4%), 0 parse failures, 0
invalid-output dead-ends** — every retry recovered on attempt 2 (`providerPayload.attempts` forensics: all 6
run-16 retries show attempt-2 userBytes ≈ attempt-1 + 680–1,300 B of validation feedback, i.e., shape/ref
validation retries — e.g. Amazon__0 ep_1 315→997 B, ESPN__10 select-value guidance 6,280→6,430 B — and both
runs' failureReason histograms contain no `planner_invalid_output` class). Break-even: the schema costs 887
B/call; a retry costs ~one extra full payload (+9–13 KB). At the measured 2.4% retry rate, removal wins
37:1 in expectation even if the retry rate doubled. Recommendation: `--planner-no-json-schema` flag dropping
`responseSchema` from the provider call (`V2PlannerClient.ts:103-106`), keep `responseMimeType`-equivalent
JSON-mode + the in-prompt shape documentation + `robustJsonParse` (now vendored, 257 lines, which further
de-risks truncation/aliasing). Validate on balanced30; must-not-regress: attempt-2 rate ≤ 5% and zero
`planner_invalid_output_dead_end` failures.

---

## 5. Balanced30 validation matrix

| Change | Must flip / improve | Must NOT regress | Guard metric |
|---|---|---|---|
| C1 href-vs-landed (advisory + compose-time recheck) | Coursera__10 class (bleed shortens), Booking pair tails | ESPN__0, ArXiv__0 (late-nav FP absorbed), Google__Search__0 | net fires per run ≤ 8; zero on strictly-passing tasks except as downgraded advisories |
| C2 combobox-open verification | Booking__10 destination commit, Flights__0/10 tails | Amazon__0/__10 (Enter flows must stay legal) | fires only when no Enter/submit follows in-plan |
| C3 empty-landing | Amazon__10 run-16-class pages | Google Search captcha tasks (suppressed under environment_block) | fires with `wait_for_hydration` steering, not escalation |
| C4/C5 submit echo + triad | Booking__10 (premature submit prevented) | Booking__0 run-16 winning trajectory (must stay silent on it) | zero fires when goalProgress shows all requirements addressed |
| W-A recapture | Booking pair tails (empty captures followed by usable input) | Huggingface__10 (intentional empty flows) | recapture count logged; no extra planner calls on non-empty captures |
| W-D navigate_loop state | Google__Flights__0 (run-15: 9 wasted attempts → ≤2) | ArXiv__0 (navigate-heavy pass) | navigate attempts after 2nd same-url rejection = 0 |
| pick_option | Flights__0/10 (type churn 6 → ≤2 per field) | Amazon Enter flows; Coursera search | refuse-rate (ambiguous/no-match) logged; every refusal returns option labels |
| submit_form | Booking__10; protects Booking__0 win | Booking__0 (winning trajectory must be executable) | refusal only via the shared commit-phase predicate |
| BP3 markers + names line | post-click verification speed (Booking date-cell flow, Coursera suggestion flow) | byte-identity on 62/222 topRefs-empty episodes | userBytes p90 +≤400 B; marker cap 8 |
| F11 prose alarm | Wolfram__Alpha__10 (pod-value discovery) | widget/transactional tasks (signal advisory-only) | fire rate ≈ Wolfram-class only |
| F12 max_step_risk | BBC__News__10-style tails (grounded partial instead of empty exhaust) | slow_but_alive multi-hop passes | requires last-episode rejection/block |
| schema removal (flag) | −887 B/call (−5.8% of run-16 mean wire) | attempt-2 rate ≤ 5%; no invalid-output dead-ends | flag default OFF until one clean run |

---

## 6. Sources

**Code (this worktree, read-only study)**: `src/v2/substrate/ObservationService.ts` (walk, href in
selectorCandidates:449-451, targetId hash:569, empty-navigation wait:136-158, readiness script:593-598);
`src/v2/substrate/InputService.ts` (suggestion machinery:393-515, retention:235-261, click evidence:112-139);
`src/v2/harness/BrowseGentV2Harness.ts` (mutation capture:477-510, get/search bounds:190-244);
`src/v2/tools/V2ToolDispatcher.ts` (seek:78-159); `src/v2/agent/V2AgentLoop.ts` (guards:376-408,
budget_low:129-134, oscillation dead-state:106-124); `src/v2/runtime/RecoveryState.ts` (states:5-19,
`max_step_risk`:20, type recovery:101-118); `src/v2/runtime/UncertaintySignals.ts`;
`src/v2/planner/PlannerInputComposer.ts` (effect:253, submit refs:176-187);
`src/v2/planner/PlannerWorkingSetSelector.ts` (topRefs priority:683-717, serializer selectOptions:746,
suggestion refs:385-403); `src/v2/planner/prc/PlannerRepresentationCompiler.ts` (pinned:217-242, element:137-170);
`src/v2/planner/prc/PromptLayoutEngine.ts` (effect render:67,270-274, lean element:406-422, cap:372-398);
`src/v2/planner/PlannerPrompt.ts` (BUDGET_GUIDANCE:24, effect rule:102); `src/v2/planner/robustJsonParse.ts`;
`src/v2/planner/types.ts` (effect:191); `scripts/check_v2_boundaries.ts` (v2-no-v1-imports:142,204).

**Artifacts (READ-ONLY)**: run 15 `logs/webvoyager-lite/webvoyager_lite_1788594583363/` and run 16
`…/webvoyager_lite_1788612821955/` — `summary.md`, `webvoyager_artifacts.json`, per-trace
`trace.json` (before/after observation IDs), `action_outcomes.json` (incl. pre-execution rejections and
`implicitSeek`), `planner/episode_*-{input,output}.json` (222 run-16 inputs re-rendered byte-exactly:
median delta 0, max 71 B), `observations/` (incl. the 6+4 empty captures). Rendered-surface numbers come from
the same validated lean-PRC re-implementation as round 1, updated for the two `effect` render lines.

**Prior docs**: `progress-docs/run16-validation-report.md`; `progress-docs/research/date-widget-interaction.md`
(W-A…W-D); round 1 `progress-docs/research/core-architecture-leverage.md` (in the round-1 worktree; ES4/ES5/S1–S11);
`browser-control-vs-browsegent-lean-comparison.md` §4.2 (widget class 0/4 on both engines).

*All analysis scripts and caches live outside the worktree (`%TEMP%\browsegent-arch\`); the worktree received
only this report.*
