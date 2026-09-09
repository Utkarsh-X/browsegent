# Correctness Bottleneck Audit — BrowseGent v2

**Date:** 2026-08-30
**Method:** Read-only. No code modified, no live/paid benchmark runs. Evidence from on-disk traces of 4 full `balanced30` runs + the Aug 27 baseline + two 5-task slices, source audit of `src/v2`, and mechanism research into two competitor codebases (`D:\agent-tools\browser-control` Rust; `browser_use` Python package in `D:\agent-tools\browser-use-local\.venv\Lib\site-packages`).
**Runs audited:** `webvoyager_lite_1788083614237` (newest, 26.7% strict), `1788077457042` (23.3%), `1788073716959` (23.3%), `1788041812580` (26.7%), baseline `1787773616455` (33.3%), slices `1788083293802`, `1788072339533`.
**Aggregation script:** `scratch/audit_failure_taxonomy.js` (read-only, reusable).

---

## 1. Structural result: the task-level landscape is stable

| Category | Count (of 30) | Runs |
| :--- | :--- | :--- |
| Strict pass in **every** run | 6 | Amazon__0, Apple__0, ESPN__0, GitHub__0, Google__Map__10, Wolfram__Alpha__0 |
| Fail in **every** run (incl. baseline) | ~14 | Booking__0/10, Google__Flights__0/10, Google__Search__0/10 (CAPTCHA), Cambridge Dictionary__0/10 (Cloudflare), Allrecipes__0/10 (Cloudflare), Apple__10, ArXiv__10, Coursera__0, GitHub__10, Google__Map__0, Huggingface__0/10, Wolfram__Alpha__10 |
| Coin-flip (flip between runs) | ~6 | Amazon__10, ArXiv__0, BBC__News__0/10, Coursera__10, ESPN__10 |

Run-to-run strict-score variance (23.3%↔33.3%) is dominated by the ~6 coin-flip tasks and env-block denominators — **not** by systemic flakiness. The improvement lever is the stable-fail core, especially the 8–9 tasks the agent *internally completes* but the evaluator rejects.

## 2. Failure taxonomy per run (aggregated from report.json + traces/*/action_outcomes.json)

| Metric | 1788083614237 | 1788077457042 | 1788073716959 | 1788041812580 | baseline 1787773616455 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Strict pass | 8 | 7 | 7 | 8 | 10 |
| Env block | 6 | 6 | 5 | 5 | 6 |
| Internal pass, eval reject (mismatch bucket) | 9 | 10 | 11 | 9 | 9 |
| Internal fail: `answer_contract_failed:missing_ranking_evidence` | 3 | 3 | 2 | 1 | 0 |
| Internal fail: `v2_max_steps_exhausted` | 3 | 4 | 5 | 7 | 5 |
| Failed action codes — `timeout` | 20 | 30 | 24 | 34 | 25 |
| Failed action codes — `target_blocked` | 19 | 13 | 19 | 20 | 6 |
| Failed action codes — `action_blocked_by_loop_detector` | 7 | 12 | 16 | 12 | 10 |
| Failed action codes — `input_not_applied` (new WIP) | 4 | — | — | — | — |
| `v2ref_` leaked into final answers | 3 | 2 | 2 | 1 | 1 |

## 3. Evidence table (exact paths / file:line)

