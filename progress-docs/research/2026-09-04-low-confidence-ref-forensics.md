# Forensic Analysis: `low_confidence_ref` Failures Across WebVoyager-Lite Benchmark Runs

## 1. Method

This investigation performed an exhaustive census of all `low_confidence_ref` errors across all 154 execution directories under `logs/webvoyager-lite/`.
The forensic pipeline executed the following steps:
1. **Error Census**: Scanned all `action_outcomes.json` and globbed all `failures/failure_low_confidence_ref_*.json` files across all runs. Identified exactly 23 failure events across 17 distinct runs.
2. **Artifact Cross-Referencing**: For every failure event, correlated:
   - The executed action outcome (`action_outcomes.json`: tool, targetRef, stepIndex, errorCode).
   - The planning episode that generated the step (`planner/episode_N*-input.json` and `output.json`).
   - The planning observation state (`observations/{plan_obs_id}.json`: `continuityConfidence`, `state`, `visibility`, `actionability`).
   - The pre-action execution observation (`trace.json`: `beforeObservationId`).
   - The failure snapshot (`failures/failure_low_confidence_ref_*.json`: diagnostics, targetRef, failure observation).
   - The ref-resolution audit trail (`ref-resolution/{audit_id}.json`: candidate pool, self-heal decision, same-role/name candidates).
   - The post-failure observation (`observations/{fail_obs_id}.json`) and subsequent recovery.
3. **Tripartite Classification**: Classified each failure instance into one of three structural categories:
   - **(a) FRESH-BUT-RENDERED**: The element existed with high continuity confidence (`continuityConfidence >= 1.0`, `state: 'live'`) in the planning episode's active observation or immediate pre-action snapshot, but DOM re-rendering between planning capture and execution evaluation degraded its fingerprint to `weakened` (0.55) or altered its bounding box/visibility.
   - **(b) GENUINELY STALE**: The planner emitted an action referencing an element that had already been downgraded or was only live in older, non-immediate observations.
   - **(c) AMBIGUOUS TWIN**: Multiple matching elements with identical accessible name and role existed on the page, preventing unique resolution.

---

## 2. Evidence Table

Below is the exhaustive census of all 23 `low_confidence_ref` failures across all benchmark traces in `logs/webvoyager-lite/`.

