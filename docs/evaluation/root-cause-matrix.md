# BrowseGent MVR Root-Cause Matrix

Date: 2026-05-29

This matrix is primarily based on the existing 30-task WebVoyager-lite reports in:

- `C:\Users\Utkarsh\Downloads\browsegent_benchmark_report.md`
- `C:\Users\Utkarsh\Downloads\browseruse_benchmark_report.md`
- Adjacent local `logs/webvoyager-lite/<runId>/webvoyager_evaluation.json` artifacts

A later fixed 5-task `mvr5` BrowseGent run, `logs/webvoyager-lite/webvoyager_lite_1779994103138`, failed before agent execution because Playwright navigation returned `net::ERR_NETWORK_ACCESS_DENIED` for all five public sites. That run is environment evidence only, not planner-quality evidence.

## Scoring Snapshot

| System | Adapter pass | Strict WebVoyager score | Manual-review cases | Dominant observed failure |
| --- | ---: | ---: | ---: | --- |
| BrowseGent | 2/30 | 0/30 | 2/30 | Provider quota from large prompt payloads |
| Browser Use local | 13/30 | 1/30 | 12/30 | Runtime/zero-step crashes and timeouts |

Adapter pass is not benchmark correctness. Strict WebVoyager score is currently reference-match based, so manual-review cases must remain visible instead of being silently counted as wins.

## Failure-Class Matrix

| Failure class | BrowseGent evidence | Browser Use local evidence | Engineering interpretation | Immediate action |
| --- | --- | --- | --- | --- |
| Quota/API | 17/30 BrowseGent rows are `rate_limited`; top input-token rows reach 523,923, 389,899, and 270,874 reported input tokens. | Not the dominant reported failure. Token data is missing for most failed Browser Use rows. | BrowseGent is frequently hitting provider limits before planner quality can be measured. | Keep provider pacing/accounting/guards; do not hide this as planner failure. |
| Adapter/runtime | 4/30 BrowseGent rows are `runtime_crash`. | 17/30 Browser Use rows are `runtime_crash`, many with 0 steps. | Competitor comparison is distorted if runtime startup failures are treated as agent reasoning failures. | Keep adapter runtime failure as its own class; harden adapter lifecycle before claims. |
| Evaluator weakness | BrowseGent has 2 adapter passes but 0 strict passes. | Browser Use has 13 adapter passes but 1 strict pass and 12 manual-review cases. | Current exact/reference evaluator is too brittle for dynamic answers and cannot be the only quality signal. | Report adapter, strict, and manual-review scores separately. |
| Observation/projection bloat | High input-token rows appear after only 2-7 planner calls, indicating excessive per-call payload size. | Not measured deeply enough for failed rows. | BrowseGent likely sends oversized observation/projection/planner inputs. This is an architecture issue, not API optimization. | Add diagnostics for trace artifact size, planner input size, observation size, and payload maxima. |
| Planner decision failure | 5/30 BrowseGent rows are `planning_error`; some have 0 or 1 planner call, so causes may include early planner failure or missing evidence. | Browser Use failures are mostly runtime, not planner-classified. | Planner issues exist but are currently mixed with quota/runtime/evaluator noise. | Inspect traces after diagnostics classify failed/repeated/invalid actions. |
| Invalid/repeated actions | Current reports do not expose repeated action or invalid target markers. | Current reports do not expose repeated action or invalid target markers. | We cannot yet tell whether loops or stale targets are major failure drivers. | Add generic action diagnostics from traces. |
| Captcha/stealth/environment | BrowseGent has 2/30 `environment_block`, both Allrecipes. | Report summary labels Allrecipes as site blocking/timeout, but rows classify as runtime. | Environment blocks must not be optimized around with task-specific hacks. | Track separately and exclude only by predeclared policy, not after seeing failures. |
| Timeout | Present inside runtime/planning symptoms but not isolated consistently. | Dominant Browser Use runtime symptom includes 180s timeouts. | Timeout needs explicit classification because it affects fairness and resource cost. | Preserve timeout as runtime/adapter evidence until deeper logs prove agent cause. |

## BrowseGent High-Payload Evidence

| Task | Failure class | Planner calls | Tool executions | Reported input tokens |
| --- | --- | ---: | ---: | ---: |
| ArXiv--0 | rate_limited | 7 | 6 | 523,923 |
| Apple--0 | rate_limited | 2 | 1 | 389,899 |
| ArXiv--10 | rate_limited | 5 | 4 | 270,874 |
| Google Map--10 | adapter pass, strict fail | 12 | 12 | 249,897 |
| Huggingface--10 | rate_limited | 3 | 2 | 240,807 |

The highest-leverage BrowseGent investigation is therefore payload flow: observation -> projection -> planner input -> provider call. This must be measured before any compression or prompt changes.

Trace diagnostics from existing local artifacts confirm the payload path. These numbers were collected from already-written `trace.json` artifacts; no new benchmark was run.

| Run | Trace | Max observation | Max planner input | Max projection section | Max readables section | Max interactions section | Repeated/invalid actions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ArXiv--0 | 65,984 B | 168,432 B | 272,753 B | 170,636 B | 57,891 B | 59,480 B | 0/0 |
| Apple--0 | 47,935 B | 623,884 B | 889,324 B | 696,441 B | 275,509 B | 321,277 B | 0/0 |
| ArXiv--10 | 33,438 B | 205,341 B | 286,059 B | 181,953 B | 68,665 B | 74,222 B | 0/2 |
| Google Map--10 | 71,662 B | 173,758 B | 168,468 B | 103,498 B | 43,444 B | 57,761 B | 1/0 |

