# Parallel Work Protocol — 2026-09-03 (three concurrent agents)

## Current system state (read first)

Branch `feat/openrouter-stealth-benchmark`. Head includes Surface Horizon
Awareness (commit: `feat(planner): add surface horizon awareness ...`): horizon
detection/annotation, target-value promotion, GP long-horizon lineage with
stale/selected states, blocker-persistence recovery prior, lang/box substrate
passthroughs. Gates: 878/878 unit, tsc clean, check:v2 clean.

Evidence base: 10 single-task probes today (Booking--0/Booking--10) +
historical runs under `logs/webvoyager-lite/<run_id>/` (report.json, traces/
with planner inputs/outputs, observations, failures, action_outcomes.json).
Design + evidence lineage: `progress-docs/2026-09-03-surface-horizon-awareness.md`,
`progress-docs/2026-09-03-booking10-forensic-report.md`,
`progress-docs/flash-lite-runs-comparison.md`.

A FULL balanced30 run is in flight (key-index 1, PRC) — its result is the net
effect measurement. Do NOT launch full slices; single-task probes only.

## Ownership boundaries (hard, to avoid conflicts)

| Area | Owner |
|------|-------|
| `src/v2/planner/**` (incl. GoalProgressTracker, HorizonDetector, DateLabelMatcher, PRC, PromptLayoutEngine, PlannerPrompt, selector) | Agent 1 (horizon/planner) |
| `src/v2/tools/**`, `V2ToolDispatcher`, Stage-2 seek macro, `V2AgentLoop.ts` | Agent 1 |
| `src/v2/substrate/ObservationService.ts`, `ProjectionService`, brain1 | Agent 1 |
| `src/v2/agent/AnswerContract.ts`, `AnswerGrounding.ts`, `EvidenceLedger.ts`, `TaskEvidenceCoverage.ts` + tests | Agent A (answer fidelity) |
| `src/v2/substrate/InputService.ts`, `KeyboardService.ts`, `RefResolver.ts` + tests | Agent B (input fidelity) |
| `tests/benchmark/webvoyager/evaluator*`, judge/scoring fidelity | RESEARCH-ONLY for all agents until main agent approves a change |

Everyone: read freely everywhere; write ONLY inside your ownership list.
Benchmark probes: `--task-ids "Task--N"` (double dash), `--key-index` 4 or 5
only (1-3 reserved for Agent 1's runs), `--request-min-interval-ms 10000`,
`--planner-serialization prc`. Never edit code another agent owns; if a fix
needs it, write the finding into `progress-docs/` and hand it over.

## Shared invariants (non-negotiable)

- No task IDs, site names, selectors, answer hardcoding, or model-specific
  behavior. Generic mechanisms only, with tests including an overfitting
  firewall (behavior byte-identical for goals/pages the mechanism shouldn't
  touch).
- Never fabricate success: no ungrounded done, no evaluator loosening to score
  higher. Honest escalate > fake pass.
- Gates before claiming done: `npm run test:unit` (all green), `npx tsc --noEmit`,
  `npm run check:v2`.
- Trace-backed evidence for every claimed failure: run id + episode + file path.

## Strategic insight from the 5-run comparison (2026-09-03, run webvoyager_lite_1788398756906)

Across five balanced30 runs: browsegent at 70% internal (Run 4, S1 temporal fix) and the
browser-control Rust substrate at 100% internal (Run 6, 17.6K input tokens/task) scored
IDENTICAL strict scores (33.33%). Completion is not the ceiling — the terminal answer
layer is. Two corollaries:
- Agent A (answer fidelity) owns the strict-score ceiling; the Run-4 S1 fix already
  showed the largest single jump (56.67 -> 70.00 internal).
- Agent B (input fidelity) owns the internal-completion gap (60-70% vs the Rust
  substrate's 100%): truthful typing, post-condition verification, and overlay
  recovery are the difference.
Also: 2 of 30 tasks flipped PASS->FAIL between Run 5 and the Sep 3 run; both were
environment-attributable (BBC__News__0: 9 timeout/target_blocked steps, horizon
machinery never engaged; Google__Flights__10: step-2 target_blocked). Sep 3 avg input
tokens rose to 51.2K/task (+5% vs Run 5) partly from the GP/HORIZON blocks — acceptable
if seek adoption lands (it collapses N planner calls into one); revisit if not.

## Judge results (2026-09-04, offline rejudge of run webvoyager_lite_1788470846884)

Official-methodology judge over the 7 internal-passed strict-0 tasks:
4 SUCCESS (ArXiv__0, Coursera__0, GitHub__10, Huggingface__10 — stale-reference
artifacts), 3 NOT_SUCCESS. Full-run judge score 14/30 (46.7%) vs string strict
10/30 (33.3%). The judge honestly rejected Booking__0's answer: "the agent
provided a set of instructions on how a user could perform the search
themselves" — the done-delegation pattern. Agent A: validate the landed
answer contract against that exact answer text (run webvoyager_lite_1788470846884,
webvoyager_Booking__0 final value); it must be rejected as NOT SUCCESS-grade.
Judge fields are additive; strict scores untouched. Re-run any existing run
offline via: npx tsx scripts/webvoyager_rejudge.ts <runDir>.

## Audit response (2026-09-04, runs 9/10 + browser-control comparison)

- Judge evidence bug fixed (e621823); runs 9/10 re-judged with real page evidence — both land at 13/30 (43.3%) official total. Full audit: flash-lite-runs-comparison.md §5.
- Agent A action item still open: validate the landed answer contract rejects the run 8 Booking__0 delegation answer. Note the failure class now also includes **suggestion-surface answers** (run 10 Booking__0 named hotels while the final page still showed the search form; Coursera__0 answered from search suggestions). If the answer-contract work can add a generic "final answer must be grounded in captured read evidence, not suggestion surfaces" check, that is the highest-value next contribution.
- Answer hygiene (ref-token stripping + evaluator leak flag) landed in d876adf; captcha_wall in-denominator scoring in 36cee29. Compact data plane measured larger than verbose — do not use for benchmark runs until redesigned.
