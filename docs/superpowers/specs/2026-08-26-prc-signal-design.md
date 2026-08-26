# PRC Signal-Preserving Design — V2-Native Compact Representation

**Date:** 2026-08-26
**Status:** Proposal v2 — revised per battle-test verdict, zero-compromise
**Scope:** PRC secondary long-jump only. Primary levers (cognitive data plane `src/v2/agent/TaskEvidenceCoverage.ts:22`, outcomes `src/v2/trace/ActionOutcomeRecord.ts:30`, latency `src/v2/trace/LatencyLedger.ts:21` with `provider_pacing_wait` `src/v2/agent/V2AgentLoop.ts:108`, conditional re-observation `src/v2/agent/V2AgentLoop.ts:298`, safe multi-action `src/v2/agent/V2AgentLoop.ts:1118`) already shipped. Substrate `ObservationService.ts:41` single-evaluate and `StabilizationService.ts:13` MutationObserver are deferred to separate substrate spec. No isolated prompt patches, no Brain1/Brain2 merge.

**Goal:** SOTA-range by reducing signal-to-noise. `browser-control` `D:\agent-tools\browser-control` 17,986 in/task via 12k `@e1` `src/js.rs:5`. v2 PRC v1.1.2 54,401 in/task `tests/benchmark/v2/report` with `PromptLayoutEngine.ts:98` `~140B/elem × 80`. Gap 3.06×. Verified `Wrong-Evidence 23.3%`.

---

## 0. Battle-Test Verdict Response

*   **45/45 current tests validate current renderer only** — new preservation tests required per pillar.
*   **Synthetic gridcell omitted:** `readableEvidence` is `projection.readables.filter(selectedSet).slice(0, maxReadableEvidence)` `PlannerWorkingSetSelector.ts:256` — candidate score bonus `readable-only +60` never reached because `candidates = projection.interactions` `PlannerWorkingSetSelector.ts:59` plus `classifyLowValue` `PlannerWorkingSetSelector.ts:217` dropped `generic` offscreen before scoring.
*   **`PromptLayoutEngine.ts:128` already omits large action-surface list** — `renderDecisionSignals` only `suppressed`, so P1 savings overstated. **P1 now tier-only, lane retained** (`lane` not derivable from `tools` `PlannerRepresentationCompiler.ts:60`).
*   **Outcome gates removed** — preservation-only.
*   **Flags behind independent commits** with preservation tests.

---

## 1. Architecture — Three Flag-Gated Pillars

Independent flags/commits. No pillar depends on another.

*   `prcTierOmitted` `PlannerSerializationConfig` `src/v2/planner/types.ts:222` default `false` → P1.
*   `readablePhraseBonus` `PlannerWorkingSetOptions` `src/v2/planner/workingSetTypes.ts:36` default `30` → `60` + P2 pipeline fix.
*   `compactDataPlane` `PlannerSerializationConfig` default `false` → P3 with `PlannerPrompt.ts:5` co-update.

P4/P5 rejected, substrate backlog.

**Flag wiring (previously inert, now explicit):**
*   `V2PlannerClient.ts:86` `buildV2PlannerSystemPrompt(this.plannerSerialization)` — pass `prcTierOmitted` + `compactDataPlane`.
*   `PlannerPrompt.ts:61` `buildV2PlannerUserMessage(input, config)` — when `config.mode==='prc'` pass `prcTierOmitted` and `compactDataPlane` to `new PromptLayoutEngine().render(ir, opts)`.
*   `PlannerInputComposer.ts:22` add `workingSetOptions?: PlannerWorkingSetOptions` to `PlannerInputComposerInput`, construct `new PlannerWorkingSetSelector(input.workingSetOptions ?? this.workingSetOptions ?? {})` — no default selector that ignores options. `V2AgentLoop.ts:83` compose call passes `workingSetOptions` from `V2AgentLoopOptions` `src/v2/agent/types.ts`.
*   Runtime enable: `V2AgentLoopOptions.plannerSerialization` and `workingSetOptions` `src/v2/agent/types.ts` → `BrowseGentV2Harness` non-hardcoded; replay tests pass `plannerSerialization:{mode:'prc', prcTierOmitted:true, compactDataPlane:true}` and `workingSetOptions:{readablePhraseBonus:60}` explicitly. No hardcoded `true` in renderer.

### P1 — Tier Only (lane and remainder region preserved)

Per-element `PromptLayoutEngine.ts:98` ` [v2ref_12] <button name="Search term" lane="interaction" tier="top" region="region_repeated_1" text="Search term" tools="c" />` `~140B`. `renderDecisionSignals` already omits action-surface list `PromptLayoutEngine.ts:128`.

