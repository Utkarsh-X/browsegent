# Terminal Answer Quality — Round 1: The Judge-Conversion Audit

**Date:** 2026-09-07 · **Corpus:** runs 18–25 (8 balanced30 runs) + fresh50-stable, browser-control run 6 as contrast only. **Method:** artifacts only — `webvoyager_evaluation.{md,json}` verdicts + judge reasons, `planner/episode_*-output.json` done answers, `observations/obs_*.json` final-page content, goal text. No live browsing, no sub-agents. The extraction script and all intermediate caches live in `%TEMP%\browsegent-aq\` (`extract.mjs`, `dossier.json`, `runtable.json`, `summary.tsv`, `fin.json`, `run6.json`); the corpus was not written to; the evaluator was not touched; the only worktree artifact is this report.

---

## 0. Population math (measured, not assumed)

Census definition: internally-completed tasks scoring 0 combined = `internalPassed ∧ strictScore=0 ∧ judgeScore=0`, or `internalPassed` with no judge pass available. Per-run verdict-channel distribution, extracted from each run's `webvoyager_evaluation.json`:

| run | ts | tasks | int=1 | strict pass | judged | judge pass | census (int=1, strict=0, judge=0) | unjudged int-pass | combined solved |
| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: |
| 18 | 1788634111591 | 30 | 19 | 11 | 8 | 4 | 4 | 0 | 15/30 |
| 19 | 1788680381229 | 30 | 20 | 7 | 13 | 6 | 7 | 0 | 13/30 |
| 20 | 1788683438066 | 30 | 23 | 12 | 11 | 6 | 5 | 0 | 18/30 |
| 21 | 1788685822038 | 30 | 22 | 9 | 13 | 5 | 8 | 0 | 14/30 |
| 22 | 1788689024341 | 30 | 20 | 7 | 13 | 6 | 7 | 0 | 13/30 |
| 23 | 1788703918678 | 30 | 17 | 7 | 10 | 4 | 6 | 0 | 11/30 |
| 24 | 1788718289231 | 30 | 24 | 12 | 12 | 6 | 6 | 0 | 18/30 |
| 25 | 1788723829378 | 30 | 22 | 9 | 13 | 8 | 5 | 0 | 17/30 |
| fresh50 | 1788550095257 | 50 | 24 | 7 | 17 | 9 | 8 | 0 | 16/50 |
| **total** | | **260** | **191** | | **110** | **54** | **56** | **0** | |

- The "no judge pass available" branch is **empty in practice**: every strict-failing internally-completed task in all nine runs was judged (`unjudged int-pass = 0` everywhere). The census is exactly 56 tasks (48 across the balanced30 runs, 8 in fresh50).
- Judge rejection share of judged pools is stable across runs: 27–62% (run 25's 5/13 is the best; run 21's 8/13 the worst). The brief's "same shape" claim holds.
- **A8 is structurally excluded from this census.** Terminal-kind × internal-pass tally across all 9 runs: `escalate|int=0` = **67**, `escalate|int=1` = **0**. Every escalation is scored int=0, so an escalation — honest or not — never reaches the judge channel and cannot appear as a judge-rejected answer. See §2.3 for what this does to the ledger-composition design family.

---

## 1. The rejection census

### 1.1 Headline table (primary-cause classification, 56 tasks)

| class | definition (refined) | count | per-run spread (18→25, fresh50) | fixability |
| :-- | :-- | --: | :-- | :-- |
| **A1** multi-part incompleteness | answer covers fewer details than the goal requests (item count, detail categories) | **9** | 0,0,1,1,1,1,1,1 · 3 | browsing (values behind unperformed actions); mechanically detectable |
| **A2** ungrounded claim | a stated fact does not appear on any captured surface/read — incl. prior-knowledge overrides and unverified superlatives | **25** | 3,3,2,4,3,3,3,3 · 1 | **split: 14 answer-side convertible, 11 browsing-rooted** |
| **A3** delegation phrasing | answer narrates an action / gives human instructions instead of delivering the value | **6** | 0,1,1,1,2,0,0,0 · 1 | phrasing is answer-side, but all 6 also lacked the value → browsing |
| **A4** wrong locale/unit/format | right shape of answer, wrong language/currency | **2** | 0,1,0,0,0,0,0,0 · 1 | language: answer-side detectable; currency: browsing (locale) |
| **A5** extraction miss | the correct fact WAS on a captured surface the agent reached but never entered the answer (closest-ref selection, prose gate, "no match" assertion) | **5** | 0,0,0,0,0,2,1,1 · 1 | **answer-side convertible (highest confidence)** |
| **A6** stale/contradicted fact | answer matches an earlier page state superseded by the final page | **0** | — | — |
| **A7** content drift | live page changed under the golden answer (strict-miss-only; judge would pass) | **0 primary** (4 census tasks carry A7 *context*, see §1.5) | — | judge-channel only |
| **A8** escalation-bound | honest escalation where evidence existed to answer | **0 — structural** (all 67 escalations are int=0; census excludes them by definition) | — | n/a (see §2.3) |
| **A9** other | premature give-up reported honestly (4), math error (1), vague not-found conclusions (2), locale-stuck honest reports counted in A9 not A4 (2 of the 4 give-ups double as locale failures) | **9** | 1,2,1,2,1,0,1,0 · 1 | browsing ×8, reasoning ×1 |

Per-run matrix (columns = A1/A2/A3/A4/A5/A9, census total, combined, theoretical ceiling §1.5):

| run | A1 | A2 | A3 | A4 | A5 | A9 | census | combined | ceiling |
| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 18 | 0 | 3 | 0 | 0 | 0 | 1 | 4 | 15/30 | 18/30 |
| 19 | 0 | 3 | 1 | 1 | 0 | 2 | 7 | 13/30 | 18/30 |
| 20 | 1 | 2 | 1 | 0 | 0 | 1 | 5 | 18/30 | 22/30 |
| 21 | 1 | 4 | 1 | 0 | 0 | 2 | 8 | 14/30 | 20/30 |
| 22 | 1 | 3 | 2 | 0 | 0 | 1 | 7 | 13/30 | 19/30 |
| 23 | 1 | 3 | 0 | 0 | 2 | 0 | 6 | 11/30 | 17/30 |
| 24 | 1 | 3 | 0 | 0 | 1 | 1 | 6 | 18/30 | 23/30 |
| 25 | 1 | 3 | 0 | 0 | 1 | 0 | 5 | 17/30 | 22/30 |
| fresh50 | 3 | 1 | 1 | 1 | 1 | 1 | 8 | 16/50 | 23/50 |
| **total** | **9** | **25** | **6** | **2** | **5** | **9** | **56** | | |

**Are classes stable?** Yes — with one caveat. A2 is present in every run (2–4 per run) and is dominated by *recurring identical task clusters*, not one-offs: `GitHub__10` (6 runs, byte-similar "Copilot Individual $10/mo + 2,000 completions" answers) and `ArXiv__10` (6 runs, "withdraw option" answers) fail the same way every single time. A1 recurs at exactly 1/run on balanced30 (driven by the `Google__Map__0` cluster in 6 of 8 runs) and 3× on fresh50. A3 is 1–2/run through run 22 then disappears. The fresh50 taxonomy (§6 of the comparison doc, class 2 = 8 judge-rejected answers) cross-walks cleanly onto this scheme: 3×A1, 1×A2, 1×A3, 1×A4, 1×A5, 1×A9 — the one new class the seed didn't predict is the A9 math error (`Wolfram__Alpha__15`).

### 1.2 A2 — ungrounded claim (25; the dominant class)

Sub-split (decided per-task from golden-token hits across all captured observations + read previews — see appendix):

- **Answer-side convertible (14):** the correct value is already in captured evidence; the answer was composed from prior knowledge or the wrong captured entity instead.
  - `GitHub__10` ×6 (runs 18,19,20,21,22,23) — answer asserts "Copilot Individual $10/mo, $120/yr, 2,000 completions/mo"; the captured table shows 2,000 completions as the **Free** tier's limits and no "Individual" plan (Pro-era naming); judge rejects the same claim every run. The pricing table itself was read (`obs_1_5/1_6` snippets captured). Golden ($100/yr annual) is only reachable by answering **from the captured table**.
  - `ArXiv__10` ×6 (runs 19,20,21,22,24,25) — answer prescribes the 'withdraw' option; the captured help page and Reference Hint both say delete/unsubmit for unannounced submissions, and the page text itself was captured (`publicly available` hits). Prior knowledge overrode the read.
  - `Apple__10` (run 21) — answer claims "MacBook Air … **M3** chip" while the final surface shows M5 chips with exact memory/storage rows (16GB/1TB, 24GB/512GB) never entered. *Re-derived from final-page observations; the judge reason was vague on what the page actually showed.* (Golden itself says M3 — a live-drift context; only the judge channel is winnable, which is what combined needs.)
  - `BBC__News__0` (run 25) — answer is a bare URL (`…c5y21111111o`) that appears on **no captured surface** (fabricated article id); real renewable-energy headlines *were* captured (`obs_1_5/1_6`). *Re-derived.*
- **Browsing-rooted (11):** the needed fact never entered any captured surface, so no answer-side mechanism can convert:
  - `GitHub__0` ×4 (18,19,21,23) — "AgroSphere has the most stars (20)": no star *ordering* was ever captured (the golden repo row itself was captured on `obs_1_6/1_7` in run 18, but without counts a superlative is unverifiable). This is the documented sort/verification-compliance failure family.
  - `ArXiv__0` ×2 (22,25) — presents cosmology preprints as the latest "quantum computing" results; the QC search never produced QC results. Both tasks show 9 answer-feedback rejections (`fbN=9`) — the loop burned without the search ever being fixed.
  - `Allrecipes__10` ×2 (23,24) — "second recipe is Beef Wellington, 1 hr 10 mins" from a session whose captured pages never contained the 1960s collection.
  - `Google__Search__10` (24) — "10 most played songs" list the judge assessed as generated; the Taylor Swift chart row *was* captured (`obs_2_4/2_5`) but no song list ever was. *Re-derived.*
  - `GitHub__18` (fresh50) — "lovell/sharp 32,630 stars" with final page = GitHub nav menu (seed-confirmed ungrounded).

### 1.3 A1 — multi-part incompleteness (9)

- `Google__Map__0` ×6 (20,21,22,23,24,25) — goal requests 5 salons rated **greater than** 4.8; answers deliver 3–5 items that repeatedly include a 4.8 or a 4.7 (boundary misread of ">") and omit a 5.0 salon visible in the final evidence (run 20, judge: "the Final Page Evidence actually contains 'Lady Neptune Hair Salon' with a rating of 5.0, which the agent missed"). Run 25's answer even self-reports the two failing entries and ships anyway.
- `ESPN__15` (fresh50) — 1 of 5 Christmas-day scores (a headline catch); the other four needed the scoreboard page (goal: "Check the scores of the NBA games played on December 25, 2023").
- `Coursera__19` (fresh50) — 1 of 3 requested details (institution only; instructor + specific hours missing; judge: "did not actually click into the course page").
- `GitHub__3` (fresh50) — compared Team-vs-Free instead of Enterprise-vs-Team; the golden '48GB' appears on no captured surface.
- `Booking__0` (run 21) — hotel named, but the requested December 25–26 availability/deals absent ("the current search interface is displaying results for September/October").

Every A1 conversion needs an action the agent didn't take (scroll/filter, open course page, open scoreboard) — answer-layer machinery can *detect* the gap (goal says a count or category; answer has fewer) but cannot *fill* it.

### 1.4 A3 / A4 / A5 / A9

- **A3 (6):** `Apple__0` ×4 (19,20,21,22 — byte-identical meta-commentary "the comparison page does not display prices directly. To find the prices… one must navigate…"; judge: Buy links were accessible) · `Booking__0` (22 — explicit how-to-for-humans instructions; judge: "providing instructions instead of the requested result is not a success") · `Google__Flights__19` (fresh50 — "please click on the date '25' to view the flight details", seed-confirmed). All six additionally lacked the value itself → phrasing repair alone converts none of them; the phrasing defect *masks* an escalation-honesty defect (the agent shipped narration instead of either fetching or escalating).
- **A4 (2):** `Booking__0` (19) — the entire answer is composed in **Hindi with ₹ prices** (India-locale session poisoning the output language; goal is English). *Re-derived; the judge never even mentioned the language.* · `Amazon__24` (fresh50) — price delivered as INR 4,007–4,720 against the goal's $100 USD frame (seed-confirmed).
- **A5 (5):** the judge literally points at the missed fact every time — `Allrecipes__3` (23: "a recipe that was clearly present in the provided evidence", matching card with 72 ratings on the final page, 10 answer-feedback rejections never shook the "no recipes meet the criteria" claim) · `Huggingface__0` ×3 (23, 25: "no models matching" while the judge names the matching March-2023 model in the final evidence; 24: answered the ayameRushia model whose dataset updated Feb 3 for a March window while the golden model row `mrm8488/distilroberta…` was captured on `obs_1_4/1_5` — *re-derived*) · `Apple__12` (fresh50: listed service-page titles instead of the repair *ways* the page enumerates; 'Apple Authorized Service Provider' captured on `obs_1_2/1_3`, golden = any 2 of the five ways — *re-derived*).
- **A9 (9):** premature-give-up honest reports where the judge shows the surface was still workable — `Google__Flights__0` ×4 (18,19,20,24: stuck on Lucknow-locale flights page), `Booking__10` (19: India instead of Paris), `Google__Map__0` (21: "do not currently display five salons" while the Rating filter was on the final page), `Amazon__10` ×2 (21,22: "not explicitly listed as a single price" while the price was one tier-click away; golden $30.99). Plus **the census's only reasoning failure**: `Wolfram__Alpha__15` (fresh50) — blood-relation fraction 1/8 vs the correct 1/32; grounding was fine, the arithmetic wasn't.

### 1.5 Strict-fixable vs judge-fixable vs browsing-fixable; ceilings

- **Strict-fixable: essentially none of the census.** The strict channel compares against golden strings that are stale for exactly the census's recurring clusters (golden M3 vs live M5 on `Apple__10`; golden salon list ≠ live salons on `Map__0`; golden $100/yr vs live Pro-only pricing on `GitHub__10`; golden Taylor Swift on `Search__10`). Corrected answers convert the **judge channel**, which is precisely what combined needs — strict anchors stay untouched (what the guard matrix wants anyway).
- **A7-as-context inside the census:** `Apple__10`, `Map__0` ×6, `Search__10`, `GitHub__3` carry live-drift contexts (strict unreachable regardless); their ceiling contribution assumes judge conversion only. No census task's *primary* failure is A7 — pure content-drift tasks pass the judge by construction and never enter this census.
- **Theoretical combined-score ceiling if every A1–A6 instance converted:**
  - **run-25 composition: 17 + 5 = 22/30 (73.3%)** — census A1×1 + A2×3 + A5×5-classes all convert, A9×0 (run 25 has none).
  - **fresh50: 16 + 7 = 23/50 (46%)** — all census except the `Wolfram__Alpha__15` A9 math error.
  - Balanced30 average ceiling ≈ **19.9/30** (159/8) vs current average 14.9/30 — the census is worth ~5 points/run, of which **~3.4 points/run (19 of 56, §1.2/§1.4 split) is answer-side convertible without any new browsing**. That is the honest "cheapest points" number — not the full 5.

---

## 2. The conversion design

### 2.0 Measured baselines every design must survive

1. **A static final-check already exists and didn't prevent this census.** The fixed planner head has carried "Before returning done, make sure the answer covers all requested multiple details…" (multi-detail checklist) on every call of every run 18–25 — yet A1 ×9 and the `Map__0` boundary errors persisted. Static-head guidance has the program's weakest engagement record: budget guidance 2/88 (the cautionary tale), HORIZON 0/11 pre-seek-fix (the hopeful one), and the documented analogs (HORIZON 3/200 in the static era; recovery guidance rendered but overruled on 11/13 BBC episodes).
2. **Finalization-mode compliance is 36/54 — one third of finalization calls ignore the mode entirely.** The 54 `episode_finalization_*` calls in runs 18–25 (the brief's "32 finalization + done_candidate calls": measured populations are 54 total calls, 36 of which returned a done answer; `done_candidate` mode itself has **0 occurrences** in runs 18–25 — the mode is typed and checked in `PlannerPrompt.ts` but nothing produces it yet). The 18 non-done finalization calls returned raw browser plans, tripping `finalization_attempted_plan` ("finalization mode cannot return a plan, only done or escalate"). Mode instructions are respected only ~2/3 of the time even when they're the whole job of the call.
3. **The advisory answer-feedback loop converts less than half of the tasks it touches.** 39 tasks received 108 `answerFeedback` re-prompts across the 9 runs; 13 later reached a judged pass, **16 stayed rejected and form the census tail** (with rejection-loop burns: `Allrecipes__3` fbN=10, `ArXiv__0` fbN=9, `Map__0` fbN up to 6). Steer-once works when the missing detail is fetchable or was a phrasing slip; it fails exactly on A5 (the model re-asserts "no match" over the evidence) and A1 (the detail can't be named without an action).
4. **71% of census answers never pass through finalization.** 16/56 census answers were composed by a finalization call; 40/56 came from the main-loop done path. A verification checklist that only rides `extract/verify/done_candidate` finalization modes would see a minority of the failure population.

### 2.1 D1 — Done-candidate verification checklist (prompt-tail block) — **round-2 centerpiece**

**Design.** Wire the already-specified but never-produced `done_candidate` mode at the answer-acceptance point: when the loop is about to accept a `done` — **both** the main-loop done proposal (where 71% of census answers originate) and the finalization composition — re-render one planner call with `workingSet.mode='done_candidate'` and a compact (~250 B) checklist tail whose items are conditioned on the goal contract and the validation evidence:

1. **item-count:** the goal states a count ("5", "both", "all N") — does the answer text actually contain ≥N enumerated items? (mechanical pre-check can attach the count).
2. **claim-source:** every distinct fact in the answer must be quotable from the current validation evidence (final-surface evidence + read history — the same text `buildAnswerValidationEvidence` already assembles). Anything not quotable gets re-answered from evidence or honestly escalated.
3. **value-vs-narration:** if the answer contains delegation/imperative phrasing ("click on… for details", "you should navigate…"), replace it with the value or escalate.
4. **language:** answer language must match the goal language.

**Semantics: advisory steer-once, hard-capped** — one checklist re-ask per task, verdict recorded in `advisoryNotes`; the `fbN=10` loops are the reason the cap is non-negotiable (integrity constraint: escalate stays honest; the checklist may only *surface* evidence that exists, never pressure the planner to answer without it — item 2 explicitly offers "escalate honestly" as the compliant exit).

**Projected conversions × confidence:** A5 ×5 at high confidence (the fact is on the final evidence; claim-source check names it — the `Allrecipes__3`/`Huggingface__0` families are the exact "re-assert absence over present evidence" failure) + A2-answer-side ×14 at ~30–40% (prior-knowledge override is responsive to evidence-attached re-asks, per the 13/39 answer-feedback recovery record) ≈ **5–8 conversions per balanced30 run**. Risk: +1 planner call on the done path (calls/task +0.2–0.3, inside the ±0.4 guard); rejection-burn contained by the cap. Flag: `--done-candidate-checklist`, off-path byte-identity (flag off → no extra call, no byte change).

### 2.2 D2 — Answer-contract extensions (mechanical, advisory, zero extra calls)

Extend `inferAnswerContract` with three answer-vs-goal checkable families, all advisory steer-once (established `a32c1b5`/`6497311` partition: steer once → accept with `advisoryNotes`; long-standing hard checks untouched):

- **stated-count check:** goal text contains an explicit count ("five", "5", "both") → answer must contain ≥N items (enumeration delimiters). Targets A1's checkable half (`ESPN__15`, `Map__0` ×6, `Coursera__19` partially via existing detail-category checks from `f1cb064` — extend, don't duplicate).
- **goal-language guard:** answer script/language ≠ goal language (Devanagari/CJK range check against an English goal is deterministic). Targets the `Booking__0` Hindi answer.
- **currency guard:** goal names $/USD and the answer carries ₹/€/£ → advisory flag. Targets `Amazon__24`, secondary on `Flights__19`/`Booking__0`. (Honest conversion of the currency itself needs the locale fix — the guard's job is to make the mismatch *visible once* rather than shipped silently.)
- **delegation-phrase detector:** second-person/imperative narration ("click on…", "you should", "navigate to… for details") → advisory. Targets A3's form; per §1.4 it converts nothing alone — its value is forcing the choice the judge actually wants: fetch the value, or escalate honestly.

Projected: ~4–6 census-touching detections per balanced30 run at **high confidence** (mechanical), **minimal risk** (no extra calls, no bytes unless fired). Flag: `--answer-contract-v2`.

### 2.3 D3 — Ledger-to-answer composition (repositioned)

Measured reality: **A8 = 0 in the census.** All 67 escalations across the nine runs are int=0 — escalation-bound episodes never reach the judge channel, so no ledger-surfacing mechanism can convert census points by "rescuing" escalations. Moreover the ledger already feeds finalization: `buildAnswerValidationEvidence` prefers `evidenceLedger.buildValidationEvidenceText()` when present, and `buildFinalizationEvidence` embeds the read history into the finalization prompt — yet the 16 finalization-composed census answers still failed on *selection* (composing the wrong entity from present evidence). **Verdict: defer to the W3 CLAIMS section / world-model stage-3 placement contract** (surface matched ledger cards at finalize time there; do not duplicate). Direct census conversions projected: 0. Integrity note: honest escalation is never weakened — surfacing evidence that exists is compliant; pressuring the planner away from escalate is not, and nothing in this family does.

### 2.4 D4 — Grounding phrasing rules (A2/A3): which layer wins

The measured compliance history is decisive against prompt-layer rules as a standalone: static-head guidance = budget 2/88, horizon 0/11, and the static multi-detail checklist that coexisted with all 56 census answers; conditional tail guidance fires reliably only when a salient runtime signal forces it (recovery states render, but were still overruled 11/13 on BBC).

- **A2 → answer-layer.** "Never state what you have not read" as a head rule is a 2/88-class rule. The evidence-attached form (D1's claim-source item, rendered on the done-candidate re-ask with the validation verdict in view) is the variant with a measured chance: the 13/39 answer-feedback recovery rate shows the model *does* respond when the rejection names the gap.
- **A3 → answer-layer detection, prompt-layer one-liner.** The detector (D2) surfaces the narration pattern once; a single tail line "answer with the value, never narrate next steps" rides the same re-ask (no standalone flag).

### 2.5 Ranked shortlist by (conversions × confidence) ÷ risk

| rank | design | census population addressed | projected conversions / balanced30 | confidence | risk | flag |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | D2 answer-contract v2 (count, language, currency, delegation) | A1-checkable + A4 + A3-form | ~4–6 detections; ~2–4 conversions | high (mechanical) | minimal | `--answer-contract-v2` |
| 2 | D1 done-candidate checklist (steer-once) | A5 ×5 + A2-answer-side ×14 (+A1/A3 residue) | ~5–8 | medium-high | low-moderate (+1 call on done path) | `--done-candidate-checklist` |
| 3 | D4 phrasing rule (only as D1's lead line) | A2/A3 form | folded into #2 | — | none | (no standalone flag) |
| 4 | D3 ledger composition | none in census | 0 direct | — | — | defer to W3 / world-model stage 3 |

**Round-2 gate:** execute D1 + D2 behind flags in one balanced30 A/B; fold in the perception/AX-oracle verdicts when they land. The ~11 A2-browsing + 9 A1/A3/A9 browsing-rooted tasks are **out of scope for round 2** — they belong to the browsing/stealth/seek machinery lines, not the answer layer (they are documented here so nobody re-derives them).

---

## 3. Integrity constraints honored & A/B plan

- The evaluator was never touched; no corpus file was written; scripts/caches stayed in `%TEMP%\browsegent-aq\`; no sub-agents used.
- **No task IDs, site names, or URL patterns in shipped guidance** — D1's checklist and D2's checks are generic (count-from-goal, language-match, currency-symbol, delegation patterns, claim-source). All task identifiers in this report are for program-internal evidence tracking only.
- **Honest escalation untouched:** every design either surfaces evidence that exists (claim-source names the captured fact) or detects a form defect; none pressures the planner away from escalate when evidence is genuinely absent. D1 item 2's compliant exits are "re-answer from evidence" **or** "escalate honestly".
- **Flag-gated with off-path byte-identity:** both flags default off → identical planner bytes (verifiable from existing `providerPayload.systemBytes/userBytes` telemetry); `done_candidate` fires one extra call only on the done path when the flag is on.
- **A/B plan: one balanced30 run** with the guard matrix — strict anchors (strict within −2 of the run-25 9/30 anchor; the known floor is 10/30), combined band (≥ run-25's 17/30 − 2), **calls/task ±0.4**, judged-count parity, escalation rate unchanged (±3 vs baseline — the honesty guard), and steer-once cap verified from `advisoryNotes` telemetry.

---

## Appendix A — Full census (56 tasks, primary class + one-line evidence)

| run | task | class | evidence line |
| :-- | :-- | :-- | :-- |
| 18 | Amazon__10 | A2 | answered "$200–$249.99" — the plan-tier *bucket label* captured on a tier page, never a price; judge: no product page in evidence |
| 18 | GitHub__0 | A2 | "AgroSphere most stars (20)" — no star ordering captured anywhere; unverified superlative from nav-surface reads |
| 18 | GitHub__10 | A2 | "Individual $10/mo, 2,000 completions" — 2,000 completions captured as Free-tier limits; no Individual tier on the captured table |
| 18 | Google__Flights__0 | A9 | honest "stuck on Lucknow" report; judge: search form was functional, route never entered |
| 19 | Apple__0 | A3 | meta-commentary "one must navigate to Buy"; judge: Buy links were accessible; prices never delivered |
| 19 | ArXiv__10 | A2 | 'withdraw' option asserted; captured help page + Reference Hint say delete/unsubmit for unannounced |
| 19 | Booking__0 | A4 | answer composed in Hindi with ₹ prices (India-locale session); dates never applied — *re-derived* |
| 19 | Booking__10 | A9 | honest "results for India (Varanasi, Agra…) not Paris" |
| 19 | GitHub__0 | A2 | same unverified superlative as run 18 |
| 19 | GitHub__10 | A2 | same prior-pricing answer as run 18 |
| 19 | Google__Flights__0 | A9 | same locale-stuck report as run 18 |
| 20 | Apple__0 | A3 | identical delegation answer (3rd occurrence) |
| 20 | ArXiv__10 | A2 | identical 'withdraw' answer |
| 20 | GitHub__10 | A2 | identical prior-pricing answer |
| 20 | Google__Flights__0 | A9 | same locale-stuck report |
| 20 | Google__Map__0 | A1 | 3 of 5 salons; included a 4.8 (goal: >4.8); missed a 5.0 salon present in final evidence (judge) |
| 21 | Amazon__10 | A9 | "not explicitly listed as a single price"; price was one tier-click away (judge: did not extract) |
| 21 | Apple__0 | A3 | identical delegation answer |
| 21 | Apple__10 | A2 | claimed "MacBook Air … M3"; final surface shows M5 chips + memory/storage rows never entered — *re-derived* (golden stale: A7 context) |
| 21 | ArXiv__10 | A2 | identical 'withdraw' answer |
| 21 | Booking__0 | A1 | hotel named; December 25–26 deals absent ("interface displaying September/October") |
| 21 | GitHub__0 | A2 | same unverified superlative |
| 21 | GitHub__10 | A2 | same prior-pricing answer |
| 21 | Google__Map__0 | A9 | "do not currently display five salons…"; Rating filter visible on final page; stopped after 5 rejections |
| 22 | Amazon__10 | A9 | vague "typically listed as an add-on option"; cost never extracted (judge) |
| 22 | Apple__0 | A3 | identical delegation answer (4th) |
| 22 | ArXiv__0 | A2 | cosmology preprints presented as latest "quantum computing" results; QC search never returned QC papers (fbN=9) |
| 22 | ArXiv__10 | A2 | identical 'withdraw' answer |
| 22 | Booking__0 | A3 | explicit how-to-for-humans instructions; judge: "providing instructions… is not a success" |
| 22 | GitHub__10 | A2 | same prior-pricing answer |
| 22 | Google__Map__0 | A1 | 4 listed incl. a 4.7 labeled as qualifying; 5 never assembled |
| 23 | Allrecipes__3 | A5 | "no recipes meet the criteria" while the 72-rating matching card sat in final evidence (judge names it; fbN=10) |
| 23 | Allrecipes__10 | A2 | "second recipe is Beef Wellington, 1 hr 10 mins"; the 1960s collection content never captured |
| 23 | GitHub__0 | A2 | same unverified superlative |
| 23 | GitHub__10 | A2 | same cluster; features attributed inconsistently with captured Free-tier text |
| 23 | Google__Map__0 | A1 | 5 listed, only 3 meet >4.8 (Emerson 4.7 included; judge) |
| 23 | Huggingface__0 | A5 | "no models matching" while a valid March-2023 match was in the final evidence (judge names it) |
| 24 | Allrecipes__10 | A2 | identical Beef Wellington answer |
| 24 | ArXiv__10 | A2 | identical 'withdraw' answer |
| 24 | Google__Flights__0 | A9 | same locale-stuck report |
| 24 | Google__Map__0 | A1 | 4 of 5; boundary violation (4.8 included; fbN=6) |
| 24 | Google__Search__10 | A2 | "10 most played songs" list assessed by judge as generated; KATSEYE unverifiable from final evidence — *re-derived* (golden Taylor Swift: A7 context) |
| 24 | Huggingface__0 | A5 | answered ayameRushia (dataset Feb 3) for a March window; golden model row captured on obs_1_4/1_5 — *re-derived* |
| 25 | ArXiv__0 | A2 | same wrong-domain preprint answer (fbN=9) |
| 25 | ArXiv__10 | A2 | identical 'withdraw' answer |
| 25 | BBC__News__0 | A2 | answered a bare URL present on no captured surface; real renewable-energy headlines were captured — *re-derived* |
| 25 | Google__Map__0 | A1 | 5 listed; only 3 meet >4.8; the failures self-reported in the answer and shipped anyway |
| 25 | Huggingface__0 | A5 | same "no models matching" over present evidence |
| fresh50 | Wolfram__Alpha__15 | A9 | relation fraction 1/8 vs correct 1/32 — pure math error, grounding fine |
| fresh50 | GitHub__3 | A1 | compared Team-vs-Free instead of Enterprise-vs-Team; '48GB' never captured (golden possibly stale: A7 context) |
| fresh50 | GitHub__18 | A2 | "lovell/sharp 32,630 stars" with final page = nav menu (seed-confirmed) |
| fresh50 | Amazon__24 | A4 | price in INR vs the goal's $100 USD frame (seed-confirmed) |
| fresh50 | Apple__12 | A5 | service-page titles instead of the repair ways the page enumerates; ways captured on obs_1_2/1_3 — *re-derived* |
| fresh50 | Coursera__19 | A1 | institution only; instructor + specific hours missing; course page never opened (judge) |
| fresh50 | ESPN__15 | A1 | 1 of 5 game scores (a headline); scoreboard page never reached |
| fresh50 | Google__Flights__19 | A3 | "please click on the date '25' to view the flight details" (seed-confirmed); price also in ₹ (A4 secondary) |

## Appendix B — Verification notes

- Verdict distribution, combined scores, judged counts, and fresh50's 16/50 match §6 of `flash-lite-runs-comparison.md` and the run-2x validation reports exactly (run-25: 17/30, 8 judge approvals).
- Every class claim cites ≥3 task IDs either in §1 or via the recurring-cluster cross-references; single-instance classes (A4 fresh50 row, A9 math) are labeled one-offs.
- Five verdicts were re-derived from answer-vs-final-page where the judge reason was vague or silent on the decisive defect (marked *re-derived*): 19 `Booking__0` (language), 21 `Apple__10`, 24 `Google__Search__10`, 24 `Huggingface__0`, 25 `BBC__News__0`, plus fresh50 `Apple__12`.
- Golden-token provenance (which facts were actually captured) comes from a mechanical sweep of all observations + read previews per census task (`dossier.json` in `%TEMP%\browsegent-aq\`); the "32 finalization + done_candidate calls" from the brief measured out as 54 finalization calls (36 done-shaped, 18 invalid plans) + 0 done_candidate occurrences — reported as measured in §2.0.