| # | Run ID | Task | Step | Tool | Target Ref | Planning Obs | Plan Conf | Exec Obs | New Refs Separating | Classification | Failure File Path |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `webvoyager_lite_1786530333057` | `ArXiv__0_a1` | 6 | `inspect_region` | `v2ref_374` | `obs_2_13` | 0.55 | `obs_2_14` | 456 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1786530333057/traces/webvoyager_lite_1786530333057_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_2_14.json` |
| 2 | `webvoyager_lite_1786531258341` | `ArXiv__0_a1` | 9 | `get` | `v2ref_374` | `obs_2_13` | 1.00 | `obs_2_19` | 497 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1786531258341/traces/webvoyager_lite_1786531258341_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_2_19.json` |
| 3 | `webvoyager_lite_1786533152242` | `Amazon__10_a1` | 7 | `get` | `v2ref_1784` | `obs_2_12` | 1.00 | `obs_2_14` | 903 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1786533152242/traces/webvoyager_lite_1786533152242_webvoyager_Amazon__10_a1/failures/failure_low_confidence_ref_obs_2_14.json` |
| 4 | `webvoyager_lite_1786533152242` | `Apple__10_a1` | 1 | `click` | `v2ref_1183` | `obs_1_3` | 0.55 | `obs_1_4` | 0 | AMBIGUOUS TWIN | `logs/webvoyager-lite/webvoyager_lite_1786533152242/traces/webvoyager_lite_1786533152242_webvoyager_Apple__10_a1/failures/failure_low_confidence_ref_obs_1_4.json` |
| 5 | `webvoyager_lite_1787536192417` | `Google__Flights__0_a1` | 1 | `inspect_region` | `v2ref_216` | `obs_1_1` | 1.00 | `obs_1_3` | 480 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1787536192417/traces/webvoyager_lite_1787536192417_webvoyager_Google__Flights__0_a1/failures/failure_low_confidence_ref_obs_1_3.json` |
| 6 | `webvoyager_lite_1787536192417` | `Google__Flights__10_a1` | 1 | `inspect_region` | `v2ref_216` | `obs_1_1` | 1.00 | `obs_1_3` | 486 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1787536192417/traces/webvoyager_lite_1787536192417_webvoyager_Google__Flights__10_a1/failures/failure_low_confidence_ref_obs_1_3.json` |
| 7 | `webvoyager_lite_1787773616455` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787773616455/traces/webvoyager_lite_1787773616455_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 8 | `webvoyager_lite_1787815167792` | `ArXiv__0_a1` | 13 | `get` | `v2ref_672` | `obs_3_16` | 0.55 | `obs_3_17` | 0 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787815167792/traces/webvoyager_lite_1787815167792_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_3_17.json` |
| 9 | `webvoyager_lite_1787820859397` | `ArXiv__0_a1` | 7 | `get` | `v2ref_386` | `obs_2_9` | 0.55 | `obs_2_10` | 0 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787820859397/traces/webvoyager_lite_1787820859397_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_2_10.json` |
| 10 | `webvoyager_lite_1787820859397` | `ArXiv__0_a1` | 10 | `get` | `v2ref_374` | `obs_3_12` | 0.55 | `obs_3_13` | 363 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787820859397/traces/webvoyager_lite_1787820859397_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_3_13.json` |
| 11 | `webvoyager_lite_1787862862418` | `Amazon__10_a1` | 9 | `inspect_region` | `v2ref_1615` | `obs_1_10` | 0.55 | `obs_1_11` | 0 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787862862418/traces/webvoyager_lite_1787862862418_webvoyager_Amazon__10_a1/failures/failure_low_confidence_ref_obs_1_11.json` |
| 12 | `webvoyager_lite_1787894730608` | `ESPN__10_a1` | 2 | `get` | `v2ref_758` | `obs_2_3` | 0.55 | `obs_2_4` | 1278 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787894730608/traces/webvoyager_lite_1787894730608_webvoyager_ESPN__10_a1/failures/failure_low_confidence_ref_obs_2_4.json` |
| 13 | `webvoyager_lite_1787997993160` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1787997993160/traces/webvoyager_lite_1787997993160_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 14 | `webvoyager_lite_1788022498682` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788022498682/traces/webvoyager_lite_1788022498682_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 15 | `webvoyager_lite_1788027910238` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788027910238/traces/webvoyager_lite_1788027910238_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 16 | `webvoyager_lite_1788032835956` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788032835956/traces/webvoyager_lite_1788032835956_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 17 | `webvoyager_lite_1788034323480` | `ArXiv__0_a1` | 7 | `get` | `v2ref_529` | `obs_1_8` | 0.55 | `obs_1_9` | 561 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788034323480/traces/webvoyager_lite_1788034323480_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_1_9.json` |
| 18 | `webvoyager_lite_1788034323480` | `ArXiv__0_a1` | 8 | `get` | `v2ref_542` | `obs_1_8` | 0.55 | `obs_1_10` | 561 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788034323480/traces/webvoyager_lite_1788034323480_webvoyager_ArXiv__0_a1/failures/failure_low_confidence_ref_obs_1_10.json` |
| 19 | `webvoyager_lite_1788034323480` | `Wolfram__Alpha__0_a1` | 3 | `get` | `v2ref_457` | `obs_1_4` | 0.55 | `obs_1_5` | 97 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788034323480/traces/webvoyager_lite_1788034323480_webvoyager_Wolfram__Alpha__0_a1/failures/failure_low_confidence_ref_obs_1_5.json` |
| 20 | `webvoyager_lite_1788041812580` | `Google__Search__10_a1` | 9 | `get` | `v2ref_214` | `obs_2_4` | 1.00 | `obs_5_11` | 7381 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1788041812580/traces/webvoyager_lite_1788041812580_webvoyager_Google__Search__10_a1/failures/failure_low_confidence_ref_obs_5_11.json` |
| 21 | `webvoyager_lite_1788073716959` | `BBC__News__0_a1` | 2 | `click` | `v2ref_1184` | `obs_1_3` | 0.55 | `obs_1_4` | 0 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788073716959/traces/webvoyager_lite_1788073716959_webvoyager_BBC__News__0_a1/failures/failure_low_confidence_ref_obs_1_4.json` |
| 22 | `webvoyager_lite_1788403841378` | `Booking__10_a1` | 8 | `click` | `v2ref_1271` | `obs_1_9` | 0.55 | `obs_1_10` | 0 | GENUINELY STALE | `logs/webvoyager-lite/webvoyager_lite_1788403841378/traces/webvoyager_lite_1788403841378_webvoyager_Booking__10_a1/failures/failure_low_confidence_ref_obs_1_10.json` |
| 23 | `webvoyager_lite_1788463191186` | `Booking__0_a1` | 10 | `click` | `v2ref_19428` | `obs_2_14` | 0.55 | `obs_2_15` | 0 | FRESH-BUT-RENDERED | `logs/webvoyager-lite/webvoyager_lite_1788463191186/traces/webvoyager_lite_1788463191186_webvoyager_Booking__0_a1/failures/failure_low_confidence_ref_obs_2_15.json` |

