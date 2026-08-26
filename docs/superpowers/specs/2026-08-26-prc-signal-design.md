# PRC Signal-Preserving Design — V2-Native Compact Representation

**Date:** 2026-08-26
**Status:** Proposal v2 — revised per battle-test verdict, zero-compromise
**Scope:** PRC secondary long-jump only. Primary levers (cognitive data plane `src/v2/agent/TaskEvidenceCoverage.ts:22`, outcomes `src/v2/trace/ActionOutcomeRecord.ts:30`, latency `src/v2/trace/LatencyLedger.ts:21` with `provider_pacing_wait` `src/v2/agent/V2AgentLoop.ts:108`, conditional re-observation `src/v2/agent/V2AgentLoop.ts:298`, safe multi-action `src/v2/agent/V2AgentLoop.ts:1118`) already shipped. Substrate `ObservationService.ts:41` single-evaluate and `StabilizationService.ts:13` MutationObserver are deferred to separate substrate spec. This doc does not add isolated prompt patches and does not merge Brain1/Brain2.

**Goal:** SOTA-range (easy→complex) by substantially reducing signal-to-noise. `browser-control` `D:\agent-tools\browser-control` achieves 17,986 in/task 40% strict via 12k `@e1 link "Label"` 14 bytes/elem `src/js.rs:5` + 6-step history `browser_control_runner.py:210` and relies on model priors. v2 PRC v1.1.2 is 54,401 in/task 33.3% strict `tests/benchmark/v2/report` with `PromptLayoutEngine.ts:98` `~140 bytes/elem × 80` `PlannerWorkingSetSelector.ts:24` 32+48. The gap is 3.06× after 50.6% saving `README.md:60`. Verified failure is `Wrong-Evidence 23.3%` `report:72` — ranking noise.

---

## 0. Battle-Test Verdict Response (2026-08-26)

*   **45/45 current PRC/replay tests pass on current renderer, not proposed P1/P2/P3.** Spec now requires preservation tests per pillar before any byte claim.
*   **Synthetic ranking test:** offscreen goal-matching `gridcell` readable ref was omitted; `readableEvidence` contained only generic visible button. Therefore readable-only `+60` through current `candidates = projection.interactions` `PlannerWorkingSetSelector.ts:59` pipeline cannot work — `readableEvidence` is `projection.readables.filter(selectedSet)` `PlannerWorkingSetSelector.ts:256`. Fix is selector-pipeline change in P2, not just bonus.
*   **Current `PromptLayoutEngine.ts:128` already omits large action-surface list** `renderDecisionSignals` only emits `suppressed` count, `promptLayoutEngine.test.ts:45` `doesNotMatch action surface: click=` — so P1 savings from dropping that list are overstated. Corrected P1 keeps `lane` initially; dropping `tier` is safer. `lane` is not derivable from `tools` `PlannerRepresentationCompiler.ts:60`.
*   **Benchmark outcome gates removed.** No `strict ≥38–40%` or Booking-specific ranking gates. Gates are preservation-only: refs, capabilities, readable evidence, recovery, options, answer-contract fields.
*   **Independent flags/commits** required for P1/P2/P3 with per-pillar preservation tests.

---

## 1. Architecture — Three Flag-Gated Pillars

P1/P2/P3 ship behind independent flags and independent commits. No pillar depends on another for correctness. `src/v2/planner/prc/PromptLayoutEngine.ts`, `src/v2/planner/PlannerWorkingSetSelector.ts`, `src/v2/planner/prc/PlannerRepresentationCompiler.ts`, `src/v2/planner/PlannerPrompt.ts`, `src/v2/planner/types.ts` are the only touched files plus `src/v2/planner/workingSetTypes.ts` for P2 flag.

*   Flag `prcTierOmitted` `PlannerSerializationConfig` `src/v2/planner/types.ts:222` default `false` → `true` enables P1.
*   Flag `readablePhraseBonus` `PlannerWorkingSetOptions` `src/v2/planner/workingSetTypes.ts:36` default `30` → `60` plus `classifyLowValue` gridcell exempt enables P2.
*   Flag `compactDataPlane` `PlannerSerializationConfig` default `false` → `true` enables P3. Prompt co-update `PlannerPrompt.ts:5` ships in same commit as P3.

