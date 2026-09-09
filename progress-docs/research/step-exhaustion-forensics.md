# Forensic Analysis: Step-Budget Exhaustion Across BrowseGent v2 Benchmark Traces

## 1. Executive Overview & Scope

Across the holdout benchmark run (`webvoyager_lite_1788550095257`) and two balanced-30 evaluation runs (`webvoyager_lite_1788531291513`, `webvoyager_lite_1788525300673`), exactly **33 task executions** consumed the full 12-step planner budget (`metrics.plannerCalls >= 12`).

A comprehensive census across all 33 execution traces reveals that step-budget exhaustion is driven by five distinct behavioral archetypes:
1. **`failed_click_cycling_blocker`** (10 tasks, **78 wasted episodes**): Unresolved modal backdrops and fixed banner overlays block click/type targets. The model repeatedly attempts interactions against occluded elements because persistent blocker signals fail to engage.
2. **`failed_click_cycling_timeout`** (7 tasks, **42 wasted episodes**): Non-responsive elements, unhydrated buttons, or delayed framework event listeners repeatedly trigger harness timeouts.
3. **`type_no_effect_loop`** (5 tasks, **40 wasted episodes**): The model repeatedly types identical strings into combobox/searchbox inputs without committing the selection via dropdown item click or enter key, trapped in an unhandled `repeated_value_preview:type` cycle.
4. **`navigate_oscillation`** (2 primary tasks + secondary in Booking, **16 wasted episodes**): The planner repeatedly navigates back and forth between two URLs (e.g. `A -> B -> A -> B`) or reloads the same URL, triggering full DOM re-renders and form resets.
5. **`slow_but_alive`** (9 tasks, **0 wasted episodes**): Clean forward progress through complex documentation or multi-page hierarchies. All actions succeeded, but the 12-step ceiling was reached just before finalization.

---

## 2. Methodology & Evidence Extraction

For each exhausted task, the following artifacts were mined and cross-referenced:
- `report.json`: `metrics.plannerCalls`, `metrics.toolExecutions`, `success`, `failureReason`.
- `action_outcomes.json`: Full per-step execution audit (`tool`, `success`, `errorCode`, `observableEffect`, `stateChanged`, `inputApplied`).
- `trace.json`: Exact action inputs (`kind`, `targetRef`, `text`, `url`, `key`, `beforeObservationId`, `afterObservationId`).
- `planner/episode_*-input.json` & `output.json`: Multi-episode history of `recovery.state`, `recovery.nextMechanisms`, `recovery.blockedAction`, `uncertainty.signals`, and `goalProgress`.
- `failures/failure_*.json`: Direct substrate diagnostics for blocked actions (`blockerDescription`, `blockerTagName`, `blockerIsFixedOrSticky`, `hitTestOutcome`).
- `observations/obs_*.json`: Full URL sequences to quantify navigation churn and detect 2-cycle oscillation (`url[i] == url[i+2] && url[i+1] == url[i+3]`).

---

## 3. Archetype Forensics

### Archetype 1: `failed_click_cycling_blocker`
- **Total Tasks**: 10 tasks across 3 runs.
- **Total Wasted Episodes**: **78 episodes**.
- **Task List**:
  - `webvoyager_lite_1788550095257`:
    - `webvoyager_Booking__24`: 14 calls, 0 done, 9 wasted episodes.
    - `webvoyager_GitHub__14`: 13 calls, 0 done, 8 wasted episodes.
    - `webvoyager_Google__Search__21`: 13 calls, 0 done, 7 wasted episodes.
  - `webvoyager_lite_1788531291513`:
    - `webvoyager_Booking__10`: 13 calls, 0 done, 9 wasted episodes.
    - `webvoyager_Google__Map__0`: 13 calls, 0 done, 8 wasted episodes.
    - `webvoyager_Apple__0`: 12 calls, terminal success, 5 wasted episodes.
    - `webvoyager_Booking__0`: 12 calls, terminal success, 5 wasted episodes.
  - `webvoyager_lite_1788525300673`:
    - `webvoyager_Booking__0`: 14 calls, 0 done, 11 wasted episodes.
    - `webvoyager_Booking__10`: 14 calls, 0 done, 11 wasted episodes.
    - `webvoyager_BBC__News__0`: 13 calls, terminal success, 5 wasted episodes.

