# Booking--10 Forensic Analysis — Deep Research Report

**Date:** 2026-08-31 · **Method:** Read-only. Three single-task probe runs reconstructed from traces; source audit of `src/v2` (incl. uncommitted WIP); competitor research from local clones (`D:\agent-tools\browser-control`, `D:\agent-tools\agent-browser-source`, `browser_use` site-packages) and the locally installed Playwright 1.58.2 package. Web documentation fetch was quota-limited; Playwright contracts were verified from `node_modules/playwright-core/types/types.d.ts` (the exact version in use).
**Runs:** `webvoyager_lite_1788128439841` (primary, 13 planner calls, `v2_max_steps_exhausted`), `1788126942380` (9 calls, `planner_invalid_output_dead_end`), `1788125824549` (13 calls, `v2_max_steps_exhausted`). All n=1 probes, `gemini/gemini-3.1-flash-lite`, PRC serialization.

---

## 1. Executive conclusion

Booking__10 fails for **three stacked, independently-reproducible reasons** — none of which is a ref-identity or substrate defect. (1) **The agent has no operable input path on Booking's locale-variant site**: the destination combobox announces `aria-haspopup="listbox"` / `aria-autocomplete="list"` (values must be committed by picking a suggestion; free-typed fills are cleared synchronously, and a retained value is discarded on Enter in favor of the geo-default destination "New Delhi"), while the URL-parameter bypass the planner *twice discovered* is neutralized because `searchresults.hi.html?ss=Paris&…` arrives with the query stripped. (2) **6 of 16 observations captured zero refs** during open/locale-redirect/search transitions; the current mitigations (75ms stabilization, single 100ms title-gated recapture, narrow V2PlannerClient rescue) cannot cover multi-second hydration, so the planner was called blind 6 times, fled a loading results page once (fatal), and finalized on an empty screen. (3) **Quarantine is single-tool-scoped per failure**, permitting a deterministic type↔click alternation loop for 3 full cycles before the all-tool `persistent_target_failure` quarantine engaged. Ref continuity, by contrast, is **proven correct**: `target_oa5klo` and `target_ok56an` are correctly maintained as distinct physical controls across refId churn, generations, and pages. The task goal itself ("February 14–21, **2024**") is time-impossible and the planner silently re-dated to 2027 — an evaluator/environment artifact worth flagging separately.

## 2. Complete failure timeline (primary run `1788128439841`)

Goal: *"Find a well-reviewed hotel in Paris … couple (2 adults) on Valentine's Day week, February 14-21, **2024** … free cancellation."* Reference (golden): `"Villa Alessandra"`.

| Ep | Observation | Refs | URL | Title | Planner decision → outcome |
|---|---|---|---|---|---|
| 1 | obs_1_1 | **0** | booking.com/ | **""** | `navigate https://www.booking.com/` (blind, model prior) |
| 2 | obs_2_2 | **0** | booking.com/ | **""** | attempts=2 (first output invalid); `search_page "search"` on empty page |
| 3 | obs_2_3 | 3103 | /index.**hi**.html | Booking हिन्दी home | `type "Paris" → v2ref_67` ("जगह डालें") → **input_not_applied** (fill ok, value read-back 0) |
| 4 | obs_2_4 | 3103 | /index.hi.html | same | `click v2ref_67` → **target_blocked** by `p.da8a6fe12c.fab9d44163` (non-fixed, non-interactive, 7-point hard) |
| 5 | obs_2_6 | 3103 | /index.hi.html | same | **Deep-link**: `navigate searchresults.hi.html?ss=Paris&checkin=2027-02-14&checkout=2027-02-21&group_adults=2&no_rooms=1` (dates silently shifted 2024→2027) |
| 6 | obs_3_7 | **0** | /searchresults.hi.html | **""** | `wait` (planner chose correctly) |
| 7 | obs_3_8 | 267 | /searchresults.hi.html (no query!) | generic "खोज नतीजे…" | `type "Paris" → v2ref_3171` + `press Enter` — type **ok, applied=true** |
| 8 | obs_3_9 | 316 | /searchresults.hi.html | generic | (post-press capture; destination box text="") |
| 8b | obs_3_10 | **0** | /searchresults.hi.html | **"10 बेहतरीन नई दिल्ली होटल, भारत (₹ 1,108 से)"** | Enter committed a **New Delhi** search (geo default), not Paris; obs empty mid-reload → planner **flees**: `navigate index.hi.html` |
| 9 | obs_4_11 | **0** | /index.hi.html | **""** | `search_page` on empty home (read produced no text) |
| 10 | obs_4_12 | 3104 | /index.hi.html | हिन्दी home | `type "Paris" → v2ref_3586` → **input_not_applied** (identical) |
| 11 | obs_4_13→15 | 3104 | /index.hi.html | same | `click v2ref_3586` → **target_blocked** (same `<p>`) |
| 12 | obs_4_15 | 3104 | /index.hi.html | same | Deep-link #2 → searchresults |
| fin | obs_5_16 | **0** | /searchresults.hi.html | **""** | **Finalization ran on an empty observation** → `v2_max_steps_exhausted`, value="" |