*Change behind `prcTierOmitted` — scope explicitly `tier` only:*
*   Drop `tier="top|high|mid|low"` `PromptLayoutEngine.ts:104` only. **Retain `lane`** `PromptLayoutEngine.ts:103` — `mixed` vs `readable` not derivable from `tools`. **Retain `region` for `remainder` elements** `PromptLayoutEngine.ts:91` where group header does not cover them; for grouped elements region stays in header `PromptLayoutEngine.ts:88` only. Keep `v2ref_N`, `kind`, `name`, `tools c/t/s/r/a`, `score s=`. Suppress `text` only when `text===name` `PlannerRepresentationCompiler.ts:143`.
*   Result ` [v2ref_12] <button name="Search term" lane="interaction" tools="c" s=115 />` `~85B` `1.8×` `ProjectionSizeDiagnostics.ts:12`.

*Preservation:* `surfaceRefCount` equal, `tools c/t/s/r/a` per ref equal, `lane` per ref equal, `region` for `remainder` equal, `selectOptions` equal, `actionRefCoverage=1.0 readRefCoverage=1.0` `src/v2/planner/CompactPlannerView.ts:186`.

### P2 — Selector-Pipeline Fix + Lane-Scoped `+60`

Root cause: `candidates = projection.interactions.map(scoreCandidate)` `PlannerWorkingSetSelector.ts:59`, `readableEvidence` filtered by `selectedSet` `PlannerWorkingSetSelector.ts:256`, `buildReadableEvidence` capped in **projection order** `projection.readables.slice(0, maxReadableEvidence)` not candidate-score order, so `top 5` guarantee false even if score boosted. Plus `classifyLowValue` `PlannerWorkingSetSelector.ts:217` `offscreen_low_value`/`generic_low_value` dropped `generic` `gridcell` before `goal_phrase` bonus.

*Change behind `readablePhraseBonus=60`:*
1.  Exempt `role radio|checkbox|option|gridcell` with non-empty `name|text|aria-label` from `generic_low_value` and `offscreen_low_value` `PlannerWorkingSetSelector.ts:217` — never low-value.
2.  Lane-scoped bonus in `scoreCandidate` `PlannerWorkingSetSelector.ts:168`: if `readableSet.has(item.refId)` `projection.readables` then `goal_phrase_match + (readablePhraseBonus ?? 30)` else `+30`. `60` not `90` to avoid equalling `recently_appeared +90`.
3.  Fix capping order: `buildReadableEvidence` must sort `projection.readables.filter(selectedSet)` by **candidate score order** `compareCandidates` `PlannerWorkingSetSelector.ts:209` (or by `selectedRefIds` score order) before `slice(0, maxReadableEvidence)`, not projection order. Also ensure exempt `gridcell` offscreen with `hasText` bypasses `shouldKeepCandidate` `PlannerWorkingSetSelector.ts:205` via `classifyLowValue` returning `undefined`.

Offscreen phrase readable `60 lex+60 phrase=120 > visible generic 100` now top 5 by score, enters `selectedSet` then `readableEvidence` top 5 by score. Recently appeared actionable in clickable lane keeps `+90`.

*Why +60:* `+90` ties temporal `Booking__0` `refChanges.appeared` `PlannerWorkingSetSelector.ts:133`; `+60` preserves recency.

*Preservation:* synthetic offscreen `gridcell gridcell "Dec 25"` goal `Book Dec 25` must be in `readableEvidence` and `selectedRefIds`; empty `gridcell` still dropped; hidden still dropped.

### P3 — Compact Data Plane Behind Flag With Full Preservation

`PromptLayoutEngine.ts:4` `MISSION+STATE+RECENT+EVIDENCE+PROBLEMS+SURFACE+WORKING_SET+DECISION` keeps every field `PlannerInputComposer.ts:51` but behind `compactDataPlane` renders `S:` `LAST:` `EVIDENCE:` `W:` one-liners. `PlannerPrompt.ts:5` co-updated same commit.

*Preservation — rendered output must preserve:*
*   `supportingReadIndexes` `TaskEvidenceCoverage.ts:51` per requirement,
*   `c/t/s/r/a` per ref `actionSurface` `PlannerWorkingSetSelector.ts:374`,
*   `failures` `PlannerInputComposer.ts:54` list,
*   `quarantine` `PlannerWorkingSetSelector.ts:286`,
*   `changedRefs` `PlannerWorkingSetSelector.ts:430` counts + `topRefs`,
*   `answerFeedback` `PlannerInputComposer.ts:57` `missingDetails`,
*   `deadState` `PlannerInputComposer.ts:55` `reasons/failureKinds`,
*   `lineage` `PlannerInputComposer.ts:60` `totalSteps`.