#### Failure Diagnostics & Blocker Signatures
In every case, the substrate correctly detected that the target element was occluded at its center point:
- **`Booking__24` & `Booking__10`**: Target `v2ref_67` (destination input) was occluded by `div#onetrust-banner-sdk` and `div.b9720ed41e` (sign-in promotional modal overlay).
  - `blockerTagName`: `"div"`, `blockerIsFixedOrSticky`: `true`, `hitTestOutcome`: `"hard_blocker"`.
- **`GitHub__14`**: Target `v2ref_562` (contributors link) occluded by floating sticky repository header.
  - `blockerTagName`: `"header"`, `blockerIsFixedOrSticky`: `true`.
- **`Google__Search__21`**: Target search result links occluded by Google full-screen cookie consent dialog (`div#CXQnmb`).
  - `blockerTagName`: `"div"`, `blockerIsFixedOrSticky`: `true`.
- **`Google__Map__0`**: Directions action card occluded by floating route panel modal.

#### Detection & Recovery Gaps
1. **The Single-Target Blindspot in `persistent_target_blocker`**:
   In `src/v2/runtime/RecoveryState.ts:182`, the trigger for `persistent_target_blocker` is:
   ```typescript
   const matchingGroup = [...groups.values()].find(refs => refs.size >= 2);
   ```
   This requires **at least two distinct target refs** (`refs.size >= 2`) to be blocked by the same blocker. When the model repeatedly clicks the **same** blocked element (e.g. `v2ref_67`), `refs.size` is strictly 1. Thus, `persistent_target_blocker` **never fires**, leaving the model in generic `wrong_target_type` without persistent escalation.
2. **Page Reload Memory Wipe**:
   In Booking traces, when the model attempts a navigation to recover, `hasPageBoundary(evidence)` evaluates to `true`, clearing `input.failures = []` (`V2AgentLoop.ts:459`). The memory of the blocker is erased, allowing the model to cycle into the exact same modal trap again.

---

### Archetype 2: `failed_click_cycling_timeout`
- **Total Tasks**: 7 tasks across 3 runs.
- **Total Wasted Episodes**: **42 episodes**.
- **Task List**:
  - `webvoyager_lite_1788550095257`:
    - `webvoyager_BBC__News__25`: 12 calls, 0 done, 7 wasted episodes (clicks on media player controls timed out).
    - `webvoyager_Coursera__15`: 13 calls, 0 done, 6 wasted episodes (clicks on faceted filters timed out).
    - `webvoyager_Huggingface__13`: 14 calls, 0 done, 6 wasted episodes (clicks on model task tags timed out).
    - `webvoyager_Huggingface__14`: 13 calls, 0 done, 8 wasted episodes (click on `v2ref_115` timed out 6 consecutive times).
  - `webvoyager_lite_1788531291513`:
    - `webvoyager_Amazon__10`: 13 calls, terminal success, 4 wasted episodes.
    - `webvoyager_ESPN__10`: 13 calls, terminal success, 5 wasted episodes.
  - `webvoyager_lite_1788525300673`:
    - `webvoyager_ESPN__10`: 14 calls, 0 done, 6 wasted episodes.

#### Failure Diagnostics & Repetition Trace
In `Huggingface__14` (`webvoyager_lite_1788550095257`):
- Episodes 1, 2, 3, and 4 all planned: `{"tool": "click", "ref": "v2ref_115"}`.
- All 4 dispatches timed out in Playwright without observable DOM change.
- The model repeated the click on `v2ref_115` again at Episode 9, and again at Episode 14 (finalization).
- Total clicks wasted on the exact same timing-out ref: **6 episodes**.

#### Detection & Recovery Gaps
1. **No Specific Signal for Repeated Timeouts**:
   `UncertaintySignals.ts` contains `low_confidence_ref` and `failure:target_blocked`, but **no signal exists for repeated timeouts** on an element (`failure:timeout`).
2. **`same_action_loop` Threshold Ineffectiveness on Timeouts**:
   Because timed-out actions return `success: false`, they do not trigger `repeated_no_progress_transition` (which tracks state changes on successful dispatches). As a result, the planner receives no explicit steering to quarantine the timed-out element.

---

### Archetype 3: `type_no_effect_loop`
- **Total Tasks**: 5 tasks across 3 runs (100% concentrated on Google Flights tasks).
- **Total Wasted Episodes**: **40 episodes**.
- **Task List**:
  - `webvoyager_lite_1788550095257`:
    - `webvoyager_Google__Flights__4`: 14 calls, 0 done, 10 wasted episodes.
    - `webvoyager_Google__Flights__14`: 14 calls, 0 done, 10 wasted episodes.
  - `webvoyager_lite_1788531291513`:
    - `webvoyager_Google__Flights__10`: 14 calls, 0 done, 8 wasted episodes.
  - `webvoyager_lite_1788525300673`:
    - `webvoyager_Google__Flights__0`: 14 calls, 0 done, 6 wasted episodes.
    - `webvoyager_Google__Flights__10`: 13 calls, 0 done, 6 wasted episodes.