P4/P5 (lenient dispatch `src/v2/substrate/InputService.ts:206`, innerText fallback `browser_control_runner.py:295`) remain rejected for PRC and tracked as substrate backlog.

### P1 — Lossless Surface Economy (tier only, lane retained)

Current per-element `PromptLayoutEngine.ts:98 renderElement` ` [v2ref_12] <button name="Search term" lane="interaction" tier="top" region="region_repeated_1" text="Search term" tools="c" />` `~140 bytes`. `renderDecisionSignals` `PromptLayoutEngine.ts:128` already omits large action-surface list, so remaining saving is `tier` string `tier="top|high|mid|low"` `PromptLayoutEngine.ts:104` (monotonic with `score` thresholds `PlannerRepresentationCompiler.ts:164` 110/90/70 — keep `score` as `s=115`), per-element `region="..."` hoisted to group header `PromptLayoutEngine.ts:88` `# Search Form (region_form_1, omitted 12 of 40)` already partially but still emitted per element, and `text` when `text===name` `PlannerRepresentationCompiler.ts:143`. **Retain `lane`** — `lane` `interaction|readable|navigation|mixed` `src/v2/planner/prc/types.ts:14` is not derivable from `tools` `c|t|s|r|a` `PlannerRepresentationCompiler.ts:60` because `mixed` and `readable` with `tools=r` vs `lane=readable` vs `interaction` differ in `ProjectionService.ts`.

*Change behind `prcTierOmitted`:* drop `tier="..."`, keep `lane="..."`, keep `v2ref_N`, `kind`, `name`, `tools`, `score s=`, hoist `region` already header-only, suppress `text` when `text===name`. Result ` [v2ref_12] <button name="Search term" lane="interaction" tools="c" s=115 />` `~85 bytes` `1.8× not 2.7×` — `ProjectionSizeDiagnostics.ts:12` `currentBytes` down modestly. No large action-surface saving to claim.

*Preservation test:* `ir.surface.surfaceRefCount` `PlannerRepresentationCompiler.ts:104` equal, `tools` coverage `evaluateCompactPlannerCoverage` `src/v2/planner/CompactPlannerView.ts:186` `actionRefCoverage=1.0 readRefCoverage=1.0`, `prcTraceReplay.test.ts` invariant, `V2PlannerOutputSchema` `src/v2/planner/PlannerOutputSchema.ts` still validates.

### P2 — Selector-Pipeline Fix + Lane-Scoped `+60`

Root cause: `candidates = projection.interactions.map(scoreCandidate)` `PlannerWorkingSetSelector.ts:59` scores only `interactions`. `readableEvidence` `PlannerWorkingSetSelector.ts:256` is `projection.readables.filter(selectedSet)` — a readable `gridcell` offscreen that is `generic` `classifyLowValue` `PlannerWorkingSetSelector.ts:217` `offscreen_low_value` or `generic_low_value` is dropped before scoring, so `readable-only +60` never applies. Synthetic test proved this: generic visible button survived, offscreen `gridcell` did not.

*Change behind `readablePhraseBonus=60` and `classifyLowValue` exempt:*
1.  Exempt `role radio|checkbox|option|gridcell` with non-empty `name|text|aria-label` from `generic_low_value` and `offscreen_low_value` `PlannerWorkingSetSelector.ts:217` — they are never low-value per `isVisible` `RefResolver.ts:272` non-empty guard.
2.  Make phrase bonus lane-scoped in `scoreCandidate` `PlannerWorkingSetSelector.ts:168`: when `item` is `readable` (has `hasReadableText` `ProjectionService.ts:50`) then `goal_phrase_match +60` else `+30`. Implemented by checking `projection.readables` membership or passing `lane` hint — `60` not `90` to avoid equalling `recently_appeared +90` `PlannerWorkingSetSelector.ts:188` which is temporal evidence `report:19`.
3.  Ensure exempt `gridcell` offscreen with `hasText` bypasses `shouldKeepCandidate` `PlannerWorkingSetSelector.ts:205` drop even when `reasons.size==0` if it has `goal_keyword_match` or `goal_phrase_match` — or add minimal `reasons` `goal_keyword_match` via `scoreGoalRelevance` `GoalRelevance.ts:43` before drop check. Alternative that satisfies split-commit: keep `shouldKeepCandidate` unchanged but guarantee `classifyLowValue` returns `undefined` for exempt roles, so `reasons` from `visible_ready` not required.

