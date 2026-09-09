# Core Architecture Leverage Study: Is the BrowseGent v2 Foundation Pulling Its Weight?

**Scope**: foundational (below-the-patch-layer) audit of `src/v2/**` in the frozen worktree
`D:\BrowseGent-arch-research` (branch `research/arch-leverage-snapshot`). Artifact evidence is
READ-ONLY from run 15 (`D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1788594583363`, 30 tasks,
200 planner calls, 160 dispatched actions, lean PRC plane, `gemini/gemini-3.1-flash-lite`).
Prior research built on (not duplicated): `browser-control-vs-browsegent-lean-comparison.md`,
`research/browser-control-token-efficiency.md`, `research/step-exhaustion-forensics.md`,
`research/navigation-grounding-divergence.md` (its P1–P8 are excluded here; P1/P2 are already in the
frozen source), `research/strict-regression-forensics.md`.

**Method note (measurement validity)**: all rendered-surface numbers below come from a Python
re-implementation of `PlannerRepresentationCompiler.buildSurface` + `PromptLayoutEngine.renderLeanElement`
validated **byte-exactly** against the recorded provider payloads of all 200 episodes
(median delta 0 B, p95 0 B, max 85 B — i.e. every per-section byte figure is what the model actually received).
The mission's core map lists `src/v2/observe/`; **that directory does not exist in this snapshot** — the DOM
walk lives in `src/v2/substrate/ObservationService.ts` (single file, 611 lines). Source citations are the
frozen worktree; where behavior changed after run 15 (P1/P2, judge-evidence fix, grounding reconciliation),
this is called out.

---

## 1. Executive summary — the five most consequential findings

**ES1. The wire is already lean; the foundation's unused weight is representational, not serializational.**
The lean PRC user payload averages 7,943 B against a raw observation artifact of 875,685 B (110× compression;
median 709 refs observed → 80 rendered). `PLANNER SURFACE` is 82.4% of user bytes; every situation section
combined (STATE/RECENT EVENTS/PROBLEMS/…) is ~12%; the static system prompt (10,579 B) is 57% of mean wire.
There is no meaningful wire redundancy left to cut — refIds appear 1.1× per element, the URL exactly once.
The remaining leverage is in **what the substrate knows but never says** (ES2–ES4), not in format golf.

**ES2. One representational contract is broken end-to-end: `selectOptions` never reach the prompt.**
The DOM walk captures native-select option labels (`ObservationService.ts:349-358`, verified present in the
run-15 obs artifact: ESPN `obs_2_6` `v2ref_2142` carries 20 options), the PRC render supports them
(`PromptLayoutEngine.ts:414-416`), and the system prompt instructs their use (`PlannerPrompt.ts:83` —
"Use exact visible option labels from current.refs[ref].selectOptions") — but the only serializer that feeds
`current.refs`, `PlannerWorkingSetSelector.serializeSelectedProjection`
(`PlannerWorkingSetSelector.ts:727-745`), **omits the field**. The instruction is unsatisfiable by
construction; the model sees a GUID-named combobox with options mushed into `text` ("Top 25FBSACC…").
This is a genuine foundational defect in the observation→planner contract, one hop below the P1–P8 patch layer.

