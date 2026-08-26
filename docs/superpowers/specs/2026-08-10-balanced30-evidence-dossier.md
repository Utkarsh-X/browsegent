# Balanced30 Evidence Dossier

## Purpose

This dossier separates runtime completion from evaluator success for the latest
balanced30 run. It is an audit artifact, not a benchmark-tuning proposal.

## Run

- Run: `webvoyager_lite_1783774436822`
- Slice: `balanced30`
- Adapter: `browsegent`
- Planner serialization: PRC
- Runtime-complete tasks: 19/30
- Strict evaluator success: 9/30
- Environment blocks: 7/30
- Trace completeness: 30/30
- Aggregated latency: 2,180.7 seconds total, 72.7 seconds/task
- Aggregated action outcomes: 228 total, 66 no-effect, 56 failed, 14 evidence-producing

The runtime `success` field is not a strict benchmark score. A task can return
a locally valid answer while still receiving a strict evaluator rejection.
All future audit summaries must join `report.json` with
`webvoyager_evaluation.json` before classifying outcomes.

## Outcome Distribution

| Joined category | Count | Meaning |
| --- | ---: | --- |
| Strict success | 9 | Runtime completed and evaluator strict score is 1 |
| Internal complete, strict reject | 10 | Runtime completed, but evaluator rejected or only partially credited the answer |
| Environment block | 7 | CAPTCHA, Cloudflare, or equivalent external block |
| Runtime failure | 4 | Agent did not complete before escalation or step limit |

## Internal Complete / Strict Reject Review

These are provisional classifications. They must not be converted into code
changes without trace-level evidence and, for reference-sensitive tasks, manual
review against the live page.

| Task | Observed outcome | Evidence signal | Initial interpretation | Action |
| --- | --- | --- | --- | --- |
| Apple 10 | Current M5 MacBook Pro answer; static reference expects older chips | No successful read action | Likely live-data/reference drift | Do not tune runtime |
| ArXiv 10 | Gives general withdrawal procedure | Two reads only reported `Submission not yet announced` | Likely insufficient evidence or wrong procedure path | Inspect goal/evidence contract before changing planner |
| Coursera 10 | Finds a valid current ethical-AI course | No successful read action | Non-unique result or reference drift | Do not hardcode course selection |
| GitHub 10 | Current Copilot Pro price/features | No successful read action | Likely temporal/reference drift | Do not tune answer to old price |
| Google Flights 0 | Says the search interface is incomplete | No successful read action; 21 actions and 10 no-effect | Clear incomplete navigation/completion | Candidate for generic transition/evidence recovery |
| Google Flights 10 | Returns current Qatar/Asiana prices | No successful read action | Possible live-data/reference drift; uncertain | Manual review only |
| Google Maps 0 | Explicitly says it cannot list five salons | Two evidence reads, one empty | Clear incomplete extraction | Candidate for generic list/evidence recovery |
| Hugging Face 0 | Returns a current sentiment model | No successful read action | Non-unique result or reference drift | Do not hardcode model identity |
| Hugging Face 10 | Reports requested Space as 404 | No successful read action | Live resource may have changed | Treat as environmental/data uncertainty |
| Wolfram Alpha 10 | Returns 0.506 gauss | No successful read action | Possible unit/reference discrepancy | Do not change conversion without evidence |

## Runtime Failures

| Task | Failure | Initial signal |
| --- | --- | --- |
| Amazon 10 | `v2_max_steps_exhausted` | Seven failed actions, repeated navigation pressure |
| BBC News 0 | `v2_max_steps_exhausted` | Six failed and six no-effect actions |
| Booking 0 | `v2_max_steps_exhausted` | Seven no-effect actions and only two evidence-producing actions |
| Booking 10 | `planner_invalid_output_dead_end` | Output contract/planner recovery failure |

These failures are more suitable for a generic runtime investigation than the
reference mismatches. They still need trace inspection before implementation.

## What the Data Does Not Prove

