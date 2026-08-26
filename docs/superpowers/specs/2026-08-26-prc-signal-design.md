# PRC Signal-Preserving Design — V2-Native Compact Representation

**Date:** 2026-08-26
**Status:** Proposal — battle-tested, zero-compromise
**Scope:** PRC secondary long-jump only. Primary levers (cognitive data plane `src/v2/agent/TaskEvidenceCoverage.ts:22`, outcomes `src/v2/trace/ActionOutcomeRecord.ts:30`, latency `src/v2/trace/LatencyLedger.ts:21` with `provider_pacing_wait` `src/v2/agent/V2AgentLoop.ts:108`, conditional re-observation `src/v2/agent/V2AgentLoop.ts:298`, safe multi-action `src/v2/agent/V2AgentLoop.ts:1118`) already shipped. Substrate `ObservationService.ts:41` single-evaluate and `StabilizationService.ts:13` MutationObserver are deferred to separate substrate spec. This doc does not add isolated prompt patches and does not merge Brain1/Brain2.

**Goal:** SOTA-range (easy→complex) by substantially reducing signal-to-noise, not killing problem. `browser-control` `D:\agent-tools\browser-control` achieves 17,986 in/task 40% strict via 12k `@e1 link "Label"` 14 bytes/elem `src/js.rs:5` + 6-step history `browser_control_runner.py:210` and relies on model priors. v2 PRC v1.1.2 is 54,401 in/task 33.3% strict `tests/benchmark/v2/report` with `PromptLayoutEngine.ts:98` `~140 bytes/elem × 80` `PlannerWorkingSetSelector.ts:24` 32+48 → 4.5KB surface + 2.2KB `STATE+RECENT+WORKING_SET+DECISION` `PromptLayoutEngine.ts:4`. The gap is 3.06× after 50.6% saving `README.md:60`. The failure is `Wrong-Evidence 23.3%` `report:72` — ranking noise, not byte noise.

---

## 1. Architecture — One Unified Approach

Pillars P1+P2+P3 ship together in one commit with `src/v2/planner/prc/PromptLayoutEngine.ts`, `src/v2/planner/PlannerWorkingSetSelector.ts`, `src/v2/planner/prc/PlannerRepresentationCompiler.ts`, `src/v2/planner/PlannerPrompt.ts`, `src/v2/planner/types.ts` co-updated. P4/P5 (lenient dispatch, innerText fallback) are rejected for PRC and tracked as substrate backlog.

### P1 — Lossless Surface Economy (browser-control brevity, v2 identity kept)

*Drop* `PromptLayoutEngine.ts:103` `lane="interaction|readable|navigation"` (derivable from `tools` `PlannerRepresentationCompiler.ts:60` `c|t|s|r|a`), `tier` string `PromptLayoutEngine.ts:104` (monotonic with `score` thresholds `PlannerRepresentationCompiler.ts:164` 110/90/70 — keep `score`), per-element `region="..."` (hoist to group header `PromptLayoutEngine.ts:88` `# Search Form (region_form_1, omitted 12 of 40)`), `text` when `text===name` `PlannerRepresentationCompiler.ts:143`. Keep ` [v2ref_N] kind "name" [c|t|s|r] s=115` compact. Retain `v2ref_N` stable ID (not `eN` churn), `kind`, `name`, `tools`, `score`. Per-element `140→~52 bytes`, surface `4.5→1.5KB` `ProjectionSizeDiagnostics.ts:12` `currentBytes`.

*Why zero-compromise:* `ir.surface.surfaceRefCount` `PlannerRepresentationCompiler.ts:104` unchanged, `tools` coverage `evaluateCompactPlannerCoverage` `src/v2/planner/CompactPlannerView.ts:186` `actionRefCoverage=1.0` before/after, `prcTraceReplay.test.ts` invariant. `V2PlannerOutputSchema` `src/v2/planner/PlannerOutputSchema.ts` still validates `tools` exact.

### P2 — Signal-Rank Correction Lane-Scoped `+60`

Current `PlannerWorkingSetSelector.ts:168` `visible_ready +100`, `recently_appeared +90`, `goal_keyword +score*10 capped 60` `PlannerWorkingSetSelector.ts:175`, `goal_phrase +30` `PlannerWorkingSetSelector.ts:180`, `role_relevant +40` `PlannerWorkingSetSelector.ts:183`. Offscreen phrase `60 lex+30=90` loses to visible generic `100` — `Google__Map__10` and `Booking` gridcells dropped via `classifyLowValue` `PlannerWorkingSetSelector.ts:217` `generic_low_value`.