#### Exact Typed-Value Sequence Quoted from Traces
In `Google__Flights__4` (`webvoyager_lite_1788550095257/traces/.../trace.json`):
- **Episode 1**: Planned `type v2ref_216 "New York"`, `type v2ref_236 "London"`.
- **Episode 2**: Planned `type v2ref_236 "London"`.
- **Episode 3**: Planned `click v2ref_1190` (dropdown suggestion "London Heathrow").
- **Episode 4**: Planned `type v2ref_216 "New York"`, `press Enter`.
- **Episode 5**: Planned `type v2ref_236 "London"`, `press Enter`, `type v2ref_253 "Dec 26, 2024"`.
- **Episode 6**: Planned `click v2ref_4552` (dropdown suggestion "London Gatwick").
- **Episode 7**: Planned `type v2ref_216 "New York"`, `press Enter`, `type v2ref_236 "London"`, `press Enter`.
- **Episode 8**: Planned `click v2ref_236`, `type v2ref_236 "London"`.
- **Episode 9**: Planned `click v2ref_11257` (dropdown suggestion).
- **Episode 10**: Planned `type v2ref_216 "New York"`, `press Enter`.
- **Episode 11**: Planned `type v2ref_253 "Dec 26, 2024"`.
- **Episode 12**: Planned `click v2ref_216`, `type v2ref_216 "New York"`, `click v2ref_236`, `type v2ref_236 "London"`.
- **Episode 13**: Planned `type v2ref_216 "New York"`, `press Enter`, `type v2ref_236 "London"`.
- **Episode 14 (Finalization)**: Planned `type v2ref_216 "New York"`, `type v2ref_236 "London"`.

#### Analysis of Clicks Between Types
Across all 14 episodes:
- `v2ref_216` was typed with `"New York"` **7 separate times**.
- `v2ref_236` was typed with `"London"` **8 separate times**.
- The clicks between types targeted the dropdown suggestion options (`v2ref_1190`, `v2ref_4552`, `v2ref_11257`).
- **Why the loop persists**: In suggestion-backed comboboxes, clicking a suggestion commits the value and shifts focus to the next field (e.g. date picker). However, because `goalProgress` or the planner sees that the raw input box still reflects an uncommitted or soft-matched state, it believes the origin was discarded, so it clicks the origin and re-types `"New York"` from the beginning.

#### Detection & Recovery Gaps
- **The Ignored Signal in `RecoveryState.ts`**:
  `V2AgentLoop.ts:1359` correctly generates the uncertainty signal:
  `repeated_value_preview:type:v2ref_216:2`
  However, in `src/v2/runtime/RecoveryState.ts:75-84`:
  ```typescript
  if (signals.some(signal => signal.startsWith('repeated_value_preview:get:') || signal.startsWith('repeated_value_preview:inspect_region:'))) {
    return { state: 'repeated_read_same_value', ... };
  }
  ```
  `RecoveryStateBuilder` **explicitly checks only `get` and `inspect_region`**! It contains **zero handlers** for `repeated_value_preview:type:`.
  Consequently, even though the substrate detected that the exact same text was typed multiple times into the exact same element, **no recovery state was ever built**, no `nextMechanisms` were recommended, and no error was flagged.

---

### Archetype 4: `navigate_oscillation`
- **Total Tasks**: 2 primary tasks (+ widespread occurrence in Booking tasks).
- **Total Wasted Episodes**: **16 episodes** (plus 151 episodes documented in prior Booking forensics).
- **Task List**:
  - `webvoyager_lite_1788550095257`:
    - `webvoyager_Apple__26`: 13 calls, 0 done, 8 wasted episodes.
    - `webvoyager_ArXiv__6`: 13 calls, 0 done, 8 wasted episodes.

#### URL Sequence Evidence
1. **`Apple__26`**:
   - Step 3: `navigate https://www.apple.com/ipad-mini/`
   - Step 5: `navigate https://www.apple.com/ipad-mini/specs/`
   - Step 10: `navigate https://www.apple.com/ipad-mini/specs/` (Same-URL navigation reload)
   - Observations alternated between product overview and tech specs, repeatedly reloading without extracting needed dimensions.