Checking `ir.execution` bit-equal is insufficient — must assert **rendered string** `PromptLayoutEngine.render` with flag true contains each of above substrings/values, and legacy string with flag false still contains `STATE` etc.

Byte gate `maxPlannerInputBytes` down with `maxWorkingSetObservedRefs` unchanged `diagnostics.ts:53`.

### Deferred P4/P5

Keep hard gate `InputService.ts:206`, `V2AgentLoop.ts:401` validated finalization.

---

## 2. Components & Data Flow

```
ObservationService.COLLECT → RefService.assign →
ProjectionService.project → PlannerWorkingSetSelector.select (P2 flag via workingSetOptions, readablePhraseBonus lane-scoped, gridcell exempt, score-sorted readableEvidence) →
PlannerInputComposer.compose (pass workingSetOptions, pass plannerSerialization flags) →
PlannerRepresentationCompiler.compile →
PromptLayoutEngine.render (P1 tier flag, P3 compact flag, lane & remainder region preserved) →
V2PlannerClient.call (pass plannerSerialization to buildV2PlannerSystemPrompt + buildV2PlannerUserMessage → PromptLayoutEngine) →
V2AgentLoop dispatch (V2AgentLoopOptions.plannerSerialization/workingSetOptions non-hardcoded)
```

Flags in `PlannerSerializationConfig` and `PlannerWorkingSetOptions`.

---

## 3. Expected Behavior & Quantification (Preservation Gates)

| Dimension | Before | After P1+P2+P3 | Preservation Gate |
| :--- | :---: | :---: | :--- |
| Surface/elem | ~140B | ~85B tier only, lane & remainder region kept | `lane` & `region remainder` equal |
| Metadata/call | 2.2KB | ~0.6KB `S:/W:` | rendered `supportingReadIndexes, c/t/s/r/a, failures, quarantine, changedRefs, answerFeedback, deadState, lineage` present |
| Input/task | 54k | ~38-42k | `maxPlannerInputBytes` down |
| Offscreen phrase `gridcell` | omitted | in `readableEvidence` top 5 score-sorted | synthetic gridcell test |
| Capabilities `c/t/s/r/a` | present | present | per-ref `actionSurface` bit-equal |
| Recovery `blockedAction` | present | present compact `rec:` | rendered `rec:` contains |
| Answer-contract `supportingReadIndexes` | present | present rendered | rendered contains |

No `strict` or Booking gate.

---

## 4. Error Handling & Recovery

*Invalid tool on `[c]` only:* `V2PlannerClient.ts:273` single-turn correction. *Footer phrase:* `GoalRelevance.ts:91` 2+ tokens required. *Prompt break:* prompt+renderer same commit.

---

## 5. Testing — Independent Flags/Commits

*   **P1 commit `prcTierOmitted`:** unit `promptLayoutEngine.test.ts` lane retained, tier absent when `prcTierOmitted:true` (must pass `true` explicitly, fail test otherwise invalid), `s=` kept, `region` for `remainder` kept, `surfaceRefCount` equal, `actionRefCoverage=1.0`. Flag enabled via `render(ir, {prcTierOmitted:true})` non-hardcoded.
*   **P2 commit `readablePhraseBonus`:** synthetic offscreen `gridcell` `readableEvidence` inclusion score-sorted top 5, empty still dropped, hidden still dropped, `plannerWorkingSetSelector` with `new PlannerWorkingSetSelector({readablePhraseBonus:60})` non-hardcoded, trace `readableEvidence` contains phrase ref.
*   **P3 commit `compactDataPlane`:** unit `promptLayoutEngine.test.ts` compact `S:`/`W:`/`EVIDENCE:` contains `supportingReadIndexes, c/t/s/r/a, failures, quarantine, changedRefs, answerFeedback, deadState, lineage`, legacy `STATE` with flag false, `buildV2PlannerSystemPrompt({compactDataPlane:true})` describes `S:/W:`. Runtime enable via `V2AgentLoopOptions.plannerSerialization:{mode:'prc', prcTierOmitted:true, compactDataPlane:true}` + `workingSetOptions:{readablePhraseBonus:60}` non-hardcoded.

`npm run test:unit:v2` 45/45 must stay when flags false.

---

## 6. Rollout

1. P1 flag commit with tier-only preservation tests.
2. P2 flag commit with pipeline fix + synthetic gridcell top-5 score-sorted test.
3. P3 flag commit with full rendered preservation + prompt co-update.
4. Substrate separate.

---

## 7. Open Items — None Blocking PRC Spec

*P4/P5* backlog. Dynamic control deferred — fixed behind flag.

