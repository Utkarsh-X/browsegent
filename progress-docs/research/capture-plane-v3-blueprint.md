# Capture-Plane v3 Blueprint — Iframes, Prose, Stabilization, Identity (Core-Architecture Round 3)

**Worktree**: `D:\BrowseGent-arch-research3`, detached at dev-branch tip `131d2aa` (`feat/openrouter-stealth-benchmark`).
Two mechanisms shipped since round 2 that this blueprint builds on (verified in source):
`fb0b44a` — W-A empty-capture recapture **after all mutations** (was navigation-identity-gated; now one bounded
wait-retry on any empty post-mutation capture, plus a `post_action_capture_empty: dispatched from <url>` note in
transition evidence); `e001de9` — `--planner-no-json-schema` flag (F13b, default off). Source study confined to
`src/v2/**` + `scripts/check_v2_boundaries.ts`; artifacts READ-ONLY from runs 15/16.

**Master brief**: `architecture-sota-fitness.md` — direction **R5** (capture-plane upgrades) is the
biggest long-horizon SOTA-gap lever: it attacks ceiling (c) "prose absence" and ceiling (f) "DOM-capture hop",
plus §7(a) heavy-JS churn and §7(b) iframe unobservability. This document is the implementation-grade R5.

---

## 1. Ranked summary — what each design closes (audit arithmetic)

Run-16 combined 16/30; SOTA band 75–85% = +7…+10 tasks. The audit decomposes the 14-task gap: 43% environment,
21% widget (R1), 14% grounding (R4), 7% synthesis (Wolfram__10), 0% pure navigation. Capture-plane work
addresses the **synthesis** task and the *enablers* of the grounding/widget classes, and is the only lever that
lifts the information-task ceiling at all.

| Rank | Design | Mechanism closed | Measured yield on this benchmark slice | SOTA-gap contribution (honest) |
|---|---|---|---|---|
| 1 | **D1 prose capture** | Ceiling (c): interactive-only capture + replay-only reads cap informational goals at labels + 6 KB search_page | ArXiv__10 (procedural sentence never in any ref — 0/10 obs files), Wolfram__Alpha__10 (pod value "51.5" in 0 refs and 0/39 search_page outputs), ArXiv__0 drift class (answer-from-page without the goal fact in refs) | **1 task direct** (Wolfram__10 — 7% of gap, 0 flips in 15+ runs), plus grounding support for the ArXiv__0/Huggingface measurement-flip class |
| 2 | **D3 stabilization rebuild** | §7(a) churn: 75 ms coin flip on SPAs | 10 empty captures (6+4) now absorbed by W-A recapture (shipped); remaining: the 26.1% fresh-but-rendered share of `low_confidence_ref` (6/23 steps across 154 runs) + weakened-ref churn | **0 direct flips; de-risks everything else** — fewer weakened refs = fewer refused actions = budget integrity |
| 3 | **D4 CDP identity batching + page hygiene** | Ceiling (f): capture hop 11.8% of intrinsic time; 150 sequential describeNode; live-page setAttribute; shadow-DOM identity gap | capture duration scales 0.175–0.274 ms/ref (corr 0.37/0.60); ≥2,000-ref captures already 761–1,280 ms; shadow refs get NO backendNodeId today (`DOM.querySelectorAll` cannot pierce) | **0 direct flips; removes the scaling blocker** for §7(d) 10× pages and cuts the second-largest intrinsic hop |
| 4 | **D2 iframe traversal** | §7(b): iframe content structurally unobservable | on webvoyager-lite: **9 frame-ish refs (run 15) / 30 (run 16, ESPN__10 ×20)** surface as elements; zero with `src` captured (not in `buildSelectorCandidates` attr list); no measured task flips | **0 on this slice; unblocks checkout-embedded widgets, editors, map embeds generically** — priced as future-proofing, not benchmark yield |
| 5 | **D5 targetId hardening** (flag-gated, last) | Identity churn inflating appeared sets and weakening refs | **94–97% of targetId-new same-page refs are re-matchable by role\|name** (63,557/65,597 run 15; 91,384/97,663 run 16) | removes the raw material of the appeared-inflation (round-2 BP3: median 654/574 "appeared" on same-page transitions) and most soft-fingerprint 0.55 downgrades |