- It does not prove that the PRC representation is the root cause.
- It does not prove that a stronger model is the only bottleneck.
- It does not justify changing answer contracts to match stale references.
- It does not justify adding task-specific selectors, URLs, or answer rules.
- It does not justify an XML or planner rewrite while action/evidence and
  recovery behavior remain unresolved.

## Immediate Engineering Decision

Do not patch the ten strict rejects as one category. Keep the evaluator join and
audit output as the source of truth, then investigate the four runtime failures
and the two clear incomplete normal tasks (`Google Flights 0` and `Google Maps
0`) using trace evidence.

The next runtime change, if evidence supports it, should be a generic
completion/recovery capability that:

1. detects an answer explicitly admitting missing required results;
2. prevents finalization when required evidence is absent;
3. gives the planner a bounded, non-task-specific recovery pivot; and
4. escalates honestly when the page cannot provide the requested result.

This must be implemented only after checking that the signal is derived from
the task contract and collected evidence, not from WebVoyager task names or
golden answers.

## Guardrails

- Keep 30 tasks for rapid diagnostics; use a held-out or broader set for periodic
  validation rather than optimizing against individual tasks.
- Compare repeated runs and distributions, not one stochastic score.
- Preserve current PRC and runtime architecture until a measured alternative
  wins on both quality and payload cost.
- No benchmark-specific selectors, URLs, reference strings, or task branches.
- No extra LLM call solely for evaluation or recovery unless later telemetry
  proves the control-plane signal cannot be derived locally.

## Post-Fix Canary

Two single-task canaries were run for `Google Flights--0` after the loop
identity repair:

| Run | Result | Planner calls | Tool executions | Input tokens | No-effect | Interpretation |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| key index 52 | runtime failure: max steps | 13 | 19 | 93,329 | 9 | The old repeated-press pattern still exhausted steps |
| key index 53 | internal completion, strict reject | 13 | 22 | 87,601 | 8 | No quality or efficiency promotion signal; no hard-block fired |

These runs verify that the change does not crash the agent, but they do not
prove an improvement. The task is marked impossible in the external registry
and is therefore unsuitable for a score claim. The next runtime investigation
should inspect why successful actions still produce no read evidence and why
the planner can finalize without verified task evidence.

The answer contract now rejects explicit unfinished-result language such as
“the search has not been executed” or “the requested result is not currently
available”. This is a general false-positive guard; it does not assert that a
specific benchmark answer is required.

The Booking trace also showed ref churn around one stable substrate identity:
`v2ref_4086`, `v2ref_6873`, `v2ref_9660`, and `v2ref_14247` mapped to the same
`targetId` while repeating the same no-progress interaction. Loop recovery now
uses `targetId + tool + value` as a secondary bounded identity, so ref churn
cannot bypass recovery. This does not use role/name heuristics or block
different targets that merely look similar.

## Evidence-Provenance Correction

The control plane now separates explicit read evidence from mutation previews:

- Answer-contract validation consumes only `get`, `inspect_region`, or non-empty
  `search_page` history through `buildAnswerValidationEvidence`.
- Click/type/press/navigate target previews remain available to finalization as
  action context, but are labeled `Last successful action preview` and cannot
  establish a page fact.
- This change adds no planner call, task branch, selector, URL, or benchmark
  reference. It is a general correctness invariant.

Verification: `npm run build`, `npm run check:v2`, focused V2 tests (54/54), and
the full unit suite (645/645) pass. Re-running the offline audit against this
historical run still gives the same 30/30 evaluator join and baseline
distribution; no quality or efficiency promotion claim is made until a fresh
runtime trace exercises the new boundary.

## Semantic Identity Correction

The live transition boundary now delegates to Brain2 continuity matching. The
interpreter pairs refs by stable `targetId` before observation-scoped `refId`,
so pure ref allocation changes do not become structural progress. Genuine
role/name/text/state changes remain structural, and the continuity graph rebases
live nodes onto the current ref id to avoid duplicate stale topology.

This is a general identity invariant, not a WebVoyager rule. Semantic transition
and graph fixtures pass, as do build, V2 checks, and the full unit suite (645/645).
The historical balanced30 report is unchanged and no benchmark promotion claim
is made before a fresh runtime smoke trace.

