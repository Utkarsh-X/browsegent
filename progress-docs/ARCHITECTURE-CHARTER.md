# BrowseGent — Architecture Charter: The Highest Ceiling

*Written 2026-09-07 (session with the owner) — the founding-motive record and v3 direction. This
document is the standing reference for what we are building and why; every future campaign
should be checkable against it.*

---

## 1. The motive (owner's words, distilled)

Build the browsing agent that is **the highest it can go — simultaneously better on every
measurable axis: performance, efficiency, tokens, accuracy, effectiveness.** Never trade one
axis for another. The architecture itself was founded as a *hypothesis*: that a semantic,
compressed, verified substrate reaches higher than the accessibility-tree-dump paradigm that
browser-control, browser-use, and most of the field use (the ref mechanism was inspired by
Vercel's agent-browser; everything above it is original). The hypothesis is not an identity to
preserve — **the only fixed point is the highest reachable ceiling.** Every mechanism is a
hypothesis under test; the evidence decides what stays.

**Discipline:** nothing here is rushed. Each invisible ceiling requires intensive research
before implementation. Integrity constraints are absolute: the evaluator is never touched,
honest escalation is never weakened, no site-specific hardcoding, no benchmark overfitting,
flag-gated A/B for every behavioral change, measure-first.

---

## 2. The founding hypothesis — validation status after 22+ instrumented runs

**Hypothesis:** semantic selection + compression + deterministic verification beats
tree-dumping on quality per token.

| Layer | Thesis claim | Measured verdict |
|---|---|---|
| Perception | Select-and-compress beats dumping on quality/token | **Philosophy vindicated** — but its failure mode is *selection silence* (hidden winners). Each patch (P1 pins, ledger un-blinding, rank_loss) is evidence the ceiling of select-then-render alone is capped by selection quality |
| Decision | Substrate-determined recovery lifts any model | **Vindicated** — every fix that survived runs 11→22 was substrate-side; prompt-borne steering has a measured compliance floor on flash-lite |
| Action | Deterministic verification is the moat | **Vindicated** — hit-tests, retention checks, transition classification have no analog in the compared competitors |
| Memory | (Implicitly assumed) | **Least built — the actual frontier.** Ledger is listing-gated; no cross-episode world model; 23–28% of every prompt is re-sent state |
| Grounding | Contract-backed honesty beats leniency | **Vindicated** — advisory/hard partition called novel in the literature; D1 prose broke the information-task ceiling |

Measured baseline at charter time (balanced30, same flags, gemini-3.1-flash-lite):
combined band **13–18/30** (record 18 = 60%; ex-captcha 18/24 = 75%), strict band 7–12
(record 12), internal 63–77% (record 76.7%), fresh50 holdout 32% → 44% across the campaign,
~5,068 input tok/call, 66.9 s/task, 6.4 actions/task. vs browser-control on fresh50: +4pp
combined, +22pp internal, 1.92× faster, −27% actions, 0.4× output tokens — **but 1.9× input
tokens per task.**

---

## 3. The v3 thesis (one sentence)

**The substrate as a verified world model:** full-fidelity perception beneath, an honest
compressed map above it, intents compiled to verified primitives, deltas instead of re-sends,
and every answer claim grounded.

---

## 4. The five ceilings above the visible ceiling (ranked work program)

### 4.1 TOKENS — the owner's current first priority
The input space is the one axis still visibly heavier than the competitor (1.9×/task). Levers,
in cost class order:
- **T-A. Cache-aligned rendering (new, cheap, architecture-compatible):** render the surface in
  *stable order* (DOM order for selection-stable refs) instead of score order, so the byte-
  identical ~23–28% of surface lines land at identical positions — turning the re-send tax
  from billable tokens into provider-cache-priced tokens. System prompt (48% of wire,
  byte-identical every call) is already a perfect cache prefix. Verify provider implicit
  caching is actually crediting it (billing check — owner side).
- **T-B. System prompt as composed sections:** 48% of wire even after conditional stripping;
  per-block byte budgets and measured engagement. Target another 1.5–2 KB.
- **T-C. Page-model delta rendering (the frontier):** the substrate holds the world state;
  each prompt carries deltas + pointers ("same 71 refs; changed: …"). Uses the already-
  computed changedRefs. A/B required (changes what the model sees).
- **T-D. AX-name-oracle hybrid:** merge browser-computed accessible names into our DOM walk
  as an *oracle* (identity/selectors/boxes stay ours) — heals the 13.8% anonymous-element
  noise and the name-mush problem, shrinking line bytes and improving goal matching. This is
  the v3 perception move *without* the native-capture migration; native AX capture stays an
  option behind it.

### 4.2 STEALTH — T1 shipped, T2/T3 with the research agent
T1 done (probe-validated persistent-profile launch behind `BROWSEGENT_STEALTH=1`; clears
Allrecipes + Google headless). Cambridge = Cloudflare managed challenge (silent fingerprint
loop, no iframe) — under research. Remaining: T2 profile warm-up design, extension audit,
CDP-leak verdict (does our DOM-domain usage leak?), the honest boundary (IP reputation).
Full brief: `scratch/stealth-zero-cost-prompt.md`.

### 4.3 INTENT PRIMITIVES (decision ceiling)
seek/pick_option/submit_form proved the pattern: the planner emits intents, the substrate
compiles and verifies. F5 closed-loop expectations (planner emits an expectation, the
transition classifier grades it) is built-half and unbuilt-half — the next decision-layer
ceiling lift, model-robust by construction.

### 4.4 D2 iframes / D5 identity hardening
Zero expected yield on the current slice; deferred until the above lands.

### 4.5 ANSWER STABILITY (synthesis ceiling)
Volatile-page answer drift (Apple__0 class) — claim-level verification extension of the
grounding layer. Monitor before structural work.

---

## 5. Standing principles (never negotiable)

1. The evaluator is never loosened; honest escalation is never weakened.
2. Site-agnostic mechanisms only; anti-overfit validation discipline (balanced30 = the only
   validation gate; fresh50 = owner-run holdout, spent deliberately).
3. Measure first: probe harnesses and artifact forensics before benchmarks; one run per batch.
4. Flag-gated behavior; byte-identical off-paths.
5. No per-action performance costs (T3-class) unless a wall provably demands it.
6. Research before implementation on every invisible ceiling; never rush.

---

## 6. Open questions

- Provider implicit caching: is the byte-identical system-prompt prefix actually being
  credited in billing? (Owner-side check; changes T-A's value calculation.)
- Billing vs attention: is the input-token concern cost (→ T-A first) or model context
  (→ T-C first)? Current answer: both, T-A first as it is nearly free.
- Cambridge managed challenge: IP-bound vs fingerprint-bound (research agent).
- fresh50 holdout timing: one run, after tokens + stealth land.