| # | Finding | Evidence location |
| :-- | :--- | :--- |
| E1 | Ranking-gate misfire: goals containing `latest\|best\|most\|top\|newest\|oldest\|highest\|lowest\|largest\|smallest` become `ranked_entity` requiring ranking evidence | `src/v2/agent/AnswerContract.ts:31-33`, `:78-89`, `hasRankingEvidence` `:178+` |
| E2 | ESPN__10 was strict PASS in baseline; in every later run dies internally with `missing_ranking_evidence` (score-lookup goal, not a ranking pick) | `logs/webvoyager-lite/webvoyager_lite_1788083614237/report.json` (`failureReason: answer_contract_failed:missing_ranking_evidence`); baseline `webvoyager_lite_1787773616455/report.json` (strict=1) |
| E3 | Same gate blocks Apple__10 ("latest MacBook…") and Google__Flights__0 ("lowest price…") — attribute/specification goals, not ranking picks | newest run `report.json` internal-fail groups (§2) |
| E4 | Evaluator `exact` requires the **entire** reference embedded verbatim in the answer; `partial` on a `golden` reference can never pass strictly | `tests/benchmark/webvoyager/evaluator.ts:112`, `:146-149` |
| E5 | GitHub__10 false negative: answer contains "$100 USD per year" + the reference's own feature list; reference "$100 per year; Code completions…" — `USD` insertion breaks containment; official WebVoyager judge is an LLM (`D:\agent-tools\WebVoyager\evaluation\`) | newest run `report.json` value vs `webvoyager_evaluation.json` tasks[GitHub--10].referenceAnswer |
| E6 | Wrong-attribute/wrong-entity extraction, stable in ALL runs: Wolfram__Alpha__10 (declination 3.3°E vs asked total field 51.5 µT), Coursera__0 ("3D Printing Software" vs ref "Rapid Prototyping Using 3D Printing, Specialization"), Huggingface__0 (wrong model), Amazon__10 (generic Asurion tiers vs product-specific $30.99), ArXiv__10 (help-contact page vs user-page Delete/Unsubmit icons) | newest run `report.json` values + `webvoyager_evaluation.json` referenceAnswers |
| E7 | BBC News__0: 7 consecutive `target_blocked` clicks on 7 different refs (consent wall); planner received full blocker identity each time but never dismissed it | `…/traces/webvoyager_lite_1788083614237_webvoyager_BBC__News__0_a1/action_outcomes.json` steps 2–8; blocker identity already surfaced by `src/v2/substrate/InputService.ts:46-67` (`blockerDescription`, tag, class, `Dismiss the full-viewport overlay first.` hint) |
| E8 | Booking__0/10 fail in ALL 5 runs: multi-field form + sign-in overlay + step budget; Booking__0 terminal answer is a button label `"Dismiss sign in information. button"`; 3 `navigate` calls inside 12 steps | `…/webvoyager_lite_1788083614237_webvoyager_Booking__0_a1/action_outcomes.json`; `report.json` value |
| E9 | `input_not_applied` postcondition works end-to-end: fill reported success by Playwright but DOM value empty → thrown, surfaced, planner changes behavior (Booking__0 step 2 → navigate → step 9 different field) — but only catches **empty** retention, not partial/wrong retention | WIP `src/v2/substrate/InputService.ts:154-170`; outcomes in Booking__0/10 traces |
| E10 | `v2ref_N` leaks into user-facing answers: Amazon__0 (every run), Google__Flights__0, Huggingface__0, ArXiv__10 | `report.json` values across runs; `normalizeAnswerValue` (`src/v2/agent/V2AgentLoop.ts:1315-1330`) does not strip ref tokens |
| E11 | Benchmarks ran on a moving codebase: `evidenceSnapshot` present in 15 planner inputs of newest run, 6 of `1788077457042`; `input_not_applied` only in newest run | grep over `traces/*/planner/*-input.json` |
| E12 | Click `timeout` dominates failed actions (19–34/run, ~all clicks; 1,500ms Playwright timeouts in substrate) | `action_outcomes.json` per run; `src/v2/substrate/InputService.ts:77,109,139-142,184-192` |
| E13 | Successful mutation with zero observable effect is modest (click 1–2, type 9–14 legit field fills, press 0–5 per run) | `action_outcomes.json` summaries |

## 4. Ranked smoking-gun hypotheses (each with one minimal falsifiable experiment)