**Cross-probe replication:** 6942380 — same double empty open, type/click fail ×3 (steps 2–7, alternation), quarantine all-tool at EP8, then `navigate index.en-gb.html` (locale-flip attempt) → obs_3_10 **0 refs** → invalid output ×2 → `planner_invalid_output_dead_end`. 5824549 — same signature, deep-link → results → empty obs → homepage → fail. Locale variant varies across probes (`hi.html` vs `en-gb.html`) — the geo-redirect is nondeterministic.

**Zero read evidence in all three probes**: every successful `search_page` returned no text (3× on empty/loading pages). The agent never read a single result.

## 3. Root-cause matrix

| # | Category | Finding | Evidence | Confidence | Disconfirming evidence |
|---|---|---|---|---|---|
| R1 | Environment (locale/geo) | Booking serves `index.hi.html`/`searchresults.hi.html` (Hindi labels: "जगह डालें"); variant varies per probe (en-gb once); search state defaults to **New Delhi** (geo) | failure diagnostics `targetName: "जगह डालें"`; obs_3_10 title; URLs | Proven (environment) | — |
| R2 | Environment (deep-link stripped) | `searchresults.hi.html?ss=Paris&…` → captured URL has **no query**; results page destination box empty, generic title | step_5 navigate evidence (obs_3_7, url= bare); obs_3_8/3_9 titles + box text="" | High (mechanism — redirect vs param-drop — unproven) | None observed |
| R3 | Widget protocol | Destination input declares `ariaAutocomplete:"list"`, `ariaHasPopup:"listbox"`; free-typed fill is **cleared synchronously** (homepage) and a retained fill is **discarded on Enter** (results page committed New Delhi) | ref-resolution audits (both type audits show the ARIA fields); outcomes steps 2/9 vs 6; obs_3_10 title | Proven symptom; clearing mechanism (JS sync clear vs duplicate hidden input) unproven | fill succeeded + value retained on results page — so not `readonly`/`disabled` |
| R4 | Observation lifecycle | **6/16 observations have 0 refs** (obs_1_1, 2_2, 3_7, 3_10, 4_11, 5_16); 5 have empty titles, obs_3_10 has a full title; existing mitigations insufficient: StabilizationService 75ms quiet window; ObservationService single recapture gated on `captured.length===0 && title===''` + 100ms; V2PlannerClient rescue fires only for `get/inspect_region` with `obs_…` ref after navigate | observation JSONs; WIP diffs (`ObservationService.ts` +11, `V2PlannerClient.ts` +96, `BrowseGentV2Harness.ts` captureCurrentObservation(true)) | Proven (empty captures + insufficient mitigation); "run executed with WIP active" unproven | Later captures on same URLs return 3,103 refs → not anti-bot wall, not extraction failure; obs_3_10's full title + 0 refs = hydration timing |
| R5 | Quarantine policy | Single-tool quarantine after each failure enabled type↔click alternation (EP3–EP7 in 6942380); all-tool `persistent_target_failure` engaged only at EP8 (5 entries) | 6942380 planner inputs: EP4 `{tool:type,ref:67}` quarantined → planner clicked; EP5 click quarantined → planner typed; EP8 quarantine=5 | Proven | — |
| R6 | Planner/model behavior | Adaptive overall (deep-link discovered twice, locale-flip attempted, wait chosen on first empty obs) but: EP8 fled a loading page (vs waiting at EP6 — inconsistent); redundant type+Enter on the results page destroyed a working deep-link state; EP1–2 blind calls | planner outputs EP5/EP6/EP7/EP8 | Proven (decisions); blame allocation partially unproven (missing signals contributed) | — |
| R7 | Identity/continuity | **Correct**: homepage input `target_oa5klo` persists v2ref_67→v2ref_3586 across generations (same selectors/name/geometry); results-page input is a distinct `target_ok56an`. No over-merge | ref-resolution audits; obs_2_3 vs obs_4_12 vs obs_3_8 | Proven correct | Hypothesis of incorrect merging is **disconfirmed** |
| R8 | input_not_applied classification | Classified `category:target, persistence:persistent, retryable:false`; accurate for the same-strategy retry, but the true blocker is the widget class/protocol, not the target | failure JSONs; WIP `FailureClassifier.ts` diff | Proven | — |
| R9 | Task horizon | Goal demands Feb 2024 (past); planner silently booked Feb **2027** | goal text vs EP5/EP12 URLs | Proven | — |
| R10 | Provider/model variance | Secondary: EP2 needed 2 attempts (first output invalid); probe 6942380 died on repeated invalid output **while facing an empty observation** — variance amplified by R4, not independent | EP2 attempts=2; 6942380 EP9 | Moderate | All three probes share identical structural failures → structural, not stochastic |