*Change:* `goal_phrase_match` `+30→+60` **readableEvidence lane only** `PlannerWorkingSetSelector.ts:374` `readableEvidence`, cap `visible_ready` not needed outside lane. Exempt `role radio|checkbox|option|gridcell` with non-empty `name|text|aria-label` from `generic_low_value`. Offscreen phrase readable `60+60=120 >100` now top 5, visible phrase `100+60+60=220`. Recently appeared actionable in clickable lane keeps `+90` primacy — lexical never equals temporal `report:19 10.07 steps/task` recency proof.

*Why +60 not +90:* `+90` equals `recently_appeared +90` and would let offscreen footer stale phrase tie just-appeared calendar `Booking__0` `refChanges.appeared` `PlannerWorkingSetSelector.ts:133` — lexical preempts evidence, adds one `provider` call `LatencyLedger.ts:4`. `+60` still substantially reduces problem `120>100` but preserves `recently_appeared` for complex. Configurable via `PlannerWorkingSetOptions` `src/v2/planner/workingSetTypes.ts:36` as `phraseBonus` default `60` for A/B replay without code change, not dynamic per call.

### P3 — Compact Data Plane `8 blocks→4 lines`

`PromptLayoutEngine.ts:4` `render` `MISSION+STATE+RECENT+EVIDENCE+PROBLEMS+SURFACE+WORKING_SET+DECISION` `2.2KB` → `S:` `LAST:` `EVIDENCE:` `W:` `0.35KB` `diagnostics.ts:271` `plannerInputSections`. Keep every field `PlannerInputComposer.ts:51` `continuity/transition/lastResult/failures/recovery/evidenceCoverage/uncertainty/lineage` as `S: gen1 obs_obs_1_2 | last:click v2ref_12->blocked | Δ:+2 ~1 url→true | ev:ranking uncertain rd=1 | rec:blocked click:v2ref_12 Try:get` and `W: p=v2ref_1(gk) s=v2ref_2(fc) t=[v2ref_1] c=[v2ref_12]` with deduped maximal reasons `goal_phrase implies keyword` `GoalRelevance.ts:36`. `PROBLEMS` omitted when `failures` empty `PromptLayoutEngine.ts:50 .filter(Boolean)` already. `PlannerPrompt.ts:5 buildV2PlannerSystemPrompt` co-updated to describe `S:/W:` syntax in same commit — otherwise `PLANNER_INVALID_OUTPUT` retry `V2PlannerClient.ts:99` doubles `provider_pacing_wait`.

*Why zero-compromise:* No `continuity`/`transition`/`evidenceCoverage` field removed — the V2-native data plane for complex tasks stays. Only duplicate `refId` listings `report.ts:95 maxProjectionMultiSection` removed.

**Combined byte:** per-call `~8KB→~4.2KB`, per-task `54k→32-35k` `-40%` `ProjectionSizeDiagnostics.ts:12` while `diagnostics.ts:59 projectionOverlap` and `workingSet selected 32` unchanged.

### Deferred P4/P5 — Substrate Notes

*P4* remove `assertActionCompatible` `src/v2/substrate/InputService.ts:206` and fallback `CdpBridge Input.dispatchMouseEvent` `browser-control/src/actions.rs:24` swaps `target_blocked persistent` `FailureClassifier.ts:191` for `microstate none` `brain2/transitionClassifier.ts`, hiding `quarantinedActions` `PlannerWorkingSetSelector.ts:285` and costing 3 `provider` calls via `ActionProgressMemory` `src/v2/agent/V2AgentLoop.ts:944`. Keep hard gate, surface `ambiguousRefs` `PlannerWorkingSetSelector.ts:411` for planner `scroll/get` choice. True fix is single-evaluate observation + `MutationObserver+networkIdle` stabilization, separate spec.

*P5* `browser_control_runner.py:295 innerText` fallback lifts `Wrong-Evidence 23→40%` `report:72` by extracting `Related question` `report:109`. Keep `V2AgentLoop.ts:401 attemptFinalization` with `validateAnswerAgainstContract` `V2AgentLoop.ts:175` + `missingCoverageReasons` `V2AgentLoop.ts:857` + bounded `get` on `focus` `ProjectionService.ts:44`, no LLM extract.