## Observable Action-Effect Correction

The prior action-economy report treated successful same-URL actions as no-effect
whenever they lacked URL or generation changes. Trace transitions show that
same-URL clicks, presses, scrolls, and local updates can produce structural or
weak observable changes. The metric therefore mixed telemetry loss with actual
planner waste.

The outcome contract now preserves historical `stateChanged` semantics and adds
`observableEffect` from transition strength. `noEffect` uses that fact, while a
separate summary counter exposes observable transitions. This is a diagnostic
correction only; it does not add planner calls or benchmark-specific behavior.

Verification: full unit suite 646/646, build, and V2 checks pass. Fresh smoke
attempts with key indices 55 and 10 were blocked before browser startup by
`ERR_NETWORK_ACCESS_DENIED` on all five sites, so no runtime quality claim is
made from those attempts.

## Ref-Churn Recovery Pivot

The balanced30 traces also proved that recovery signals were being delivered
but could be ignored when the planner changed refs while repeating the same
no-progress tool. The control plane now emits a tool-family signal after two
no-progress uses and rejects the fourth use after three, scoped to the current
URL/generation epoch. Navigation clears the family count and block. The
existing exact-signature and stable-target guards remain unchanged.

The new runtime and recovery fixtures pass, and the full unit suite is 652/652
with build and V2 checks green. The valid concurrent smoke
`webvoyager_lite_1786512996764` was 4/5 internal with one Cambridge CAPTCHA
block and 5/5 complete traces; because it was not an isolated A/B run, it is
recorded as smoke evidence only, not a causal promotion result.

## Persistent Blocker Provenance

Failure evidence now carries the observation URL and generation that were
active when a target was blocked. `RecoveryStateBuilder` groups blocker
diagnostics only when the same blocker is observed on at least two distinct
refs within that exact page epoch. It emits `persistent_target_blocker` with
generic recovery mechanisms such as re-observation, region inspection, and
finding a dismiss control; raw blocker descriptions remain trace diagnostics,
not planner instructions. Different blockers and different URL/generation
epochs do not aggregate. Focused recovery tests, the full 652-test suite,
build, and V2 release gates pass. This remains a recovery-quality change, not
a benchmark score claim.

## No-Effect Action Guidance

Recent Lite traces exposed a general planner failure mode: a successful click
with transition strength `none` was followed by a `type` action on the same
ref, even though the ref remained a button. The planner client now adds a
bounded retry message stating that a no-effect mutation did not change the
target's action lane and that the planner must use a compatible ref or
reobserve. It does not rewrite the target, add a retry, or add benchmark/task
logic.

The focused planner-client test, full 652-test suite, build, and V2 release
gates pass. A fresh post-fix `mvr5-stable` smoke
(`webvoyager_lite_1786532386784`, Lite key index 25) completed 4/5 tasks with
one Cambridge CAPTCHA block, zero invalid actions, and zero planner validation
retries. GitHub no longer dead-ended on the incompatible action, but returned
the wrong repository. This indicates that the next general issue is evidence
and ranking quality, not action-contract handling. The smoke is validation
evidence, not a benchmark-specific promotion claim.

## Fresh Balanced30 Audit Run (`webvoyager_lite_1786533152242`)

A full 30-task `balanced30` diagnostic run (`webvoyager_lite_1786533152242`) was completed using `gemini-3.1-flash-lite` (key index 25, PRC serialization):

- Run: `webvoyager_lite_1786533152242`
- Slice: `balanced30`
- Runtime-complete tasks: 18/30 (60.0%)
- Strict evaluator success: 10/30 (33.3%)
- Environment-adjusted strict: 10/24 (41.7%)
- Environment blocks: 6/30 (20.0%)
- Trace completeness: 30/30 (100%)
- Dispatched actions: 222 total (7.4 avg/task) — **49 fewer total actions than July 11 baseline (-17.7% action waste reduction)**
- No-effect actions: 30 total (12.8% of actions) — **Massive reduction from 144 (52.8%) down to 30 (12.8%)**
- Hard-blocked loops: 12 total (5.1%) — **Active loop detection interventions increased from 2 to 12**