**ES3. The substrate's post-action self-knowledge is written to telemetry and never fed back to the planner.**
`ActionOutcomeRecorder` computes `observableEffect`/`stateChanged`/`inputApplied` per action
(`src/v2/trace/ActionOutcomeRecord.ts`; run-15 `action_outcomes.json`). In run 15, **29 of 157 dispatched
actions (18.5%) were silent successes** — `success=true` with no state change and no observable effect — and
**28% of them were followed immediately by a repeat of the same tool+ref, vs a 6% repeat baseline after
effective actions (4.7× multiplier)**. The "did my action actually do anything" fact exists deterministically
at dispatch time and reaches the planner only as an implicit `transition: microstate` line. Deterministic
pre-verification (brain1's differentiator) is roughly one-quarter built.

**ES4. The ContinuityGraph is ~90% dormant and its regions feature is structurally dead.**
The graph accumulates real state (median 1,682 ref nodes incl. stale, per episode) but delivers to the
planner: counts (368 B) + latest-transition class/strength + appeared/weakened ref-ID sets that feed two
score bonuses (+90/+70) and are then **not rendered anywhere in lean mode** (the working-set narrative that
carried reason codes is stripped to `WORKING SET / mode:` — 28 B). `ProjectionService.project(observation,
_graphSnapshot?)` ignores the graph entirely (`ProjectionService.ts:7`); the graph-derived fields on
`ProjectionItem` (`graphPresent`, `recentlyAppeared`, `recentlyChanged`, `recentlyWeakened`) are declared in
`projectionTypes.ts:40-44` and never populated; graph `regions` are always empty (`continuity.regionCount = 0`
in 200/200 episodes — no ref ever carries `regionId` in graph context, `ContinuityGraph.ts:177-197`). Stable
re-targeting via `targetId` exists but only inside loop detection (`V2AgentLoop.ts:1342-1356`) and self-heal
(`RefSelfHealPolicy`), never as a planner-visible "the control you failed on is now `[v2ref_N]`" heal hint.
The graph/transition sidecar artifacts are empty in all 30 traces — the graph never leaves the process.

**ES5. Selection is honest about *counts* but silent about *causes*, and the biggest silence is un-coded.**
197,907 refs were dropped across the run. Only **30.2%** carry a drop reason (`offscreen_low_value` 35,436,
`hidden_low_value` 18,417, `generic_low_value` 5,117, `unlabeled_action` 833); **69.8% (138,104 refs across
185 episodes) lost the score race with no reason code at all** (e.g. GitHub EP5: 782 observed → 80 selected,
`droppedByReason` sums to 364, the other 338 un-coded — including the winning `resource-watch` row). The
working set is the architecture's central act of authorship over what the model sees, and it currently
under-explains itself by ~2.3×, which blocks both forensics and safe tuning.

---

## 2. Full data-flow map with byte economics

### 2.1 The pipeline, hop by hop (run-15 means over 200 planner calls / 30 tasks)

| # | Hop | What is added / dropped / duplicated | Measured cost |
|---|-----|--------------------------------------|---------------|
| 1 | **DOM → in-page capture** (`ObservationService.ts:282-591`) | Walks all elements (shadow DOM), keeps **interactive-only** (`isInteractiveElement`, lines 461-486); computes role, accessible name (labelledby/aria/placeholder/title/value/labels/name/textContent), text, value (≤160 ch), placeholder, `selectOptions` (≤20), visibility (viewport-only: visible/offscreen/hidden), actionability, boxes, selector candidates, `nthRoleName`, `targetId` (FNV hash of selector\|name\|text\|index, line 569). **Dropped at birth: all non-interactive prose, all numeric pod bodies, scroll position, `bodyTextLength`/`bodyChildCount` are computed but used only for the zero-ref wait test** (`shouldWaitForEmptyNavigation`, line 128-134). | **875,685 B/obs artifact (median 647,969, max 3,195,891). 209 obs artifacts = 203.3 MB per 30-task run** — by far the largest hop in the system (in-page JSON → Node via Playwright serialization). Latency: `observation_capture` 76,055 ms of 2,066,700 ms task-total (~3.7%). |
| 2 | **Observation → OperationalProjection** (`ProjectionService.ts`) | Re-tagging only: every ref → `ProjectionItem` with `scoreRef` (visibility +40/+15, actionability +30/+5, state +15/+5, name/text-length ≤ +16, confidence ×10 — `rankOperationalItems.ts:40-57`); three sorted views (interactions/readables/navigation) over the **same items**; `repeated_list` regions for ≥3 same role+name items. **The `_graphSnapshot` parameter is ignored** (line 7). | In-memory only (no serialization). Duplication: items appear in up to 3 views. |
| 3 | **Projection → working set** (`PlannerWorkingSetSelector.select`) | Selects ≤80 refs (32 primary + 48 secondary) from median 709 observed (max 3,845); force-include lanes (suggestion/recovery/horizon/target-value/submit/result-row +120…+180); readableEvidence ≤48 × 220 ch; actionSurface lanes; changedRefs (≤16); quarantine. **Drops 197,907 refs over the run; 30.2% reason-coded** (§5). | Pre-render `PlannerInput` JSON: **62,451 B/call mean**, of which `workingSet` = **36,207 B (58%)** and `current` = 23,065 B. Every selected ref is mentioned **6.7×** in this JSON (refs record + 3 views + primary/secondary lists + actionSurface lanes + region summaries + changedRefs). Written to disk per episode (trace artifacts). |
| 4 | **PlannerInput → lean PRC render** (`PlannerRepresentationCompiler` → `PromptLayoutEngine`) | Compiles IR; lean element line = name + role-if-different + aria signals + value + placeholder-if-nameless + options + anomalies + failure + tools; 12,000-char surface budget (binds 1 line in run 15); working set collapses to `mode:`; decision signals = suppressed counts. **Dropped from wire: lanes, tiers, scores, reason codes, changedRefs.topRefs, omitted narrative, `text` attribute** (name falls back to text only when name absent). | **7,943 B/call user payload** (median 8,213, p90 11,206, max 17,037). Surface = 82.4% of it. refId mentions: **1.1× per rendered element**; URL exactly 1.0×/call. **110× compression vs the observation artifact.** |
| 5 | **Render → LLM** (`V2PlannerClient.call`) | Static system prompt 10,579 B (constant across all 200 calls — **57% of the 18,522 B mean wire**); response schema sent via `responseJsonSchema` (~887 B); ≤2 attempts; validation feedback re-sends full payload on attempt 2 (14 multi-attempt calls in run 15: 204 attempts / 200 calls). | **5,153 input tok/call mean; 34,352 input tok/task; 218 output tok/task** (3.375 B/tok, per `browser-control-token-efficiency.md` §4.1). |
| 6 | **Plan → action** (`V2ToolDispatcher` → harness → InputService) | 160 dispatched actions / 30 tasks (5.33/task); 3 pre-execution guards (loop-detector signature, step validation, same-URL navigation — `V2AgentLoop.ts:326-408`); deterministic in-action verification: semantic hit-test (7 probe points, blocker diagnostics), click-event + post-click connectivity probe, input retention check (`input_not_applied`), native-select read-back. | Per-action substrate ground truth recorded (`action_outcomes.json`): **clicks 78 → 52 success / 30 stateChanged; 29/157 silent successes; 9 guarded navigations**. Stabilization = domcontentloaded + 75 ms (`StabilizationService.ts:12-25`). |
| 7 | **Outcome → next episode** (`ContinuityInterpreter` → graph → uncertainty/recovery → composer) | Transition classified (hard_reset / structural_macrostate / structural_local / microstate — `transitionClassifier.ts:11-33`) by `targetId`-first ref matching (`ContinuityInterpreter.ts:105-116`); refChanges counted; RecoveryState (6 states; fired 68/200 episodes: `navigation_oscillation` 56, `wrong_target_type` 8, `zero_result_read_loop` 3, `repeated_type_same_value` 1); uncertainty signals; lineage ≤5 steps; EvidenceLedger cards/sort. | Renders as RECENT EVENTS (147 B, 170/200) + PROBLEMS (298 B, 150/200). **Dropped from wire: which refs appeared (topRefs are JSON-only in lean), reason codes, preserved list.** |
| 8 | **Answer gates** (`AnswerContract` → advisory/hard split → hygiene → grounding reconciliation) | Hard/advisory partition; coverage (`buildTaskEvidenceCoverage`); date-requirement gate; single advisory steering; repeated-rejection dead-man switch (≥3); finalization call on budget exhaustion with evidence (fired 5×/run); grounding reconciliation (0× in run 15 — post-run-15 source). | 24 done outputs; 5 CAPTCHA escalations; 5 unknown/max-steps endings (3 with substantive answers recorded, BBC empty). |

### 2.2 Where the same fact is paid for twice or three times

- **On the wire (lean): essentially clean.** refId 1.1×/element, URL 1.0×/call. Two real duplications:
  (a) the **weakened-ref count** is paid in RECENT EVENTS (`weakened=N`) *and* in PROBLEMS (`uncertainty … weakened_refs:N`) in **78/200 episodes**;
  (b) a failed action is paid in RECENT EVENTS (`last: click v2ref_N -> failed code`) *and* in PROBLEMS (`failure: …`) in **22/200**, *and* a third time as the element's `failed=` attribute when the same ref is annotated on the surface.
- **In the pre-render JSON (composition + trace cost, not wire): heavy.** 6.7 mentions per selected ref; the
  36 KB working-set object renders as 28 B (`mode:` line). The JSON is the substrate's working memory, but it
  is serialized to disk 200× per run (~12.5 MB of planner-input artifacts) in a shape nobody re-reads; the
  same information exists in obs + rendered artifacts.
- **Structural duplication across the run: 23.4% of surface element-line bytes repeat verbatim from the
  previous episode of the same task** (measured line-level; the stateless per-call re-send tax). Over 6.67
  calls/task this is ~1.1 KB/call of pure repetition the model must re-read to re-anchor — the tax a
  persistent page model or diff-first render would remove.

---

## 3. The silence ledger — where the rendered surface lies or stays silent

Each entry: the fact, who knows it, whether the model can know it, and the run-15 receipt.

**S1. `selectOptions` — the impossible instruction.** The walk captures ≤20 option labels for native
selects (`ObservationService.ts:349-358`); the obs artifact carries them (ESPN `obs_2_6`: `v2ref_2142` =
20 options `["Top 25","FBS","ACC","American",…]`; also `v2ref_2172`); `current.refs` in the planner input
does **not** (`PlannerWorkingSetSelector.ts:727-745` omits the field while `brain1/serializeProjection.ts:65-67`
and `PlannerRepresentationCompiler.ts:165` both support it); the lean render therefore never emits `options=`;
and `PlannerPrompt.ts:83` instructs "Use exact visible option labels from **current.refs[ref].selectOptions**
when present". The model's only residual signal is `text` — the select's `textContent` concatenation
("Top 25FBSACC…", truncated at 220 chars). ESPN EP12's `select "2024"` on the wrong control is the observed
downstream behavior (`navigation-grounding-divergence.md` §2.2).

**S2. Prose does not exist in the substrate.** `isInteractiveElement` admits anchors/buttons/inputs/roles/
tabindex/on*/pointer-cursor only (`ObservationService.ts:461-486`). Paragraph sentences, list-item bodies,
pod values: never captured as refs. Receipt: "Unsubmit"/"delete or delay" appears in **0 of 10** ArXiv obs
files (grep-verified; the anchor page's procedural sentence the answer needed was never in any ref), and the
numeric answer "51.5 uT" appears in **0 refs** of any Wolfram obs (see S3).

**S3. Value-bearing titles are dropped twice.** The Wolfram "Geomagnetic field strength" pod **is** in the
final observation — `obs_1_7` `v2ref_556`, `visibility: offscreen`, `role: null` → kind `generic`, with its
"Show gaussUnits" child controls mushed into the `name` ("Geomagnetic field strength for Oslo,
Norway:Show gaussUnits …"). (This *corrects* the prior doc's §2.7 claim that the pod "was never in the
captured DOM set": the title was captured; the value was not, and the title was then dropped.)
Two independent silences: capture silence (the pod's numeric body is non-interactive text) and selection
silence (`offscreen && kind==='generic'` → `offscreen_low_value`, `PlannerWorkingSetSelector.ts:420-424`;
no planner input contains "field strength"/"51.5" — verified across all 8 episodes).

**S4. Offscreen is 51% of what the substrate sees and mostly never competes.** Observed visibility mix:
**51.0% offscreen, 37.4% hidden, 11.6% visible** (232,780 refs). Selected mix: 72.9% visible / 23.4%
offscreen / 3.6% hidden. Offscreen items pay a −25 handicap into every score race
(`rankOperationalItems.ts:43-44`: +15 vs +40) and lose it 138,104 times un-coded (ES5). The 3,457 rendered
`state="visibility=offscreen"` lines show the mechanism *can* surface below-fold data when items survive.

**S5. "Appeared" is a number without names.** RECENT EVENTS renders `appeared=143`-style counts, but in lean
mode the ref-ID lists (`changedRefs.topRefs`, `refChanges.appeared`) render **nowhere** (`renderWorkingSet`,
lean branch = mode only, `PromptLayoutEngine.ts:493-496`); reason codes (`new`, `changed`) are also stripped.
The model is told 143 things appeared and must self-diff 80 rendered lines to find the important ones — while
the combobox guidance explicitly tells it to "check the automatic observation for appeared suggestion
elements" (`PlannerPrompt.ts:112`). The substrate computed the exact list and withheld it.

**S6. Silent successes — the substrate knows the action did nothing and doesn't say so.**
`hasObservableEffect`/`stateChanged` are computed per dispatch (`V2AgentLoop.ts:468-476`) and recorded, but
`PlannerLastResultSummary` (`PlannerInputComposer.ts:246-267`) carries only success/kind/targetRef/preview/
error — no effect field. Receipt: 29 silent successes; **8/29 immediately repeated same tool+ref (28%)** vs
**6/102 (6%)** after effective actions. Also 21 clicks with `observableEffect=false` total, and 26 clicks
with `stateChanged=false` — a no-op click is indistinguishable from a working one unless the model notices
nothing changed by itself.

**S7. Anonymous elements.** 2,042 of 14,762 rendered lines (**13.8%**) have `name=` equal to the bare refId
(no accessible name, no text). They can never match goal tokens (selection bias — `goalMatchesItem` has
nothing to match), and the model must act on pure geometry/role faith. The walk already computes
`ariaLabelledByText` (`ObservationService.ts:428-441`) and label association; the mush fallback
(textContent of whole containers, e.g. "Top 25FBSACC…") degrades the rest.

**S8. Evidence snapshot scarcity and sort blindness (run-15 state).** `evidenceSnapshot` present in only
**25/200 episodes** (8 tasks); `activeSort` **null in all 25**; cards ≤8. GitHub's decisive EP5 answered a
"most stars" superlative from an unsorted list with no sort-provenance line anywhere. *(The frozen source
already contains the P2 fix — `EvidenceLedger.extractActiveSort` incl. the "generic sort control →
relevance" rule at `EvidenceLedger.ts:100-106`; run 15 predates it. Counted as banked, not re-proposed.)*

**S9. `focus` is an undocumented contract.** Every STATE block renders `focus: v2ref_N
highest_operational_score` (`ProjectionService.ts:24-26` → `PromptLayoutEngine.ts:264`) — the item with the
highest heuristic score (name-length-inflated). The system prompt never mentions this line. It is ~40 B × 200
calls of an undefined-contract hint that can actively mislead (score favors long names, not goal relevance).

**S10. Drop causes un-coded (68.9% of dropped refs).** See ES5. The DECISION SIGNALS line renders the
suppressed *count*; the diagnostics under-report the *why* by 2.3×. Anyone tuning the 80-ref budget today is
flying on 30% of the instrument panel.

**S11. Read-back windows are narrow and role-gated.** `get` returns ≤4,000 chars and a `value` **only when
`role==='textbox'`** (`BrowseGentV2Harness.ts:190-195`); `search_page` returns ≤12 lines × 500 chars + 3-line
preview (208-244). Everything the model knows about page prose arrives through these two windows plus
name/text attributes ≤120 chars — the mechanism behind S2/S3.

---

## 4. Dormancy analysis per subsystem

**substrate/ObservationService** — *partially dormant.* Core walk healthy and rich. Dormant by-products:
`readiness.bodyTextLength/bodyChildCount` computed every capture, used only as "are there zero refs"
(`ObservationService.ts:128-134`) — a page-text coverage ratio (how much of `bodyTextLength` survives into
refs) is never computed anywhere, although it is the natural alarm for S2; `selectorCandidates` reach only
RefResolver + one EvidenceLedger filter; `nthRoleName` is **not** dormant (RefResolver disambiguation,
`RefResolver.ts:138,155`). Viewport-only visibility (line 502-503) is the root of the offscreen regime.

**graph/ContinuityGraph** — *mostly dormant (ES4).* Contributions that survive: latest-transition
appeared/weakened ID sets → +90/+70 score bonuses (`PlannerWorkingSetSelector.ts:210-247`); count summaries
(368 B). Dead: `ProjectionService`'s graph parameter; `ProjectionItem.graphPresent/graphConfidence/
recentlyAppeared/recentlyChanged/recentlyWeakened` (declared, never set); graph `regions` (always empty —
`regionCount=0` in 200/200); `firstSeen/lastSeen` observations; the 20-transition ring beyond the latest
entry; stable re-targeting as a planner-facing capability (used only for loop signatures and self-heal
eligibility). What a planner *could* do with graph state it cannot do today: know which controls are the
same across a re-render (stable re-target after churn), know which region of the page a change came from,
know how long an element has existed (firstSeen) to prefer stable UI over transient chips, and receive the
appeared list by name (S5). None of this requires new capture — the data is already in memory.

**brain1/ProjectionService + rankOperationalItems** — *healthy core, capped ambition.* Deterministic,
leak-free (no goal semantics — correct per `check_v2_no_cognition_leakage`), but its only products are a
sort order and two-region kinds (`repeated_list` only; `form`/`navigation`/`content` declared in
`projectionTypes.ts:12`, never produced). The "situation assessment" the mission describes is today a
scoring function; no post-action verification, no page-state identification, no diff summary lives here.
`brain1/serializeProjection.ts` is unused inside v2 (superseded by the working-set serializer) — dead code.

**brain2/ContinuityInterpreter** — *healthy, the best-value-per-line module in v2.* TargetId-first matching,
structural-diff notes, honest strength. Its output is the substrate's ground truth about "what just
happened"; only its counts and class reach the planner.

**planner/PlannerWorkingSetSelector** — *the real selection engine; load-bearing; under-explained.*
The reason-code taxonomy is good; the drop diagnostics are 30% complete (ES5); the serializer has the S1
defect; `readableEvidence` hard-tags every entry `answer_candidate` (`PlannerWorkingSetSelector.ts:484-488`)
— 8,842 entries over the run, sample kind mix 52% generic / 37% link / 9% button, i.e. navigation chrome is
systematically presented as answer evidence (the ArXiv noise from the prior doc, quantified).

**planner/prc (compiler + layout engine)** — *healthy and validated.* Lean render is byte-clean (1.1× refId,
no lane/tier/score leakage); the 12 KB cap binds 1 line in 200 calls; options/value/placeholder/anomalies/
failure/tools paths all work — when fed. The compact-data-plane path (`renderCompactDataPlane`) is
superseded by lean and survives as ~250 lines of dual-maintenance surface (its expansion bug is already
documented in `browser-control-token-efficiency.md` §7).

**planner/V2PlannerClient** — *healthy.* 2-attempt retry, readable-only→get rescue, empty-observation wait
rescue, truncated-URL detection; validation feedback includes compatible alternatives. Wire-side: the
response schema (~887 B) is still sent although the token-efficiency study measured zero parse failures
without it (§10.2 there) — banked candidate, flag-level.

**agent/V2AgentLoop** — *healthy guards, one dead function.* Loop-detector with semantic (targetId)
signatures, same-URL-navigation guard, page-boundary evidence reset, terminal continuation, advisory
steer-once, finalization + reconciliation. `extractSurfaceEvidence` (`V2AgentLoop.ts:1248-1275`) is **never
called** — dead code duplicating `EvidenceLedger.recordObservation`.

**runtime/** — *recovery healthy after the runs-11-13 fixes; verification thin.* `RecoveryStateBuilder`
covers 6 states with fingerprint-grouped blockers incl. the single-ref blindspot fix
(`RecoveryState.ts:216-240`); steering compliance measured good for oscillation (0/56 repeats) but weak for
targeted states (`wrong_target_type` 4/8, `zero_result_read_loop` 2/3 repeated the blocked tool within 2
steps). `DeadStateDetector` is coarse (empty/environment/high-uncertainty only — `DeadStateDetector.ts:62-80`).
`UncertaintySignals` healthy. `StabilizationService` minimal (domcontentloaded + 75 ms).

**trace/** — *LatencyLedger + ActionOutcomeRecorder are the self-knowledge layer — currently write-only*
(ES3/S6). `Brain1SurfaceOverlap.ts` is dead **and reaches outside src/v2**: it imports
`from '../../brain1/types'`, which from `src/v2/trace/` resolves to the **retired V1** `src/brain1/types`
(the only v2 file that does this). `trace/graph`+`transitions`+`failures`+`ref-resolution` sidecar dirs:
empty in all 30 tasks (the recorders exist; the harness never persists graph snapshots).

**agent/EvidenceLedger** — *the under-acknowledged star.* It is already a persistent cross-episode page
model for the listing-page class: entity cards with metric parse, sort provenance, origin-change
invalidation, relation-bound validation text. Its limits: visible-refs-only cards (below-fold rows
invisible to the memory — the GitHub S8 case), search/listing-URL gate (`isSearchOrListingPage`), 8-card cap.

---

## 5. Redundancy & noise audit (numbers)

| Signal | Measurement | Decision impact |
|---|---|---|
| Static system prompt | 10,579 B × 200 calls = 57% of mean wire; conditional mode implemented, flag off in run 15 (engagement measured: HORIZON 3/200, TASK PROGRESS guidance subject present 53/200, GOAL PROGRESS 69/200, EVIDENCE COVERAGE 30/200, EVIDENCE SNAPSHOT 25/200, recovery inactive on ~132/200 — prior doc §4 measured 1.5–2.5 KB/call strippable) | Banked: flip the flag; zero design work |
| `tools="…"` attribute | 827 B/episode (12.4% of surface); **98% of instances are one of two constant values** (`r` 54%, `c,r` 44% of 12,793 instances) | Redundant with `kind` for all but form controls; compressible to exceptions-only |
| `state=` anomaly attribute | 782 B/episode (11.7%); 3,457 offscreen + 542 hidden lines across the run | Mostly informative (offscreen rows are data per P1); keep |
| Anonymous lines | 2,042/14,762 (13.8%) nameless elements | Noise + selection bias (S7) |
| Goal-token coverage of surface | Only 33.3% of element lines contain ≥1 goal token; 66.7% is chrome/structure | Chrome-digest lane candidate (F9) |
| Cross-episode repetition | 23.4% of surface line-bytes repeat verbatim from the previous episode (same task) | Diff-first render candidate (F2) |
| RECENT EVENTS ∥ PROBLEMS duplication | weakened count twice in 78/200; failure twice in 22/200 | ~150 B/call in failure regimes; merge candidate |
| DECISION SIGNALS | 96 B × 193 episodes; pure suppressed-count, no instruction references it beyond "don't assume omitted refs are unavailable" | Keep (cheap) but pair with reason-coded drops (F10) |
| Undocumented `focus` line | ~40 B × 200, contract never explained in PlannerPrompt | Remove or document-and-meaningful |
| readableEvidence `answer_candidate` tagging | 8,842 entries, ~52% generic / 37% link in sample | Retag by kind; answer-candidate ≠ nav label |
| Response JSON schema | ~887 B/call; 0 parse failures measured without it on this model (prior doc §10.2) | Flag-level removal candidate |
| Dead code | `extractSurfaceEvidence` (never called), `brain1/serializeProjection` (unused in v2), `Brain1SurfaceOverlap` (unused + imports **retired V1** `src/brain1/types`), compact-data-plane render path (superseded) | Removal candidates (verdict table) |

What did **not** show up as noise: RECENT EVENTS, GOAL PROGRESS, HORIZON, TASK PROGRESS are small
(114–247 B), conditional, and engaged exactly where their subjects exist; steering via `recovery.nextMechanisms`
was respected in 56/56 oscillation episodes. The prior runs' "guidance fired and was ignored" pathology is
largely fixed; what remains is that guidance is often **silent** (S1–S7), not ignored.

---

## 6. Ranked foundational portfolio

Ranked by (expected effect on run-15 task classes × confidence) ÷ risk, restricted to mechanisms **below the
patch layer** — none re-propose P1–P8, none touch evaluators, all site-agnostic, all behind feature flags.

**F1. Make the working-set serializer lossless for action-relevant facts (fix the `selectOptions` chain).**
*Mechanism*: copy `selectOptions` (already capped ≤20) in `serializeSelectedProjection`; optionally strip the
mush-`text` of a select when options exist. *Touch*: `PlannerWorkingSetSelector.ts:727-745` (+1 line); the
render path needs nothing. *Core advantage exercised*: truthful substrate→planner contract. *Expected
effect*: `select` becomes executable exactly where the prompt promises it (ESPN-class combobox/select tasks);
zero cost when no select present. *Risk*: minimal; JSON-mode consumers get a new field (schema-tolerant).
*Validation*: balanced30 — Booking/Flights/ESPN select usage; must-not-regress: `select`-tool error count
does not rise on Coursera/Amazon; userBytes +≤300 B on select-bearing pages only.

**F2. Diff-first rendering: mark what changed since the last action.** *Mechanism*: the composer already has
`refChanges.appeared/changed` from the transition; annotate those refs' lean lines (e.g. a `+` marker or
`new` in the state list) and/or emit one `CHANGED SINCE LAST ACTION: [v2ref_1, …]` line. *Touch*:
`PlannerInputComposer` (pass sets into IR) → `PlannerRepresentationCompiler.normalizeElement` →
`PromptLayoutEngine.renderLeanElement`. *Core advantage exercised*: the ContinuityGraph/interpreter finally
speaks to the model (S5); kills self-diffing of 80 lines of which 23.4% are unchanged bytes. *Expected
effect*: combobox-suggestion flows (Guidance already assumes the model can see appeared options), post-click
verification, faster convergence; ~10–80 B/episode. *Risk*: low; markers must be deterministic and bounded
(≤16 refs, consistent with `maxChangedRefs`). *Validation*: Coursera/Flights type→suggestion tasks; must-not-
regress: no growth in repeated-action signatures on Booking (markers must not read as "act on these").

**F3. Explicit action-effect honesty on `lastResult` (pre-verification v0).** *Mechanism*: add
`effect: 'none' | 'local' | 'page'` to `PlannerLastResultSummary` from the already-computed
`observableEffect`/`stateChanged` (`V2AgentLoop.ts:468-476`), plus one system-prompt sentence: "`effect:
none` means the runtime measured no page change — do not repeat the same action; choose a different
mechanism." *Touch*: `V2AgentLoop` (outcome→lastResult), `PlannerInputComposer.summarizeLastResult`,
`PlannerPrompt.ts`. *Core advantage exercised*: substrate self-knowledge → planner (S6). *Expected effect*:
the 28%-repeat-after-silent-success rate converges toward the 6% baseline; on run 15 that is ~8 repeats
across 30 tasks (≈1 task-class of budget). *Risk*: low; purely additive field. *Validation*: must-not-regress
Google Maps/Apple (legitimate multi-click flows where effect arrives late — pair with the existing
low-information-refresh logic, `V2AgentLoop.ts:439-451`).

**F4. Deterministic post-action verification suite (pre-verification v1) — brain1's untapped power.**
Catalog (exists vs missing), all site-agnostic, all verifiable from data the substrate already holds or can
hold with one captured attribute:

| Check | Status today |
|---|---|
| Input value retained | **Exists** (`input_not_applied`, `InputService.ts:235-261`) |
| Click event observed + target connected | **Exists** (`InputService.ts:112-139`) |
| Occlusion pre-check (7-point hit test + blocker forensics) | **Exists** (`semanticHitTest.ts`, `InputService.ts:96-106`) |
| Native select read-back | **Exists** (`InputService.ts:286-298`) |
| Suggestion-open / commit detection | **Partial** (`repeated_type_same_value` recovery; `waitForSuggestionState` inside type) |
| Link href vs landed URL | **Missing** — anchor href is capturable today (`buildSelectorCandidates` already reads `href`) but never compared to the post-click URL |
| Combobox `aria-expanded` actually opened | **Missing** (open attempt exists, open *verification* doesn't) |
| Result-count / list-length delta after filter/sort/submit | **Missing** (counts are computable from consecutive observations the loop already holds) |
| URL query semantics after submit (search executed? dates in query?) | **Missing** (URL is compared only for sameness, not for requirement echo — GoalProgressTracker parses goals but never re-parses landed URLs) |
| Form submit reached a results surface (generation+URL+ref-count triad) | **Missing** as an explicit signal |

*Mechanism*: implement the missing checks in `InputService`/`TransitionService` as FailureClassifier signals
(`navigation_divergence`, `open_not_confirmed`, `no_result_delta`) feeding the existing recovery machinery.
*Expected effect*: directly attacks the 21 no-effect clicks + 26 no-state-change clicks + Booking/Flights 0/4
class (both engines) without a single extra LLM call. *Risk*: medium — signal false-positives must be
advisory-only initially. *Validation*: Booking__0/10, Flights__0/10 flip-or-improve; must-not-regress:
SPA routes where URL legitimately doesn't change (gate on anchor-href presence, not URL-shape heuristics).

**F5. Closed-loop plans: planner emits an expectation, the runtime grades it.** *Mechanism*: optional
`expect` field per plan step in `PlannerOutputSchema` (enum: `url_change`, `options_visible`,
`value_committed`, `results_loaded`); after dispatch, the runtime compares expectation vs transition evidence
and injects `expectation_mismatch` into the next input's PROBLEMS. This is the substrate-native answer to the
2025–2026 world-model literature (WebDreamer/WMA simulate outcomes with an LLM; here the *transition
classifier is the world model* and grading is free). *Touch*: `PlannerOutputSchema.ts`, dispatcher post-check,
`PlannerInputComposer`. *Expected effect*: converts open-loop multi-step plans (the ESPN/Booking tunneling
pattern) into self-verifying ones; near-zero token cost (one short field). *Risk*: medium (schema change;
models may omit the field — tolerate and degrade to today's behavior). *Validation*: ESPN__10, Booking__0/10;
must-not-regress: overall planner-call count on Wolfram/Allrecipes single-shot tasks.

**F6. Graph-driven stable re-targeting as a planner-visible heal hint.** *Mechanism*: when an action fails
with `stale_ref`/`element_detached`, map the failed ref through `targetId` (graph `resolveExistingNode` /
`RefResolver`'s ordinal machinery already re-identifies) and append to lastResult error: "same control now =
[v2ref_N]" when found. *Touch*: `RefService`/`FailureClassifier` diagnostics + one composer line. *Core
advantage exercised*: the identity churn machinery becomes user-visible for the first time (Q2's "is ref
identity used for stable re-targeting? — only internally"). *Expected effect*: fewer dead-ends on re-render-
heavy pages (Booking overlays, GitHub SPA nav). *Risk*: low. *Validation*: Booking/Flights; must-not-regress:
ambiguous re-matches must stay silent (require exact targetId match, no fuzzy).

**F7. Reason-coded drops (fix the 69.8% un-coded silence) + emit appeared-names.** *Mechanism*: (a) add
`rank_loss:score=<n>` as a drop reason in `buildDiagnostics` for candidates that passed low-value filters and
lost the race; (b) render `changedRefs.topRefs` names (≤8, 48-char gists) in one lean line. *Touch*:
`PlannerWorkingSetSelector` (diagnostics), `PromptLayoutEngine` (one line). *Expected effect*: forensics and
tuning become possible (this study required re-implementing the renderer to see what happened); F2+this make
"what's new" fully legible for ≤300 B. *Risk*: none (diagnostics) / low (one render line). *Validation*: pure
telemetry + one-line render; must-not-regress: userBytes p90.

**F8. Cross-episode page memory beyond listing pages.** *Mechanism*: generalize `EvidenceLedger`'s
origin-scoped memory to a bounded visited-page registry (origin+path+title+key entity names, ≤8 entries)
with a compact `PAGE MEMORY` section rendered only when the planner is on a page it has already left (the
BBC portal-tunneling regime). Complements P4 (prompt-layer site-search guidance) with memory-layer facts:
"you already visited /news/uk and /news/climate". *Touch*: `EvidenceLedger`, composer, `PromptLayoutEngine`.
*Expected effect*: BBC/ESPN-class over-exploration; measured waste in run 15: 12/13 (BBC), 7/12 (ESPN)
episodes contributed nothing. *Risk*: medium (memory staleness — clear on generation change, cap entries).
*Validation*: BBC__News__10, ESPN__10; must-not-regress: Google Flights (multi-page flows are legitimate).

**F9. Chrome digest lane for the surface.** *Mechanism*: two-lane lean render — full lines for
goal-relevant/actionable/region-representative refs; one digest line per repeated-role cluster elsewhere
("12 nav links: Home | About | …"). 66.7% of lines are chrome today; the regions machinery (repeated_list)
already clusters them. *Touch*: `PlannerRepresentationCompiler.buildSurface` + `PromptLayoutEngine`.
*Expected effect*: ~1.5–2.5 KB/call on heavy pages (≈25–30% of surface) without hiding availability (digest
keeps labels + refIds for the first K). *Risk*: medium-high (hiding an affordance breaks a task) — gate to
cluster members beyond the representative, never to form/option/goal-matching refs. *Validation*: Amazon__10,
ESPN (1,475-ref pages); must-not-regress: every strict pass; userBytes p50 −20% target, p90 guarded.

**F10. Deterministic widget primitives as substrate tools (seek-family generalization).** *Mechanism*: add
`pick_option(ref, pattern)` (commit a combobox/select choice: type→match option by normalized label
(enables after F1)→click/Enter, with the seek-style bounded loop + honest stop reasons) and
`submit_form(ref)` (click submit → verify results-triad: URL/generation/ref-count change). These are the
same design the `seek` macro proved (planner decides *what*, substrate owns *iterations* — `V2ToolDispatcher.ts:78-135`)
applied to the widget class where both engines scored 0/4 (Booking, Flights — `browser-control-vs-browsegent-lean-comparison.md` §4.2).
*Touch*: `V2ToolDispatcher`, `InputService`, `PlannerPrompt` tool table. *Expected effect*: the single
largest task-class unlock available at the foundation level; converts 3–4 wasted episodes per widget task
into 1–2 primitive calls. *Risk*: medium (new tools need guardrails: bounded retries, no silent success).
*Validation*: Booking__0/10, Flights__0/10; must-not-regress: Coursera/Amazon search flows (primitives must
not hijack planning when plain tools suffice).

**F11. Page-text coverage alarm (capture-honesty metric).** *Mechanism*: `readiness.bodyTextLength` is
already captured; compute `coveredText = Σ(ref.name+text lengths) / bodyTextLength` per observation; when
< threshold on an informational goal, emit uncertainty signal `prose_poor_surface` with one guidance
sentence ("visible controls carry little page text; use get/search_page for prose before answering").
Makes S2/S3 *measurable at runtime* instead of only in post-hoc forensics. *Touch*: `ObservationService`
(expose readiness on the observation), `UncertaintySignals`. *Risk*: low. *Validation*: ArXiv__10-type
prose tasks; must-not-regress: widget-heavy transactional pages (signal is informational only).

**F12. Self-measuring budget (episode telemetry → steering).** *Mechanism*: the loop knows
`plannerCalls` vs `maxSteps` and coverage states; at ≥75% budget with `evidenceCoverage.status !=
ready` and no fresh structural transition, emit `budget_pressure` uncertainty signal (P3 is the
prompt-layer twin; this is the signal-layer trigger that also feeds recovery `max_step_risk`, already
declared in `RecoveryState.ts:19` but never built). *Risk*: low. *Validation*: BBC__News__10 tail;
must-not-regress: slow_but_alive tasks (ArXiv/Huggingface multi-hop passes — gate on coverage-uncertainty,
not raw step count).

**F13. Conditional system prompt activation + schema removal (banked, flag-level).** Not re-designed here;
measured engagement in §5; flipping `conditionalSystemPrompt` + dropping `responseJsonSchema` (0 parse
failures without it, prior doc §10.2) is worth ~1.8–2.6 KB/call (≈35–50% of wire) with zero engaged-guidance
loss. Listed because it is the cheapest foundational lever that exists today, unmounted.

**F14. Dead-weight removal.** `Brain1SurfaceOverlap.ts` (unused **and** the only v2→V1 import — a boundary
violation in spirit that `check_v2_boundaries.ts` should catch: verify why it doesn't),
`brain1/serializeProjection.ts`, `extractSurfaceEvidence` (`V2AgentLoop.ts:1248`), compact-data-plane render
path (`renderCompactDataPlane` + `CompactShadow*` telemetry, superseded by lean after its expansion bug),
`ProjectionItem`'s never-populated graph fields. Each removal is evidence-backed in §4/§5.

**Deliberately not proposed**: relaxing the 12 KB surface cap (binds 1/200 calls), raising maxSteps
(rejected in prior doc §6), any per-site logic, evaluator changes, hard-gate additions (the advisory/hard
split and honest escalation are load-bearing and preserved throughout).

---

## 7. Subsystem verdict table

| Subsystem | Verdict | Evidence (condensed) |
|---|---|---|
| substrate/ObservationService | **Keep, extend** | Correct interactive-only walk, shadow DOM, rich facts; extend: href capture for F4, readiness exposure for F11, name-derivation for S7 (13.8% anonymous lines) |
| substrate/InputService + RefResolver + semanticHitTest | **Keep — flagship** | Deterministic verification already prevents whole failure classes (retention check, hit-test forensics, self-heal); F4/F10 extend the same pattern |
| graph/ContinuityGraph | **Simplify or wire up — currently 90% dormant** | Counts + latest-transition sets are its only consumed outputs; regions always empty; graph fields in ProjectionItem never set; sidecars never persisted (ES4). Either wire F2/F6/F7 or shrink it to the transition evidence it effectively is |
| brain1/ProjectionService + rankOperationalItems | **Keep, extend** | Deterministic, leak-free; extend into the F4 verification home; delete `serializeProjection.ts`; populate or delete the graph fields |
| brain2/ContinuityInterpreter | **Keep as-is** | Highest signal/line in v2; already the substrate's world model (F5 builds on it) |
| planner/PlannerWorkingSetSelector | **Keep, fix, instrument** | Load-bearing selection engine; fix S1 serializer defect; add `rank_loss` reason (F7); retag readables |
| planner/prc (lean) | **Keep — validated** | Byte-clean render (1.1× refId mention), cap healthy; add diff markers (F2), chrome digest (F9), changed-names line (F7) |
| planner/prc compact-data-plane | **Remove** | Superseded by lean; documented expansion bug; dual-maintenance cost |
| planner/PlannerPrompt | **Extend conditionally** | Activate conditional mode (F13); fix the unsatisfiable selectOptions instruction (S1); document or drop `focus:` |
| planner/V2PlannerClient | **Keep; consider schema removal** | Robust rescues; `responseJsonSchema` measurable-only benefit (F13) |
| planner/CompactShadow* + CompactPlannerClient/View | **Remove or quarantine to tests** | Shadow telemetry for a superseded mode; wrote 200 artifacts/run of comparison data post-decision |
| agent/V2AgentLoop | **Keep, extend** | Guards + advisory semantics work (steering compliance 0/56 oscillation repeats); remove `extractSurfaceEvidence`; add effect→lastResult (F3), expectation grading (F5) |
| agent/EvidenceLedger | **Keep, extend** | Already a listing-page page-model (cards/sort/origin invalidation); F8 generalizes; note visible-only card blindness (S8) |
| agent/AnswerContract + gates | **Keep** | Advisory/hard split verified working in runs 11–15; frozen source adds ranking advisory per prior fix |
| runtime/RecoveryState + FailureClassifier + UncertaintySignals | **Keep, extend** | 6 states fire correctly; steering respected for oscillation; F4 adds the missing verification signals; `max_step_risk` declared-but-unbuilt (F12) |
| runtime/DeadStateDetector | **Simplify into UncertaintySignals** | 86 lines that re-derive what uncertainty already knows; only `empty/environment/high-uncertainty` triggers |
| runtime/StabilizationService | **Keep** | Minimal and sufficient (75 ms quiet window; 8.1 s total across the run) |
| tools/V2ToolDispatcher (+seek) | **Keep, extend** | Seek macro proves the primitive pattern; F10 adds pick_option/submit_form |
| trace/TraceStore + LatencyLedger + ActionOutcomeRecorder | **Keep; feed back** | ActionOutcomes are write-only today (F3); persist graph snapshots or stop creating empty dirs |
| trace/Brain1SurfaceOverlap | **Remove** | Dead + imports retired V1 `src/brain1/types` across the v2 boundary |

---

## 8. Sources

**Code (frozen worktree `D:\BrowseGent-arch-research`, read-only)**: `src/v2/substrate/ObservationService.ts`
(walk, selectOptions:349-358, visibility:488-504, readiness:593-598); `src/v2/graph/ContinuityGraph.ts` +
`types.ts`; `src/v2/brain1/ProjectionService.ts` (unused `_graphSnapshot`:7), `rankOperationalItems.ts:40-57`,
`projectionTypes.ts:40-44`, `serializeProjection.ts`; `src/v2/brain2/ContinuityInterpreter.ts`,
`transitionClassifier.ts`; `src/v2/planner/PlannerInputComposer.ts`, `PlannerWorkingSetSelector.ts`
(serializer:727-745, evidence sets:203-248, classifyLowValue:412-427), `prc/PlannerRepresentationCompiler.ts`,
`prc/PromptLayoutEngine.ts` (lean element:406-422, cap:398, lean WS:489-496), `PlannerPrompt.ts` (selectOptions
instruction:83), `V2PlannerClient.ts`; `src/v2/agent/V2AgentLoop.ts` (guards:326-408, outcomes:468-476,
`extractSurfaceEvidence`:1248), `EvidenceLedger.ts`, `AnswerContract.ts`; `src/v2/runtime/RecoveryState.ts`,
`FailureClassifier.ts`, `UncertaintySignals.ts`, `DeadStateDetector.ts`, `StabilizationService.ts`;
`src/v2/tools/V2ToolDispatcher.ts` (seek:78-135); `src/v2/substrate/InputService.ts` (retention:235-261,
hit-test:96-106); `src/v2/harness/BrowseGentV2Harness.ts` (get:190-195, searchPage:208-244);
`src/v2/trace/Brain1SurfaceOverlap.ts` (V1 import:1); `scripts/check_v2_boundaries.ts`.

**Run artifacts (READ-ONLY)**: `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1788594583363\` —
`webvoyager_artifacts.json` (per-task outcomes), `webvoyager_evaluation.md` (63.3% internal / 26.7% strict),
`summary.md` (wire totals), per-trace `planner/episode_*-{input,output}.json` (200), `observations/` (209
files, 203.3 MB), `action_outcomes.json`, `compact-planner/`; competitor run 6
`webvoyager_lite_1788360177393\traces\external\browser-control\`.

**Prior research (build-on)**: `progress-docs/browser-control-vs-browsegent-lean-comparison.md`;
`progress-docs/research/browser-control-token-efficiency.md` (BPE ratio 3.375 B/tok §4.1; schema §10.2);
`progress-docs/research/navigation-grounding-divergence.md` (P1–P8, per-task divergence timelines);
`progress-docs/research/step-exhaustion-forensics.md`; `progress-docs/research/strict-regression-forensics.md`.

**External (2025–2026)**: [Building Browser Agents: Architecture, Security, and Practical Considerations (arXiv 2511.19477)](https://arxiv.org/html/2511.19477v1); [AgentOccam (OpenReview)](https://openreview.net/forum?id=oWdzUpOlkX); [Prune4Web: DOM Tree Pruning Programming for Web Agents (AAAI 2025)](https://ojs.aaai.org/index.php/AAAI/article/view/40772/44733); [LiteWebAgent (NAACL 2025 Demo)](https://aclanthology.org/2025.naacl-demo.36.pdf); [World-Model-Augmented Web Agents with Action Correction (arXiv 2602.15384)](https://arxiv.org/html/2602.15384v1); [Web Agents with World Models (WMA, OpenReview)](https://openreview.net/forum?id=moWiYJuSGF); [WebDreamer: Model-Based Planning for Web Agents (OSU NLP)](https://github.com/osu-nlp-group/webdreamer); [Is Your LLM Secretly a World Model of the Internet? (arXiv 2411.06559)](https://arxiv.org/html/2411.06559v1); [Agent-E — change observer / DOM diff (arXiv 2407.13032)](https://arxiv.org/html/2407.13032v1); [Signal-Driven Observation for Long-Horizon Web Agents (arXiv 2606.06708)](https://arxiv.org/html/2606.06708v1); [Agentic Compilation: Mitigating the LLM Rerun Crisis (arXiv 2604.09718)](https://arxiv.org/html/2604.09718v2); [The Accessibility Tree Explained (isagentready.com)](https://isagentready.com/en/blog/how-ai-agents-see-your-website-the-accessibility-tree-explained); [Build agent-friendly websites (web.dev)](https://web.dev/articles/ai-agent-site-ux); [Serialising Web UI State for LLMs (Webfuse)](https://www.webfuse.com/blog/serialising-web-ui-state-for-llms-the-complete-guide).

*Analysis scripts and intermediate episode/task/outcome caches were kept outside the worktree
(`%TEMP%\browsegent-arch\`); the worktree received only this document.*