## 4. Smoking-gun hypothesis and alternatives

**Primary (H-A) — The input-path closure: suggestion-gated combobox protocol is unoperable blind, and the locale-variant URL bypass is stripped.** The site offers exactly two generic ways to set a destination: the combobox (requires expand→type→pick-suggestion; substrate `fill()` cannot commit, and Enter commits the geo default) and URL parameters (stripped on the `.hi.html` variant). Both captured metadata (`ariaHasPopup`, redirect chain) exist in the system but are not surfaced to the planner (`planner-saw v2ref_67 = {kind:'input', name, role, score…}` — **no aria fields, no value, no placeholder**) nor acted on by the substrate. **Falsification test:** fixture combobox with `aria-haspopup=listbox` whose JS clears non-suggestion values — if the current `type()` succeeds on it, H-A is wrong.

**Alternative (H-B) — Empty-observation lifecycle is the dominant defect.** 6/16 empty captures, two probe deaths directly caused (6942380: empty obs → invalid output → dead end; primary: EP8 flee + finalization on obs_5_16). Falsification: a bounded wait-for-content recapture (readyState complete + interaction-count stable, 2–3s cap) that eliminates empty captures would also have removed the flee/dead-end — but the agent would still face R2/R3 (New Delhi results, unoperable combobox), so H-B alone doesn't restore completion. This is why H-B ranks below H-A for *completion* though it is the largest *efficiency/derailment* multiplier.

**Alternative (H-C) — Planner/model decision quality is the root cause.** Largely falsified: the model found deep-links, waited correctly once, attempted locale-flip; its failures concentrate where the runtime fed it empty screens or stripped signals. Residual genuine model errors (EP8 flee, redundant type+Enter, blind EP1–2) are real but secondary and partly induced.

## 5. What is definitely not proven yet

1. The exact DOM mechanism of the fill-clear (sync JS clear vs hidden duplicate input receiving the fill — the resolution audit shows `candidateCount:1`, `nthRoleName:1`, so a single visible match, favoring JS clear; unconfirmed).
2. Whether `searchresults.hi.html` strips the query server-side (redirect chain) or the capture read a pre-redirect URL.
3. Whether the `<p>` blocker is the combobox's own dropdown/popup (no screenshot at block time — `screenshots/` is empty).
4. Whether these probe runs executed with the WIP rescue/retry code active (code was in the working tree; traces cannot prove which build ran — no commit pin in run metadata).
5. Whether obs_3_8/3_9's results were already New Delhi (generic title + empty destination box strongly suggest, but the destination label never entered the refs the planner read).
6. Whether ARIA-aware combobox handling (expand→pick) would have been within the step budget given the other wastes.

## 6. Missing diagnostics required (bounded, no secrets, no DOM dumps)