Offscreen phrase readable `60 lex+60 phrase=120 > visible generic 100` now top 5 within `interactions` sorted `compareCandidates` `PlannerWorkingSetSelector.ts:209`, so it enters `selectedSet` and therefore `readableEvidence`. Recently appeared actionable in clickable lane keeps `+90` primacy.

*Why +60 not +90:* `+90` equals `recently_appeared +90` — lexical would tie temporal `Booking__0` calendar `refChanges.appeared` `PlannerWorkingSetSelector.ts:133`. `+60` still substantially reduces problem `120>100` but preserves recency for complex. No dynamic per-mode; fixed behind flag for A/B replay `compact_telemetry_summary.ts` without code change.

*Preservation test:* synthetic `projection` with offscreen `gridcell gridcell "Dec 25"` goal `Book Dec 25` must have `readableEvidence` containing that `gridcell` and `selectedRefIds` containing it; `hasText` empty `gridcell` still dropped; `isVisible` hidden still dropped.

### P3 — Compact Data Plane `8 blocks→4 lines` Behind Flag

`PromptLayoutEngine.ts:4` `render` `MISSION+STATE+RECENT+EVIDENCE+PROBLEMS+SURFACE+WORKING_SET+DECISION` `diagnostics.ts:271` keeps every field `PlannerInputComposer.ts:51` `continuity/transition/lastResult/failures/recovery/evidenceCoverage/uncertainty/lineage` but behind `compactDataPlane` renders `S:` `LAST:` `EVIDENCE:` `W:` one-liners `S: gen1 obs_obs_1_2 | last:click v2ref_12->blocked | Δ:+2 ~1 url→true | ev:ranking uncertain rd=1 | rec:blocked click:v2ref_12 Try:get` and `W: p=v2ref_1(gk) s=v2ref_2(fc) t=[v2ref_1] c=[v2ref_12]` deduped maximal reasons. `PROBLEMS` omitted when `failures` empty via `PromptLayoutEngine.ts:50 .filter(Boolean)` already. `PlannerPrompt.ts:5 buildV2PlannerSystemPrompt` co-updated in same commit to describe `S:/W:` — otherwise `PLANNER_INVALID_OUTPUT` `V2PlannerClient.ts:99` doubles `provider_pacing_wait` `LatencyLedger.ts:4`. No benchmark outcome gate; byte gate is `maxPlannerInputBytes` down with `diagnostics.ts:59` `maxWorkingSetObservedRefs` unchanged.

*Preservation test:* before/after `ir.execution` fields `evidenceCoverage` `TaskEvidenceCoverage.ts:40`, `recovery` `RecoveryState.ts`, `continuity` `PlannerInputComposer.ts:51` bit-equal; `buildV2PlannerSystemPrompt` describes new lines.

### Deferred P4/P5 — Substrate Backlog

*P4* `assertActionCompatible` `src/v2/substrate/InputService.ts:206` → keep hard gate, surface `ambiguousRefs` `PlannerWorkingSetSelector.ts:411`. *P5* `V2AgentLoop.ts:401 attemptFinalization` keep `validateAnswerAgainstContract` `V2AgentLoop.ts:175` + `missingCoverageReasons` `V2AgentLoop.ts:857` + bounded `get` on `focus` `ProjectionService.ts:44`, no LLM `innerText` extract.

---

## 2. Components & Data Flow

```
ObservationService.COLLECT → RefService.assign →
ProjectionService.project → PlannerWorkingSetSelector.select (P2 flag: lane-scoped +60, gridcell exempt, pipeline fix) →
PlannerInputComposer.compose (P3 flag: S:/W: compact) →
PlannerRepresentationCompiler.compile (P1 flag: hoist region, keep lane, drop tier keep s=) →
PromptLayoutEngine.render (P1 85B/elem, P3 4 lines) →
V2PlannerClient.call (P3 prompt co-updated) →
V2AgentLoop dispatch → Harness (unchanged hard gate)
```

