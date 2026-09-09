# PRC Signal-Preserving Design — V2-Native Compact Representation

**Date:** 2026-08-26
**Status:** Proposal v2 — revised per battle-test verdict, zero-compromise
**Scope:** PRC secondary long-jump only. Primary levers (cognitive data plane `src/v2/agent/TaskEvidenceCoverage.ts:22`, outcomes `src/v2/trace/ActionOutcomeRecord.ts:30`, latency `src/v2/trace/LatencyLedger.ts:21` with `provider_pacing_wait` `src/v2/agent/V2AgentLoop.ts:108`, conditional re-observation `src/v2/agent/V2AgentLoop.ts:298`, safe multi-action `src/v2/agent/V2AgentLoop.ts:1118`) already shipped. Substrate `ObservationService.ts:41` single-evaluate and `StabilizationService.ts:13` MutationObserver are deferred to separate substrate spec. No isolated prompt patches, no Brain1/Brain2 merge.

**Goal:** Improve signal-to-noise without sacrificing planner evidence. Competitor figures and wrong-evidence rates are comparison signals only, not acceptance gates; they must not drive benchmark-specific behavior or a fixed byte target.

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
*   `V2PlannerClient.ts:85` `buildV2PlannerSystemPrompt(this.plannerSerialization)` — pass `prcTierOmitted` + `compactDataPlane`.
*   `PlannerPrompt.ts:61` `buildV2PlannerUserMessage(input, config)` — when `config.mode==='prc'` pass `prcTierOmitted` and `compactDataPlane` to `new PromptLayoutEngine().render(ir, opts)`.
*   `PlannerInputComposer.ts:27` add `workingSetOptions?: PlannerWorkingSetOptions` to `PlannerInputComposerInput`, and select with those per-call options without mutating shared selector state.
*   Runtime enable: `plannerSerialization` already enters through `V2AgentLoopInput` and is forwarded by `BrowserAgentRunOptions`/`BrowserAgentRunner`. Add `workingSetOptions` to those same per-run input types and forward it through every `PlannerInputComposer.compose` call in `V2AgentLoop.ts`, including reconciliation/finalization. Do not add these controls to `V2AgentLoopOptions`; that type contains construction dependencies, not per-run planner configuration. No hardcoded `true` in renderer.

### P1 — Tier Only (lane and remainder region preserved)

Per-element `PromptLayoutEngine.ts:98` ` [v2ref_12] <button name="Search term" lane="interaction" tier="top" region="region_repeated_1" text="Search term" tools="c" />` `~140B`. `renderDecisionSignals` already omits action-surface list `PromptLayoutEngine.ts:128`.

*Change behind `prcTierOmitted` — scope explicitly `tier` only:*
*   Drop `tier="top|high|mid|low"` `PromptLayoutEngine.ts:104` only. **Retain `lane`** `PromptLayoutEngine.ts:103` — `mixed` vs `readable` is not derivable from `tools`. **Retain `region` for `remainder` elements** `PromptLayoutEngine.ts:91` where group header does not cover them; grouped elements may rely on the group header. Keep `v2ref_N`, `kind`, `name`, and `tools c/t/s/r/a`. In the flagged representation only, emit the existing numeric score as compact `s=` so removing tier does not remove ranking information. Suppress `text` only when `text===name` `PlannerRepresentationCompiler.ts:143`.
*   The result shape is illustrative only; measure actual bytes after implementation. With the flag omitted or false, rendering must remain byte-equivalent to the current renderer.

*Preservation:* `surfaceRefCount` equal, `tools c/t/s/r/a` per ref equal, `lane` per ref equal, `region` for `remainder` equal, `selectOptions` equal, `actionRefCoverage=1.0 readRefCoverage=1.0` `src/v2/planner/CompactPlannerView.ts:186`.

### P2 — Selector-Pipeline Fix + Lane-Scoped `+60`

Root cause: `readableEvidence` is filtered by `selectedSet` `PlannerWorkingSetSelector.ts:256`, while `classifyLowValue` `PlannerWorkingSetSelector.ts:217` drops generic offscreen semantic content before it can contribute to selection. `ProjectionService` currently includes all observed refs in `projection.interactions`, so do not expand the candidate pool. `buildReadableEvidence` also caps in **projection order** rather than candidate-score order, so a score boost cannot reliably affect the evidence cap.

*Change behind `readablePhraseBonus=60`:*
1.  Normalize `item.role` with `trim().toLowerCase()` and exempt only named `radio|checkbox|option|gridcell` items from `generic_low_value` and `offscreen_low_value` `PlannerWorkingSetSelector.ts:217`. The current projection item has no separate `aria-label` field; use the normalized `name|text` values. Empty generic items remain droppable, and existing hidden-empty behavior remains unchanged.
2.  Lane-scoped bonus in `scoreCandidate` `PlannerWorkingSetSelector.ts:168`: membership in `projection.readables` is the readable lane for this purpose; it does not claim the ref is read-only. When `readablePhraseBonus` is explicitly `60`, a goal phrase match in that lane receives `+60`, while non-readable candidates retain the existing `+30`. With the option omitted, preserve current scoring.
3.  Fix capping order: in the flagged path, `buildReadableEvidence` must sort `projection.readables.filter(selectedSet)` by the candidate score map/order before `slice(0, maxReadableEvidence)`, not projection order. Ensure an exempt offscreen named `gridcell` survives candidate filtering and enters `selectedSet`; do not expand the candidate pool or uncap the overall working set.

An offscreen phrase-matching readable can now compete by its explicit score and enter the bounded evidence set; recently appeared actionable refs retain their existing recency priority. Do not encode a fixed synthetic score relationship as a production requirement.