1. **Capture readiness record**: `readyState`, interaction-count, and title at *first* and *second* capture attempt, recorded in the observation artifact (≤6 fields) — distinguishes hydration vs extraction failure definitively.
2. **Blocker screenshot** (or blocker subtree text ≤200 chars) attached to `target_blocked` failure diagnostics — identifies whether the blocker is the widget's own popup.
3. **Navigate redirect chain**: final URL after redirects in the navigate result value (one field) — proves R2's mechanism.
4. **Planner-visible ref projection**: include `ariaHasPopup`, `ariaAutocomplete`, current `value`, and `placeholder` in the serialized projection (already captured by the substrate; purely a rendering change, ~4 fields).
5. **Retention evidence**: `requestedValue`, `retainedValue`, `activeElement` tag after fill (2 fields) — distinguishes cleared vs written-elsewhere.
6. **Run metadata commit pin** (already designed in the flag-observability work — extend to a git SHA field).
7. **Search-commit postcondition signal**: after type/press on a search widget, record the page's destination-state text (title or searchbox value) vs the intended value — catches "retained but not committed" (obs_3_10 case) generically.

## 7. Minimal safe offline experiment / fixture (next step)

**Fixture (local, headless, no network):** one static page + small JS:
- A `role=combobox` input with `aria-haspopup="listbox"`, `aria-autocomplete="list"`, whose `input` handler **clears the value** unless the text matches a rendered listbox option, and whose form `submit` reads a *state variable* (not the input value) defaulting to "New Delhi".
- A redirect shim serving `results.html?ss=X` → `results.html` (query stripped), rendering a 2-second-delayed interactive DOM (empty body, then refs) with a non-empty `<title>` set immediately.
- A `<p>` overlay positioned over the combobox after focus (blocker reproduction).

**Measurements (offline, deterministic):**
1. Current `InputService.type()` → expect `input_not_applied` (validates R3).
2. Proposed combobox protocol (click → fill → wait for `[role=option]` → click matching option; fall back to retain-only) → expect applied **and committed** (validates the fix).
3. Capture path against the slow page: current single 100ms title-gated retry vs bounded wait-for-content (readyState complete + interaction count stable across two samples, cap 2.5s) → measure empty-observation rate 0 vs N (validates R4 fix).
4. Quarantine alternation replay: recorded 6942380 planner inputs through the working-set selector with all-tool semantic-target quarantine at count≥2 → verify the type↔click cycle is cut at EP4–5 instead of EP8.

## 8. Minimal production architecture change (only if fixture validates)

