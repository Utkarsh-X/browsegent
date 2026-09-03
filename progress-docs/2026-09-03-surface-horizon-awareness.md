# Surface Horizon Awareness — Design Note (2026-09-03)

## 1. Problem class (generic, not site-specific)

Rich web widgets expose only a **window** of their option space: calendars render 1–2
months at a time, paginated tables render one page, carousels render a slice. A goal
whose target value lies **outside the currently visible window** requires a
widget-local navigation loop:

1. recognize the target value is not among the visible options,
2. identify the widget-local control that advances the window,
3. iterate (click → re-observe → click …) until the target enters the window,
4. commit the value.

This class covers calendars, paginated result tables, "load more" lists, and paged
dropdowns. It is one of the most common interaction shapes on booking / travel /
e-commerce surfaces.

## 2. Evidence (probe battery, 2026-09-03, both runs `--planner-serialization prc`, flash-lite)

### Run A — `webvoyager_lite_1788388143290`, Booking--0 ("Find a Mexico hotel with deals for December 25-26")

- GOAL PROGRESS checklist worked as designed: EP1 `focus=destination` → EP2
  `destination=typed:"Mexico"`, `focus=dates`. Parser fix live.
- Calendar opened showing **September/October 2026** only. Goal month (December 2026)
  not in DOM (verified: `दिसंबर` absent from full observation, 3836 refs).
- `अगले महीने` (Next month, `v2ref_7082`, role=button) **was in the EP5 working set**;
  model re-clicked the date field and detoured to occupancy instead.
- Model panic-navigated to the homepage it was already on (EP9) → input cleared,
  sign-in overlay returned → re-type loop. Budget exhausted (13 episodes, ~107k input
  tokens).

### Run B — `webvoyager_lite_1788388870883`, Booking--10 ("…Paris… February 14-21, **2027**…")

- Checklist held `destination=typed:"Paris"` for 11 straight episodes (stable).
- Model executed the suggestion-gated combobox protocol correctly (clicked
  "Paris Ile de France, France" suggestion) — first observed clean execution.
- Calendar showed September/October 2026; goal month is February **2027** — five
  next-month iterations away.
- **`v2ref_14150` "Next month" (role=button, visible, ready, live) existed in the full
  observation but was NOT selected into the working set** (80 of 3785 kept; cutoff
  filled by `recently_changed` flood of the just-opened calendar + goal-matched items
  scoring 285–295; the nav button sat at ~100–170).
- EP13: GP `destination` regressed to NOT_SET **with no page reset** — the ~5-step
  lineage window forgot the type from step 6. Model responded with despair moves
  (scroll up + wait). Budget exhausted.

### Defect stack (all generic)

| ID | Defect | Layer |
|----|--------|-------|
| D1 | Widget-local navigation controls lose the working-set score competition when a widget opens (flood of `recently_changed` siblings) | selection |
| D2 | Nothing connects "focused requirement's target is outside the visible window" to "this control advances the window" | representation |
| D3 | Window-to-target paging costs 1 planner call per click (Sep 2026 → Feb 2027 = 5 calls) inside a 14-step budget | budget/efficiency |
| D4 | GP requirement state derived from the ~5-step lineage window regresses spuriously (forgetting without a page event) | representation |

## 3. Design

Architecture fit: Brain2 (deterministic substrate) computes the *facts*
(coverage, target, candidate controls); Brain1 (planner) makes the *decisions*
(direction, when to stop, which value to commit). Same philosophy as
`suggestion_option` and `recovery_control` promotions: a ranking prior plus honest
information, never an auto-action.

### Stage 0 — GP long-horizon evaluation + staleness (D4)

- `PlannerInputComposer` evaluates `evaluateGoalProgress` against a **long-horizon**
  lineage (compress `input.trace` with `maxSteps = 48`) instead of the rendered
  5-step lineage. Rendered lineage unchanged.
- Staleness marking: for each requirement satisfied by a `type` step, if a successful
  `navigate` step occurs **after** the last matching type step, the state becomes
  `stale:"X"` (the value may have been reset by navigation; re-verify on surface).
  Fresh type after navigate → fresh `typed:"X"`.
- Renderer (verbose + compact) and one PlannerPrompt sentence for `stale`.

### Stage 1 — Horizon detection + annotation + promotion (D1 + D2)

Substrate passthroughs (truth already captured, previously dropped):
- `BrowserObservation.lang` ← `document.documentElement.lang` in `capturePageState`.
- `ProjectionItem.box` ← passthrough of `V2Ref.box` in `toProjectionItem`.
- `OperationalProjection.lang` ← observation lang.

New pure module `src/v2/planner/HorizonDetector.ts`:
- Day-cell cluster: ≥10 interaction refs whose name/text contains a day number and a
  4-digit year (locale-free digit pattern).