Interfaces: `PlannerInput v2.planner_input.v2` `src/v2/planner/types.ts:31`, `TraceStore`, `LatencyLedger` phases unchanged. Flags in `PlannerSerializationConfig` `src/v2/planner/types.ts:222` and `PlannerWorkingSetOptions` `src/v2/planner/workingSetTypes.ts:36`.

---

## 3. Expected Behavior & Quantification (Preservation Gates, Not Outcomes)

| Dimension | Before | After P1+P2+P3 | Preservation Gate |
| :--- | :---: | :---: | :--- |
| Surface/elem | ~140B | ~85B tier drop, lane kept | `surfaceRefCount` equal |
| Metadata/call | 2.2KB | ~0.6KB compact `S:/W:` | `evidenceCoverage` fields equal |
| Input/task | 54k | ~38-42k modest | `maxPlannerInputBytes` down |
| Offscreen phrase `gridcell` | omitted | in `readableEvidence` top 5 | synthetic gridcell test |
| Capabilities `clickable/typeable/selectable/readable/ambiguous` | present | present | `actionSurface` bit-equal per ref |
| Recovery `blockedAction + nextMechanisms` | present | present compact `rec:` | `recovery.state` equal |
| Answer-contract `evidenceCoverage` `supportingReadIndexes` | present | present | `evidenceCoverage` equal |

No `strict ≥X%` or Booking-specific gate.

---

## 4. Error Handling & Recovery

*Invalid tool on `[c]` only:* `V2PlannerClient.ts:273` still emits `Typeable refs available: v2ref_1` single-turn correction. *Footer phrase:* `GoalRelevance.ts:91` 2+ contiguous tokens required — `Privacy Policy for Flights` vs `Find cheapest flights` no boost. *Prompt break:* prompt and renderer ship same commit, `tests/unit/v2/prc/promptLayoutEngine.test.ts:45` updated to assert `S:`/`W:`.

---

## 5. Testing — Independent Flags/Commits

Each pillar is a commit with flag default `false` and preservation tests enabled when flag `true`:

*   **P1 commit `prcTierOmitted`:** unit `compactPlannerView.test.ts:34`, `prc/plannerRepresentationCompiler.test.ts:96` `score` kept, `lane` retained assert, `promptLayoutEngine.test.ts:45` still `lane` present, trace `surfaceRefCount` equal, `actionRefCoverage=1.0`.
*   **P2 commit `readablePhraseBonus`:** unit synthetic offscreen `gridcell` `readableEvidence` inclusion, `generic` empty `gridcell` still dropped, `hidden` still dropped, `plannerWorkingSetSelector.test.ts:72` phrase promotion still `readable` lane only, `classifyLowValue` exempt test, trace `readableEvidence` contains phrase ref.
*   **P3 commit `compactDataPlane`:** unit `promptLayoutEngine.test.ts:134` `BLOCKED` line compact `S:`, `buildV2PlannerSystemPrompt` describes `S:/W:`, trace `ir.execution.evidenceCoverage` `recovery` `continuity` `options` `answer-contract` bit-equal, `ProjectionSizeDiagnostics` `measureCompactPlannerView` `reductionRatio` modest, `diagnostics.ts:53` `maxPlannerInputBytes` down with `maxWorkingSetObservedRefs` unchanged.

Run `npm run test:unit:v2` 45/45 must stay 45/45 on new renderer + `npm run check:v2` boundaries. No outcome gate.

---

## 6. Rollout

1. P1 commit behind `prcTierOmitted` flag false→true with preservation tests.
2. P2 commit behind `readablePhraseBonus` flag with synthetic gridcell test + trace replay A/B `60 vs 30` via `compact_telemetry_summary.ts`.
3. P3 commit behind `compactDataPlane` flag with prompt co-update.
4. Separate substrate spec for `ObservationService` single-evaluate and `StabilizationService` networkIdle.

---

## 7. Open Items — None Blocking PRC Spec

*P4/P5* substrate backlog. No PRC open question after `+60 readable-only, lane retained` lock. Dynamic control deferred — fixed behind flag.
