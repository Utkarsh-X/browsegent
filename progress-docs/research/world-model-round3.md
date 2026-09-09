# The World Model — Round 3: The Stateless-Safe Delta Wire + C6 Gate Fixtures

**Date:** 2026-09-08 · **Basis:** rounds 1–2 (`world-model-round{1,2}.md` — definitions inherited,
not re-derived) + implementation state since. Worktree `D:\BrowseGent-arch-worldmodel` re-pinned to
the current dev tip `fbd9270` (stage 2a `--prc-page-model` @7199ef7, H4 carry `--prc-delta-surface`
@fbd9270, D1/D2 @02405da/9988974); `src/v2/**` read-only; artifacts read-only; scripts/caches in
`%TEMP%\browsegent-wm\` (`wm_r3.py`, `wm_r3_forensics.py`, `wm_r3_fixtures.py`, `wm_r3_pairs.json`,
`wm_r3_agg2.json`). The worktree receives only this report and the C6 fixture pack
(`tests/unit/v2/prc/fixtures/worldmodel/` — sanctioned fixtures-only write).

**Method floor.** Same validated Python port of the lean PRC renderer (round-1: 974/1,002 exact,
median 0 B) over the same frozen corpus (runs 18–22: 1,002 episodes, 852 consecutive pairs, 608
acted refs). Round-3 upgrades, both required by the landed implementation:
1. **Production-faithful marker normalization** — the round-2 textual strip left a phantom
   `state=""` attr when a line's only anomaly was a continuity marker; production 2a filters the
   anomalies array and *omits the attr when it empties* (`PromptLayoutEngine.renderLeanElement`,
   fbd9270 tree). All round-3 lines use the production-faithful rule; this grew the stable-acted
   class from 65 (round-2 accounting) to **98 refs** and improved measured savings.
2. **Production H4 composition** — carry first (prev-render order, targetId join, K=32, additive
   `carried` reason, `PlannerWorkingSetSelector.carryPreviouslyRendered`), then wire
   classification. Carried refs whose current obs-render equals their previous marker-free line
   (failure/tools-stripped comparison — the ≤14 B/line obs-record undercount bound from round 2)
   inherit the previous line byte-exactly, matching production behavior where carried refs render
   through the same element renderer as selected refs.

**Two integrity corrections to round-2 statements:**
- The **K=32 cap binds on 143/852 pairs (16.8%)** (uncapped pool mean 13.8, p90 52, max 80) —
  round-2's "binds on <1% of pairs" and the fbd9270 commit message were wrong on this point. The
  cap cannot starve acted refs (acted refs are always in the selected set, never in the carried
  pool — 0 starved, §1.4); it only drops never-acted chrome from the carry tail.
- The L1 STATE split adds **8 B/pair, not 6** (head/tail are separate sections joined `\n\n`,
  so one intra-section `\n` becomes a paragraph break). All percentages below are unaffected at
  reported precision; the fixtures encode the correct 8-B convention.

**The stateless fact, verified in code:** every planner call is a fresh single-turn conversation —
`V2PlannerClient.call` builds one system prompt and one user message and invokes
`provider(systemPrompt, userMessage, …)` (`V2PlannerClient.ts:90–111`); no message history exists
anywhere in the loop. The model never sees the previous episode's render. Round-2's A4 accounting
("0 acted refs off the effective surface: changed ∪ always-full ∪ re-listed ids") is therefore
too generous: a bare id in `STABLE REFS` is *present* but not *understandable*.

---

## 0. Run-27 forensics: what actually converted (mini-task)

Run 27 = `webvoyager_lite_1788760183386` (balanced30, D1 done-candidate checklist + D2 advisory
form-defect detectors). Verdict transitions vs run 26 (`webvoyager_evaluation.json`, both runs):

| Task | 26 → 27 | Mechanism evidence (episode files) |
|---|---|---|
| Amazon__0 | strict 0→1, **internal False→True** | re-ask fired, answer confirmed (`done_candidate` @obs_1_4) |
| BBC__News__0 | judge 0→1 | re-ask fired, **REVISED** (rewording; @obs_1_7, cached 3,695 tok) |
| **GitHub__10** | judge 0→1 | re-ask fired, **REVISED** — the conversion (below) |
| Google__Search__10 | judge 0→1 | re-ask fired, **REVISED** — generated "10 most played songs" list replaced with an honest hedge; judge passed |
| ESPN__10 | strict 1→0 | re-ask fired, REVISED (give-up → historical FA Community Shield answer; failed either way) |
| Google__Map__10 | judge 1→0, internal→False | **no re-ask** (budget death at ep13); D2 advisory fired @ep11–12 (`missing_concrete_basic_information`) — co-occurrence, not proof |
| Huggingface__0 | strict 1→0 | re-ask fired, REVISED (cosmetic rewording of the same give-up; the A5 class) |
| **Wolfram__Alpha__10** | judge 1→0 | re-ask fired, **REVISED — the regression** (below) |
| ArXiv__10 | judge 1→1 | **no re-ask, no D2 signals** — not mechanism-attributable |

D1 fired on **20/30 tasks** (every task that reached done-acceptance; 0 on the 6 budget-death
tasks, so the +1 call never burned a budget). Results: **18 REVISED / 2 confirmed** (Amazon__0,
Apple__0); all 20 candidates returned `done=true` (0 escalate-verdicts, so the "original stands
unless passing" fallback never split); 12/20 shorter. Re-asks are the first measured
identical-prefix cache hits at scale: `cachedInputTokens` present on 17/20, **sum 64,701, mean
3,806 tok** (the run report's 22 calls / 83,294 additionally counts non-re-ask cache hits); the
re-ask payload is +2,928 B over the original (GitHub__10: 11,461→14,389 userBytes). Calls/task
7.93 (26: 8.27, 24: 8.17) — the +1 call did not raise the mean.

**The two named clusters:**
- **GitHub__10 — D1-mechanism-attributable.** Runs 24/25/26 all shipped the census's A2 answer
  ("Pro plan costs **$10 per month ($120 per year)**…"; judge passed it twice by variance, failed
  it in 26). Run 27's original had the same claim; the done-candidate re-ask replaced it with
  "**The Pro plan costs $15 per month ($180 per year)**…" — the captured pricing table's values —
  and that revision shipped (`episode_done_candidate_obs_1_7-output.json`). The recurring
  ungrounded claim did not survive the checklist.
- **ArXiv__10 — NOT mechanism-attributable.** Its winning answers in both 26 and 27 were composed
  by the **finalization path** (`episode_finalization_obs_2_13-*`), and D1 never fires on
  finalization-composed answers (0 of 20 re-asks). No D2 signals either. First conversion was run
  26 (composed prompt), before D1/D2 existed. Honest label: trajectory + composed prompt, not
  this A/B's mechanisms.

**New failure signature (the round's one mechanism-proven regression):** Wolfram__Alpha__10's
original answer was "**approximately 0.505 gauss**" — the pod value that passed the judge in 24,
25, 26 (8-run streak). The re-ask replaced it with "**not explicitly provided**… displays the
magnetic declination instead" — accepted because it returned `done=true` — and lost the judge.
D1 can currently **swap a correct answer for a confident-sounding give-up**. D2's one-steer design
showed both directions: `list_page_only_answer` on ArXiv__0 co-occurred with a strict pass (the
answer became an enumerated list), `requested_item_count_missing` on Map__0 correctly fired but
the gap was browsing-rooted.

**Actionable findings for the answer-quality track (recorded, not owned here):**
1. D1 should never accept a revised answer that *retracts* a claim the original grounded (a
   numeric-presence check between original and revised would have caught Wolfram__Alpha__10).
2. D1 has a **finalization-path coverage gap**: answers composed by `episode_finalization_*`
   bypass the checklist entirely (measured: 0/20 re-asks; ArXiv__10's entire winning path).

---

## 1. The stateless-safe wire: variants measured

### 1.1 The criterion (replaces A4's accounting)

An acted ref (the 608-ref corpus) is **statelessly complete** in episode N iff *this call's
render* describes it with at least kind + name/role (and any value/option the plan needs).
**Id-only does not count.** The always-full class (inputs/selects, autocomplete/popup roles,
failed, changed) renders full lines in every variant by construction — asserted, 0 exceptions in
852 pairs. Under this criterion round-2's option-c re-list is **not shippable**: it hands the
model ids it cannot understand.

### 1.2 Variant table (the round's headline; 852 pairs, production H4 composition)

| Variant | stable-ref rendering | user bytes mean | vs SQ (8,682 B) | vs pageModel-full (8,889 B) | median pair | statelessly blind (of 608) |
|---|---|---|---|---|---|---|
| W0 (SQ, no wire) | full line | 8,681.8 | — | — | — | 0 |
| pageModel-full (2a+H4, no wire) | full line (markers normalized, carry added) | 8,889.0 | +2.4% | — | — | 0 |
| **W1** (round-2 spec) | id only, `STABLE REFS: [..], [..]` | 6,744.4 | **−22.3%** | −24.1% | −2,226 B | **98 (16.1%) — dead** |
| **W2** | `[id] <kind name="…" />` minimal line | 8,288.4 | **−4.5%** | **−6.8%** | **−851 B** | **0 — shippable** |
| W3 | W2 + `value="…"` when present | 8,291.1 | −4.5% | −6.7% | −851 B | 0 |
| W4 | full line if acted before, id-only otherwise | 6,764.1 | −22.1% | −23.9% | −2,192 B | **68 (11.2%) — dead** |

Decomposition of the acted corpus (608): **464 full** (changed ∪ always-full), **98 stable**
(unchanged marker-free lines — the stateless-blind set under id-only), 0 nameless, 0 off-surface.
W4's acted-history repair heals 30 of the 98 (rendered full because acted in an earlier episode);
**68 first-time-actor stable refs remain blind** — and their blindness is undecidable at render
time (whether the planner will act on one this episode is not known when the wire renders).
The only repair that closes W4 is giving every stable ref kind+name — which is W2. **W2 is the
unique fixed point of the stateless-completeness constraint**: any shippable rendering must print
kind+name for every stable ref, and W2 prints exactly that (the W3 measurement confirms value
attrs add nothing: +2.7 B/pair mean, because value-bearing elements are all always-full).

Byte cost of that constraint: W2 renders 29.8 stable refs/pair (mean; median 9) at ~40 B vs W1's
~14 B — the difference is the −22.3% → −4.5% gap. That is the honest price of a stateless wire.

### 1.3 The combined H4+wire interaction (new, measured)

**The carry tax:** the shipped pageModel-full render (2a+H4) is **+207 B/call (+2.4%) over SQ**
(8,889 vs 8,682) — additive carry adds ~9.7 refs/pair of new full lines while marker
normalization saves less than that. 328/852 pairs have a *larger* full render than SQ. The wire
then claws back: W2 −600.6 B vs the full render (**−6.8%**). The round-2 `min(hybrid, full)` guard
**never binds in production (0/852 for every variant)** — the wire surface is a subset of the
full surface by construction (same changed ∪ always-full lines; stable refs render smaller), so
under the landed H4 the guard is structurally vacuous. Round-2's 142 guard-relevant pairs were an
artifact of comparing against the *carry-free* SQ full render; the honest end-to-end number is
instead "worse than SQ" pairs: **W2 is worse than today's flag-off render on 245/852 pairs
(28.8%)** — mean still wins, median wins by 851 B — driven by:

| Class | n | W2 vs pageModel-full | W2 vs SQ |
|---|---|---|---|
| observation-reuse | 49 | −23.9% | −30.6% |
| microstate | 25 | −18.2% | −14.7% |
| structural_local | 397 | −6.1% | **+1.1%** |
| structural_macrostate + hard_reset (navigation) | 381 | −4.5% | −6.4% |

The structural_local +1.1% vs SQ is the carried-stable lines' cost: on same-page re-captures the
carry adds refs SQ never sent, and W2 prints them at kind+name cost. This is not waste — it is
the world model's additive information (W2 renders ~30 previously-invisible stable refs per
call) — but it must be stated: **on same-page steps the W2 wire buys information with bytes, not
savings.** The savings concentrate exactly where the model re-orients (reuse/microstate/navigation).

Token economics (round-2 anchor: −17.2% user ↔ −435 tok/call ⇒ ~25.3 tok per point): W2 ≈
**−115 tok/call ≈ −900 tok/task** (7.9 calls/task at the run-27 telemetry) ≈ −2.7% of input
tokens. Modest — the wire's second value is attention: ~30 redundant full lines per call leave
the surface, and 57.0 full lines/pair (mean) remain. That behavioral question is what the staged
A/B is for; round 3 does not guess it.

### 1.4 Invariants (asserted on all 852 pairs)

Zero acted refs off-surface; zero displaced; zero force-include lane losses; zero always-full
displacements; zero nameless stable acted refs. All variants pass by construction under H4's
additive rule — the round-2 starvation verdicts are unchanged. The K=32 cap binds 143/852 times
(§0 integrity note) and cannot starve acted refs (acted refs are never in the carried pool).

### 1.5 Risk register, re-scored

| Risk | Round-2 status | Round-3 measured | Verdict |
|---|---|---|---|
| Stateless blind action (NEW) | unaccounted (A4 counted bare ids) | W1: 98 blind; W4: 68; **W2: 0** | closed by W2 |
| Stale type/select | closed (always-full kept whole) | unchanged; 0 always-full displaced | closed |
| Stale click target | closed (ids never transmute) | unchanged; carried refs verified alive by targetId | closed |
| Marker re-anchoring | closed by A1 | production rule now attr-omitting (fixture-exact) | closed |
| Wire grows on some pairs | closed by min(hybrid,full) | guard vacuous in production (0/852); honest metric = worse-than-SQ pairs: 245/852 (W2), worst +741 B (fixture `19_Booking_10_a1_ep4`) | re-characterized |
| Carry tax | unmeasured | +207 B/call mean on the full render; 328/852 pairs larger than SQ | new, bounded |
| Attention/behavioral effect | open (A/B) | still open — the staged A/B decides | open |
| Provider implicit-cache billing | owner-side | T0: caching absent in practice (~1.4% of tokens); run-27 re-asks are the measured exception (identical prefixes, 3,806 tok/call mean) — consistent with a minimum-prefix threshold. **No cache arithmetic is weighted in this recommendation; billable bytes are the lever.** | closed for this design |

**Recommendation: round 4 implements W2 only** (`[id] <kind name="…" />` minimal stable lines,
production attr order, 120-char name cap, no value attr — W3's measured null result). W1/W4 are
measured dead on the stateless criterion; option-d query tokens remain rejected (round-1 §3.5).

---

## 2. The C6 fixture pack + harness spec (second deliverable)

**Exported:** `tests/unit/v2/prc/fixtures/worldmodel/` — 10 pairs (20 episodes), 1,355 KB:
2 reuse, 1 microstate (K=32 cap-bound), 3 structural_local (one cap-bound, one stable=0 edge),
4 navigation (one hard_reset, one wire-loses pair, carried 0–17). Each fixture: `.prev.input.json`
+ `.cur.input.json` (verbatim artifact copies), `.expected.full.txt` (off-flag render, byte-exact
via the validated renderer), `.expected.wire.txt` (L1 + W2 wire payload, byte-exact),
`manifest.json` (provenance, pair facts, byte lengths, invariant checklist), `README.md`.
Selection deliberately includes the hard cases: a cap-bound carry pair (32 carried refs), a
stable=0 pair (no re-list emitted), and a wire-loses pair (+579 B, `19_Booking_10_a1_ep4`).

**The harness spec (what the in-repo TypeScript harness asserts; amends round-2 §C6):**

1. **Off-path byte identity:** for every fixture, rendering `cur.input.json` with all page-model
   flags off reproduces `expected.full.txt` byte-exact (Buffer.compare === 0). This is also the
   renderer-parity check — the fixtures encode the 97.2%-validated renderer.
2. **Stage-2a parity:** with `pageModel` on, the full render's surface is marker-free (production
   attr-omitting rule) plus the `CONTINUITY: weakened=N refs carried from before the last action;
   changed=M` header after the lines, and L1 section order (MISSION → STATE-head → SURFACE →
   STATE-tail → RECENT EVENTS → … → WORKING SET → DECISION SIGNALS). The STATE split adds 8 B
   (head/tail as separate sections).
3. **H4 invariants on every fixture pair:** zero displacement, zero force-include lane loss,
   carried reason additive only, K=32 cap honored, carried refs render current obs values.
4. **Wire parity (W2 only — do not spec W1/W3/W4):** with `pageModel` + `deltaSurface` on, the
   payload equals `expected.wire.txt` byte-exact: surface = changed ∪ always-full full lines in
   rank order, then one minimal line `  [v2ref_N] <kind name="…" />` per stable ref (rank order,
   120-char name cap, **no value attr, no role attr**), then the CONTINUITY header. No
   `STABLE REFS` id-list line exists under W2.
5. **Stateless completeness:** every plan-step ref in the fixture episode's recorded output
   appears in the wire surface with kind + name (full or minimal line) — asserted per fixture in
   the manifest (`actedStatelesslyComplete`), 0 exceptions across the 10 fixtures.
6. **Guard:** assert `min(wire, pageModel-full)` semantics exist and that wire ≤ pageModel-full
   byte-wise on every fixture (the production measurement found the guard never binds; the
   assertion pins the subset property).
   **Gate owner:** the stage-2b-part-2 PR cannot flip `BROWSEGENT_PAGE_MODEL`/delta-surface
   defaults until 1–6 hold on the committed fixtures (no `logs/` dependency — the round-2 C6
   wording allowed a logs-dependent skip; fixtures replace that).

---

## 3. What round 4 executes vs decides

**Executes (flagged, one commit):** W2 wire on `--prc-delta-surface` exactly per §2.4, the six
fixture assertions as a unit test, and the answer-quality fixes if the owner accepts them (D1
retract-guard; finalization-path checklist coverage — 0/20 re-asks reached finalization answers,
and ArXiv__10's winning path bypasses D1 entirely).

**Decides (after the stage-2b A/B, not before):** whether W2's −115 tok/call and ~30-lines-call
attention reduction hold on balanced30 without regression (anchors: all strict passes,
Booking__0's trajectory, Coursera multi-page flows; guards: wire p90 ≤ SQ+5%, calls/task, stale-ref
error rate, 812/812-equivalent rendered-action invariant — now stateless-completeness, not
surface-presence); whether the +207 B carry tax is worth its additive information on the
structural_local class; whether the D1 finalization gap matters on the answer-quality track.

---

## Implementation record (round-4 fold-in, 2026-09-08)

Round 4 executed the report's "W2 only" recommendation plus the two answer-quality fixes, one commit per concern, each with the full gates green (unit, tsc, check:v2) before the commit:

1. **`cefac8d` — feat(planner): render stable refs as minimal kind+name lines on delta-surface.** Production W2 on `--prc-delta-surface` exactly per §2.4: flat refs-map (rank) order, full block (changed ∪ always-full) then minimal `  [id] <kind name="…" />` block, CONTINUITY header last, no `STABLE REFS` line, no `NEW SINCE` line on the wire. The changed class is a line-diff of marker-free lean element lines against the previous payload's element lines, supplied per call by the agent loop (renderer stays stateless; first episode renders everything full). Off-path byte-identical; wire-only conventions (8-B STATE split, delta markers kept on full lines) are gated.
2. **`6803a86` — test(prc): world-model round-3 C6 fixture replay gate.** The 10-pair fixture pack imported verbatim and pinned by a 9-assertion unit gate (off-path byte identity, wire parity, block structure, stateless completeness, always-full, first-episode safety, off-path flag isolation, wire ≤ full). Two exporter artifacts are corrected for and documented in the fixture README: (a) simulated carried lines — refs absent from the shipped `cur.refs`, which production renders from the working set instead; (b) the exporter's delta-marker strip regex (` \+\+(?:chg|new)(?=/>)`) never matches the real render (` +chg />`), so fixtures pin prev-marker-dropping refs as full; production follows the spec (stable = content-unchanged) and renders them minimal — the gate proves every class flip is exactly that artifact (content byte-identical after marker strip).
3. **`ccdcde3` — fix(agent): reject done-candidate revisions that retract grounded values.** §11.2.1: `retractsGroundedValues(original, revised)` requires every numeric measurement of the original answer to survive into any accepted revision; rewordings that keep values pass, escalation semantics untouched. Unit-tested against the exact measured Wolfram__Alpha__10 shape plus reword/enrich/partial-drop/no-numbers edges.

Pending: §11.2.2 finalization-path checklist coverage is designed but not implemented — the report's own "decides" list defers it until the A/B shows the gap matters. Stage-2b A/B (`--prc-page-model --prc-delta-surface` stack vs the run-27 anchor, guards per §3) is next.

---

## Sources

**Code (read-only, worktree @ fbd9270):** `src/v2/planner/V2PlannerClient.ts:90–111` (stateless
two-string provider call); `src/v2/planner/PlannerWorkingSetSelector.ts` (`carryPreviouslyRendered`,
K=32, secondary append); `src/v2/planner/prc/PromptLayoutEngine.ts` (2a L1 split, production
marker normalization, CONTINUITY header); `src/v2/agent/V2AgentLoop.ts:300–345` (D1 re-ask gating,
D2 advisory steer-once); `src/v2/agent/AnswerContract.ts` (contract reasons, item-count parse).

**Artifacts (read-only):** runs 18–22 (unchanged corpus); run 27
`webvoyager_lite_1788760183386` — `webvoyager_evaluation.json` (verdicts),
`traces/*/planner/episode_done_candidate_*-{input,output}.json` (20 re-asks, revised/confirmed
vals, `metrics.cachedInputTokens`), `episode_finalization_*` (ArXiv__10/Map__0 paths),
`uncertainty.signals` (`answer_contract:*` D2 footprint); runs 24–26 evaluation files for the
roster comparison (ts 1788718289231 / 1788723829378 / 1788729313820).

**Prior rounds (inherited):** `world-model-round1.md` §1 (608/812 corpora, always-full class),
`world-model-round2.md` §A (H4, wire options), §C (contract C1–C6); `answer-quality-round1.md`
(A2 census clusters: GitHub__10 ×6 runs 18–23, ArXiv__10 ×6 runs 19–25).

**Simulation caches (outside the worktree):** `%TEMP%\browsegent-wm\` — `wm_r3.py` (variant
harness), `wm_r3_forensics.py` (run-27 sweep), `wm_r3_fixtures.py` (fixture exporter),
`wm_r3_pairs.json` / `wm_r3_agg2.json` (per-pair results, 852 rows).
