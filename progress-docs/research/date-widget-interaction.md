# Date-Widget Interaction Forensics (Run 15, focused extraction)

Focused self-extraction over the four widget tasks (`Booking__0`, `Booking__10`, `Google__Flights__0`, `Google__Flights__10`) after two research-agent attempts failed on platform concurrency limits. All findings derive from run-15 traces (`logs/webvoyager-lite/webvoyager_lite_1788594583363/traces/`), live probes with the real pipeline functions (`scratch/horizon-probe*.ts`, delete after next round), and the run-6 competitor traces.

## 1. Executive summary

1. **Booking__0's calendar machinery was NOT the blocker.** The locale-tolerant horizon/target-date pipeline (`HorizonDetector`, `DateLabelMatcher`) parses Hindi day cells perfectly (`"25 दिसंबर 2026"` → Dec 25, 2026), `goalProgress` focused `dates` correctly, and December 25/26 cells reached the planner's working set by episodes 10–11 (Dec 26 alone in ep 7).
2. **Real bug candidate (W-B, re-attributed):** in episode 7 the planner saw `v2ref_13053` (Dec 26) but not `v2ref_13051` (Dec 25), despite both being visible and matched in the raw observation. The original graph-filtering hypothesis is **refuted** — `ProjectionService.project` has ignored its `_graphSnapshot` parameter since introduction (core-architecture-leverage.md ES4). The drop is an **un-coded selection race** (ES5 class: 69.8% of drops carry no reason code); the F7a `rank_loss` accounting plus target-value force-include verification on the next run will pinpoint it.
3. **Real waste (W-C):** sibling day-cell clicks dispatch OK but produce no observable change (`ok=True, stateChanged=False` streaks) — the same signature P5 now covers for link-role targets, but widget roles (checkbox day cells) are deliberately excluded there.
4. **Real waste (W-A):** post-submit observations twice came back **empty (0 refs)** — `obs_1_13`, `obs_1_21` — burning final episodes; the run ended `v2_max_steps_exhausted` with finalAnswer "खोजें button" (the last successful evidence preview, not an answer).
5. **Real waste (W-D):** `Google__Flights__0` spent **8 of 13 steps** on navigate attempts (3× `same_url_navigation` rejections, 5× `action_blocked_by_loop_detector`) after the autocomplete flow stalled — the `no_op_navigation` signal fired but flash-lite ignored it repeatedly.

## 2. Booking__0 anatomy (goal: "Find a Mexico hotel with deals for December 25-26", page locale `hi`)

| Phase | Evidence |
|---|---|
| Destination typed | step 0 `type v2ref_67` blocked by overlay → dismissed → step 3 typed OK (`goalProgress: destination typed:"Mexico"`) |
| Calendar opens on current-month window | ep 6 view: Sept (42) + Oct (18) labels; goal needs December — no `दिसंबर` anywhere yet |
| Dec 26 reaches planner, Dec 25 missing | ep 7 input: 80 refs, `v2ref_13053` present, `13051` absent (raw obs `obs_1_11` has both, 20 visible) |
| Both Dec cells in set | ep 10 input: 2 dec cells; ep 11: 8 |
| Candidate clicks without effect | steps 8–10 clicks `ok=True stateChanged=False` (sibling widget refs) |
| Search submitted | step 11 click `v2ref_16071` ("खोजें") |
| Empty captures kill the tail | `obs_1_13`/`obs_1_21`: `refs: 0` |
| Terminal | `v2_max_steps_exhausted`, finalAnswer "खोजें button" |

Verified capabilities (probes): `buildMonthNameLookup('hi')` → 26 entries; `parseCalendarLabel("25 दिसंबर 2026")` → `{month: 12, day: 25, year: 2026}`; `findTargetDateCells` → both cells; `PlannerWorkingSetSelector.select` with `targetValueRefs` force-includes both through the 80-cap. `detectDateHorizon` returns undefined (correctly — target months were covered when the cells were visible).

## 3. Widget findings W-A…W-D with generic mechanisms

- **W-B (bug, high priority):** target-required cells must survive graphSnapshot projection filtering. Touchpoint: whatever filter `ProjectionService.project(observation, graphSnapshot)` applies to interactions — union `targetValueRefs`/horizon-required cells back into the projection, or run `findTargetDateCells` before filtering and re-include. Validation: unit repro with a graphSnapshot that weakens a matched cell; balanced30 Booking pair.
- **W-C (recovery):** extend the click-no-navigation/no-observable-effect streak to clicks inside a *detected calendar cluster* (reuse `selectCalendarCluster` classification): after 2 effect-less clicks, inject guidance to verify picker state (get on the cell/field) or use keyboard (ArrowDown/Enter), and never re-click a sibling cell blindly. Roles: checkbox/gridcell/button inside the cluster — bounded by cluster membership, so no global widget false-positives.
- **W-A (capture integrity):** an empty post-action observation (0 refs) should (a) trigger one immediate recapture with hydration wait before composing the next planner input, and (b) if still empty, surface `empty_interactions` with the "wait once, then re-observe" guidance (exists) AND record the pre-submit URL so the planner knows the submit *did* something. Validation: Booking pair, no-regress on Huggingface__10 (intentional empty flows).
- **W-D (navigate-loop):** after the second `same_url_navigation` pre-execution rejection in a run, raise a dedicated recovery signal (`navigation_after_mutation_blocked`) whose mechanisms name the alternatives: press Enter in the last-typed field, click the visible submit control, or report honestly. This is P5's sibling for navigate-type churn; consider suppressing `navigate` plans entirely once this state is active (runtime-level refusal already exists — the planner just keeps trying).

## 4. Competitor comparison (run 6)

Browser-control also scored 0/4 on these tasks (head-to-head doc §4.2) — it looped against the same widgets for the full 12 steps on every one. No competitor primitive to import here; the leverage is in fixing our own four defects above.

## 5. Validation plan (next balanced30 round)

| Change | Must flip | Must NOT regress | Guard |
|---|---|---|---|
| W-B target-cell graph-survival | Booking__0/10 progress (dates selected → search) | Google__Flights__0/10 tail | `target_value` reason present on both range cells in planner inputs |
| W-C calendar click streak | Booking pair | — | effect-less sibling click streaks ≤ 2 per run |
| W-A empty-capture recapture | Booking pair tail | Huggingface__10 | post-submit empty observations followed by recapture |
| W-D navigate-loop suppression | Google__Flights__0 | ArXiv__0 (navigate-heavy) | navigate attempts after 2nd same-url rejection = 0 |

These four are queued behind the current validation run (P1–P6 batch) to keep attribution clean.