2. **`ArXiv__6`**:
   - Step 3: `navigate https://arxiv.org/search/?query=%22On+the+Sentence+Embeddings...`
   - Step 6: `navigate https://arxiv.org/search/?query=%22On+the+Sentence+Embeddings...` (Redundant Search Reload)
   - Step 8: `navigate https://arxiv.org/abs/1802.05365`
   - Step 9: `navigate https://arxiv.org/abs/1802.05365` (Redundant Abstract Reload)
   - Step 10: `navigate https://arxiv.org/abs/1802.05365` (Third Abstract Reload)
   - Step 12: `navigate https://arxiv.org/pdf/1802.05365.pdf` (Direct PDF navigation creating unrenderable DOM)

#### Detection & Recovery Gaps
- **Absence of URL History Ring Buffer**: The runtime tracks `lastResult.kind === 'navigate'` and `transitionEvidence.urlChanged`, but maintains **no sliding history of visited URLs**. It cannot detect 2-period cycles (`A -> B -> A -> B`) or 3-step loops.
- **Reload Masking**: When an identical URL is navigated, `hasObservablePageChange` returns `true` because the reload generates new element IDs. This erases progress memory and prevents `no_op_navigation` from steering the model.

---

### Archetype 5: `slow_but_alive` (All-Success, Insufficient Budget)
- **Total Tasks**: 9 tasks across 3 runs.
- **Total Wasted Episodes**: **0 episodes**.
- **Task List**:
  - `webvoyager_lite_1788550095257`:
    - `webvoyager_ArXiv__17`: 13 calls, terminal success (`done: true`).
    - `webvoyager_ArXiv__27`: 13 calls, terminal success (`done: true`).
    - `webvoyager_ArXiv__30`: 13 calls, terminal success (`done: true`).
    - `webvoyager_BBC__News__11`: 13 calls, terminal success (`done: true`).
    - `webvoyager_Google__Flights__19`: 14 calls, terminal success (`done: true`).
    - `webvoyager_Huggingface__25`: 13 calls, terminal success (`done: true`).
  - `webvoyager_lite_1788525300673`:
    - `webvoyager_ArXiv__10`: 13 calls, terminal success (`done: true`).
    - `webvoyager_Huggingface__0`: 13 calls, terminal success (`done: true`).
    - `webvoyager_Huggingface__10`: 12 calls, terminal success (`done: true`).

#### Inspection of Last 3 Planner Inputs: Close to Done vs. Wandering?
Analysis of episodes 11, 12, and finalization shows **the agent was systematically close to done, never wandering**:
- **`ArXiv__17`**:
  - Episode 11: Clicked into version history table (`v2ref_875`).
  - Episode 12: Clicked specific submission date row (`v2ref_1051`).
  - Finalization: Extracted the exact date ("v3 was submitted on March 27, 2023") and called `done: true`.
- **`ArXiv__27`**:
  - Episode 11: Clicked Economics subject taxonomy (`v2ref_661`).
  - Episode 12: Clicked category listing link (`v2ref_695`).
  - Finalization: Listed all 3 economics categories and called `done: true`.
- **`BBC__News__11`**:
  - Episode 11: Navigated to Scottish Premiership table (`v2ref_2962`).
  - Episode 12: Used `search_page` to locate the Hibernian team record.
  - Finalization: Extracted the 12-team count and recent match result with `done: true`.
- **`Huggingface__25`**:
  - Episode 11: Drilled into PEFT adapter documentation (`v2ref_3653`).
  - Episode 12: Located quantization section (`v2ref_3752`).
  - Finalization: Returned the exact `bitsandbytes` library name with `done: true`.

#### Conclusion for `slow_but_alive`
These tasks experienced zero failures, zero loops, and zero wasted steps. They represent legitimate multi-step exploratory tasks where drilling through documentation, verifying tables, and extracting multi-attribute answers requires 10?13 discrete steps. The terminal continuation grant added in BrowseGent v2 functioned as designed, allowing 100% of these tasks to finalize cleanly rather than failing at step 12.

---

## 4. Summary Quantification Matrix

