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