All generic; no site, task, model, or benchmark references:
1. **Combobox protocol** (substrate/dispatcher): for refs with `ariaHasPopup`/`ariaAutocomplete=list`, `type` becomes click-to-expand → fill → bounded wait for options → select matching option; expose option list in the result so the planner can commit. Requires no ref-system change.
2. **Capture lifecycle**: replace the single 100ms title-gated recapture with a bounded wait-for-content (two-sample interaction-count stability, readyState complete, cap ~2.5s), and make the V2PlannerClient empty-observation rescue unnecessary for this class (keep it as backstop; it is currently too narrow — fires only for `get/inspect_region` with `obs_…` refs after navigate — and does not avoid the provider call it post-processes).
3. **Planner signal plumbing**: render `ariaHasPopup`/`ariaAutocomplete`/`value`/`placeholder` in the projection serialization; reconcile the working-set `typeableRefs` classification with substrate `capabilities.typeable` (currently contradictory: substrate says typeable, action surface excluded the ref).
4. **Quarantine semantics**: promote to all-tools for a semantic target after 2 persistent failures keyed on `targetId` (the `repeated_persistent_target` mechanism exists — lower its threshold and remove the current-epoch-only gate so refId churn can't delay it).
5. **Commit-aware mutation feedback** (from R3's second face): after type+press on a search-like widget, surface the page's destination/title delta to the planner as transition evidence.

No changes to Brain1/Brain2/ContinuityGraph/EvidenceLedger cores; the identity system passed its adversarial test (R7).

## 9. Explicitly rejected (overfitting or overengineering)

- Any Booking/geo-locale-specific selector, URL pattern, or language handling; forcing `en-gb` locales; cookie/geo spoofing.
- Force-click through blockers (unproven semantic safety; the blocker here is likely the widget's own popup — clicking through would corrupt state).
- Replacing `fill()` with naive JS value injection (browser-control style) — breaks controlled-widget semantics; the retention check is the right complement instead.
- Global wait/timeouts inflation (pays latency on every page for one site's hydration).
- Screenshot-first observation or vision-based retries (architecture change not justified by evidence).
- Rewriting the ref/continuity system (disconfirmed defect), removing `input_not_applied` (it is correct and necessary), benchmark/evaluator changes in this task (the failure is internal, not evaluator-side).
- Model-specific prompt tuning or retry-count increases (masks structural gaps; violates the no-model-specific rule).

## 10. Source and trace references

**Traces (primary):** `logs/webvoyager-lite/webvoyager_lite_1788128439841/traces/webvoyager_lite_1788128439841_webvoyager_Booking__10_a1/` — `trace.json` (steps step_1/5/9/13 navigate evidence), `action_outcomes.json` (13 outcomes), `failures/failure_input_not_applied_obs_2_4.json` + `obs_4_13` (`targetName:"जगह डालें"`, `observedLength:0`), `failures/failure_target_blocked_obs_2_6.json` + `obs_4_15` (`blockerDescription:"p.da8a6fe12c.fab9d44163"`, `probePointsTested:7`), `ref-resolution/obs_2_3-v2ref_67-type-audit.json` + `obs_4_12-v2ref_3586-type-audit.json` (`ariaAutocomplete:"list"`, `ariaHasPopup:"listbox"`, `candidateCount:1`), `observations/obs_{1_1,2_2,2_3,3_7,3_8,3_9,3_10,4_11,4_12,5_16}.json`, `planner/episode_{1..12,finalization}-*.json`. Comparison probes: `…/webvoyager_lite_1788126942380/…` and `…/webvoyager_lite_1788125824549/…` (quarantine timeline in EP4–EP8 planner inputs).
**Source:** `src/v2/substrate/InputService.ts:135-178` (type: resolve→fill→value read-back→`input_not_applied`), `:46-67` (`buildClickErrorFromVerdict` blocker diagnostics), `src/v2/substrate/ObservationService.ts` (WIP: `EMPTY_NAVIGATION_RETRY_WAIT_MS=100`, title-gated single recapture), `src/v2/substrate/semanticHitTest.ts:276-295` (hard_blocker verdict, 7 probe points), `src/v2/planner/V2PlannerClient.ts` (WIP `buildEmptyObservationWaitRescue` — navigate+`obs_`-ref-get gated), `src/v2/runtime/FailureClassifier.ts` (WIP: input_not_applied → category=target, persistence=persistent), `src/v2/planner/PlannerWorkingSetSelector.ts` (WIP: `repeated_persistent_target` ≥2 + current-epoch gate; `evidenceRefIds` +120), `src/v2/agent/V2AgentLoop.ts:1086` (signal producer, semanticTargetKey), `src/v2/harness/BrowseGentV2Harness.ts` (WIP: `captureCurrentObservation(true)` at open + post-action), `src/v2/agent/AnswerContract.ts` (not implicated in this failure).
**External:** Playwright 1.58.2 (installed): `node_modules/playwright-core/types/types.d.ts:2659-2662` — fill = wait for element + actionability → focus → fill → trigger `input` event (no retention verification; `force` bypasses actionability; click adds "receives events" hit-testing, fill does not). browser-use: `tools/service.py:804-810` (type read-back warning; concatenation auto-retry `default_action_watchdog.py:1981-2050`), no combobox suggestion protocol. browser-control: `src/js.rs:4` (native-prototype fill, no read-back). agent-browser (vercel-labs, local clone): `cli/src/native/interaction.rs:114` (RefMap → CDP fill), no retention verification found. Alumnium: driven via `tests/benchmark/v2/adapters/alumnium_runner.py` (official pip package, Playwright backend, a11y-tree canned actions; no local site-packages available — mechanism details knowledge-based, web verification quota-blocked).

## 11. Go/No-Go recommendation

**GO** — sequence: (1) build the §7 fixture and run the four offline measurements (pure test-scope, no production code touched); (2) only on fixture validation, implement §8 items 1–4 as generic, individually flag-gated changes with unit tests mirroring the fixture; (3) re-run the single-task probe (n=1, same trace dir) with the commit pin recorded and compare episode counts, empty-observation rate, and input_not_applied count. **NO-GO** for: any Booking-specific logic, force-click, global wait inflation, ref-system changes, and any production change before the fixture result. Expected effect if validated: the agent gains an operable destination input path (R3), retains deep-link state or recovers from stripped redirects via the combobox protocol (R2), stops paying 3–6 episodes per probe on blind calls and alternation loops (R4, R5), and finalizes on a real observation — the minimal generic path to internal completion on this failure class.