Sequencing rationale: D1 first (only direct task-closing design; independent); D3+D4 next (shared file,
`ObservationService`/`StabilizationService`, and D4's `getDocument(-1, pierce)` changes what D2 builds on);
D2 after D4 (frame identity depends on the batched resolver); D5 last (its benefit is partially realized by
round-2 BP3's topRefs markers; the residual is real but riskiest — duplicate-label pages).

---

## 2. DESIGN 1 — Prose capture (the S2/S3 killer)

### 2.1 What the substrate cannot see today (receipts)

- Walk admits interactive elements only: `isInteractiveElement` (`ObservationService.ts:461-486`).
- `get`/`inspect_region` are replay-only: `executeRefRead` reads `read(ref, before)` where `before` is the
  captured observation (`BrowseGentV2Harness.ts:621-702`); `buildBoundedReadEvidenceText`
  (`harness/ReadEvidence.ts:19-55`) composes from **stored refs** (≤12 nearby, 320 px window, ≤1,800 chars) —
  no read tool can escape the capture filter. Live prose window = `search_page` 12 lines × 500 chars
  (`BrowseGentV2Harness.ts:208-244`).
- The two canonical casualties: ArXiv__10 — "Unsubmit"/"delete or delay" in **0/10** observation files
  (round-1 grep; re-verified this round); Wolfram__Alpha__10 — the pod title IS a ref
  (`obs_1_7` `v2ref_556`, name = truncated textContent mush "Geomagnetic field strength for Oslo,
  Norway:Show gaussUnits") but the **value** ("51.5 µT") is in a non-interactive text node: 0 refs contain it,
  and 0 of the run's 39 `search_page` calls ever returned it (the model never searched the right pattern —
  search_page is a needle tool, not a window).
- Live body-text availability is real (the readiness script already computes `bodyTextLength` every capture,
  `ObservationService.ts:593-598`) — the substrate measures the prose exists and discards it.

### 2.2 Capture design (in-page, single evaluate, bounded)

**What to collect** — extend `COLLECT_INTERACTIVE_ELEMENTS_SCRIPT` (one `page.evaluate`, no extra round trip)
with a second pass that walks **text-node clusters**:

1. **Section-anchored prose** (primary): for each interactive ref already captured whose `role` is
   `link`/`button`/`heading-like` (anchor set), collect the text of sibling/descendant text nodes within the
   nearest common block container (upward walk to the first ancestor whose childElementCount bound holds),
   excluding text already consumed as `name`/`text` of a captured ref. This is the mechanism that yields
   ArXiv's procedural sentences (anchor "Submission not yet announced" → its section's paragraphs) and the
   Wolfram pod value (pod container text nodes beside the "Show gaussUnits" child controls).
2. **Headings** (secondary): elements with `tagName` h1–h4 or `role=heading` become prose refs even though
   non-interactive (bounded count ≤12/obs).
3. **List-item bodies**: `li` text nodes not already inside a captured interactive element.

**Caps (all enforced in-page, deterministic)**: per prose node 300 chars; per anchor section 800 chars;
per observation **2,500 chars total prose** and ≤ **8 prose refs** (fill order: goal-anchored sections first —
normalized goal-token overlap with the section text — then headings, then DOM order); skip anything inside
`nav`/`footer`/`[role=navigation]`/repeated-item containers (the `repeated_list` predicate can be evaluated
in-page by counting identical sibling labels), skip `visibility:hidden` nodes.

**Trigger gating (keeps transactional pages at zero cost)** — prose pass runs only when
(a) `workingSet.mode ∈ {extract, verify}` (measured share: run 15 = 107/200, run 16 = 125/222), **and**
(b) the observation is prose-poor by the round-2 F11 gate (`refTextChars < 4,000` — the measured gap sits
between Wolfram/Map-class 2.1–3.6 KB and content pages ≥20 KB), **or** a goal-token-matched anchor exists whose
adjacent section text is non-empty (the ArXiv case: 2 seeds/obs median — a low-seed, prose-poor page). The
round-2 seed-frequency replay confirms the gate discriminates: median seeds/obs is 1–2 on ArXiv/Wolfram
(prose-poor informational) vs 100–350 on query-laden search pages where raw triggering would be noise.

**Where it lives**: new field `prose: ProseRef[]` on `BrowserObservation` (schema v3, §7) where
`ProseRef = { proseId: 'prose_N', anchorRefIds: string[], text, chars }`. It deliberately does **not** enter
`refs[]` (no refId — the planner cannot click a paragraph; keeping prose out of ref identity preserves the
working-set/ref-id invariants and the validator's ref tables). `ProjectionService` maps prose into the
**readables view** with `kind: 'prose'` (a new `ProjectionItemKind`) so selection, serialization, and rendering
reuse the existing readables lane; `answer_candidate` tagging does NOT apply (retag per round-2 finding).

**How it renders (lean plane)** — `PromptLayoutEngine` renders prose refs inside PLANNER SURFACE as a new
group after readables-eligible elements: `  Page Text (bounded)` followed by
`    [prose_1] ("anchor: v2ref_558") Geomagnetic field strength for Oslo, Norway: 51.5 µT` lines with the
standard 120-char name cap. Byte replay: ≤8 × ~140 B ≈ **≤1.1 KB on engaged episodes, 0 elsewhere**; engaged
share in run 15/16 replays ≈ 30–40% of calls (extract/verify + gate), so amortized ≈ 300–450 B/call ≈ 4–6% of
the run-16 user payload. Artifact side: ≤2.5 KB JSON per engaged observation; 284.3 MB/run grows <2% (budget §7).

**Read path decision: keep replay-only.** `get`/`inspect_region` continue reading the snapshot — but prose
refs join the `ReadEvidence` nearby composition (`ReadEvidence.ts:34-52` extends its filter to prose refs in
the same frame/region), so `get(v2ref_556)` returns the pod text **including the value**. Justification: (i)
determinism story preserved — a read always returns what the planner saw at capture time; evidence-ledger and
answer-contract checks (claim-vs-read conflict detection, `AnswerGrounding`) stay sound because they compare
against captured text only; (ii) live reads would break the replay/audit property that every judged claim maps
to an artifact; (iii) the residual live need (reading text the filter missed entirely) is now covered by the
prose capture itself, which is capture-time, not read-time. The one live window (`search_page`) stays as-is.

**Which failures plausibly flip**: Wolfram__Alpha__10 (pod value reachable → the compound-measurement answer
becomes visible to P7-style completeness or the model directly), ArXiv__10 (the "Delete or Unsubmit" procedure
sentence present at the done moment), ArXiv__0-class drift (the goal fact is in a prose ref, so
`evidenceSnapshot`/coverage reads bind the answer to page text). None of the captcha (v) class; no
widget-task effect; transactional tasks byte-identical (gate off).

**False-positive analysis**: (a) cookie banners/consent walls — excluded by nav/footer skip + budget order
(goal-anchored first); (b) hidden pre-rendered text (SEO dumps) — visibility filter; (c) repeated card lists —
repeated-container skip prevents the Coursera card-grid flood; (d) prose that *contradicts* a later click —
bounded by snapshot semantics (prose is timestamped with its observation, same as every ref today).

---

## 3. DESIGN 2 — Iframe traversal

### 2.1 Measured presence on this slice (honest baseline)

Frame-ish elements (`tagName ∈ iframe/frame/embed/object`) that survived the interactive filter: **9 refs
(run 15: ESPN__10 ×5, ESPN__0 ×2, Amazon ×2) and 30 (run 16: ESPN__10 ×20, ESPN__0 ×5, Amazon ×5)**; **zero**
carry a `src` attribute (the selector builder checks `href` but not `src` — `ObservationService.ts:449-451`).
No frame content has ever entered an observation; no measured task failed *because* of a frame on this slice.
Design is therefore priced as capability, with explicit caps so it can never regress the measured classes.

### 3.2 Design

- **Enumeration**: `page.frames()` per observation (`BrowserSession` currently exposes a single `page`,
  `BrowserSession.ts:59-64` — no frame code exists anywhere in the capture path). For each frame:
  `frame.parent()`, `frame.url()`, `frame.name()`, `frame === page.mainFrame()`.
- **Same-origin only**: traverse `frame` when `new URL(frame.url()).origin === mainFrame origin` **and**
  `frame.url()` is http(s) — this automatically excludes cross-origin ad/analytics frames and OOPIF CDP
  complexity (each OOPIF would need its own CDP session; out of scope). `about:blank` frames skipped.
- **Noise guards**: skip frames with `frame === mainFrame`; skip if element bounding box (via
  `frameElement()`) is < 100×100 px or `display:none` (ad-slot signature); cap **≤3 same-origin frames per
  observation** (largest by element count) and **≤40 refs per frame** (same walk script, same filters).
- **Identity**: `V2Ref.frameId` already exists (`runtime/types.ts`) and is already consumed by
  `ReadEvidence.sameFrame` (`ReadEvidence.ts:62-64`) — the schema anticipates frames. refIds get a frame prefix
  `f2_ref_G_N` (frame index stable within an observation); `refId` uniqueness is preserved by the prefix;
  `RefResolver.resolve` gains a frame-scope step: `page.frames().find(f => f.url() matches ref.frameUrl)` →
  locator resolution scoped to that frame (`frame.locator(...)` — Playwright-native; ordinal machinery
  unchanged). `selectorCandidates` gain `src` for frame elements (one attribute added to the builder list).
- **CDP identity per frame**: after D4 lands, the batched `DOM.getDocument(-1, pierce:true)` runs **per
  same-origin frame** (the frame's own execution context; a `CDPSession` per frame is avoidable because
  same-origin frames share the page session — frame scoping via `frame.evaluate` and per-frame
  `DOM.getDocument` calls is sufficient). Cross-origin frames: no identity, no traversal, by policy.
- **Wire**: frame refs render with a frame tag on their lean line (`frame="f2"`; ≤6 B/line), only on
  multi-frame observations.

**Unblocked site classes (generic, from the audit §7(b))**: embedded checkout/payment widgets, third-party
editors and bots (intercom-style), map/schedule embeds. On the balanced30 slice: **0 expected flips**;
must-not-regress anchors are ESPN__10 (20 frame refs — must not flood the working set: caps + frame tag keep
frame refs out of the 80-ref race unless goal-relevant) and every current strict pass.

---

## 4. DESIGN 3 — Stabilization rebuild

### 4.1 Current state and what W-A already absorbed

`StabilizationService.waitForSettledState` = `domcontentloaded` (5 s cap) + **75 ms** fixed quiet window
(`StabilizationService.ts:14-32`). W-A (shipped, `fb0b44a`) adds a bounded wait-retry when a post-mutation
capture returns 0 refs and a `post_action_capture_empty` note when it still is. Measured capture durations
(obs `stats.durationMs`): empty captures took **2,060 ms mean (run 15) / 873 ms (run 16)** — they already
burned the empty-navigation wait loop — vs 282–296 ms for small captures. The remaining gap is *proactive*:
today the substrate settles too early on same-URL mutations (popover opens, calendar re-renders) and too
late nowhere — producing the weakened-ref regime (soft-fingerprint 0.55 downgrades; 26.1% of the 23
`low_confidence_ref` steps were fresh-but-rendered per the forensics, 100% recovered live in the *next*
observation).

### 4.2 Design: bounded readiness quiet window

- **Composite readiness rule** (per action, after the existing `domcontentloaded`):
  inject a `MutationObserver` + rAF sampler at session open (`BrowserSession.open` context
  `addInitScript`) that records `lastMutationTs` and `pendingRAF` on `window.__bgSettle`; after each action,
  wait until `now - lastMutationTs ≥ 150 ms` **and** no rAF pending for 2 consecutive frames, with a hard cap
  **1,200 ms** (p95 budget: median actions currently settle in 75 ms; the cap adds ≤1.1 s worst-case).
  Keep the existing 75 ms as the *minimum* quiet floor (unchanged fast path).
- **Per-action-class calibration**: `navigate` → dcl + quiet window (current behavior, now mutation-aware);
  `click`/`press` → quiet window (catches delayed menus — the round-1 `shouldRefreshAfterLowInformationAction`
  recapture exists for microstate-none clicks and stays); `type` → 150 ms fixed (autocomplete surfaces stream);
  `select` → quiet window.
- **Integration with W-A**: quiet window runs *before* the capture; W-A recapture remains the backstop when
  the window still misses hydration (both layers are bounded; combined worst case ≈ 1.2 s + 6 s emergency path
  unchanged for the rare truly-empty page).
- **Budget check**: stabilization was 8.1–9.4 s per 30-task run (≈1.0% of intrinsic time). Quiet-window adds
  ≈0.2–0.4 s/action × 195 actions ≈ 40–80 s/run ≈ **+1.2–2.4% intrinsic** — inside the <2 s p95 action budget
  (measured p95 action ledger total stays < 2 s because most actions already see ≥150 ms of natural quiet).
- **What it must NOT do**: never wait for `networkidle` (long-lived XHR/SSE on SPAs would hang to the cap every
  action); never wait past the cap even mid-animation (hard cap is the honesty boundary; churn after the cap is
  handled by the transition classifier, not by waiting).

### 4.3 Replay: what each candidate rule absorbs

| Symptom (measured) | W-A recapture (shipped) | + 150 ms quiet window | + offscreen self-heal (forensics fix) |
|---|---|---|---|
| 10 empty captures (6+4) | absorbs most (Booking tails; empty captures already waited 0.9–2.1 s) | prevents several at the source (hydration race within window) | — |
| `low_confidence_ref` fresh-but-rendered (6/23 steps; 100% recovered live next obs) | — | absorbs the sub-150 ms subset (micro-render between plan and dispatch) | absorbs the offscreen-fold subset (e.g. Booking cell at y=723.5 in 720 px viewport — `RefSelfHealingPolicy.ts:22` refusal) — the round-2/forensics fix spec, flag `selfHealOffscreen` |
| weakened-ref churn inflating appeared/weakened sets | — | reduces (fewer mid-render captures) | — |
| genuinely stale (69.6%) | correctly NOT absorbed | — | — |

---

## 5. DESIGN 4 — CDP identity batching + live-page hygiene

### 5.1 Measured cost and consumers (verified)

- Capture duration correlates with refCount: slope **0.175 ms/ref (run 15) → 0.274 ms/ref (run 16)**, corr
  0.37/0.60; ≥2,000-ref captures mean 761–1,280 ms; max capture 7,756 refs (run 16). Inside the capture:
  identity resolution performs up to **150 sequential `DOM.describeNode` calls** per capture
  (`ObservationService.ts:179-249`, `MAX_CDP_IDENTITY_ELEMENTS = 150`).
- **The live-page marker's only consumer is the resolver itself**: `data-browsegent-v2-marker` is written
  (`ObservationService.ts:527`), queried (`:204`), and cleaned (`:275,287`) by `ObservationService` alone.
  **No action resolution touches it** — `RefResolver.resolve` is pure Playwright locator scoring
  (`RefResolver.ts:41-58`); `backendNodeId`'s only consumer is the **hard fingerprint**
  (`runtime/refFingerprint.ts:9`). Removing the marker therefore cannot break click verification.
- **Shadow-DOM gap confirmed**: `DOM.querySelectorAll('[data-browsegent-v2-marker]')` cannot pierce shadow
  roots, so shadow elements never receive `backendNodeId` — hard fingerprints for shadow refs silently degrade
  to soft.

### 5.2 Design: one batched identity call, zero page mutation

Replace `setAttribute` + `querySelectorAll` + 150× `describeNode` with:

1. **Single batched call**: `DOM.getDocument({ depth: -1, pierce: true })` — one CDP round trip returning the
   full document tree *with backendNodeIds for every node including shadow roots* (pierce flag). Per-frame
   variant for D2.
2. **Order-aligned join**: the in-page walk already produces refs in document-order DFS (`walk()` over
   `children` + `shadowRoot`, `ObservationService.ts:294-302`); `getDocument(-1)` returns the same document
   order. Join by position with a **tagName-equality guard** at each step; any mismatch → fall back to
   `backendNodeId: undefined` for the remainder (soft fingerprints still apply; identical to today's behavior
   for the 150+ tail and all shadow refs). On persistent mismatch the resolver falls back to the current
   marker path behind the flag — migration is dual-path by construction.
3. **Live-page hygiene**: the marker write disappears entirely (flag `cdpBatchedIdentity`); page mutations
   from the observer drop to zero; MutationObserver-driven framework re-render risk eliminated (the
   re-render churn class that weakens refs mid-observation).
4. **Expected effect**: identity cost drops from O(min(150, n)) sequential RTTs to 1 RTT ≈ 5–20 ms; the
   capture hop's identity share (dominant in the measured 0.18–0.27 ms/ref slope) collapses; shadow refs gain
   real backendNodeIds (hard fingerprints work where modern apps live).

**Risk**: `getDocument(-1)` payload size on 7K+-ref pages (tens of MB of tree JSON in the worst case) — cap by
sampling: if `captured.length > 150`, request `depth: -1` once but process lazily; alternatively fall back to
the legacy marker path when the tree JSON exceeds a byte cap. Both guards are flag-scoped.

---

## 6. DESIGN 5 — targetId hardening (flag-gated, last)

**Measured upside**: across same-URL+same-generation consecutive observations, **97% (run 15: 63,557 of
65,597) and 94% (run 16: 91,384 of 97,663) of targetId-new refs are re-matchable by `(role|name)`** — the
appeared-inflation (round-2 BP3: median 654/574 same-page "appeared") is overwhelmingly the index term in the
hash (`targetId = hash(selectorCandidates[0] | name | text | index)`, `ObservationService.ts:569`).

**Design**: `targetId = FNV(role | accessibleName | text-prefix(64) | quantizedBox(24 px grid))` with
`nthRoleName` ordinal disambiguation for duplicate keys (the ordinal already exists for exactly this purpose,
`ObservationService.ts:558-560`).

**Regression surface (why it is last)**: duplicate-label siblings (the census's one AMBIGUOUS TWIN case,
Apple__10) get *stable but shared* identities when boxes shift within the 24 px grid — two "Buy now" buttons
swapping positions would re-match each other's identity. Mitigations: keep the box-quantization coarse only
when `nthRoleName` is unique; when duplicates exist, append the ordinal (current behavior) and accept
positional churn among twins. Flag: `indexIndependentTargetId`, A/B on balanced30; the round-2 BP3 topRefs
markers already soften the model-facing damage of churn, which is why D5's residual value is substrate-side
(weakened-ref churn, fingerprint stability) rather than wire-side — and why it ships after D1–D4.

---

## 7. Observation schema v3 + artifact budget

- **Version field**: `BrowserObservation.schemaVersion: 3` (new optional field; absent = v2 on dual-read).
  Additive fields only: `prose: ProseRef[]` (D1), `bodyTextLength` in `stats` (F11 ratio form),
  `frameOrigin`/frame tag on refs (D2). Every consumer that must dual-read: `RefService.assign` (ignores new
  fields), `ProjectionService` (maps `prose` when present), working-set serializer (passes prose to readables),
  render engine (renders the new group), benchmark evaluator (reads `finalAnswer` — untouched), trace
  `serialize.ts` (passes through). The round-1/2 renderers stay byte-identical when `prose` is absent — the
  schema-version check gates every new code path (`if (obs.schemaVersion >= 3)`), giving a one-flag rollback
  (`captureV3 = false` emits v2 verbatim).
- **Artifact-size budget** (284.3 MB/run-16 must not grow >2×): prose adds ≤2.5 KB × engaged captures
  (≈30–40% of 238 ≈ 80–95 × 2.5 KB ≈ **+0.24 MB/run, <0.1%**); frame refs bounded ≤40×3 per obs with 140-char
  caps (worst +~50 KB on the rare multi-frame page); D4 removes nothing from artifacts; D5 is identity-only.
  The dominant artifact driver stays the interactive walk itself (mean 1.19 MB, max 6.2 MB). Projected
  run-total: **≈285–290 MB (<2% growth)** — far inside budget. The audit's W2 (write-only 84 KB planner-input
  JSON, 18.9 MB/run) remains the bigger storage lever and is out of scope here.
- **F11 ratio form**: once `stats.bodyTextLength` persists (computed already, `ObservationService.ts:593-598`),
  the round-2 provisional absolute threshold (`refTextChars < 4,000`) upgrades to
  `refTextChars / max(1, bodyTextLength) < 0.25`, same `prose_poor_surface` advisory signal and same extract-
  mode gate; recalibrate the ratio on the first v3 run before tightening.

---

## 8. Balanced30 validation matrix

| Change (flag) | Must flip / improve | Must NOT regress | Guard metric |
|---|---|---|---|
| D1 prose capture (`captureProse`) | Wolfram__Alpha__10 (pod value visible; compound answer reachable), ArXiv__10 (procedure sentence at done) | Amazon__0/__10 Enter flows, Booking__0 run-16 winning trajectory, every current strict pass; Allrecipes/Cambridge captcha tasks (gate off) | user payload p90 +≤1.5 KB; prose bytes ≤2.5 KB/obs; gate fires only in extract/verify modes |
| D1 read-path extension (prose in ReadEvidence window) | `get` on pod/container refs returns values (Wolfram EP6-class reads become useful) | determinism receipts: every answered claim still maps to a captured artifact | zero live-DOM reads added; replay-verification test |
| D2 iframe traversal (`traverseSameOriginFrames`) | none on this slice (capability) | ESPN__10/ESPN__0 (20+ frame refs must not flood the 80-ref race) | ≤3 frames, ≤40 refs/frame; frame-tagged lines; zero refs from cross-origin |
| D3 quiet window (`mutationQuietWindow`) | weakened-ref count ↓; fewer fresh-but-rendered refusals | every strict pass; slow_but_alive tasks (no added steps) | stabilization p95 < 2 s/action; intrinsic time +≤2.5% |
| D3 offscreen self-heal (`selfHealOffscreen`, forensics spec) | the 26.1% fresh-but-rendered refusal class (Booking cell at fold) | ambiguous-twin refusals stay refusals (Apple__10 census case) | single re-observation cap; zero retry loops |
| D4 batched identity (`cdpBatchedIdentity`) | capture hop −; shadow refs get backendNodeId | refId stability (hard/soft fingerprint match rates must not drop) | position-join mismatch rate <1% → legacy path fallback; capture duration ≥20% lower on ≥2K-ref pages |
| D5 index-independent targetId (`indexIndependentTargetId`) | appeared-inflation ↓ (94–97% re-matchable), soft-fingerprint 0.55 downgrades ↓ | duplicate-label pages (Apple__10 twin case); transition strength semantics | appeared-count distribution on same-page pairs → median ≤50; no increase in wrong-target executions |

---

## 9. Sources

**Code (this worktree, read-only)**: `src/v2/substrate/ObservationService.ts` (walk:294-302, interactive
filter:461-486, visibility:488-504, selector attrs:443-459, marker set/query/clean:204,231,275,287,527,
identity resolve:179-249 + cap:8, targetId hash:569, readiness script:593-598, selectOptions:349-358);
`src/v2/substrate/BrowserSession.ts` (single page, no frames:59-64); `src/v2/substrate/CdpBridge.ts`;
`src/v2/substrate/RefResolver.ts` (locator scoring:41-58); `src/v2/harness/BrowseGentV2Harness.ts`
(replay-only reads:621-702, search_page:208-244, get bounds:190-195, W-A recapture
`fb0b44a`:509-516 + `post_action_capture_empty` note:489-496); `src/v2/harness/ReadEvidence.ts`
(1,800-char window:9-13, sameFrame:62-64); `src/v2/runtime/StabilizationService.ts:14-32`;
`src/v2/runtime/RefService.ts` (0.7 threshold:56-63, soft 0.55:100-109); `src/v2/runtime/refFingerprint.ts:9`
(backendNodeId consumer); `src/v2/runtime/types.ts:34` (frameId/backendNodeId fields);
`scripts/check_v2_boundaries.ts`.

**Artifacts (READ-ONLY, both runs re-mined this round)**: run 15 = 209 obs files, 203.3 MB (mean 973 KB,
max 3.2 MB); run 16 = 238 obs, **284.3 MB (mean 1,195 KB, p90 3,081 KB, max 6.2 MB)** — matches the audit §2;
capture-duration vs refCount (slope 0.175→0.274 ms/ref); empty-capture durations (2,060/873 ms mean);
frame-ish ref census (9/30; ESPN-heavy; zero src captured); same-page appeared re-matchability (97%/94%);
search_page prose probe (ArXiv__10 matches=0 pre-arrival; 0/39 calls with "51.5"); working-set mode
distribution (extract 41/33, verify 66/92 of 200/222); Wolfram pod ref detail (`v2ref_556`).
Prior docs: `architecture-sota-fitness.md` (ceilings c/f, W1–W6, R5, §9 gap arithmetic),
`core-architecture-leverage.md` (S2/S3, §2.1 hop table), `widget-verification-blueprints.md` (F11 gate §4.1,
BP3 marker design), `2026-09-04-low-confidence-ref-forensics.md` (23-step census, 69.6/26.1/4.3 split,
RefSelfHealingPolicy refusals:15-48), `date-widget-interaction.md` (W-A…W-D), `run16-validation-report.md`.

*Analysis scripts/caches kept outside the worktree (`%TEMP%\browsegent-arch\`); the worktree received only
this report. No evaluator changes; no site-specific logic; honest escalation preserved (prose never fabricates,
frames never cross origins, caps are hard); every design flag-gated with a byte-identical off-path.*