---

## 2. Components & Data Flow

```
ObservationService.COLLECT → RefService.assign (hard 1.0 / soft 0.55) →
ProjectionService.project → PlannerWorkingSetSelector.select (P2 lane-scoped +60, gridcell exempt) →
PlannerInputComposer.compose (P3 S:/W: compact) →
PlannerRepresentationCompiler.compile (P1 hoist region, keep s=) →
PromptLayoutEngine.render (P1 52B/elem, P3 4 lines) →
V2PlannerClient.call (prompt co-updated, validation guidance intact) →
V2AgentLoop dispatch → Harness (unchanged hard gate)
```

Interfaces unchanged: `PlannerInput v2.planner_input.v2` `src/v2/planner/types.ts:31`, `TraceStore` artifacts, `LatencyLedger` phases.

---

## 3. Expected Behavior & Quantification

| Dimension | Before | After P1+P2+P3 | Defense |
| :--- | :---: | :---: | :--- |
| Surface/call | 4.5KB | 1.5KB -65% | `s` kept, `tools` kept |
| Metadata/call | 2.2KB | 0.35KB -84% | `rec:BLOCKED` line kept |
| Input/task | 54k | 32-35k -40% | `current+workingSet` dominates |
| Offscreen phrase rank | dropped | Top 5 `120>100` | readable-only |
| Gridcells/radios | dropped | preserved non-empty | `isVisible` guard `RefResolver.ts:272` |
| Non-crash | 60% | 60% (no P4) | hard gate preserved |
| Strict | 33.3% | ≥38-40% | Wrong-Evidence down, no hallucination |

---

## 4. Error Handling & Recovery

*Invalid tool on `[c]` only:* `V2PlannerClient.ts:273 buildActionCompatibilityGuidance` still emits `Typeable refs available: v2ref_1` single-turn correction. `actionRefCoverage 1.0` invariant prevents `missingPlannedActionRefs` `CompactPlannerView.ts:186`.

*Footer phrase false positive:* `GoalRelevance.ts:91` requires 2+ contiguous tokens, so `Privacy Policy for Flights` vs `Find cheapest flights` no phrase boost, `+60` not applied. Recently appeared `+90` still wins.

*Prompt contract break:* `buildV2PlannerSystemPrompt` and `PromptLayoutEngine` ship in same commit, `tests/unit/v2/prc/promptLayoutEngine.test.ts:45` updated to assert `S:`/`W:` lines. `governanceChecks.test.ts` boundary still passes.

---

## 5. Testing — No Compromise Gates

1. **Unit invariants** `npm run test:unit:v2` — `compactPlannerView.test.ts:34`, `plannerWorkingSetSelector.test.ts:72`, `prc/plannerRepresentationCompiler.test.ts:96` `score` kept, `promptLayoutEngine.test.ts:134` `BLOCKED` line.
2. **Trace replay** `TraceReplayAuditor.ts` — before/after `surfaceRefCount` equal, `actionRefCoverage=1.0`.
3. **Byte gate** `ProjectionSizeDiagnostics` `measureCompactPlannerView` `CompactPlannerView.ts:168` `reductionRatio 0.60-0.65`, `diagnostics.ts:53` `maxPlannerInputBytes` down, `maxProjectionMultiSection` not up.
4. **30-task gate** `benchmark:v2` `mvr5-stable 5` then `balanced30 0ms pacing` `report.ts:143` `p50Ms` unchanged, `providerAttempts` not up, `strict ≥33.3%` holds, `partial` not via P5, `failureTypes` `target_blocked` not converted to `microstate` by P4 absence.
5. **A/B lane check** replay `phraseBonus 60 vs 90` on stored traces `compact_telemetry_summary.ts` — if `+60` relegates `Booking` calendar, promote to `+70` discussion, no code until data.

---

## 6. Rollout

1. A/B P2 weight on trace replay, lock `60`.
2. Commit P1+P2+P3 + prompt co-update + `PlannerWorkingSetOptions.phraseBonus` config.
3. `benchmark:v2` 5-task then 30-task, hold `strict`.
4. Separate substrate spec for `ObservationService` single-evaluate and `StabilizationService` networkIdle.

---

## 7. Open Items — None Blocking PRC Spec

*P4/P5* remain substrate backlog. No PRC open question after `+60 readable-only` lock.