### S1 — The answer-contract ranking gate is a self-inflicted regression (highest confidence, cheapest fix)
**Claim:** requiring ranking evidence for every `latest|best|most|top|…` goal rejects correct answers on non-ranking lookups, burning steps until exhaustion or wrong answers.
**Impact:** 1–3 tasks/run (ESPN__10 was a baseline strict pass) ≈ +3–10 pp strict.
**Experiment (offline, free):** for every task in the 5 audited runs, re-run `validateAnswerAgainstContract` on the recorded final answer + goal, with the gate both enabled and disabled; count rejections of answers that scored strict=1 or partial>0 elsewhere. Falsified if no previously-passing answer is rejected.

### S2 — The strict evaluator is materially harsher than the official WebVoyager judge (measurement distortion)
**Claim:** containment+token matching (E4) under-credits correct verbose answers; some of the "wrong-evidence" bucket is measurement error, which also risks overfitting the agent to the matcher.
**Impact:** 1–3 tasks/run ≈ +3–10 pp *reported* strict (GitHub__10 every run).
**Experiment (offline):** dual-evaluate all final answers from the 5 runs with (a) current heuristic, (b) the official WebVoyager judge prompt (`D:\agent-tools\WebVoyager\evaluation\prompts.py`) run through a local judge model. Report the per-task delta matrix. Falsified if delta ≈ 0.

### S3 — "Correct page, wrong attribute/entity" extraction (the real intelligence gap)
**Claim:** the agent completes `done` when *any* plausible value is captured; nothing verifies that the extracted value carries the **attribute semantics** the goal names (total field vs declination; product-specific plan vs generic tiers; specialization vs course).
**Impact:** 5 stable tasks/run ≈ +16 pp ceiling (hardest lever).
**Experiment (offline, generic):** from each goal, deterministically derive the demanded attribute labels; replay each run's captured read evidence and test whether a minimal "attribute-label-present-in-read" check would have fired before `done` on the 5 wrong-extraction tasks — and would NOT fire on the 6 always-pass tasks (specificity check).