| Archetype | Total Tasks | Total Episodes Consumed | Wasted Episodes | Primary Failure Mechanism | Existing Signals That Failed to Fire / Help |
|---|---|---|---|---|---|
| **`failed_click_cycling_blocker`** | 10 | 131 | **78** (59.5%) | Center-point occlusion by modal overlays & fixed banners | `persistent_target_blocker` (requires 2 distinct refs; failed on single-ref retry), `surface_blocked` (absent) |
| **`failed_click_cycling_timeout`** | 7 | 91 | **42** (46.2%) | Repeated clicks on non-responsive / unhydrated controls | `repeated_action_timeout` (absent), `repeated_no_progress_transition` (only checks success=true) |
| **`type_no_effect_loop`** | 5 | 69 | **40** (58.0%) | Repeatedly re-typing into combobox without committing dropdown item | `repeated_value_preview:type` (emitted by loop, but ignored by `RecoveryStateBuilder`) |
| **`navigate_oscillation`** | 2 (+Booking) | 26 | **16** (61.5%) | Alternating between 2 URLs or redundant same-URL reloads | `url_oscillation_detected` (absent), `no_op_navigation` (erased by page boundary reset) |
| **`slow_but_alive`** | 9 | 117 | **0** (0.0%) | Legitimate multi-tier navigation through deep content trees | N/A (healthy behavior; successfully saved by terminal continuation) |
| **TOTALS** | **33** | **434** | **176** (40.6%) | ? | ? |

---

## 5. Ranked Generic Detection Gaps & Proposed Substrate Mechanisms

Ranked in order of total wasted episodes prevented:

### 1. Gap: Single-Ref Persistent Blocker Blindspot (`failed_click_cycling_blocker`) ? 78 Episodes Lost
- **Defect**: `RecoveryStateBuilder.buildPersistentBlockerRecovery` requires `refs.size >= 2` distinct refs. Retrying the same blocked ref 2?5 times never triggers `persistent_target_blocker`.
- **Proposed Signal**: `persistent_target_blocker`
- **Generic Trigger Condition**:
  - A `target_blocked` failure occurs where `sameTargetCount >= 2` on the identical target ref within the last 3 episodes, OR `refs.size >= 2` distinct refs are blocked by the same `blockerFingerprint`.
- **Targeted Recovery Mechanisms**:
  - `['find_dismiss_or_close_control', 'avoid_repeating_blocked_action', 'choose_unblocked_alternative', 'reobserve_current_surface']`

---

### 2. Gap: Unhandled `repeated_value_preview:type` (`type_no_effect_loop`) ? 40 Episodes Lost
- **Defect**: `V2AgentLoop` generates `repeated_value_preview:type:<ref>:<count>`, but `RecoveryStateBuilder` only handles `get` and `inspect_region`. The planner is never steered when typing is stuck.
- **Proposed Signal**: `repeated_type_no_effect`
- **Generic Trigger Condition**:
  - An action `type(ref, text)` is dispatched where `(ref, text)` matches a previously typed entry in the current generation, AND `inputApplied === false` OR the control's accessibility role is `combobox`/`searchbox` and no suggestion item click followed within 2 steps.
- **Targeted Recovery Mechanisms**:
  - `['confirm_combobox_selection', 'avoid_repeating_blocked_action', 'choose_alternative_ref', 'press_enter_to_commit']`

---

### 3. Gap: Repeated Action Timeout Quarantine (`failed_click_cycling_timeout`) ? 42 Episodes Lost
- **Defect**: Repeated timeouts (`errorCode === 'timeout'`) on a specific control do not trigger `same_action_loop` because `isNoProgressMutation` only increments on successful transitions.
- **Proposed Signal**: `repeated_action_timeout:<ref>:<count>`
- **Generic Trigger Condition**:
  - `errorCode === 'timeout'` occurs on the same target ref (or same accessible name + role) `>= 2` times in a run.
- **Targeted Recovery Mechanisms**:
  - `['avoid_repeating_blocked_action', 'choose_alternative_ref', 'expand_or_reobserve', 'wait_for_hydration']`

---

### 4. Gap: URL Oscillation Ring Buffer (`navigate_oscillation`) ? 16 Episodes Lost
- **Defect**: The substrate only compares `currentUrl` with `previousUrl`. It cannot detect alternating 2-period cycles (`A -> B -> A -> B`) or multi-step loops across 3?4 episodes.
- **Proposed Signal**: `url_oscillation_detected`
- **Generic Trigger Condition**:
  - Maintain a sliding ring buffer of the last 6 observation URLs:
    Trigger if `url[t] === url[t-2] && url[t-1] === url[t-3] && url[t] !== url[t-1]`, OR if `count(url[t]) >= 3` within the last 5 navigation steps.
- **Targeted Recovery Mechanisms**:
  - `['avoid_navigation_churn', 'quarantine_navigate_tool', 'interact_with_visible_controls', 'stop_if_dead_end_evidence_is_sufficient']`
