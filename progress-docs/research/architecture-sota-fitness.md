# Architecture Fitness-for-SOTA Audit: Adversarial Structural Assessment of BrowseGent v2

**Scope**: second-round foundational audit of `src/v2/**` (84 files, 17,929 lines of TS), judged as
architecture, not as dormant leverage. Source read READ-ONLY in the isolated worktree
`D:\BrowseGent-arch-sota` = commit `3c91567` (`feat/openrouter-stealth-benchmark` tip), which contains
local `main` (`7d24344`) **plus** the whole v2 line plus the round-1 implementation
(`5da2396` = F1/F3/F7a/F14/W-B re-attribution) and the run-16 validation (`d053e22`). Note on the task
brief's "implemented on main": local branch `main` does **not** contain the v2 history or the round-1
fixes (its tip's serializer has no `selectOptions`; `merge-base(main, feat-tip) = main`); the fixes live on
the branch checked out at `D:\BrowseGent` — this audit treats that line as current main, which is the only
self-consistent reading.

**Run evidence** (READ-ONLY from `D:\BrowseGent\logs\webvoyager-lite\`): run 15
(`webvoyager_lite_1788594583363`, 200 planner calls) and run 16 (`webvoyager_lite_1788612821955`,
222 calls/228 attempts), plus run-6 competitor traces and the prior research corpus.

**A critical dating fact discovered by artifact mining**: run 16 predates `5da2396`. Its 222 episodes
contain **zero** `selectOptions` fields in `current.refs`, **zero** `lastResult.effect` fields, and
**zero** `rank_loss` drop reasons — i.e. **F1/F3/F7a are implemented in source but have never been
validated on any run**. Every run-16 number below therefore measures the architecture *without* the
round-1 contract fixes; the next balanced30 run is the first that carries them.

---

## 1. Verdict up front

**Conditional yes — the foundation is SOTA-capable, but it is not yet SOTA-shaped.** (≤10 lines)

1. The substrate's deterministic layers (input verification, ref identity + transition classification,
   honest escalation, advisory/hard contracts) are at or beyond anything in the 2025–2026 browser-agent
   literature, and the wire economics (15,356 B/call, ~4,549 tok) now undercut both measured baselines.
2. Four structural ceilings hold it below the ~75–85% line: interactive-only viewport-bounded capture
   (no prose, no iframes), an 80-ref top-K working set binding in 90% of episodes against p90 3,592
   observed refs, a stateless re-send tax (~21–28% of every surface re-read verbatim), and a single
   model pass with no verification or look-ahead beyond one episode.
3. One subsystem cluster is wrong-built rather than under-built: ~1,100 lines of superseded
   compact/shadow render machinery still execute and write 6.6 MB/run of telemetry, and four overlapping
   signal vocabularies (FailureClassifier, UncertaintySignals, DeadStateDetector, RecoveryStateBuilder)
   diffuse what should be one enforcement point.
4. Compliance-sensitive steering still lives in a 7.4 KB prompt tuned to one model's obedience profile;
   measured weaker-model failures (Flights navigate loop, GitHub sort refusal) are exactly the cases
   where it was ignored.
5. Environment noise (6 captcha escalations in run 16, 5 of them locked in both runs) is the single
   largest block of the remaining measured gap — larger than any agent-side category.

---

## 2. Method and measurement basis

- **Source**: full reads of `V2AgentLoop.ts` (1,877 L), `PlannerWorkingSetSelector.ts` (962),
  `BrowseGentV2Harness.ts` (865), `EvidenceLedger.ts` (684), `V2PlannerClient.ts` (653),
  `ObservationService.ts` (611), `InputService.ts` (524), `PromptLayoutEngine.ts` (586),
  `PlannerInputComposer.ts` (454), `RecoveryState.ts` (505), plus the transition/graph/uncertainty/
  failure/ledger/contract/dispatcher/seek modules; targeted greps for dead code and wiring.
- **Artifacts**: a Python miner over run 16's 30 traces (222 episode inputs, 228 output payloads,
  197 action-outcome records, 30 latency ledgers, 238 observation files) and both runs'
  `webvoyager_evaluation.{md,json}`. All figures below are from that miner or from source lines cited
  inline; run-15 figures are from round 1 (`core-architecture-leverage.md`) and the four named research
  docs.
- **Correction to round 1**: round 1 reported `observation_capture` as 3.7% of wall time; that divides by
  pacing-inflated totals (run 16: `provider_pacing_wait` = 1,221,057 ms of 2,166,550 ms ledger time, the
  benchmark's artificial 10 s/request interval). Against **non-pacing** time — the only architecturally
  meaningful denominator — observation capture is **9.1% (run 15) → 11.8% (run 16)** of intrinsic time:
  the substrate's second-largest hop after the provider itself.

**Run-16 measured economics (222 episodes, 30 tasks)**: wire system 7,371.5 B mean (p50 7,514, p90
8,637), user 7,984.4 B (p50 7,791, p90 11,797, max 21,622), total 15,355.9 B/call; 228 attempts / 222
calls; planner-input pre-render JSON 84,308 B mean (max 148,037) = **10.6× the wire user payload**;
`current.refs` JSON alone 17,056 B mean = 2.1× the entire rendered user message; observation artifacts
284.3 MB/run (238 files, max 6.25 MB); whole-trace 324.4 MB ≈ 10.8 MB/task; intrinsic 31.5 s/task
(provider 64.1%, observation_capture 11.8%, browser_interaction 7.3%, stabilization 1.0%, local_compute
0.7%).

---

## 3. SOTA-grade inventory (dimension 1)

These are the parts that are already at or beyond the strongest known designs. "Receipts" = source +
measured trace evidence.

**3.1 Deterministic input verification (`substrate/InputService.ts`, `semanticHitTest.ts`).**
Every mutation is pre-verified and post-verified without a single LLM call: 7-probe-point semantic hit
test with blocker forensics (tag/id/class, fixed-or-sticky, transparent, native-dialog, full-viewport
coverage — `InputService.ts:38-81`), click-event capture + `isConnected` post-check
(`InputService.ts:112-139`), input-retention truthfulness check (`input_not_applied`,
`InputService.ts:235-261`), native-select read-back (`InputService.ts:286-298`), and a combobox protocol
ladder (open-verification, keyboard priming, pointer-blocked fallbacks, `waitForSuggestionState`
polling). This is the layer browser-control measurably lacks — the token-efficiency study (§5 there)
shows browser-control's blind CDP clicks producing "ok" on covered elements and exhausting 12 steps on
53.3% of tasks, versus v2 completing in 1–4 steps on the same tasks. Nothing in the cited 2025–2026
literature (AgentOccam, Prune4Web, LiteWebAgent, WMA/WebDreamer) implements per-action deterministic
verification at this depth; it is the project's clearest SOTA-grade asset.

**3.2 The transition classifier as world model (`brain2/transitionClassifier.ts` — 33 lines,
`ContinuityInterpreter.ts`).** Four classes (hard_reset / structural_macrostate / structural_local /
microstate) with strength, computed by targetId-first ref matching (`ContinuityInterpreter.ts:105-116`)
rather than positional diffing. This is the substrate-native answer to LLM world-model proposals
(WebDreamer, WMA — arXiv 2411.06559, 2602.15384): outcome prediction is *measured*, not simulated, at
zero token cost, and it feeds every downstream consumer (loop guards, recovery states, selection
bonuses, F3's effect verdict). The mini-plan continuation heuristics (`V2AgentLoop.ts:1666-1737`) and
the terminal-continuation grant (`V2AgentLoop.ts:1638-1664`) are both pure consumers of this signal.

**3.3 Advisory/hard answer contracts (`agent/AnswerContract.ts:332-346`).**
`partitionAnswerContractReasons` is the load-bearing design: shape failures (empty, url-only, numeric
goal without number) hard-reject with a repeated-rejection dead-man switch at 3
(`V2AgentLoop.ts:262-294`); completeness heuristics (item counts, detail categories, ranking evidence,
list-page-only answers) steer exactly once and then preserve the delivered answer with a recorded
caveat (`V2AgentLoop.ts:296-316`). Finalization never lets an advisory destroy the last-chance answer
(`V2AgentLoop.ts:898-908`). Run-16 receipts: 7 judge wins include Booking__0 and Coursera__0 — task
classes that in run 15 died in rejection loops. This partition is genuinely novel in the public
literature and must never be regressed (it is integrity-load-bearing).

**3.4 Honest escalation semantics (`AnswerContract.ts:406-424`, `V2AgentLoop.ts:319-327`).**
`escalate: user_needed|captcha|dead_end` is honored terminally, unavailability reports are accepted as
terminal answers when the runtime evidence corroborates them, and the same-URL navigation guard,
dead-state machinery, and budget-aware synthesis (`budget_low`) all push toward *truthful* termination
over hallucinated completion. The 6 run-16 captcha escalations are this design working: they fail the
run in-denominator rather than fabricating an answer.

**3.5 Locale-tolerant horizon machinery (`planner/HorizonDetector.ts`, `DateLabelMatcher.ts`,
`agent/SeekPolicy.ts`).** Verified by probe in `date-widget-interaction.md` §2: `parseCalendarLabel("25
दिसंबर 2026")` → `{month:12, day:25, year:2026}` from `lang: hi`. The `seek` macro
(`V2ToolDispatcher.ts:87-135`) plus implicit seek continuation
(`V2AgentLoop.extendManualHorizonClickWithSeek:696-741`) implement the "planner decides WHAT, substrate
owns ITERATIONS" pattern with honest stop reasons (`seek_stalled`, `seek_iteration_cap`,
`widget_unavailable`) — the correct substrate/primitive split, and the single best template for the
widget-primitive direction below.

**3.6 Identity machinery (`runtime/RefService.ts`, `RefSelfHealingPolicy.ts`,
`runtime/RefResolutionAudit.ts`).** targetId (FNV of selector|name|text|index) + backendNodeId +
soft/hard fingerprints, continuity confidence, self-heal eligibility, and a per-failure resolution audit
trail (56 audit files in run 16). Its flaws are quantified in §4/§6, but no competing open design does
stable re-identification across re-renders at this granularity.

**3.7 Wire economics (`prc/` lean plane).** 110× compression vs the observation artifact (round-1 §2.1),
refId mentioned 1.1× per element, byte-validated render; conditional prompt −30.3% system bytes with
zero engaged-guidance loss (run-16 report); 15,356 B/call = 4,549 tok vs browser-control 1,982 tok/call
with 2.8× BrowseGent's output tokens and 3× its step count. The measured economics are now
best-in-class among the compared systems for *total* task cost at equal-or-better completion depth.

**3.8 Loop guards as substrate policy (`V2AgentLoop.ts:340-427`).** Hard-block loop detector with
semantic (targetId) signatures, single-ref persistent-blocker blindspot fix
(`RecoveryState.ts:219-244`), page-epoch blocker fingerprinting, and the same-URL destructive-reset
guard (Guard 3, `V2AgentLoop.ts:392-427`) — all enforced pre-execution, independent of model compliance.
The navigate-reset forensics (151 wasted episodes, signal absent 115/115 times pre-fix) were solved by
*substrate refusal*, not by better prompting — the correct architectural instinct, and the template for
§6.

---

## 4. Structural ceilings (dimension 2) — limits no patch can lift

**(a) The stateless per-call re-send tax.** Measured on run 16: across 192 consecutive-episode pairs,
4,026 refs co-occur, and 4,025 of them (99.98%) carry byte-identical name+kind — i.e. when a ref
survives an action, its line is re-rendered verbatim. Mean 21 shared refs per pair ≈ **28% of a
mean-size surface** re-sent and re-read every call (run-15 line-level measure: 23.4%). On top sits the
static system prompt at 48.0% of mean wire. There is **no persistent page model anywhere in the
architecture**: `PlannerInput` is rebuilt from scratch each episode; the only cross-episode memory is
`EvidenceLedger` (listing-page-gated) and ≤5 lineage steps. A diff-first render (F2, not yet
implemented) trims the marker cost but cannot remove the re-anchoring tax; only a session-level page
model or provider-side context caching could — and the provider path is stateless by design
(token-efficiency §10.4: no `cachedContent` used). **Ceiling: ~20-30% of wire + the model's re-read
attention on every call.**

**(b) The 80-ref working-set ceiling.** Run 16: observed refs per episode mean 1,420, p50 730, p90
3,592, **max 7,756**; selected = 80 (32 primary + 48 secondary, `PlannerWorkingSetSelector.ts:28-36`) in
199/220 full episodes (**90% binding**); median selection rate 5.6% of observed. 51 episodes observed
>2,000 refs. The selector's scoring is heuristic top-K with a −25 offscreen handicap
(`rankOperationalItems.ts:38-46`) and goal-token bonuses; force-include lanes (suggestion/recovery/
horizon/target-value/submit/result_row, +80…+180) rescue only enum-listed classes. Is top-K the right
shape? For action surfaces, mostly yes (bounded wire, deterministic); for **information** tasks on
1K–7K-ref pages it is structurally wrong: relevance is decided by name/text token overlap against a
goal string, so the winning fact (GitHub's `resource-watch` row at 782 refs — round-1 §2.6, the
canonical casualty) loses races against chrome. Structured alternatives (region trees, cluster
summaries, per-region representative + on-demand expansion — the PRC regions machinery exists but
carries only `repeated_list`, `projectionTypes.ts:12`) are the right shape for this regime and are
declared-but-unbuilt. **Ceiling: the architecture cannot see 94%+ of a large page in one call, and
today it cannot summarize what it drops (reason-coded only after F7a — unvalidated).**

**(c) Prose absence in the substrate.** The walk admits interactive elements only
(`ObservationService.ts:461-486`); paragraphs, list bodies, pod values are never refs. Worse than round
1 reported: `get`/`inspect_region` are **replay-only** — they read the *captured* observation's stored
name/text (`BrowseGentV2Harness.executeRefRead:611-692` passes the pre-action snapshot;
`ReadEvidence.buildBoundedReadEvidenceText` composes from `observation.refs`), so **no read tool can
escape the capture filter**; the single live prose window is `search_page`'s 12 lines × 500 chars
(`BrowseGentV2Harness.ts:208-244`). Informational goals are therefore capped at (interactive
labels + 6 KB of search_page) per page — the ArXiv/Wolfram failure classes (S2/S3) are permanent under
this design, not tunable. P8 (prose capture) is queued but unbuilt. **Ceiling: hard cap on
information-task accuracy.**

**(d) Single model, single pass, one-episode look-ahead.** One planner call per episode; no
self-critique pass, no verification model, no simulation; plans are ≤-steps-per-episode with
conservative breaks. The only second-pass machinery is bounded grounding reconciliation at finalization
(`V2AgentLoop.ts:949-1052`), which fires only when deterministic claim-vs-read conflicts are detected.
Everything else rides one flash-lite forward pass. **Ceiling: no error correction above what the
substrate can verify deterministically** — which is why synthesis failures (Wolfram__10 compound
measurement, 0 flips across 15+ runs) never recover.

**(e) maxSteps/budget shape.** Benchmark budget = 12 action episodes (+1 one-shot terminal
continuation + finalization; library default 15, `BrowseGent.ts:30`). Run 16 exhausted tasks: Booking__10
(13 calls), Flights__0/10 (14 calls), Booking-type widget tasks. The step-exhaustion census (33 tasks,
176/434 episodes = 40.6% wasted) predates the current guard set; the waste share is now lower but the
**shape** remains: a hard step ceiling with no mid-run budget/coverage tradeoff beyond the
`budget_low` signal, and `max_step_risk` still declared-but-unbuilt (`RecoveryState.ts:20` — grep
verified no builder returns it). **Ceiling: long-horizon tasks must fit 12 decisions.**

**(f) The DOM-capture hop.** 284.3 MB of observation artifacts per run (mean 1.19 MB, max 6.25 MB per
capture), 11.8% of intrinsic time (111.3 s over run 16) — second only to the provider. Inside it, CDP
identity resolution does up to 150 **sequential** `DOM.describeNode` calls per capture
(`ObservationService.ts:179-249`), and marks every interactive element with a temporary DOM attribute
(`setAttribute('data-browsegent-v2-marker')`) — a mutation of the live page that can trip
framework MutationObservers, and `DOM.querySelectorAll` does **not pierce shadow roots**, so
shadow-DOM elements never receive backendNodeId at all. **Ceiling: capture cost grows linearly with DOM
size; identity guarantees degrade exactly where modern apps live (shadow DOM).**

---

## 5. Wrong-built audit (dimension 3) — where redesign beats patch

**W1. The compact/shadow plane is alive in the hot path.** `renderCompactDataPlane` + 8 compact
renderers survive in `PromptLayoutEngine.ts:33-257`, and `CompactPlannerClient` (206 L) +
`CompactPlannerView` (339) + `CompactShadowInput` (198) + `CompactShadowPlanner` (163) +
`CompactShadowComparison` (157) + `CompactShadowPrompt` (34) ≈ **1,097 lines** remain wired:
`V2AgentLoop.recordCompactPlannerTelemetry` (lines 1055-1082) executes on **every** planner call
including finalization and grounding reconciliation (call sites at 170, 206, 850, 1004), building view +
baseline + stats + coverage for a mode that lost its last comparison and was superseded by lean. Measured
cost: **222 artifacts = 6.6 MB in run 16** for data nobody reads, plus per-episode compute. Round-1 F14
removed `Brain1SurfaceOverlap` but left this family. **Rebuild sketch**: delete the family and the
`compact_enforced` branch in `createPlannerClient`; keep one serialization config recorded honestly in
`providerPayload.serialization` (today it logs `mode/prcTierOmitted/compactDataPlane` but **not**
`prcLeanPlane` or `conditionalSystemPrompt` — run 16's own payloads cannot prove which plane was
active; verified on `episode_1_*-output.json`).

**W2. The planner-input JSON shape is a write-only intermediate at 10.6× the wire.** Mean 84.3 KB
(max 148 KB) pre-render JSON per call, ~18.9 MB/run on disk (444 files), with `current.refs` alone
(17 KB) doubling the rendered user message; round-1 measured 6.7 mentions per selected ref across
views/lanes/lists. Nobody consumes these artifacts (this audit is the only reader, and it had to write a
re-render to see what the model saw). **Rebuild sketch**: stop serializing `PlannerInput` per episode;
persist instead (i) the compiled IR/surface, (ii) selection diagnostics (already in
`workingSetDiagnostics`), (iii) the compact shadow *only* under an explicit experiment flag. The IR is
the ground truth of what the model saw; the JSON is not.

**W3. Graph machinery vs consumption — still 90% dormant, now with proof.** `ProjectionService.project
(observation, _graphSnapshot)` still ignores the graph (verified at 3c91567); `ProjectionItem`'s
`graphPresent/recentlyAppeared/...` fields remain declared and never populated
(`projectionTypes.ts:40-44`); graph `regions` remain structurally dead (no `regionId` is ever assigned
on a `V2Ref` — grep verified; `ContinuityGraph.buildRegions` filters them all out); and the
`graph/` + `transitions/` trace sidecars were **empty in all 30 run-16 traces** (0 files; measured). The
graph's live outputs remain: latest-transition appeared/weakened sets (+90/+70 bonuses) and count
summaries. **Rebuild sketch**: shrink `ContinuityGraph` to what is consumed — a transition store +
targetId index — and make F2 (diff markers) and F6 (heal hints) its only two deliverables; delete
regions/firstSeen/lastSeen or wire them in the same change. Keeping 198 lines of dead weight per run is
how dormancy hides.

**W4. Four overlapping signal vocabularies.** `FailureClassifier` (21 error codes → category/severity/
persistence tables), `UncertaintySignals` (level ladder over signal strings), `DeadStateDetector` (85 L
re-deriving `empty_interactions`/`environment_block`/`high_uncertainty` — all three already
high-tier signals in UncertaintySignals), and `RecoveryStateBuilder` (15 declared states, 3
near-duplicate `same_action_loop` branches, `repeated_value_preview` split per tool prefix). The loop
consults them in different branches (`V2AgentLoop.ts:567-583` runs DeadStateDetector then
UncertaintySignals **twice** with near-identical inputs). Additionally, `FailureClassifier.detectEnvironment
Block` (lines 177-190) overrides the *actual* error whenever page text contains "captcha"/"verification
required"/"security check"/"access denied" — a text-sniffing classifier that can misfile any failure on a
page that merely mentions those words. **Rebuild sketch**: one taxonomy (codes + evidence), one
assessment pass per episode producing {failure, uncertainty, dead-state, recovery} as projections of
it; environment detection keyed on escalation-grade evidence (interstitial structure or provider
signals), not substring search.

**W5. EvidenceLedger's visible-only, platform-shaped memory.** Cards are built from visible refs only
(`EvidenceLedger.ts:233`), gated to search/listing URLs (`isSearchOrListingPage:161-165`), capped at 8,
and entity anchors are platform-convention regexes (`owner/repo`, `arXiv:\d+`, h1–h3, metric-neighbor
geometry — lines 170-224). It is the project's best page-model seed **and** its clearest shape
violation: a general "page memory" need is implemented as a listing-page entity-card extractor whose
extension path is regex accretion. **Rebuild sketch** (this is also refactor direction R2): a bounded
visited-page registry (origin+path+title+key facts+cards) with origin-change invalidation (already
exists, line 467-479) and a compact PAGE MEMORY render; cards become one consumer.

**W6. Dual-maintenance leftovers and dead code (post-F14).** `goalMatchesItem`/`goalTokens` in
`PlannerWorkingSetSelector.ts:443-450` are defined and never called (superseded by `GoalRelevance`); the
`focus:` STATE line still renders an undefined-contract hint (`PlannerRepresentationCompiler.ts` →
`PromptLayoutEngine.renderState:265`); readable evidence still blanket-tags every entry
`answer_candidate` (`PlannerWorkingSetSelector.ts:489` — 52% generic/37% link content, round-1 §4);
`isGenericRecoveryControl` hardcodes Hindi dismiss labels (`PlannerWorkingSetSelector.ts:381-384`) —
locale-whitelist where the rest of the system is lang-tagged and data-driven. Each is small; together
they are the maintenance tax the next engineer pays.

**W7. F1/F3/F7a are unvalidated in any run** (dating fact from §2). The serializer carries
`selectOptions` (`PlannerWorkingSetSelector.ts:746`), the composer computes `effect`
(`PlannerInputComposer.ts:275-280`), diagnostics compute `rank_loss` (line 902) — and 222/222 run-16
episodes show none of these fields. Until the next balanced30 run, these are source-verified claims only,
and the round-1 expected effects (ESPN select tasks; 28%-repeat-after-silent-success convergence;
drop-cause accounting) remain un-evidenced. Run-16's measured silent-success repeat multiplier improved
to 2.25× (6/21 vs 14/110 baseline) from 4.7× — attributable to P5/P6, not F3.

---

## 6. Model-resilience analysis (dimension 4)

**Where model-dependence is concentrated.** The steering contract lives in: (i) `PlannerPrompt.ts`'s
7.4 KB conditional base — 48.0% of mean wire — including recovery-state guidance, combobox protocol,
horizon "MUST be exactly the suggested plan line", superlative-sort, site-search, and budget rules; (ii)
`recovery.nextMechanisms` — ~40 snake_case mechanism tokens whose *meaning* exists only in that prompt;
(iii) `answerFeedback.instruction` strings. The compliance assumption is total: every recovery state is
substrate-detected but model-executed.

**With a weaker model (measured).** Run 15/16 + forensics give three clean cases: Google Flights
navigate loop — 8/13 steps on navigate attempts, `no_op_navigation` absent in 115/115 same-URL episodes
pre-fix (navigate-reset forensics §3); the fix that worked was **substrate refusal** (Guard 3), not
prompting. `repeated_value_preview:type` was emitted but had no RecoveryState handler (40 episodes lost
pre-implementation — step-exhaustion archetype 3). GitHub sort refusal (run 16): P2 fired, the
superlative-sort guidance was present, and the model still answered from the unsorted list — the judge
rejected it. Pattern: **prompt-borne steering has a measured failure floor on flash-lite exactly where
the substrate could refuse, retry, or execute instead.** The current architecture's answer to
non-compliance is a hard block after 3 repeats — the strongest tool — but it is applied to signatures,
not to semantics like "list is unsorted".

**With a stronger model.** Most conditional guidance becomes overhead again (engagement was measured:
recovery guidance active on ~1/3 of episodes, combobox ~1/2, horizon 0–3/200) and the prescriptive
"exactly the suggested plan line" rules would *constrain* a model capable of its own planning. What
survives model upgrades unchanged: the guards, verification, contracts, escalation, seek — all
substrate-side. That asymmetry is the design lesson: **everything substrate-side is model-robust;
everything prompt-borne is model-specific.**

**Should compliance-sensitive logic live in the substrate? Yes — and the codebase already agrees.**
Every fix that survived across runs 11→16 was a substrate move: same-URL guard, click_no_navigation
detection, repeated_type_same_value state + mini-plan breaks, seek macro, terminal continuation,
budget_low. The remaining prompt-rideable risks are (1) sort/verification compliance (GitHub__0), (2)
combobox commit compliance (Flights — W-C), (3) honest-report compliance. Direction R1 (§8) converts (1)
and (2) into primitives/verification; (3) is already contract-backed.

---

## 7. Scale prognosis (dimension 5)

**(a) Heavy-JS/SPA churn.** Stabilization is `domcontentloaded + 75 ms` (`StabilizationService.ts:14-32`)
— no mutation-observer quiet window, no network quiescence. Continuous churn manifests as microstates
and weakened refs; the known cost is the `low_confidence_ref` refusal regime (23 steps lost across 154
runs; 69.6% genuinely stale, 26.1% fresh-but-rendered — low-confidence forensics), and the proposed
bounded re-observation fix is not yet implemented (`RefSelfHealingPolicy.ts:15-48` still refuses
offscreen/read-tool self-heal). targetId = FNV(selector|name|text|**index**) is attribute- and
position-sensitive, so framework re-renders churn identity; targetId-first matching absorbs part of it,
but a hard re-render still produces "everything appeared" transitions — the exact failure that
masqueraded as progress in the navigate-reset forensics (partially patched by `isNoProgressMutation`'s
navigate clause, `V2AgentLoop.ts:1517-1519`). Verdict: workable today, degrade-heavy under continuous
animation/virtualization; needs readiness-based settling + identity hardening.

**(b) Canvas/iframe/auth walls.** The walk recurses shadow roots **only** (`ObservationService.ts:294-302`)
— **iframe content is invisible to the entire architecture** (no `contentDocument` traversal, no
Playwright frame enumeration anywhere in the capture path). Embedded editors, paywall widgets,
3rd-party checkout forms, and canvas-rendered UI are structurally unobservable — not degraded,
*unobservable*. Auth walls: escalation-only (`captcha_or_access_block`); `BROWSEGENT_STORAGE_STATE`
opt-in sessions exist (`7bbe317`) but the loop has no login-flow competence. This is the single largest
unpriced scale risk: it silently zeroes out whole site classes.

**(c) Long-horizon multi-page flows (10+ steps).** Budget 12(+1+finalization). The four wasted-episode
archetypes from the exhaustion census are now largely guarded (oscillation dead-state at 3 consecutive
episodes, `V2AgentLoop.ts:107-125`; click-no-navigation; repeated_type; same-URL guard), and
slow-but-alive tasks finalize cleanly via terminal continuation (9/9 in the census). What is missing for
10+ step *legitimate* flows: general cross-page memory (EvidenceLedger is listing-gated; F8 unbuilt) and
`max_step_risk` budget steering (declared, unbuilt). Flights-class flows burn 6-8 steps on 2 widgets —
the primitives (R1) matter more than the ceiling here.

**(d) 10× longer pages / infinite scroll.** Observed refs p90 is already 3,592 (max 7,756); an infinite
scroll multiplies observed refs while viewport-only visibility
(`ObservationService.ts:502-503`) keeps 51%+ of capture offscreen and unreachable by the −25-handicapped
top-K. Wire stays capped (80 refs + 12 KB lean cap — good), but selection quality on 10K-ref pages
becomes a lottery biased toward chrome; obs artifact size grows linearly (6.25 MB max today → 30+ MB);
CDP identity caps at 150 elements (`MAX_CDP_IDENTITY_ELEMENTS`), so identity verification starves
exactly on the biggest pages. Verdict: the architecture degrades gracefully on wire, catastrophically on
selection, and linearly on cost.

**(e) Concurrent tasks.** Per-task process/browser isolation (`BrowserSession` per harness), zero shared
state, no global locks — horizontal concurrency is architecturally free. The benchmark runner is serial
with 10 s pacing (pacing = 56% of raw wall; 56-key pool configured), so throughput is an orchestration
question, not an architecture question. Scaling costs are per-task: 10.8 MB trace storage, ~33.7 MB
provider bytes/task, and the capture hop. Nothing in the substrate breaks at 30× concurrency; the
write-only telemetry (W1/W2) multiplies storage cost linearly.

---

## 8. Rebuild-vs-refactor verdicts (dimension 6)

| Subsystem | Verdict | Basis |
|---|---|---|
| `substrate/InputService` + `semanticHitTest` | **Keep verbatim** — flagship | §3.1; the layer competitors lack |
| `brain2` (classifier + interpreter) | **Keep verbatim** | §3.2; highest signal/line |
| `agent/AnswerContract` partition + escalation | **Keep verbatim**; refactor pattern tables to data | §3.3/3.4; load-bearing |
| `agent/V2AgentLoop` | **Refactor** — split guards/mini-plan/done-gates/continuation into modules; keep semantics | 1,877 L; the only file where all vocabularies meet |
| `substrate/ObservationService` | **Refactor** (partial rebuild of identity) | add iframe traversal (W-b), bounded prose, stop page mutation, batch CDP identity |
| `runtime/StabilizationService` | **Rebuild** | readiness-based settling; 75 ms is a coin flip on SPAs |
| `runtime/RefService` + `RefSelfHealingPolicy` | **Refactor** | bounded re-observation for fresh-but-rendered; threshold brittleness |
| `graph/ContinuityGraph` | **Refactor hard** (shrink) | W3; keep transitions + targetId index only |
| `brain1` projection/ranking | **Keep, extend** into verification home | deterministic, leak-free; delete dead `goalMatchesItem` |
| `planner/PlannerWorkingSetSelector` | **Keep core, extend** | top-K is right for actions; add region-tree summaries for information pages |
| `planner/prc` lean plane | **Keep verbatim** | byte-validated, best-in-class economics |
| `planner/prc` compact plane + `CompactShadow*`/`CompactPlannerClient/View` | **Remove** | W1; ~1,097 lines + 6.6 MB/run |
| `planner/PlannerPrompt` | **Rebuild as composed sections** | string surgery (`stripAbsentGuidance`) is fragile; substrate-borne enforcement first |
| `planner/V2PlannerClient` | **Keep**; drop response schema (measured 0 parse failures without it) | §3.7; flag-level |
| `agent/EvidenceLedger` | **Refactor → general page memory** | W5; cards become one consumer |
| `runtime/FailureClassifier`+`UncertaintySignals`+`DeadStateDetector`+`RecoveryState` | **Rebuild as one taxonomy** | W4 |
| `trace/` (ledger, outcomes) | **Keep; feed back** (F3 done, unvalidated); stop creating empty sidecar dirs | graph/transitions/screenshots: 0 files ×30 |
| `tools/V2ToolDispatcher` | **Keep, extend** (pick_option, submit_form) | seek proved the pattern |

**If building v3 from scratch today**: keep verbatim the deterministic verification layer, the
transition/identity machinery, the contract partition, and honest escalation — these are the moat. Do
differently from day one: (1) capture plane is a *page model* (frames + prose + regions + stability),
not an interactive-elements array; (2) one signal taxonomy, enforced substrate-side, with the prompt as
rendering of substrate verdicts — never as the enforcement mechanism; (3) session-scoped page memory and
diff-first rendering instead of stateless re-send; (4) primitives (pick_option/submit_form/seek) as the
default action vocabulary; (5) no second render plane, ever — one serialization, feature-flagged *within*
it.

**Ranked refactor directions — (SOTA-gap closed × confidence) ÷ migration cost:**

**R1. Substrate widget primitives: `pick_option(ref, pattern)` and `submit_form(ref)`** — the seek
pattern applied to the 0/4-both-engines widget class. Closes Booking__10/Flights__0/Flights__10 (3
tasks = 21% of run-16's remaining gap), kills the combobox-commit compliance dependency (W-C/D),
high confidence (seek + InputService ladder already exist). *Migration*: new dispatcher cases +
`PlannerPrompt` tool rows + recovery mechanisms; flag-gated; no schema break. Cost: medium.

**R2. EvidenceLedger → bounded cross-episode page memory** (visited-page registry + prose facts +
cards; origin-invalidated, ≤8 entries, rendered only when revisiting). Closes BBC/ESPN-class
over-exploration residue and supports ArXiv-class prose grounding; pairs with P8. *Migration*:
extend the existing ledger behind `pageMemory` flag; composer renders one section. Cost: low-medium.

**R3. Delete the compact/shadow plane + fix serialization telemetry.** Zero direct task gap; removes the
largest wrong-built surface (~1,100 lines, 6.6 MB/run, per-episode compute), and makes provider
payloads self-describing (record `prcLeanPlane`/`conditionalSystemPrompt`). *Migration*: deletion +
one telemetry field; trivial. Cost: low. (Velocity compounds every other direction.)

**R4. One signal taxonomy with substrate enforcement** (merge W4; add substrate actions where
compliance failed: auto-quarantine sibling-link clicks after 2 no-nav clicks, auto-verify sort state
before ranking-goal finalization, bounded re-observation on weakened refs). Closes the weaker-model
floor and GitHub__0-class grounding. *Migration*: keep public surfaces of all four modules, move
brains into one assessor. Cost: medium.

**R5. Capture-plane upgrades**: iframe traversal, bounded prose/heading capture, readiness-based
stabilization, batched CDP identity, coverage alarm (F11). Closes the information-task ceiling (S2/S3)
and heavy-JS churn; biggest long-horizon SOTA-gap lever and the biggest blast radius. *Migration*:
flag-gated capture versioning (observation schema v3), A/B on balanced30. Cost: medium-high.

---

## 9. The SOTA gap, quantified (dimension 7)

**Baseline**: run 16 combined 16/30 (strict 9 + judge 7). SOTA line on this benchmark class: 75–85%
(Agent-E 73.2%, Operator/CUA 87%, Browser Use 89.1%, Magnitude 93.9% claimed — all with the
contamination caveat of arXiv:2504.01382; see Sources). That is **+7 to +10 tasks over run 16**.

**The 14 tasks not combined-passed in run 16, decomposed:**

| Category | Tasks | Share of gap | Evidence |
|---|---|---|---|
| (v) Evaluator/environment noise | **6** — Allrecipes__3/10, Cambridge__0/10 (captcha in *both* runs), GoogleSearch__0/10 (captcha run 16; __10 also run 15) | **43%** | `webvoyager_artifacts.json`: 6× `planner_escalated:captcha`; run-15 eval: 5× |
| (i) Widget/interaction capability | **3** — Booking__10, Flights__0/10 | 21% | both engines 0/4 class; Flights__0 ends `answer_contract_failed:incomplete_answer\|missing_ranking_evidence`; Booking__10/Flights__10 `v2_max_steps_exhausted` |
| (ii) Grounding/verification | **2** — GitHub__0 (sort refusal + hidden row), GoogleMap__0 (judge-NO both runs) | 14% | run-16 report §Mechanism; P2 fired but not complied |
| (iv) Answer synthesis | **1** — Wolfram__10 (compound measurement; 0 flips across all runs) | 7% | navigation-grounding §2.7 |
| (iii) Navigation policy | **0 pure** (site-search guidance fixed BBC__10; ESPN__10 now strict) | 0% | run-16 flips |
| Measurement flips | 2 — ArXiv__0, Huggingface__0 (run-15 wins lost to corrected judge) | — | run-16 report "Down (3)" |

**Arithmetic to the SOTA line**: fixing *all* non-noise categories (R1+R2+R4-class work) = +6 tasks →
22/30 (73.3%) — at the *bottom* of the SOTA band only if the captcha set is excluded or resolved;
with the 5 doubly-locked captcha tasks scored in-denominator and unresolved, the practical ceiling of
current architecture + planned work is ~22-23/30 (73-77%). The task brief's "5 captcha-affected"
matches the both-runs-locked set; note the run-16 validation report's claim of "0 captcha escalations
overall" contradicts its own artifacts (6) — an accounting bug in the report, not the evaluator.
**Conclusion**: on this benchmark, roughly **two-fifths of the remaining gap is environmental**, one
fifth widget capability, and the architecture-side levers (R1-R5) address ~7 tasks — exactly the +7
needed to reach the band's floor, leaving the top of the band (85%) unreachable without either the
environment fixed or the deeper capture-plane rebuild (R5) plus a stronger planner model.

---

## 10. Sources

**Code (worktree `D:\BrowseGent-arch-sota`, commit 3c91567, read-only)**: all paths cited inline; the
load-bearing ones are `src/v2/agent/V2AgentLoop.ts`, `src/v2/planner/{PlannerWorkingSetSelector,
PlannerInputComposer,PlannerPrompt,V2PlannerClient}.ts`, `src/v2/planner/prc/{PromptLayoutEngine,
PlannerRepresentationCompiler}.ts`, `src/v2/substrate/{ObservationService,InputService,semanticHitTest,
RefResolver}.ts`, `src/v2/harness/BrowseGentV2Harness.ts` + `ReadEvidence.ts`,
`src/v2/agent/{EvidenceLedger,AnswerContract}.ts`, `src/v2/runtime/{RecoveryState,FailureClassifier,
UncertaintySignals,DeadStateDetector,RefService,RefSelfHealingPolicy,StabilizationService}.ts`,
`src/v2/graph/ContinuityGraph.ts`, `src/v2/brain2/{transitionClassifier,ContinuityInterpreter}.ts`,
`src/v2/tools/V2ToolDispatcher.ts`, `src/v2/agent/SeekPolicy.ts`.

**Run artifacts (READ-ONLY)**: `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1788612821955\`
(`webvoyager_artifacts.json`, `webvoyager_evaluation.{md,json}`, `summary.md`, 30 traces: 222 planner
inputs/outputs, 238 observations, 197 action-outcome records, 30 latency ledgers, 222 compact-planner
artifacts, empty graph/transitions/screenshots dirs) and `webvoyager_lite_1788594583363\` (run 15
evaluation + round-1 measurements). Competitor: run 6 `webvoyager_lite_1788360177393`.

**Prior research (build-on, not duplicated)**: `progress-docs/research/core-architecture-leverage.md`
(round 1 — F1/F3/F7a/F14 verified implemented at 3c91567 via `git show 5da2396 --stat` and source
reads); `progress-docs/run16-validation-report.md`; `progress-docs/research/{date-widget-interaction,
step-exhaustion-forensics,browser-control-token-efficiency,navigation-grounding-divergence,
2026-09-04-low-confidence-ref-forensics,2026-09-04-navigate-reset-forensics}.md`.

**External (SOTA line)**: [Browser Use SOTA technical report (89.1% WebVoyager)](https://browser-use.com/posts/sota-technical-report);
[OpenAI Computer-Using Agent (87% WebVoyager)](https://openai.com/index/computer-using-agent/);
[AgentOccam, ICLR 2025 (OpenReview)](https://openreview.net/forum?id=oWdzUpOlkX);
[An Illusion of Progress? Assessing the Current State of Web Agents (arXiv 2504.01382)](https://arxiv.org/abs/2504.01382);
plus the 2025–2026 world-model/pruning citations already indexed in round-1 §8 (WMA, WebDreamer,
Prune4Web, Agent-E, AgentOccam, Signal-Driven Observation).

*Analysis scripts kept outside the worktree (`%TEMP%\browsegent-arch-sota\`); the worktree received only
this document. No evaluator changes, no site-specific logic proposed; honest-escalation semantics and
the advisory/hard contract partition treated as load-bearing throughout; every proposed direction is
flag-gated with a backward-compatible path.*