### S4 — Overlay/consent walls: the planner receives full blocker identity (E7) but doesn't convert it into dismissal
**Claim:** blocker identity + hint are already surfaced; the failure is in the planner/working-set loop connecting "blocker description" to the dismiss control (e.g., the dismiss button may be missing from the working set, or the hint isn't phrased as an actionable next step).
**Impact:** 2–4 tasks/run (BBC__News__0/10, Booking__0/10).
**Experiment (offline):** from all `target_blocked` events in the 5 runs, extract `blockerDescription`/hint from failure diagnostics and check whether a plausible dismiss control (matching the blocker's text/role) existed in the same observation's working set. Falsified if dismiss controls were present and the planner ignored them repeatedly (>3 misses across runs).

### S5 — Step budget vs multi-field form flows
**Claim:** early-break rules (break after any effective click/press) turn a 10-action form flow into 10+ planner iterations; Booking/Flights flows never finish inside the budget (E8). browser-use completes with multi-action chains.
**Impact:** 2–4 tasks/run.
**Experiment (offline):** replay Booking__0/10 + Google Flights__0/10 captured episodes; compute the minimal planner-iteration count for an ideal action sequence under current early-break rules vs a rule allowing same-view form sequences (type→type→select without transition). Falsified if iteration counts are similar.

### S6 — `v2ref_N` leakage into final answers (hygiene, trivial)
**Experiment:** grep all final answers across runs (done: 1–3/run, E10); strip `\(v2ref_\d+\)` (and future ref formats) in `normalizeAnswerValue`. Zero-risk.

### S7 — Type postcondition gap: partial/wrong retention passes
**Claim:** new gate only catches empty retention; a controlled input that reformats (adds commas, autocompletes) retains *something* ≠ requested. browser-use warns on `actual != typed` and auto-retries concatenation.
**Experiment:** local fixture with a reformatting input; assert current behavior, then decide warn-vs-fail. (Only after S1–S4.)

## 5. Competitor mechanism comparison (what actually matters for completion)

| Mechanism | BrowseGent v2 | browser-use (v0.9.x, pure CDP) | browser-control (Rust CLI) |
| :--- | :--- | :--- | :--- |
| Element identity | RefService fingerprints + soft/hard matching + targetId continuity | `backendNodeId` as index (stable), selector-map cache, soft "refresh state" on miss | attribute-stamped `data-browser-control-ref`, fail-fast |
| Stale-ref recovery | multi-candidate semantic re-resolution (strongest of the three) | none at action time (fails → fresh snapshot) | none (one re-observe doctrine in skill docs) |
| Waits/settle | StabilizationService + transition classification (strongest) | page-load + download detection only; no generic settle | opt-in `wait load/networkidle/element` primitives |
| Action verification | click: elementFromPoint pre-check + click verdict; type: **empty-retention only (new)**; select/press/checkbox: none | **type value read-back + auto-retry on concatenation; checkbox toggle read-back + JS fallback; select revert detection** | none (success = no exception) |
| Retry | loop detector + quarantine + recovery control plane | errors fed to LLM verbatim; 5-strike cap on step exceptions only | none (failure diagnostic rings) |
| Answer handling | in-loop AnswerContract + coverage gate (aggressive — see S1) | done schema guard + post-hoc judge that never overrides | skill-doc final-answer checklist + harness re-verification |

**Takeaways:** (1) The substrate gap is narrow and specific: browser-use's three post-action verifications (type-mismatch warning/auto-retry, checkbox read-back, select revert detection) are the only competitor mechanisms we lack — S7. (2) Neither competitor has an in-loop answer gate; our gate's regression risk (S1) is self-inflicted, not competitive pressure. (3) browser-use's `is_new` diff marker is a cheap planner signal worth considering later.

## 6. Mapping to BrowseGent architecture (no rewrite indicated)

- **S1, S2** → AnswerContract + benchmark evaluator (answer validation layer). Targeted scope fix + measurement fix.
- **S3** → EvidenceLedger + FinalizationEvidence (attribute-checklist extension of the existing coverage pipeline — the current WIP already moves in this direction for rankings).
- **S4** → planner prompt/working-set loop consuming existing `blocker*` diagnostics (data already flows; the *use* is the gap).
- **S5** → agent loop `shouldContinueMiniPlan` policy + step budgeting.
- **Brain1/Brain2/ContinuityGraph/EvidenceLedger/substrate core: sound.** No evidence of architectural inadequacy; all smoking guns live in policy/validation layers.

## 7. Recommended implementation order

0. **Pin the code revision into run metadata** (process fix; prevents the E11 confound from recurring).
1. **S6** — strip ref tokens from answers (trivial, zero-risk).
2. **S1** — offline rejection-count experiment, then narrow the ranking gate to goals that ask to *identify an item from alternatives* (keep `latest`-attribute lookups exempt). Generic rule change, no task IDs.
3. **S2** — dual-evaluation delta matrix with an official-prompt judge; then decide evaluator policy (report both scores).
4. **S4** — offline blocker→dismiss-control analysis; if confirmed, strengthen how blocker hints are consumed (planner feedback + working-set pinning of the dismiss control).
5. **S3** — attribute-checklist pre-`done` gate via EvidenceLedger, validated offline on captured reads with a specificity check.
6. **S5** — replay-based iteration-count estimate, then a flag-gated early-break relaxation for same-view form sequences.
7. **S7** — type postcondition mismatch warning/auto-clear (after the above).

Explicitly excluded: benchmark-specific selectors, task IDs, answer hardcoding, model-specific behavior, surface truncation by evidence status, global score flattening, cryptic DSLs, and any `src/v2` substrate rewrite.

## 8. Proven / uncertain / do-not-touch

**Proven (trace/code-backed):** §1–§2 taxonomy; E1–E10 as stated; `input_not_applied` end-to-end behavior; competitor absence of generic post-click verification; v2ref leak counts; moving-codebase confound.
**Uncertain (needs its experiment):** exact judge-parity delta (S2); how often blocker-dismiss controls were actually available (S4); ideal step budgets (S5); whether a generic attribute check can meet the specificity bar (S3); ArXiv__0 classification (drift vs harshness vs genuine).
**Do not change yet:** substrate ref/fingerprint system, StabilizationService, PRC representation (not the bottleneck per data), working-set scoring core, DeadStateDetector thresholds, mini-plan early-break semantics (until S5 experiment), the new `input_not_applied` gate (working; extend only in S7).

## Appendix — Prompts for the user's other agents

### A. Cheap/sub-agent prompt (information collection, no code changes)
```text
In D:\BrowseGent (read-only; do not modify any file under src/ or tests/):
1. Write scratch/eval_gate_replay.js: for each run in
   [webvoyager_lite_1788083614237, webvoyager_lite_1788077457042,
    webvoyager_lite_1788073716959, webvoyager_lite_1788041812580,
    webvoyager_lite_1787773616455] (under logs/webvoyager-lite/):
   load report.json; for every result, extract taskId, success, value, failureReason.
   Emit one JSON array to scratch/gate_replay_data.json:
   {run, taskId, goal, value, internalSuccess, strictScore}.
   Goals come from webvoyager_evaluation.json tasks[].originalQuestion (match via
   normalized id: lowercase alphanumerics only).
2. Then, using tsx, import { inferAnswerContract, validateAnswerAgainstContract }
   from src/v2/agent/AnswerContract and for each entry report
   validateAnswerAgainstContract(value, inferAnswerContract(goal), {evidenceText: value}).reasons
   with the ranking gate ON. Summarize: how many internally-successful answers get
   non-empty reasons, grouped by reason. Output scratch/gate_replay_summary.json
   plus a printed table. No other changes.
```

### B. Capable peer-agent prompt (independent verification + judge delta)
```text
Working in D:\BrowseGent. Goal: independently verify a correctness audit and run a
judge-parity measurement. Do not modify src/ or tests/; do not run live benchmarks;
do not launch browsers.
1. Reproduce the failure taxonomy of logs/webvoyager-lite runs
   {1788083614237, 1788077457042, 1788073716959, 1788041812580, 1787773616455}
   using report.json, webvoyager_evaluation.json and traces/<task>/action_outcomes.json:
   counts of env blocks, strict passes, internal-pass-but-eval-rejected, internal-fail
   groups, failed action codes, and v2ref leakage in final answers. Compare against
   progress-docs/2026-08-30-correctness-bottleneck-audit.md §2 and report any mismatch.
2. Judge-parity experiment: read the official WebVoyager evaluation prompt from
   D:\agent-tools\WebVoyager\evaluation\prompts.py. Build a script that evaluates every
   internally-successful final answer from those runs against its referenceAnswer using
   the configured local judge model (same access pattern as existing benchmark providers),
   and produce a per-task delta table: local heuristic verdict vs judge verdict.
   Summarize how many tasks flip, and which failure-mode bucket they came from.
3. Return: reproduction deltas, the flip matrix, and any evidence contradicting the
   audit's smoking guns (§4 of the audit doc).
```

---

## Appendix C — Empirical Replay Findings (Execution of Prompt A via `scratch/eval_gate_replay.ts`)

**Execution Date:** 2026-08-30  
**Scripts generated:** `scratch/eval_gate_replay.ts` / `scratch/eval_gate_replay.js`  
**Output datasets:** `scratch/gate_replay_data.json` (150 task results), `scratch/gate_replay_summary.json`  

### 1. Replay Summary Statistics

| Metric | Value |
| :--- | :--- |
| Total Runs Audited | 5 (`1788083614237`, `1788077457042`, `1788073716959`, `1788041812580`, `1787773616455`) |
| Total Task Results Evaluated | 150 (30 tasks × 5 runs) |
| Total Internally-Successful Answers | 88 |
| Internally-Successful Answers Failing Contract Gate | 6 (6.8% of internal passes) |
| Primary Failure Reason Category | `missing_ranking_evidence` (100% of contract rejections: 6/6) |

### 2. Per-Run Breakdown Table

| Run ID | Total Tasks | Internal Pass | Contract Rejection | Strict Pass (Eval) | Contract Failure Reason |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `webvoyager_lite_1788083614237` | 30 | 17 | 1 | 8 | `missing_ranking_evidence` (1) |
| `webvoyager_lite_1788077457042` | 30 | 17 | 1 | 7 | `missing_ranking_evidence` (1) |
| `webvoyager_lite_1788073716959` | 30 | 18 | 1 | 7 | `missing_ranking_evidence` (1) |
| `webvoyager_lite_1788041812580` | 30 | 17 | 1 | 8 | `missing_ranking_evidence` (1) |
| `webvoyager_lite_1787773616455` (baseline) | 30 | 19 | 2 | 10 | `missing_ranking_evidence` (2) |
| **Total** | **150** | **88** | **6** | **40** | **`missing_ranking_evidence` (6)** |

### 3. Detailed Affected Tasks (Internally-Successful Answers Rejected by Gate on Replay)

1. **`webvoyager_ArXiv__0` (Run `1787773616455` — Baseline Strict Pass = 1)**:
   - **Goal:** *"Search for the latest preprints about 'quantum computing'."*
   - **Inferred Contract:** `kind=ranked_entity`, `requiresRankingEvidence=true` (triggered by keyword `"latest"`)
   - **Gate Verdict:** Rejected (`missing_ranking_evidence`)
   - **Finding:** In the baseline run (before ranking gate was introduced), this task scored **strict=1** with accurate preprint extraction. Under current ranking contract, it is marked invalid because a search listing query was classified as a ranked comparison.
2. **`webvoyager_ArXiv__0` (Runs `1788083614237`, `1788077457042`, `1788073716959`, `1788041812580`)**:
   - **Goal:** *"Search for the latest preprints about 'quantum computing'."*
   - **Gate Verdict:** Rejected (`missing_ranking_evidence`) across all 4 runs.
3. **`webvoyager_Apple__10` (Run `1787773616455`)**:
   - **Goal:** *"Find information on the latest (as of today's date) MacBook model, including its key features such as processor type, memory size, and storage capacity."*
   - **Inferred Contract:** `kind=ranked_entity`, `requiresRankingEvidence=true` (triggered by keyword `"latest"`)
   - **Gate Verdict:** Rejected (`missing_ranking_evidence`)
   - **Finding:** A specification/attribute lookup goal is misclassified as requiring comparative ranking provenance.

### 4. Cross-Run In-Loop Contract Failure Audit

Beyond the 6 post-hoc replay rejections on internally-passed answers, the ranking gate actively blocked the agent *during live loop execution* in runs where the gate was active:
- **`ESPN__10`** (*"Check ESPN for the score and a brief recap of the latest college football championship game"*):
  - Baseline `1787773616455` (no ranking gate): **Strict Pass = 1 (100%)**
  - Later runs `1788083614237`, `1788077457042`, `1788073716959`: **Failed in-loop with `failureReason: answer_contract_failed:missing_ranking_evidence`**
- **`Apple__10`**: Failed in-loop with `failureReason: answer_contract_failed:missing_ranking_evidence` across all 4 active runs.
- **`Google__Flights__0`**: Failed in-loop with `failureReason: answer_contract_failed:missing_ranking_evidence` in runs `1788083614237` and `1788077457042`.

**Conclusion:** Hypothesis S1 is empirically confirmed. Broad keyword triggering (`latest`, `most`, `lowest`) forces comparative ranking validation onto lookups and listings, rejecting previously-passing answers.

