# A5 Extraction-Miss Autopsy — Did the Done-Candidate Checklist Convert Fabrication (A2) into Honest Extraction Misses (A5)?

**Date:** 2026-09-09 · **Corpus:** runs 25–27 (balanced30) + run 28 (`webvoyager_lite_1788885672207`, context) · **Method:** artifacts only — planner episode inputs/outputs, observation JSONs, `webvoyager_evaluation.json`, `webvoyager_artifacts.json`. No live browsing, no benchmark runs, evaluator untouched. Scripts/caches in `%TEMP%\browsegent-a5\` (`census.mjs`, `judge_check.mjs`, `dc_fires.mjs`, `run28_check.mjs`, `timing.mjs`, `steps.mjs`, `plan26.mjs`, `census.json`, `census_out.txt`). Only worktree write: this file. All task identifiers are internal evidence tracking only; recommendations are generic.

---

## 1. Verdict on the hypothesis: **REFUTED** — no fabrication was converted; the checklist caught an *ungrounded draft* and converted it to an honest non-answer. A5 (strict definition) shrank to 0 in runs 25–27, but the *honest-miss class* is real and broader than A5.

### 1.1 What actually happened on `Wolfram__Alpha__10` (run 27 vs run 26)

Run 27 trajectory (`logs/webvoyager-lite/webvoyager_lite_1788760183386/traces/webvoyager_lite_1788760183386_webvoyager_Wolfram__Alpha__10_a1/`):

| episode | obs | plan/output |
|---|---|---|
| ep1 (`episode_1_obs_1_1-output.json`) | obs_1_1 (homepage, 423 refs) | type `v2ref_49` "geomagnetic field in Oslo on June 20, 2023" + click `v2ref_50` |
| ep2 | obs_1_2 | click `v2ref_50` (no-op; click already executed in ep1's plan) |
| ep3 | obs_1_3 (results URL, 89 refs) | press Enter |
| ep4 | obs_1_4 (195 refs, pod titles present) | **done: "…approximately 0.505 gauss"** (`episode_4_obs_1_4-output.json`) |
| ep5 | obs_1_4 | **done: "…approximately 0.506 gauss"** (`episode_5_obs_1_4-output.json`) |
| `episode_done_candidate_obs_1_4-output.json` | obs_1_4 | **done: "…is not explicitly provided in the current Wolfram|Alpha output, which instead displays the magnetic declination and magnetic dip…"** |

- **No read or search of the results surface was ever issued** (steps: type → click → press only, `trace.json`). The only numeric evidence in any observation is box coordinates; the pod value (51.5 µT / 0.5xx gauss) appears in **no observation and no planner input** in either run (grep sweeps of all observation JSONs + planner inputs; hits are only `"box":{"x":5.0x…}` coordinate noise).
- **The done-candidate re-ask fired** (`workingSet.mode: "done_candidate"` confirmed in `planner/episode_done_candidate_obs_1_4-input.json`; no `answerFeedback` episodes; fbN=0).
- **What the model cited for "not provided":** the re-ask input's `answerFeedback` block told it the previous answer "did not satisfy the answer contract" and to "Continue gathering evidence or return done only when all missing details are answered" (`missingDetails: ["requirements_unaddressed:dates_not_entered"]`). Faced with an unreadable evidence plane (pod titles + "Show gauss"/"Show DMS" buttons only), the model re-answered honestly that the value is absent and named what the capture actually shows.

### 1.2 Run 26 "winning" provenance — and why the streak was never a capture win

Run 26 (`webvoyager_lite_1788729313820`, same task):
- Steps identical to run 27 (type → click → press; **no read, no scroll**, `trace.json`).
- Ep4 done: **0.505 gauss**; ep5 re-affirmed 0.505 (`planner/episode_4_obs_1_4-output.json`, `episode_5_obs_1_4-output.json`). The value appears in **no captured surface** — it is a model-side prior-knowledge draft, not an extraction.
- The run-26 judge reason (`webvoyager_evaluation.json` verdict for `webvoyager_Wolfram__Alpha__10`) states the final page "does not explicitly display the numerical result (it shows the buttons to 'Show gauss')" and passes the task *because* "51.5 uT (the reference hint value) is equivalent to 0.515 gauss. The agent's answer of 0.505 gauss is extremely close… scientifically accurate."
- **Conclusion: the "8-run winning streak" was never a prose-capture extraction win** (contradicting the run-21/24 report claims of "D1 prose capture extracted 51.5 µT"); it was a *correct-ish prior-knowledge guess* (0.505 gauss vs the true 0.515) blessed by a lenient judge. Verified cross-run: run-24's value links (`+51.5 microteslas`, `+15.1 microteslas`, `+1.18 microteslas`, `+49.2 microteslas` as readable refs) appear **only in obs_1_5 after an explicit scroll step** (obs_1_4 refs=89 → obs_1_5 refs=231; `observations/obs_1_5.json`), while runs 26/27/28's terminal observations (195–231 refs) never contain them.

### 1.3 Counts: the done-candidate checklist regime

Run 27 fires: 22 re-asks across 22 tasks (every internally-completing task except `Booking__10`; run-27 report's 22 re-ask calls ≈ 83,294 cached tokens). Outcomes (per `dc_fires.mjs` sweep of `planner/` dirs + `webvoyager_artifacts.json` finals):
- **1 honest-absence flip** — `Wolfram__Alpha__10` (0.505/0.506 gauss draft → "not explicitly provided"). Judge: NOT_SUCCESS ("failed to extract the pod value"). The correct behavior; the wrong outcome — it should have prompted a read, not accepted absence.
- **2 no-change flips on failing answers** — `Huggingface__0` ("no models matching March 2023" re-asserted), `ESPN__10` (wrong-sport answer re-asserted). Both judge NOT_SUCCESS.
- **19 near-carbon-copy re-asks** (e.g., `Amazon__0`, `Apple__0`, `Coursera__0`, `Wolfram__Alpha__0` byte-similar) + a few compressions (`ArXiv__0` dropped per-paper titles for a bare arXiv-ID list; `BBC__News__10` "current headlines do not feature…"). 9 judged passes, 0 strict regressions (9/30 both runs).

**Net effect:** +1 honest escalation, −1 lucky-prior pass, ±0 strict. Combined 18/30 in both runs. **The checklist did not convert fabrication into extraction misses — it converted *one lucky ungrounded guess* into an honest (but unsupported) absence report.** That is integrity-positive and score-neutral-to-negative *only because no capture/read machinery ever surfaced the value to answer from*.

### 1.4 A5 refresh census (runs 25–27) — hypothesis test Q3

Census population: judged NOT_SUCCESS ∧ internalPassed, runs 25/26/27 → 17 tasks (5/6/6). Token-level sweep of every reference-answer numeric token and judge-named entity against every captured observation and every planner input (scripts `census.mjs`, `judge_check.mjs`; coordinate-context regex excluded `box`/`x`/`y`/`width`/`height`/`refId`/`nthRoleName` false positives):

| run | census tasks | golden value present in captures, absent from answer (strict A5) | judge-named alternative entity present in captures, absent from answer (stale-golden A5) |
|---|---|---|---|
| 25 | 5 (`ArXiv__0`, `ArXiv__10`, `BBC__News__0`, `Google__Map__0`, `Huggingface__0`) | **0** | 0 (both ArXiv judge tokens are goal-text echoes; `Map__0` judge-named salons are the model's own answer entities) |
| 26 | 6 (`Allrecipes__10`, `Amazon__10`, `BBC__News__0`, `GitHub__10`, `Google__Map__0`, `Google__Search__10`) | **0** | 0 (judge-named tokens are the model's own fabricated/wrong entities — `Chicken Kiev`, `Individual`, `no. 1` — i.e., ungrounded, not missed) |
| 27 | 6 (`Allrecipes__10`, `Amazon__10`, `ESPN__10`, `Google__Map__0`, `Huggingface__0`, `Wolfram__Alpha__10`) | **0** | **1** — `Huggingface__0`: `finiteautomata/beto-headlines-sentiment-analysis`, `juliensimon/reviews-sentiment-analysis`, `Mar 28, 2023`, `Mar 23` all present in `observations/obs_1_9.json` (9 occurrences; result-card `name`/`text`, `header`, `h4` nodes) but in **no planner input** (compact plane pruned them) and absent from the final answer |

**Strict-A5 grew 0 → 0 → 0: refuted.** Under the *capture-grounded* lens, run 27 holds **exactly one case** (class a: value on a captured surface the model demonstrably reached — `obs_1_9` was its terminal observation — but the compact working-set plane never rendered it into any planner input). This is **not a checklist effect**: the identical case exists in run 25 (`Huggingface__0`, judge names the same model row; `obs_1_5/1_9`-family captures contain it; same zero planner-input presence). The checklist-era delta is the WA10 *honest-miss* flip (§1.1), which is a *new failure mode* (honest absence over an unreadable capture), not A5.

### 1.5 A5 case classes (Q4)

| run | task | class | evidence path (trace-backed) |
|---|---|---|---|
| 25 | `Huggingface__0` | **(a)** value in a captured surface the model reached but ignored (compact-plane blind spot) | `traces/…_webvoyager_Huggingface__0_a1/observations/obs_1_5.json`, `obs_1_9.json` (match-model row captured); `planner/episode_finalization_obs_1_10-input.json` et al. contain zero occurrences; judge names `finiteautomata/beto-headlines-sentiment-analysis` (`webvoyager_evaluation.json`) |
| 27 | `Huggingface__0` | **(a)** same blind spot, checklist era | `traces/…_webvoyager_Huggingface__0_a1/observations/obs_1_9.json` (9 occurrences incl. `h4` result-card nodes); `planner/episode_6_obs_1_9-input.json` + `episode_done_candidate_obs_1_9-input.json` contain zero occurrences; answer re-asserted "no models matching" |
| 27 | `Wolfram__Alpha__10` | **(b)+(c) hybrid** — value on page but below the capture filter (rendered as non-text image nodes, zero-alt `img`), *and* no read/search was ever issued to surface it | `observations/obs_1_4.json` (pod titles + `Show gauss`/`Show DMS` buttons only; zero-alt `img` at v2ref_468/v2ref_563); `planner/episode_done_candidate_obs_1_4-input.json` (`mode: done_candidate`); run-24 contrast: values appear only post-scroll (`…_1788244732279…/observations/obs_1_5.json`) |
| 25–27 | all other 15 census tasks | **(c)/(d)** — value reachable only via an unissued action (never captured), or ungrounded answers where no golden token was ever present (incl. stale-golden strict-misses that are judge-unreachable anyway) | `census_out.txt` (0 genuine token hits per task); `all_runs_join.csv` rows (judge reasons quote the agent's own ungrounded entities) |

No class-(d) pure wording-mismatch cases found in runs 25–27 census.

---

## 2. Run-26 vs run-27 divergence analysis (Q2) — with run 28 as the tiebreaker

- **Byte-parallel until the done path**: both runs' steps are type → click → press (`trace.json` in both trace dirs); episode plans identical; no read/scroll/search in either.
- **The divergence point is a single planner call**: run 27's `episode_done_candidate_obs_1_4` re-ask (mode `done_candidate`, +3,382 prompt bytes over ep5's input: 18,010 vs 15,793 bytes, `providerPayload.attempts[0]`) which enforced claim-source against an evidence plane that never contained the value. Run 26 had no such call, so the 0.505 draft shipped.
- **Run 28 tiebreaker** (`webvoyager_lite_1788885672207`, `--prc-page-model --prc-delta-surface`, checklist still on): WA10 drafted **0.506 → 3°17' + dip → 3°25'** across three done-shaped calls (`episode_5/6/done_candidate_obs_1_5-output.json`) and shipped 0.512 gauss (delta-pruning noise across re-renders). The judge passed it ("0.512 gauss… aligning closely with the reference hint of 51.5 µT"). **The value is still absent from every observation** (sweep: only pod titles + `Show gauss` buttons in `observations/obs_1_5.json`). Run 28's WA10 "rebound victory" is **the same ungrounded-draft class as run 26**, now with *three* drifting drafts and a lucky judge. **Run 28's headline does not close the D1 question — the capture plane still never surfaces the pod value.**
- **Interpretation:** the done-candidate checklist does exactly what it was designed to do (enforce claim-source); the failure is upstream — the evidence plane starves it. The same enforcement that broke run-26's lucky guess would *fire correctly* if a read ever surfaced the value; the missing piece is the read itself.

---

## 3. Recommendation memo (no code; generic mechanisms, byte-identical off-path, must-not-regress anchors)

Ranked by (expected judged conversions per balanced30 run) ÷ (risk × effort). All are flag-gated, default-off, byte-identical when off (verifiable via existing `providerPayload.systemBytes/userBytes` telemetry); all preserve the escalate-honestly exit; all gate only at `extract`/`verify`/`done_candidate` working-set modes.

### R1 — Advisory "captured-surface value-candidate exists but is unanswered" check (rank 1)
- **Mechanism:** at the done-acceptance point (and only in `extract`/`verify`/`done_candidate` modes), mechanically compare the candidate answer against the *full observation text layer* (not just the compact working set): if the observation layer contains salient value-like tokens (numeric+unit patterns, dates, named entities) that (i) do not appear in the answer and (ii) co-occur with a goal-contract keyword (from the existing `inferAnswerContract` families), emit a one-line advisory in the re-ask input: *"captured evidence contains candidate values not present in the answer; answer from evidence or escalate honestly."* Advisory steer-once, hard-capped, recorded in `advisoryNotes`.
- **Targets:** the class-(a) blind spot (`Huggingface__0` ×2) and any class-(a) recurrence; also helps class-(c) by making the starvation *visible* instead of silently answered around.
- **Expected yield:** 1–2 judged conversions/run (the HF0 family alone is 1/run in 25+27; the goal-contract keyword gate keeps it off ~95% of tasks).
- **Must-not-regress anchors:** all current strict passes byte-identical (advisory never mutates answers, only appends re-ask input text when fired); `Wolfram__Alpha__0` strict (its "2x = 11.2" answer contains the goal keyword but the observation-token co-occurrence gate must not fire on calculator-style tasks — require observation-layer token, not model-computed token); combined ≥ run-27's 18/30 − 2; judged-approval count not lower than baseline −1; escalation rate unchanged ±3 (integrity guard); steer-once cap verified from `advisoryNotes`.
- **Off-path byte-identity:** flag off → no token scan, no re-ask input suffix, no extra call (same as run-26's byte profile).

### R2 — Read nudge when checklist verification fails on extract/verify modes (rank 2)
- **Mechanism:** when a done-candidate re-ask downgrades or rejects the previous draft (the exact WA10 signal: draft withdrawn, absence asserted, or `answerFeedback.missingDetails` non-empty on the re-ask) **and** the terminal observation contains ≥1 readable/inspectable ref whose text matches the goal-contract keyword family, append one advisory line to the *next* planner input: *"verification could not confirm the answer from captured evidence; if a readable element on the current surface may contain the value, inspect it before answering or escalating."* The nudge rides existing finalization/working-set plumbing (no new call); it fires at most once per task.
- **Targets:** the WA10 honest-miss class (b)+(c) hybrid — the re-ask already knows the draft was unsupported; the nudge converts "honest absence" into "one read attempt before absence."
- **Expected yield:** 0.5–1 conversions/run (this exact case recurs every run under the checklist regime; run-24 proved a single extra interaction surfaces the value links).
- **Must-not-regress anchors:** strict passes unchanged (advisory-only, no answer mutation); `Allrecipes__3` 4-run judged streak (its honest-absence answer must remain shippable — the nudge is advisory, never a block); calls/task ±0.4 (zero added calls by construction); escalation-honesty preserved (the compliant exits remain answer-from-evidence **or** escalate).
- **Off-path byte-identity:** flag off → no nudge text, no scan.

### R3 — D1 prose-capture prioritization (rank 3 — highest ceiling, highest risk, needs its own blueprint)
- **Mechanism:** extend the capture plane so values rendered as non-interactive/non-text nodes (zero-alt images, canvas, non-accessible-value spans) inside result-pod containers are *additionally* represented via an OCR/alt-text/vision side-channel attached to the pod's section ref (bounded, budget-capped), or prioritize the D1 prose layer for pod-family sections (title + value node + unit toggle in one prose block).
- **Targets:** the class-(b) root cause for the entire recurring family (the value has never been captured in runs 26–28; run-24's scroll-dependent link refs show the content *does* render as text when given interaction+time).
- **Expected yield:** converts the whole recurring cluster deterministically (1 judged task/run + strict-side robustness) but only after the capture-plane work lands.
- **Must-not-regress anchors:** strict passes byte-identical when flag off; when on, `providerPayload` byte deltas bounded (the compact plane must not balloon — run 28's −20.1% input-token win must be preserved within guard bands); planner-input size diagnostics (`sizeDiagnostics.totalPlannerInputBytes`) within +10% of baseline.
- **Off-path byte-identity:** flag off → capture plane unchanged.

### R4 — Stabilize draft drift across re-asks (rank 4, hygiene)
- **Mechanism:** pin the accepted done-candidate answer byte-exactly when the re-ask makes no claim-source violation finding (today run 28 shipped the *third* draft — 0.512 — while the re-ask produced a fourth variant, 3°25'); expose a `draftStable: true/false` diagnostic so downstream analysis can distinguish "checklist approved" from "checklist rewrote."
- **Expected yield:** no judged points; prevents noise like run 28's 0.506→3°17'→3°25' drift from masquerading as extraction.
- **Must-not-regress anchors:** strict passes unchanged; answer byte-stability on all strict-pass tasks (the 19 carbon-copy re-asks in run 27 are the reference behavior).

**Explicitly rejected:** hard-gating done answers on claim-source findings (run 27's shipped-final-is-re-ask-output behavior — `GitHub__10` shipped the checklist-rewritten answer claiming "$15/mo ($180/yr)" for the wrong tier vs the main-loop's "$10/mo ($120/yr)" — shows re-ask outputs can *introduce* new ungrounded claims; a hard gate would multiply this), and any read *requirement* (would violate escalation honesty when surfaces are genuinely empty).

---

## 4. Answers to the brief's five questions (condensed)

1. **Run-27 autopsy (§1.1):** zero reads/searches of the results surface; the pod value appears in no observation and no read output; the done-candidate re-ask fired (`mode: done_candidate`, fbN=0); the model cited the capture's actual contents (pod titles + `Show gauss`/`Show DMS` buttons) for "not provided."
2. **Run-26 provenance (§1.2):** the winning 0.505 gauss came from **no captured surface** — model-side prior knowledge; the divergence step in run 27 is the `episode_done_candidate_obs_1_4` re-ask.
3. **A5 refresh (§1.4):** strict A5 = 0 in runs 25, 26, and 27 (no growth); one capture-grounded A5-equivalent exists in run 27 (class a, `Huggingface__0`) and the identical case exists in run 25 — not a checklist effect.
4. **Classes (§1.5):** 1×(a) in run 27 (+1 in run 25), 1×(b)+(c) hybrid (WA10), rest (c)/(d).
5. **Recommendations (§3):** R1 captured-surface value-candidate advisory > R2 verification-failure read nudge > R3 D1 prose-capture prioritization > R4 draft-stability pinning; all generic, flag-gated, byte-identical off-path, with must-not-regress anchors as listed.

---

## 5. Sources (run id + task + episode + file path)

- Run 27 `webvoyager_lite_1788760183386`: `traces/webvoyager_lite_1788760183386_webvoyager_Wolfram__Alpha__10_a1/` — `trace.json` (3 steps), `planner/episode_{1..5}_obs_1_*-output.json` (drafts 0.505/0.506 gauss), `planner/episode_done_candidate_obs_1_4-{input,output}.json` (mode `done_candidate`; honest-absence final), `observations/obs_1_{1..4}.json` (prose 2→5 items; pod titles; zero-alt `img` refs; no value tokens), `webvoyager_evaluation.json` (WA10 judge NOT_SUCCESS reason), `webvoyager_artifacts.json` (shipped finals incl. `GitHub__10` re-ask-output case).
- Run 27 `…_webvoyager_Huggingface__0_a1/`: `observations/obs_1_5.json`, `obs_1_9.json` (match-model rows captured, 9 occurrences incl. `h4` cards), `planner/episode_6_obs_1_9-input.json` + `episode_done_candidate_obs_1_9-input.json` (zero occurrences), `episode_{1..6}_obs_1_*-output.json` ("no models" trajectory).
- Run 26 `webvoyager_lite_1788729313820`: `traces/…_webvoyager_Wolfram__Alpha__10_a1/trace.json` (identical 3 steps), `planner/episode_{4,5}_obs_1_4-output.json` (0.505 gauss from no capture), `webvoyager_evaluation.json` (judge SUCCESS citing µT→gauss conversion of the reference hint).
- Run 25 `webvoyager_lite_1788723829378`: `webvoyager_evaluation.json` (5 census verdicts; HF0 judge reason), trace dirs per `webvoyager_artifacts.json`.
- Run 24 `webvoyager_lite_1788244732279` (mechanism contrast): `traces/…_webvoyager_Wolfram__Alpha__10_a1/trace.json` (4 steps incl. `scroll`), `observations/obs_1_4.json` (89 refs, no values) vs `observations/obs_1_5.json` (231 refs; `+51.5 microteslas`/`+15.1`/`+1.18`/`+49.2 microteslas` readable link refs), `planner/episode_3_obs_1_4-output.json` (scroll plan), `episode_4_obs_1_5-output.json` (µT answer from captured links).
- Run 28 `webvoyager_lite_1788885672207` (context): `traces/…_webvoyager_Wolfram__Alpha__10_a1/` — `trace.json` (4 type/click steps), `planner/episode_{5,6}_obs_1_5-output.json` + `episode_done_candidate_obs_1_5-output.json` (draft drift 0.506 → 3°17'+dip → 3°25'), `observations/obs_1_5.json` (no value tokens), `webvoyager_evaluation.json` (judge SUCCESS on 0.512 gauss).
- Cross-run token sweeps: `%TEMP%\browsegent-a5\census_out.txt`, `census.json`, `dc_fires.mjs` output, `run28_check.mjs` output; prior art `progress-docs/answer-fidelity-analysis/all_runs_join.csv` (rows for `webvoyager_lite_1788244732279`, `1788073716959`, `1788091487187` — declination/dip answers, judge rejects for missing total intensity), `progress-docs/research/navigation-grounding-divergence.md` §"Wolfram__Alpha__10" (composite-measurement goal contract), `progress-docs/flash-lite-runs-comparison.md` (run-28 section; historical prose-capture claims now contradicted by artifacts).
- Prior census: `progress-docs/research/answer-quality-round1.md` (A1–A9 definitions; A5 ×5 population; answer-feedback recovery rates; integrity constraints).