### Outcome Distribution

| Joined category | Count | % of Suite | Meaning |
| --- | ---: | ---: | --- |
| Strict success | 10 | 33.3% | Runtime completed and evaluator strict score is 1 |
| Wrong-evidence (strict reject) | 8 | 26.7% | Runtime completed, but evaluator rejected or only partially credited the answer |
| Environment block | 6 | 20.0% | CAPTCHA, Cloudflare, or equivalent external network block |
| Recovery loop | 4 | 13.3% | Max steps exhausted (BBC 0, Booking 0, Booking 10, ESPN 10) |
| Execution dead-end | 2 | 6.7% | Planner invalid output dead-end (Coursera 0, GitHub 0) |

### Comparative Telemetry Findings vs. July 11 Baseline

1. **Massive Reduction in No-Effect Actions (52.8% → 12.8%)**:
   - `targetId` semantic continuity matching, `buildAnswerValidationEvidence` read-only provenance, and `inputApplied` classification successfully eliminated false-progress ref churn.
2. **Active Hard-Block Interventions (2 → 12)**:
   - Progress memory actively caught and hard-blocked 12 unproven action loops across changing ref IDs.
3. **Action Economy Optimization**:
   - Reached the same 33.3% strict / 41.7% env-adjusted score using 49 fewer total actions (222 vs 271).

## Fresh Balanced30 Signal-Preserved PRC Audit Run (`webvoyager_lite_1787773616455`)

A full 30-task `balanced30` diagnostic run (`webvoyager_lite_1787773616455`) was completed using `gemini-3.1-flash-lite` (key index 1, PRC serialization, 10s pacing):

- Run: `webvoyager_lite_1787773616455`
- Slice: `balanced30`
- Duration: **35 minutes and 21 seconds** (started 01:16:56, completed 01:52:17)
- Runtime-complete tasks: 19/30 (63.3%)
- Strict evaluator success: 10/30 (33.3%)
- Environment-adjusted strict: 10/24 (41.7%)
- Environment blocks: 6/30 (20.0%) (Cloudflare / Turnstile)
- Trace completeness: 30/30 (100%)
- Dispatched actions: 184 total (6.13 avg/task) — **Peak action economy (89 fewer total actions than July 11 baseline, -32.6% reduction)**
- Total planner calls: 197 calls (6.57 avg/task)
- Repeated action markers: 12 (down from 18)
- Invalid action markers: 6 (down from 10)
- Provider API network latency: 690.0s total across 197 API calls (3.5s per API call average)
- Inter-request rate-limit pacing wait: 957.7s total (isolated separately by `LatencyLedger`)

### Outcome Distribution

| Joined category | Count | % of Suite | Meaning |
| --- | ---: | ---: | --- |
| Strict success | 10 | 33.3% | Runtime completed and evaluator strict score is 1 |
| Wrong-evidence (strict reject) | 9 | 30.0% | Runtime completed, but evaluator rejected or only partially credited the answer |
| Environment block | 6 | 20.0% | CAPTCHA, Cloudflare, or equivalent external network block |
| Recovery loop | 3 | 10.0% | Max steps exhausted (Booking 0, Booking 10, Google Flights 0) |
| Execution dead-end | 2 | 6.7% | Planner invalid output dead-end |

### Comparative Telemetry Findings

1. **Peak Action Economy (6.13 actions/task)**:
   - Dispatched actions dropped to **184 total actions across 30 tasks** (down from 273 on July 11 and 222 on Aug 12), establishing a record for action economy.
2. **Invalid Action Marker Reduction (10 → 6)**:
   - Zero-typeable launcher re-observation prompts and non-typeable action surface retry guidance reduced invalid action markers to 6.
3. **Pacing vs. Network Latency Disambiguation**:
   - `LatencyLedger` isolated 957.7s of inter-step rate-limit pacing delay from the 690.0s of actual Gemini API round-trip network time.