- Visible months: parse month names from cell names using `Intl.DateTimeFormat(lang)`
  month names (platform i18n database — zero hardcoded tables, zero site selectors).
  Missing/empty lang → detector returns undefined (honest no-op).
- Widget bounds: min/max of cell boxes; nav candidates = ready/visible buttons within
  the widget bounds whose names are not day-cells or month headers (cap 6), direction
  hint from x-position (right half → `next`, left half → `prev`) rendered as a hint.
- Coverage check: focused `dates` requirement's target months (from parsed
  `dateFrom`/`dateTo`) vs visible month set → `covered: boolean`, `want: string[]`.

#### Geometry lessons (from validating against the live Booking observation artifact)

The first detector draft passed all synthetic tests but failed on the real Hindi
calendar artifact. Two real-surface facts, now pinned by regression tests:

1. **Header strip gap**: nav buttons sit *above* a month-label + weekday strip —
   ~36px above the first cell row on the real widget. A nav band tolerance of
   24px excluded them; raised to 64px above the widget top (and 80px horizontally,
   since buttons overhang the cell grid's left/right edges).
2. **Day-number sub-buttons**: grids contain inner role=button elements labelled
   with bare day numbers ("2", "3"). They are cells, not nav controls; a bare
   1–2 digit label is rejected as a nav candidate.

Validation: the detector now fires on the exact artifact where the live run
missed it, returning exactly the `अगले महीने` control; a full
`ProjectionService → PlannerInputComposer` replay annotates the planner input and
force-selects the control into the working set.

Wiring:
- Composer: when `goalProgress.focus === 'dates'` and dates are `NOT_SET`, run the
  detector; attach `plannerInput.horizon` and pass nav refIds to the selector.
- Selector: `horizon_control` reason, +160 score, dropReason cleared, **force-include
  into the secondary lane** (bounded ≤6) — planner refs are validated against the
  selected set, so annotation without selection would be unactionable.
- PromptLayoutEngine: verbose `HORIZON` block + compact `HORIZON:` line, omitted when
  undefined. Byte-identical output when absent.
- PlannerPrompt: one generic sentence about advancing paginated controls.

### Stage 1b — Target-value promotion + selection detection (probe-driven additions)

Probe run `webvoyager_lite_1788392661548` proved the horizon loop works (two
next-month clicks steered by HORIZON, December reached) but exposed the mirror
defect: **December 25 was in the DOM but cut from the working set** (December
cells 1–19 filled the cap; the model clicked Dec 1 + "19" and spiraled).

- `findTargetDateCells` (HorizonDetector): matches observed day cells against the
  requirement's exact target dates; composer force-selects them into the working
  set with reason `target_value` (+160) when the target month IS covered.
- Date-selection state in the checklist: `evaluateGoalProgress` now accepts the
  page `lang` and detects committed in-widget selection from the long-horizon
  lineage — a completed click whose element name parses (via Intl) to every
  target date yields `dates=selected:"<goal's date label>"`, freeing the focus
  so the planner proceeds to search/submit instead of re-selecting.
- `CompressedLineageStep.targetName`: bounded accessible name of the acted-on
  element, extracted from the trace result — the substrate truth that makes
  value-level lineage matching possible.
- `parseAllDatePairs`: confirmation controls render the whole committed range in
  one accessible name ("Fri 25 Dec — Sat 26 Dec"); all date pairs are matched,
  not just the first. Locale abbreviations normalize combining marks so CLDR
  truncations ("दिस॰") and site truncations ("दिसं") converge.
- Direction recommendation: the horizon marks the nav control whose direction
  deterministically moves the window toward the target month as
  `[recommended]` (rendered first). Yearless targets only recommend against a
  single-year visible window.
- Blocker-persistence prior: dismissal controls keep the `recovery_control`
  promotion while the latest failure is a `target_blocked` at the current URL —
  successful reads/navigations no longer wash the blocker out of salience.
  Once dismissed, the control itself disappears, so stale promotion is a no-op.

### Stage 2 — `seek` macro (D3) — deferred, evidence-gated

Planner-callable bounded loop (`click nav control → re-observe → repeat until target
month/value visible`, max ~6 iterations, 1 planner call). Only implemented if the
Stage 1 probe shows the model engaging the horizon loop but exhausting budget on
paging calls. Keeps each stage falsifiable.

## 4. Non-goals / overfitting firewall

- No site names, task IDs, selectors, or hardcoded month-name tables (Intl only).
- Non-travel goals must produce byte-identical planner input (tests enforce).
- Detection failure degrades to today's behavior (no horizon annotation), never to
  invented facts.
- No auto-clicking from the substrate: nav controls are promoted and annotated, the
  planner decides.