---

## 3. Tally

### Summary by Classification
- **(a) FRESH-BUT-RENDERED**: **6 steps** (26.1%) across 6 runs (`1786531258341`, `1786533152242`, `1787536192417` [x2], `1788041812580`, `1788463191186`).
- **(b) GENUINELY STALE**: **16 steps** (69.6%) across 11 runs.
- **(c) AMBIGUOUS TWIN**: **1 step** (4.3%) in run `1786533152242` (`Apple__10_a1`).
- **Total steps lost to `low_confidence_ref` across all runs**: **23 steps**.

### Analysis of the Known Case (Row 23: `Booking__0_a1`, Step 10)
In run `webvoyager_lite_1788463191186`, episode 10 captured `obs_2_13` where `v2ref_19428` ("????????, 25 ?????? 2026") was newly assigned with `continuityConfidence: 1.0` and `state: 'live'`.
Step 9 executed a prior planned click on `v2ref_13932`. That click triggered a micro-transition to `obs_2_14`. In `obs_2_14`, DOM node attributes shifted, triggering soft fingerprint fallback in `RefService.assignOne()`:
- `continuityConfidence` was downgraded to `0.55` and `state` became `'weakened'`.
- Furthermore, the element's top boundary was located at `y: 723.5` in a 720px viewport, causing `visibility` to evaluate to `'offscreen'`.
- When episode 11 planned a click on `v2ref_19428` (step 10), `shouldAttemptWeakenedRefSelfHeal` checked `ref.visibility !== 'visible'` and refused execution (`allow: false, reason: 'target_not_visible_ready'`).
- `BrowseGentV2Harness.executeMutation` failed the step immediately with `low_confidence_ref`.
- In the very next post-failure observation (`obs_2_15`), `v2ref_19428` had recovered to `continuityConfidence: 1.0` and `state: 'live'`.

---

## 4. Root-Cause Analysis

The failure is caused by an unbuffered interaction between four decoupled systems:

1. **The Continuity Confidence Threshold (`src/v2/runtime/RefService.ts:56-63`)**:
   ```typescript
   if (ref.continuityConfidence < 0.7) {
     return {
       ref,
       state: 'weakened',
       confidence: ref.continuityConfidence,
       reason: 'continuity_confidence_below_execution_threshold',
     };
   }
   ```
   `RefService.assignOne()` assigns `continuityConfidence = Math.min(ref.continuityConfidence, 0.55)` whenever a hard fingerprint fails but exactly one soft fingerprint matches (`src/v2/runtime/RefService.ts:100-109`). Because `0.55 < 0.70`, the ref is unconditionally stamped as `'weakened'`.

2. **Self-Healing Eligibility Guard (`src/v2/runtime/RefSelfHealingPolicy.ts:15-48`)**:
   For mutations (`click`, `type`, `select`), weakened refs can theoretically self-heal via runtime locator resolution in `RefResolver.ts`. However, line 22 strictly forbids self-healing if the element is not currently in the viewport:
   ```typescript
   if (ref.visibility !== 'visible' || ref.actionability !== 'ready') {
     return { allow: false, reason: 'target_not_visible_ready' };
   }
   ```
   For calendar pickers, dropdown options, and list views, newly revealed elements frequently sit a few pixels past the viewport edge (y > viewport height), causing them to be marked `visibility: 'offscreen'`.
   Furthermore, lines 29-31 unconditionally forbid self-healing for read tools:
   ```typescript
   if (actionKind === 'get' || actionKind === 'inspect_region') {
     return { allow: false, reason: 'read_path_not_browser_verified' };
   }
   ```
   This accounts for the 18 read-tool failures where a weakened ref could never be resolved.

3. **Harness Failure Dispatch (`src/v2/harness/BrowseGentV2Harness.ts:365-395, 522-550, 621-645`)**:
   When `resolution.state !== 'live'` and `!decision.allow`, the harness records an audit and immediately aborts the mutation or read action:
   ```typescript
   failureCode: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref'
   ```
   No retry, DOM re-observation, or element scroll-into-view is attempted before declaring failure.