*Why +60:* it is an explicit, caller-controlled boost that improves goal-relevant readable evidence without making it equal to the existing recency bonus. The value is a selector experiment, not a benchmark-derived contract.

*Preservation:* synthetic offscreen named `gridcell` goal evidence must be in `readableEvidence` and `selectedRefIds`; empty generic content remains dropped and hidden-empty content remains dropped.

### P3 — Compact Data Plane Behind Flag With Full Preservation

`PromptLayoutEngine.ts:4` keeps the same semantic blocks but, behind `compactDataPlane`, renders compact `S:`/`LAST:`/`EVIDENCE:`/`W:` lines. `PlannerPrompt.ts:5` is co-updated in the same commit so the model receives the compact syntax contract. Before rendering, extend `WorkingSetIR` in `src/v2/planner/prc/types.ts` and copy the fields in `PlannerRepresentationCompiler.ts`; otherwise the renderer cannot preserve data that the current compiler drops.

*Preservation — rendered output must preserve:*
*   `supportingReadIndexes` `TaskEvidenceCoverage.ts:51` per requirement,
*   `c/t/s/r/a` per ref `actionSurface` `PlannerWorkingSetSelector.ts:374`,
*   `failures` `PlannerInputComposer.ts:54` list,
*   `quarantine` `PlannerWorkingSetSelector.ts:286`,
*   `changedRefs` `PlannerWorkingSetSelector.ts:430` counts + `topRefs`,
*   `answerFeedback` `PlannerInputComposer.ts:57` bounded `previousAnswer`/`instruction` plus `missingDetails`,
*   `deadState` `PlannerInputComposer.ts:55` `reasons/failureKinds`,
*   `lineage` `PlannerInputComposer.ts:60` `totalSteps`, `truncated`, and a bounded last-step summary when available.

Checking `ir.execution` bit-equal is insufficient. Assert the **rendered string** with flag true contains unique sentinel values for every listed field, including each action-surface lane and the bounded answer/lineage values. The legacy string with flag false must still contain the existing `STATE`/`WORKING SET` shape and must not silently lose fields.

The compact output must be shorter than the equivalent legacy PRC output for the preservation fixture, while retaining the required fields. Do not require a fixed percentage or absolute byte count. Keep `maxWorkingSetObservedRefs` unchanged `diagnostics.ts:53`.

### Deferred P4/P5

Keep hard gate `InputService.ts:206`, `V2AgentLoop.ts:401` validated finalization.

---

## 2. Components & Data Flow

```
ObservationService.COLLECT → RefService.assign →
ProjectionService.project → PlannerWorkingSetSelector.select (P2 opt-in via per-run workingSetOptions, readablePhraseBonus lane-scoped, named semantic gridcell handling, score-sorted readableEvidence) →
PlannerInputComposer.compose (pass per-run workingSetOptions) →
PlannerRepresentationCompiler.compile →
PromptLayoutEngine.render (P1 tier flag, P3 compact flag, lane & remainder region preserved) →
V2PlannerClient.call (pass plannerSerialization to buildV2PlannerSystemPrompt + buildV2PlannerUserMessage → PromptLayoutEngine) →
V2AgentLoop dispatch (V2AgentLoopInput.plannerSerialization/workingSetOptions non-hardcoded; public BrowserAgentRunOptions forwards both)
```

Flags in `PlannerSerializationConfig` and `PlannerWorkingSetOptions`.

---

## 3. Expected Behavior & Quantification (Preservation Gates)

| Dimension | Before | After P1+P2+P3 | Preservation Gate |
| :--- | :---: | :---: | :--- |
| Surface/elem | Current renderer | Flagged renderer may omit tier and compact duplicate text | `lane` & `region remainder` equal; legacy output unchanged when flags are false |
| Metadata/call | Current PRC output | Compact `S:/W:` data plane | rendered `supportingReadIndexes, c/t/s/r/a, failures, quarantine, changedRefs, answerFeedback, deadState, lineage` present |
| Input/task | Measured baseline | Must be measured after implementation | equivalent compact PRC prompt is smaller without reducing bounded evidence |
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

*   **P1 commit `prcTierOmitted`:** unit `promptLayoutEngine.test.ts` asserts exact default-vs-explicit-false byte-equivalence; with `prcTierOmitted:true`, tier is absent, flagged-only `s=` is present, lane/remainder region/tools/options/ref IDs are retained, and the rendered ref count is unchanged. Flag enabled via `render(ir, {prcTierOmitted:true})` non-hardcoded.
*   **P2 commit `readablePhraseBonus`:** synthetic offscreen named `gridcell` readable evidence is selected within the configured cap in score order; empty generic content remains dropped; role matching is normalized; and the explicit `new PlannerWorkingSetSelector({readablePhraseBonus:60})` path is tested. Also test the per-call composer option without changing default behavior.
*   **P3 commit `compactDataPlane`:** compiler/IR tests prove the four added working-set fields are copied; renderer tests use unique sentinel values and exact assertions for `supportingReadIndexes`, per-ref `c/t/s/r/a`, failures, quarantine, changed refs, answer feedback, dead state, and lineage. Legacy output remains unchanged with flags false, and `buildV2PlannerSystemPrompt({compactDataPlane:true})` documents `S:/W:`. The byte gate compares actual `buildV2PlannerUserMessage(..., {mode:'prc', compactDataPlane:false})` against the same call with `compactDataPlane:true`; it must be smaller without dropping sentinels. Runtime enable is through `BrowserAgentRunOptions` → `V2AgentLoopInput`, not `V2AgentLoopOptions`.

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