Original code evidence: `ObservationService` captures normalized but unbounded DOM `textContent`, `ProjectionService` forwards all refs into interaction/readable/navigation views, and the previous `serializeProjection` shape repeated full item facts across each view. Capping or compressing this would change planner evidence quality, so it is an architectural improvement and should not be hidden inside provider/API optimization.

Implemented safe lossless reduction: `serializeProjection` now omits item `text` only when it duplicates `name` after whitespace/case normalization. The accessible name remains available to the planner, so this removes duplicated evidence without capping, summarizing, or changing task semantics.

Estimated impact from existing high-payload planner-input artifacts:

| Task | Planner inputs inspected | Before | After | Saved |
| --- | ---: | ---: | ---: | ---: |
| ArXiv--0 | 7 | 1,904,564 B | 1,697,791 B | 206,773 B (10.9%) |
| Apple--0 | 2 | 1,547,336 B | 1,236,065 B | 311,271 B (20.1%) |
| ArXiv--10 | 5 | 1,129,910 B | 995,845 B | 134,065 B (11.9%) |
| Google Map--10 | 12 | 733,032 B | 685,675 B | 47,357 B (6.5%) |

This does not solve the full payload problem. It only removes duplicated projection evidence. Any text-length cap, readable ranking cap, or region summarization still requires a separate architectural design and quality tests.

Projection overlap diagnostics from the same existing trace artifacts show that a large number of refs are repeated across `interactions`, `readables`, and `navigation` sections in the same planner input:

| Task | Planner inputs inspected | Max refs repeated across 2+ sections | Max interaction/readable overlap | Max interaction/navigation overlap | Max readable/navigation overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| ArXiv--0 | 7 | 297 | 293 | 259 | 255 |
| Apple--0 | 2 | 554 | 545 | 326 | 317 |
| ArXiv--10 | 5 | 346 | 346 | 259 | 255 |
| Google Map--10 | 12 | 235 | 235 | 7 | 7 |

This is evidence for future projection-shaping work, not permission to silently dedupe sections. Cross-section dedupe would change the planner contract because the same ref can carry different meaning as an actionable control, readable evidence, or navigation candidate. It needs an explicit architecture design and tests that preserve answer-bearing and control-bearing refs.

Implemented first architectural payload fix: serialized planner projections now store full ref facts once in `current.refs` and keep `interactions`, `readables`, and `navigation` as lightweight ranked ref lists. This preserves the semantic views while removing structural duplication. The view cost-benefit decision is:

| View | Keep now? | Reason |
| --- | --- | --- |
| `refs` | Yes | Canonical source of ref facts; removes repeated full objects across views. |
| `interactions` | Yes | Planner needs an affordance-first action index; also drives empty-interaction uncertainty. |
| `readables` | Yes | Planner needs a read/evidence index distinct from controls; removing it would force semantic search over all refs. |
| `navigation` | Yes, lightweight | Useful route-changing subset; after canonicalization the marginal token cost is low. |
| `regions` | Yes | Required for repeated-list evidence and `inspect_region` region alias mapping. |

Do not remove views until a later controlled comparison proves they reduce quality or still consume material cost after canonicalization. Do not add text caps or summarization until preservation tests exist for answer-bearing and control-bearing refs.

Estimated impact from existing high-payload planner-input artifacts, replayed through the canonical shape without running a new benchmark:

| Task | Planner inputs inspected | Previous pretty JSON size | Estimated canonical size | Estimated saved |
| --- | ---: | ---: | ---: | ---: |
| ArXiv--0 | 7 | 1,904,557 B | 1,044,845 B | 859,712 B (45.1%) |
| Apple--0 | 2 | 1,547,334 B | 841,750 B | 705,584 B (45.6%) |
| ArXiv--10 | 5 | 1,129,905 B | 668,570 B | 461,335 B (40.8%) |
| Google Map--10 | 12 | 733,020 B | 589,145 B | 143,875 B (19.6%) |

These estimates are structural serialization estimates from old trace artifacts, not benchmark results. They should reduce provider pressure, but quality still needs the fixed 5-task comparison before any performance claim.

Benchmark key handling update: the local `.env` currently exposes 61 Gemini-compatible key entries. The benchmark runner now rotates Gemini keys per task attempt and records only `keyIndex` and env-name metadata in reports. It does not persist raw key material.

## Fixed 5-Task Next Verification Slice

Use this slice for the next small WebVoyager-lite verification run only after measurement and adapter stabilization improve:

| Task | Why included |
| --- | --- |
| Allrecipes--3 | Captures environment/site-blocking behavior. |
| ArXiv--0 | Highest observed BrowseGent payload/quota pressure. |
| GitHub--0 | Browser Use strict pass baseline; useful public-web extraction task. |
| Google Map--10 | BrowseGent adapter pass but strict mismatch; useful evaluator/answer-quality case. |
| Wolfram Alpha--0 | Simple answer task with BrowseGent planning error and Browser Use runtime failure. |

This slice is fixed before improvement work to reduce benchmark-tuning risk. It is not a training set and must not receive task-specific logic.

Runner support:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 12 --key-index 1
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browser-use-local --request-rpm 12 --key-index 11
```

Use different `--key-index` start offsets when running systems back-to-back so each task attempt gets a fresh key and the two systems do not immediately reuse the same five keys. The runner wraps around if the sequence exceeds the key-pool size.

Do not use `--count 5` for the next competitor comparison because that selects the first five tasks from the balanced 30-task list, not this predeclared representative slice.

## Current Governance Decision

Proceed in this order:

1. Stabilize measurement and diagnostics.
2. Classify failures from traces using general labels.
3. Fix only the highest-leverage verified general failure class.
4. Verify with unit/type checks and a small 5-task slice only when needed.
5. Keep the full 30-task comparison paused until the 5-task run is stable and explainable.