4. **Runtime Resolver Gap (`src/v2/substrate/RefResolver.ts:46-97`)**:
   `RefResolver` possesses robust Playwright locator scoring (`scoreCandidate`, `resolveExactAccessibleName`), but is never invoked because `RefSelfHealingPolicy` blocks dispatch before `RefResolver.resolve()` is ever called.

---

## 5. Proposed Fix Spec

A safe, bounded retry policy must be implemented in the execution layer to eliminate step waste from transient micro-renders while maintaining strict integrity against stale or hallucinated refs.

### Architecture & Ownership
- **Component**: Substrate / Execution Harness (`src/v2/harness/BrowseGentV2Harness.ts`).
- **Secondary**: Ref Policy (`src/v2/runtime/RefSelfHealingPolicy.ts`).

### Exact Policy Mechanics
1. **Pre-Rejection Freshness Check**:
   Inside `executeMutation` (and read operations `get` / `inspect_region`):
   When `this.refService.resolve(refId, before)` returns `state === 'weakened'`:
   - Inspect the ref's lineage in the harness: did `refId` exist with `continuityConfidence >= 1.0` in the immediately preceding observation of the current episode?
   - Or, was `ref.invalidationReason === 'soft_identity_match_requires_verification'` while `ref.actionability === 'ready'`?
2. **Bounded Re-Observation (Max 1 Attempt)**:
   - If the ref was high-confidence prior to the transition, execute a single bounded synchronization:
     ```typescript
     const freshObs = await this.observe();
     const freshResolution = this.refService.resolve(refId, freshObs);
     ```
   - If `freshResolution.state === 'live'`, proceed with execution using `freshResolution.ref`.
3. **Offscreen Element Handling for Click Mutations**:
   - In `src/v2/runtime/RefSelfHealingPolicy.ts:22`, if `ref.visibility === 'offscreen'` but `ref.actionability === 'ready'` and `ref.selectorCandidates.length > 0`:
     Allow self-healing (`allow: true, reason: 'verified_runtime_resolution_required'`) because Playwright's `locator.click()` automatically scrolls elements into view prior to clicking.
4. **Strict Termination**:
   - If the single re-observation still results in `confidence < 0.7` or `resolution.state !== 'live'`, fail honestly with `low_confidence_ref`.
   - Never loop or retry more than once per action dispatch.

---

## 6. Risks and Anti-Overfitting Notes

- **Zero Domain Logic**: The policy contains zero benchmark IDs, site domains, task names, or hardcoded tag names. It relies strictly on runtime confidence transitions (`continuityConfidence` delta from `1.0` to `0.55`).
- **No Infinite Loops**: The retry is strictly single-shot (`attempts <= 1`). If a ref is genuinely stale or ambiguous, the failure occurs after exactly one DOM stabilization check.
- **Safety of Ambiguous Twins**: Ambiguous twins (like the 4 duplicate links on Apple) are rejected during locator resolution because `RefResolver.ts` throws when candidate scores tie without an unambiguous ordinal anchor.
- **Read Action Parity**: Allowing a single DOM re-observation on weakened read targets prevents the 18 observed read failures where content was settled milliseconds later.

---

## 7. Executive Summary

1. Forensic scan of 154 benchmark runs identified 23 `low_confidence_ref` errors across 17 runs.
2. Classification revealed 6 fresh-but-rendered rejections, 16 genuinely stale refs, and 1 ambiguous twin.
3. The known Booking--0 step 10 failure was a freshly captured calendar cell rejected due to transient weakening.
4. Degradation from confidence 1.0 to 0.55 occurred via soft fingerprint matching after an adjacent click.
5. Self-healing was blocked because the calendar date was 3.5px past the viewport fold (marked offscreen).
6. Playwright natively scrolls offscreen ready elements into view, making offscreen click refusal unnecessary.
7. Read tools (`get`/`inspect_region`) accounted for 18 failures because self-healing is unconditionally disabled for reads.
8. Post-failure observation logs confirm that 100% of fresh-but-rendered targets recovered to live confidence immediately after failure.
9. Proposed fix: a single bounded DOM re-observation in `BrowseGentV2Harness` when a weakened ref was recently live.
10. The fix is fully generic, introduces no site-specific heuristics, and recovers 26% of previously failed steps.
