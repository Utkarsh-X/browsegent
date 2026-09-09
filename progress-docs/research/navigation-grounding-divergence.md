# Navigation & Grounding Divergence Forensics: Run 15 (BrowseGent lean-plane) vs Run 6 (browser-control)

**Scope**: the 6 head-to-head losses (`BBC__News__10`, `ESPN__10`, `ArXiv__10`, `Coursera__0`, `Coursera__10`, `GitHub__0`) plus the `Wolfram__Alpha__10` compound-measurement archetype. Same model (`gemini/gemini-3.1-flash-lite`), same balanced30 WebVoyager set.

**Artifacts used**
- Ours (run 15): `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1788594583363\` — `traces/<task>_a1\planner\episode_*-{input,output}.json`, `compact-planner\`, `observations\`, `action_outcomes.json`, `trace.json`, `report.json`, `webvoyager_artifacts.json`, `webvoyager_evaluation.json`.
- Competitor (run 6): `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1788360177393\traces\external\browser-control\<task>_a1\{input.json,result.json,stderr.txt}`.
- Code: `src/v2/planner/prc/PromptLayoutEngine.ts`, `src/v2/planner/prc/PlannerRepresentationCompiler.ts`, `src/v2/planner/PlannerPrompt.ts`, `src/v2/planner/PlannerWorkingSetSelector.ts`, `src/v2/brain1/rankOperationalItems.ts`, `src/v2/substrate/ObservationService.ts`, `src/v2/agent/{AnswerContract,V2AgentLoop,FinalizationEvidence}.ts`, `tests/benchmark/webvoyager/judge.ts`.

**Method note**: planner inputs are the *pre-render* `PlannerInput`. Rendered-surface claims below were verified by re-implementing `PlannerRepresentationCompiler.buildSurface` + `PromptLayoutEngine.renderLeanElement` (12,000-char cap, region `maxVisible` 2/3/5 + pinned working-set refs, `Page Elements` remainder) over the stored inputs; all quoted `[v2ref_N]` lines are from that reconstruction of what the model actually saw.

---

## 1. Executive summary

Per-task hidden-vs-ignored verdict (the decisive affordance/data at the divergence step):

| Task | Divergence | Winning affordance in our rendered surface? | Verdict |
|---|---|---|---|
| `BBC__News__10` | EP1: we clicked nav "UK" → `/news/uk`; competitor used site search (`bbc.com/search?q=UK+climate+change+plan`) | **Ignored** — `[v2ref_21] <link name="Earth" />` and `[v2ref_2] <button name="Open menu" />` rendered at EP1; `navigate` tool available. Answer content (climate headlines) was **absent** from all 11 observations (0 climate-ish refs on bbc.com/news and /news/uk) | Model error (portal tunneling + `search_page` loop), not pipeline |
| `ESPN__10` | EP6: we clicked a "Gamecast" of a current regular-season game; competitor opened the postseason scoreboard URL | **Absent** — CFP/bracket links and the year selector are not in our DOM capture (0 hits in `obs_2_6`, 1,475 refs); only a conference `<select>` with a GUID name and no options was rendered. `[v2ref_2178] <button name="Calendar" />` **was** rendered and ignored | Mixed: DOM capture gap + URL-crafting policy gap; 7-8 of 12 steps contributed nothing |
| `ArXiv__10` | We reached the right anchor (`help/withdraw.html#submission-not-yet-announced`) but answered "contact the arXiv administrators" from a rendered *link label*; competitor synthesized the user-page Delete/Unsubmit procedure | **Absent as prose** — "Unsubmit", "delete or delay" appear **0 times** in the raw observation; only link labels were captured (`[v2ref_698] <link name="user page" />`, `[v2ref_573] <link name="contact arXiv administrators" />`). Model **ignored** the need to `get`/`inspect_region` the section | Prose-visibility gap + under-reading, not navigation |
| `Coursera__0` | We `done` from the results list after 2 steps, naming the 3rd card ('3D Printing Software'); competitor named the 1st card ('The 3D Printing Revolution') | Winning card **present and ignored**; our answer was actually grounded in a rendered card badge (`4.6 stars, 562 reviews, Beginner, Course, 1 - 3 Months`). Rejection was **guaranteed by the judge-evidence extractor** (first 40 DOM refs = Coursera header only) | Model choice + judge-evidence artifact (§3.4) |
| `Coursera__10` | EP1 query over-specified ("artificial intelligence for beginners ethical considerations") → target course never in results; then 8 clicks on course-card links that never navigated (loop-blocked ×3); `done` from list page | Competitor's simpler query surfaced the target card; our card **clicks never navigated** (URL stuck on `/search?...` across obs_1_3→obs_1_11) and judge evidence saw only header+suggestion chips | Query crafting + click-no-navigation handling + judge-evidence artifact |
| `GitHub__0` | We answered "WorldWindLabs/AgroSphere … 20 stars" from the 3 visible cards; actual top (`resource-watch/resource-watch`, 73 stars) was below the fold | **Hidden** — `resource-watch` (v2ref_2022) and `73 stars` (v2ref_2029) exist in `obs_1_6` (`visibility: offscreen`, y=797/906) but were **ranked out of the 80-ref working set** (`offscreen_low_value: 161`, 702/782 dropped). Sort control `[v2ref_1937] <button name="Sort by: Best match" />` **was** rendered and ignored; `missing_ranking_evidence` advisory **fired** and was overridden by design | Pipeline (below-fold + working-set rank-out) + no sort-execution guidance |

**Cross-cutting findings**

1. **The 12,000-char lean payload cap is NOT the problem.** Across 65 planner episodes on these 7 tasks, the `LEAN_SURFACE_PAYLOAD_CAP` (`PromptLayoutEngine.ts:398`) truncated only **9 element lines in 1 episode** (BBC EP3). Rendered lean SURFACE averages 6.8 KB (p95 11.4 KB). **Do not relax it.**
2. **The binding constraint is the 80-ref working set.** Every episode selected exactly 80 of 200–1,834 observed refs (`workingSetDiagnostics.observedRefCount/selectedRefCount`); `droppedRefCount` 164–1,754 per episode, dominated by `offscreen_low_value`. GitHub's winning row is the concrete casualty.
3. **The run-15 judge could not see any task content on our final pages.** `collectFinalPageEvidence` (`tests/benchmark/webvoyager/judge.ts:83`) emits the **first 40 DOM-order refs** of the last observation. On GitHub/Coursera/ArXiv/Wolfram final pages that is *pure chrome* (GitHub Copilot marketing nav, Coursera header, arXiv banner, Wolfram "UPGRADE TO PRO"). The judge's stated reasons ("Final Page Evidence shows only the GitHub navigation/marketing landing page") are literally accurate about this truncation while the page actually contained the evidence. Competitor evidence = its last 40 stderr thought-lines (rich self-report). This is an evidence-capture artifact layered under 3 of the 6 losses — the agent-side failures are still real and fixed below.
4. **Recovery machinery fired correctly and was overruled by the model.** `zero_result_read_loop` and `navigation_oscillation` states with actionable `nextMechanisms` (`act_on_visible_controls`, `inspect_region_or_scroll`) were rendered on 11/13 BBC, 7/11 Coursera__10, 5/11 ArXiv, 4/13 ESPN episodes — the model kept repeating `search_page`/blocked clicks anyway.
5. **System prompt is 57% of wire bytes** (10,579 B static vs 7,943 B mean user payload; n=200 calls). Conditional-prompt mode (flag OFF in run 15) would strip ~1.5–2.5 KB/call on these tasks with zero engaged-guidance loss (§6).

---

## 2. Per-task divergence timelines

### 2.1 BBC__News__10 — over-explore + read-loop; site-search path never taken

Goal: `Identify the main headlines covering the UK's plan to tackle climate change on BBC News.` (start `https://www.bbc.com/news/`).

Competitor (`webvoyager_lite_1788360177393/.../BBC__News__10_a1/stderr.txt`): 4 steps — fill search (fails), click, **open `https://www.bbc.com/search?q=UK+climate+change+plan`**, done from the search-results links. Strict pass.

Ours (13 planner calls, `v2_max_steps_exhausted`, empty answer; `report.json`):

| EP | obs → url | Action | Outcome |
|---|---|---|---|
| 1 | obs_1_1 `bbc.com/news` | click `v2ref_26` | click "UK" nav link → lands `/news/uk` (timeout error, URL changed) |
| 2–4 | `/news/uk` | `search_page "climate change"` ×2 | `matches: 0` |
| 5–9 | `/news/uk` | scroll / `search_page` ×3 | 0 matches; EP5 blocked by loop detector; `navigation_oscillation` from EP5 |
| 10–13 | `/news/uk` | `search_page` ×2, scroll, `search_page` | blocked ×2 more; budget exhausted |

Rendered EP1 surface (reconstructed from `planner/episode_1_obs_1_1-input.json`):

```
[v2ref_21] <link name="Earth" tools="c,r" />
[v2ref_25] <link name="US & Canada" tools="c,r" />
[v2ref_26] <link name="UK" tools="c,r" />
[v2ref_2]  <button name="Open menu" tools="c,r" />
```

- The model's EP1 click was goal-token-driven ("UK" matches the goal) and defensible; the divergence is EP2 onward: no search affordance was ever opened. BBC's search box is inside "Open menu" (rendered) or reachable via `navigate` to `bbc.com/search?q=...` (tool exists, `PlannerPrompt.ts:65`).
- **Content-absence proof**: `grep climate|net-zero|solar|drought` over all 11 observation files → **0 refs** (script output, obs_1_1..obs_1_11). The winning headlines only existed on the site-search page we never visited. No cap or working-set decision hid them.
- Recovery did its job: EP4 input carries `recovery: {"state":"zero_result_read_loop","blockedAction":{"tool":"search_page"},"nextMechanisms":["try_different_evidence_action","inspect_region_or_scroll","stop_if_dead_end_evidence_is_sufficient"]}`; the model repeated `search_page` 3 more times after the block.
- **Wasted steps**: 12 of 13 planner calls contributed nothing (EP1 navigated but to a dead portal).

### 2.2 ESPN__10 — step-limit + `incomplete_answer` contract failure; postseason view unreachable on our path

Goal: `Check ESPN for the score and a brief recap of the latest college football championship game.` (start `https://www.espn.com/`, geo-redirected to `espn.in`).

Competitor (stderr): 5 steps — open `/college-football/`, **open `espn.com/college-football/scoreboard/_/group/80/year/2025/seasontype/3`**, scroll, click `CFP DEC 19 - JAN 19`, done ("Indiana 27–21 Miami"). Strict pass.

Ours (13 calls, final `failureReason: answer_contract_failed:incomplete_answer`):

| EP | obs → url | Action | Note |
|---|---|---|---|
| 1 | obs_1_1 `espn.in/` | click search + type + Enter | type applied; no navigation |
| 2–3 | `espn.in/` | `search_page` ×2 | 0 value |
| 4 | → obs_2_5 | `navigate espn.com/college-football/` | correct hub |
| 5–6 | → obs_2_6 `/college-football/scoreboard` | click `v2ref_1690`, click `v2ref_2209` | **v2ref_2209 = `[v2ref_2209] <link name="Gamecast" tools="c,r" />`** on the *current-week* scoreboard → game page `north-texas-indiana` |
| 7–10 | game/preview pages | clicks `v2ref_3521/3548/3521/4372` | tunneling; 4 steps, no championship data |
| 11 | obs_2_11 = **`/nfl/scoreboard`** | navigate back to `espn.in/college-football/scoreboard` | recovered from accidental NFL detour |
| 12 | obs_3_12 | **select `v2ref_5114` value "2024"** | wrong control — see below |
| fin. | obs_3_13 | done: "championship … not currently available … no championship game has occurred or is listed" | `hasExplicitIncompleteResult` matches "information … not currently available" → hard `incomplete_answer` (`AnswerContract.ts:374`) → run failed with value recorded |

Key rendered lines at EP6 (`episode_6_obs_2_6-input.json`):

```
[v2ref_2175] <button name="Next" tools="c,r" />
[v2ref_2178] <button name="Calendar" tools="c,r" />
[v2ref_2142] <select name="1788595722847::118b0000::8c0c..." role="combobox" tools="c,s,r" />
```

- The `<select>` is the **conference filter** (text: "Top 25 FBS ACC American Big 12 …"), rendered with a GUID `name` and **no `options=` attribute**, so EP12's `select "2024"` targeted an invalid control. A year/season selector is absent from the entire 1,475-ref observation (`obs_2_6`), and **zero refs** match `CFP|Championship|Playoff|2025|2024` (grep output) — the postseason view simply was not reachable through rendered affordances on the default scoreboard.
- **Wasted steps**: EP2, EP3 (search_page), EP7–EP10 (game tunneling), EP12 (wrong select), EP11 (detour recovery) = **7 of 12 action steps**. Divergence: EP6 (clicking a Gamecast instead of advancing the season view).
- Also note the compound ask ("the score **and** a brief recap") — same multi-quantity family as Wolfram (§2.7).

### 2.3 ArXiv__10 — right page, wrong read (under-explored *evidence*, not navigation)

Goal: `Visit ArXiv Help on how to withdraw an article if the submission is not yet announced.` Reference: "…go to your user page and select either the Delete or Unsubmit icon."

Competitor (stderr): 11 steps, including **open `https://info.arxiv.org/help/withdraw.html`**, click "Submission not yet announced" (`@e112`), done with the user-page procedure. Judge pass.

Ours (11 calls, success=true, judge FAIL): EP1–EP7 `search_page` loop on `arxiv.org` (6 calls, incl. one loop-block), EP8 `navigate arxiv.org/help/withdraw` → `info.arxiv.org/help/withdraw.html`, EP9 click `v2ref_558` ("Submission not yet announced") → URL gains `#submission-not-yet-announced`, EP10 click `v2ref_558` **again** (no change), EP11 done: *"…you should contact the arXiv administrators directly."*

Rendered EP11 surface (the done moment):

```
[v2ref_558] <link name="Submission not yet announced" tools="c,r" />
[v2ref_573] <link name="contact arXiv administrators" tools="c,r" />
```

- **"Unsubmit", "delete or delay", "user page" (as prose) appear 0 times in the planner input at EP10/EP11** — and 0 times in the raw observations (`obs_2_9`, `obs_2_10`). The page's procedural sentence was never captured; only link labels were. The model assembled its answer from the rendered label `contact arXiv administrators`.
- EP10's input *did* render `[v2ref_698]/[v2ref_699] <link name="user page" tools="c,r" />` and `[v2ref_672] <link name="Withdraw / Retract a Submission" />` — the affordances to go deeper were present and ignored; `readableEvidence` at both episodes is 48 nav-link labels all tagged `answer_candidate` (noise — `PlannerWorkingSetSelector.ts` tags links inside the help TOC as answer candidates).
- Verdict: navigation was actually fine (we reached the anchor); the failure is **prose capture (DOM-walk keeps link names, drops paragraph sentences)** plus **no forced read of the focused section** before `done`.

### 2.4 Coursera__0 — answered from the results list in 2 steps; judge saw only the header

Goal: `Find a beginner-level online course about '3d printing' which lasts 1-3 months, and is provided by a renowned university.`

Competitor (stderr): 12 steps; search, then **click 'The 3D Printing Revolution' card ×7** (their clicks also appear not to navigate), done from the listing; judge PASS.

Ours (3 calls): EP1 type "3d printing" + Enter into `[v2ref_26] <input name="Search catalog" aria-autocomplete="list">`; EP2 click `v2ref_687` (search submit; timeout but navigated) → `/search?query=3d%20printing`; EP3 **done**: "The course '3D Printing Software', offered by UIUC, is a beginner-level course that lasts 1-3 months."

Rendered EP3 surface (`episode_3_obs_1_3-input.json`):

```
[v2ref_1452] <button name="3d printing software" tools="c,r" />        <- suggestion chip
[v2ref_1456] <button name="the 3d printing revolution" tools="c,r" />  <- suggestion chip
[v2ref_1523] <link name="The 3D Printing Revolution, offered by University of Illinois Urbana-Champaign, COURSE" tools="c,r" />
[v2ref_1533] <generic name="4.7 stars, 1.7K reviews, Beginner, Course, 1 - 4 Weeks" tools="r" />
[v2ref_1597] <link name="3D Printing Software, offered by University of Illinois Urbana-Champaign, COURSE" tools="c,r" />
[v2ref_1603] <generic name="4.6 stars, 562 reviews, Beginner, Course, 1 - 3 Months..." tools="r" />
```

- Correction to the earlier hypothesis (head-to-head doc §4.4 "answered from suggestion text"): the answer entity **was a real result card** with a "Beginner … 1 - 3 Months" badge. The model even reasoned strictly (the first card is "1 - 4 Weeks", which fails "1-3 months"). The evidenceSnapshot (`evidenceSnapshot.cards`) carried all four cards.
- Real agent-side gap: **no course-detail page was ever opened** (no click on any course link; done at EP3), while the judge protocol requires final-page support for the claims.
- Judge-side gap (decisive): `collectFinalPageEvidence` first-40 simulation for the final obs = Coursera header only ("For Individuals… Explore our catalog… Search catalog"). The judge's rejection "Final Page Evidence … is merely the Coursera homepage/search interface" is an artifact of the extractor, since the cards were on the page and in our planner input. Note the suggestion chips *did* make the cut (DOM-order before the cards) — which is why the loss looks like "suggestion grounding".

### 2.5 Coursera__10 — over-specified query, 8 non-navigating clicks, answer from list page

Goal: `Locate an introductory course related to artificial intelligence … suitable for beginners and contains at least one module discussing Ethical Considerations.` Reference: "Introduction to Artificial Intelligence (AI)" (IBM).

Competitor (stderr): search "introductory artificial intelligence" → click 'Introduction to AI' → course page → done citing "Module 4: Issues, Concerns, and Ethical Considerations". Strict pass.

Ours (11 calls, success=true, judge FAIL): EP1 typed **"artificial intelligence for beginners ethical considerations"** into the same `[v2ref_26] <input ... aria-autocomplete="list" role="combobox">`; EP2 submit-click navigated to `/search?query=artificial%20intelligence%20for%20beginners%20ethical%20considerations`; EP3–EP10 clicked course-card links `v2ref_1523`/`v2ref_1560`/`v2ref_1597` repeatedly — `action_outcomes.json` shows the first two clicks `observableEffect: true, stateChanged: false`, then **three `action_blocked_by_loop_detector` hard blocks**; URL never left the search page (obs_1_3→obs_1_11, all generation 1). EP11 done: "'Ethical AI: AI essentials for everyone' offered by the University of Cambridge … includes modules on ethical considerations."

- **Query divergence at EP1 is upstream of everything**: `grep "Introduction to Artificial Intelligence|IBM"` over the EP3 input = **0 hits**; the target course was never in our results because the query embedded goal constraints into the search string. Competitor's plain query surfaced it.
- The "module discussing Ethical Considerations" claim was **not verifiable from any rendered card** (cards show "Skills you'll gain: AI literacy, Prompt Engineering Tool…"); the required fact existed only on a course page we never reached.
- Click-no-navigation: 8 planner calls burned on clicks our own runtime measured as non-navigating. The loop detector blocked 3 but the planner re-picked *other* card links instead of switching mechanism (e.g., `get` the link href, or `navigate` to the course URL visible in the card link).
- Judge evidence again chrome-only (header + the "Responsible AI and Ethical Standards" suggestion chip `[v2ref_2042]` — the "search suggestions related to ethics" the judge mentioned).

### 2.6 GitHub__0 — the one unambiguous pipeline loss (hidden winning data)

Goal: `Search for an open-source project related to 'climate change data visualization' on GitHub and report the project with the most stars.` Reference: `resource-watch/resource-watch`.

Competitor (stderr): 2 steps — **open `github.com/search?q=climate+change+data+visualization&type=repositories`**, done: "resource-watch/resource-watch … 73 stars, the highest among visible results". Strict pass.

Ours (6 calls): EP1 click+type+Enter into search box (no navigation), EP2 retype, EP3 Enter again, EP4 `search_page` on a **mid-navigation page whose entire working set was 1 ref** (`[v2ref_1] <link name="Skip to content" …>`, userB=785), EP5 (now on `/search?q=…&type=repositories`) **done**: "WorldWindLabs/AgroSphere … 20 stars". EP6 re-done (nearly identical) after advisory steering; accepted with `advisoryNotes`.

Rendered EP5 surface (done moment) — the decisive excerpt:

```
[v2ref_1937] <button name="Sort by: Best match" aria-haspopup="true" tools="c,r" />
[v2ref_1956] <link name="moriahtaylor1/climate-change-analysis" tools="c,r" />
[v2ref_1960] <link name="6 stars" tools="c,r" />
[v2ref_1970] <link name="WorldWindLabs/AgroSphere" tools="c,r" />
[v2ref_1977] <link name="20 stars" tools="c,r" />
[v2ref_1987] <link name="akshaysonvane/Climate-Change-Data-Analytics-Visualization" tools="c,r" />
[v2ref_1998] <link name="11 stars" tools="c,r" />
```

- **The winner was in the DOM but not in the prompt**: `observations/obs_1_6.json` contains `v2ref_2022 name="resource-watch/resource-watch" box.y=797 visibility:"offscreen"` and `v2ref_2029 name="73 stars" box.y=906.5`. EP5 `workingSetDiagnostics`: `observedRefCount: 782, selectedRefCount: 80, droppedRefCount: 702` (`offscreen_low_value: 161, hidden_low_value: 121, generic_low_value: 82`). Neither ref was selected (`current.refs` has 80 entries; `v2ref_2022/2029` absent). Scoring context: `rankOperationalItems.ts:43-44` gives `visible +40 / offscreen +15`, and `goalTokens` don't match "resource-watch" (the repo name contains no goal keyword) — so the row lost the rank race against 149 `navigation_candidate`/`role_relevant_to_goal` chrome refs.
- The model therefore answered "most stars" from an **unsorted, truncated, best-match-ordered** list. It even hedged ("among the top results").
- **Gate behavior**: goal → `ranked_entity` contract (`isComparativeRankingGoal`, `AnswerContract.ts:309-330`: "most" + "stars"). At EP5 the done was **rejected/steered once** — EP6's input carries `answerFeedback` (advisory path, `V2AgentLoop.ts:277-289`) — and `missing_ranking_evidence`/`answer_does_not_match_top_ranked_evidence` could not be satisfied because the evidence text (from `EvidenceLedger` cards) listed only the 3 visible cards. `evidenceSnapshot.cards` = AgroSphere(20, pos 1), climate-change-analysis(6, pos 0), akshaysonvane(11, pos 2), AndreasPrein(no metrics, pos 3) — **no `activeSort` field was emitted**, so nothing told the model "this list is Best-match, not stars, and it is partial". Resource-watch has 73 stars and would have been position ~4+ in DOM order (y≈797–906, below the 3 rendered cards).
- Verdict: **HIDDEN** (working-set rank-out of a below-fold, goal-token-mismatched row) compounded by **ignored sort control** and a snapshot that omits sort provenance and truncation state.

### 2.7 Wolfram__Alpha__10 — compound-measurement archetype (7th loss, both engines 0/1)

Goal: `Give the geomagnetic field on June 20, 2023 in Oslo.` Reference: "geomagnetic field, total 51.5 uT".

Ours (8 calls, success=true, judge FAIL): EP1 type "geomagnetic field in Oslo on June 20, 2023" + compute click (×3 — two no-op clicks on `v2ref_50`), EP4 `press Enter`, EP6 `get v2ref_457` — which returned the *input field* text ("WolframAlpha input field … textbox"), a wasted read on the wrong element; EP7/EP8 done: "…magnetic declination … 3° 35' E (3.58° East)."

- At the done moment (`episode_7_obs_1_7-input.json`): the only result pod rendered is `[v2ref_550] <generic name="Magnetic declination for Oslo, Norway:Show DMS" tools="r" />`. The **"Geomagnetic field strength" pod exists in the observation but is `offscreen`** (`v2ref_556`, `vis:offscreen`), and the string "total intensity"/"51.5" occurs **0 times** anywhere in the planner input or observation — the total-intensity value was never in the captured DOM set (it lives in a below-fold pod body our walk didn't capture as a ref).
- `taskProgress` engaged (date constraint) but nothing checks multi-quantity completeness: the goal names a *composite measurement object* ("the geomagnetic field") and the answer covered one pod. Judge: "By providing only one specific component (declination) and ignoring the total intensity…".
- Note the shared pattern with ESPN ("the score and a brief recap"): a goal whose correct answer requires **more than one value** from the same result surface, with no generic completeness signal other than `requestedDetailCategories >= 2` (which requires ≥2 explicit category words in the goal).

---

## 3. Pipeline audit results

### 3.1 Where selection happens (file map)

- DOM capture → visibility: `src/v2/substrate/ObservationService.ts:502-503` — `intersectsViewport ? 'visible' : 'offscreen'` (viewport test only; no scroll-ahead capture).
- Scoring: `src/v2/brain1/rankOperationalItems.ts:43-44` — `visible +40, offscreen +15` (offscreen results carry a −25 handicap into every downstream race).
- Selection: `src/v2/planner/PlannerWorkingSetSelector.ts` — `maxPrimaryRefs 32 / maxNavigationRefs 24 / maxSecondaryRefs 48 / maxReadableEvidence 48` (confirmed in `workingSetDiagnostics.max*` fields); `classifyLowValue` (lines 401-412) drops `hidden && !text`, `offscreen && kind==='generic'`, `generic && !text`; goal-token bonus via `goalMatchesItem` (lines 420-427, substring match on goal words).
- Rendering: `src/v2/planner/prc/PlannerRepresentationCompiler.ts:84-101` (regions show 2/3/5 elements + pinned working-set refs; everything else into "Page Elements" remainder) and `src/v2/planner/prc/PromptLayoutEngine.ts:368-398` (lean `LEAN_SURFACE_PAYLOAD_CAP=12_000`, `renderLeanElement` name cap 120 chars, W: readable gist cap 48 chars).
- System prompt: `src/v2/planner/PlannerPrompt.ts:46-141` (static `base`; conditional stripping implemented behind `conditionalSystemPrompt`, OFF in run 15 — `providerPayload.serialization = {compactDataPlane:false, mode:"prc", prcTierOmitted:false}` and constant `systemBytes=10579`).

### 3.2 Payload-cap vs working-set counts (7 tasks, 65 episodes)

| Metric | Value |
|---|---|
| `LEAN_SURFACE_PAYLOAD_CAP` truncation ("N elements omitted (payload cap)") | **9 element lines in 1/65 episodes** (BBC EP3) |
| Rendered lean SURFACE size | mean 6,848 B, median 6,974 B, p95 11,403 B, max 15,673 B (cap 12,000) |
| Refs observed per episode | 1–1,834 (e.g., GitHub EP5: 782; ESPN EP12: 1,475) |
| Refs selected | **80 in every full episode** |
| Dropped per episode | 164–1,754; dominant reason `offscreen_low_value` (e.g., BBC 2,001 total, Coursera__10 2,653 total, GitHub 830 total across episodes) |
| Concrete casualty | GitHub `resource-watch/resource-watch` + `73 stars` (`obs_1_6.json` refs, `visibility:"offscreen"`, y=797/906) — not selected, never rendered |

**Verdict**: the most impactful cap to change is **not** the 12,000-char lean cap (keep it — it is cheap insurance and rarely binds). The impactful change is the **working-set treatment of below-fold result-list rows** (scoring handicap + goal-token-only relevance + the 80-ref budget spent on chrome).

### 3.3 Answer gates (what fired, what couldn't)

- `GitHub__0`: `ranked_entity` contract; advisory steering fired exactly once (EP5 done → `answerFeedback` present in EP6 input; `V2AgentLoop.ts:277-289` steers once, then records `advisoryNotes` and preserves the answer). The gate is doing what it was designed to do; it failed because the *evidence text* (`EvidenceLedger` card list) itself was truncated to visible cards and carried **no sort provenance / truncation marker**.
- `ESPN__10`: finalization done matched `hasExplicitIncompleteResult` ("information … not currently available", `AnswerContract.ts:374`) → hard `incomplete_answer` → `answer_contract_failed` (`V2AgentLoop.ts:848-856`). The honest-failure report is scored as a failed run — correct per WebVoyager semantics, but it means late-run honesty has zero payoff; the only winning move was finding the postseason view earlier.
- `Coursera__0/10`, `ArXiv__10`, `Wolfram__Alpha__10`, `BBC__News__10`: goal → contract kind `unknown`/`entity`/`description` with **no advisory that could fire**: no `requiresRankingEvidence` (Coursera goal has no comparative term), no detail-category pairs (Wolfram "Give the geomagnetic field" parses zero categories), nothing that distinguishes a list-page answer from a content-page answer. `BBC__News__10` never emitted a done at all.

### 3.4 Judge evidence extractor (run-15 strict protocol)

`tests/benchmark/webvoyager/judge.ts:83-123` — `collectFinalPageEvidence` = first **40** refs of the **last** observation in DOM order, 90 chars/line. Simulated on our final observations:

- GitHub (`obs_1_6`, search results page): 40 lines = "Skip to content / Close navigation menu / Homepage / Sign in / … / GitHub CopilotWrite better code with AI / …" — **zero result rows**. Judge: "Final Page Evidence shows only the GitHub navigation/marketing landing page… no evidence of search results".
- Coursera__0 / __10 (`obs_1_3` / `obs_1_11`, search pages): header links + combobox + suggestion chips; **zero course cards**.
- ArXiv (`obs_2_10`): announcement banner, theme radios, search chrome; **zero help prose**.
- Wolfram (`obs_1_7`): "UPGRADE TO PRO / APPS / TOUR / Sign in…".

So the run-15 judge was structurally unable to verify answers grounded below the first 40 DOM nodes, while run 6 was judged on its own last-40 stderr thought lines (which narrate what it found). This artifact amplified losses on Coursera__0, Coursera__10, GitHub__0 (and contributed to ArXiv/Wolfram), **independently of agent behavior**. Fixing the extractor is the single lowest-risk scoring correction; the agent-side mechanisms below are still justified because they fix the underlying navigation/grounding behavior.

---

## 4. Conditional-block engagement (token angle)

Engagement per episode (computed from all 65 planner inputs on the 7 tasks):

| Block | Size | Engaged on |
|---|---|---|
| recovery guidance (`RECOVERY_STATE_GUIDANCE`, all 6 states) | 1,493 B total | BBC 11/13, ArXiv 5/11, Coursera__10 7/11, ESPN 4/13, Wolfram 3/8 episodes (one active state, rest strippable) |
| `COMBOBOX_GUIDANCE` | 1,301 B | any episode whose surface had a combobox/searchbox: Coursera EP1-2, GitHub EP1-3/5-6, Wolfram 8/8, ESPN 8/13; **never BBC, never ArXiv** |
| `HORIZON_GUIDANCE` | 674 B | **0 episodes** on these tasks |
| `TASK_PROGRESS_GUIDANCE` | 579 B | Wolfram only (8/8) |
| `ANSWER_FEEDBACK_GUIDANCE` | 188 B | GitHub EP6, Wolfram EP8 |
| `EVIDENCE_SNAPSHOT_GUIDANCE` | 421 B | Coursera__0 EP3, Coursera__10 EP3-11, GitHub EP5-6 |

Wire economics (200 calls, all 30 tasks): `systemBytes` constant 10,579 B; `userBytes` mean 7,943 B (median 8,213, p90 11,206). **The static system prompt is ~57% of mean wire bytes.** Conditional-prompt mode (already implemented, flag off) would have stripped ≈1.5–2.5 KB on most of these calls (horizon always; taskProgress 25/30 tasks; recovery inactive-state text; combobox on BBC/ArXiv) — roughly **10–15% of total wire bytes** with no engaged guidance lost. Lean+PRC (already on) is the bigger win already banked: raw observation JSON is 52–84 KB on these pages (`compact-planner` stats: e.g., BBC EP1 originalBytes 52,579 → compact 11,080).

---

## 5. Design proposals, ranked by (recovered tasks × confidence) ÷ risk

All mechanisms below are site-agnostic; none mentions a benchmark site.

### P1 — Pin proven-ranked / metric-bearing result rows into the rendered surface (working-set boost) — `(2-3 tasks × high) ÷ low risk`
- **Mechanism**: when the goal implies a ranked/filtered result list, (a) exempt rows whose *combined row text* (container + descendants already in the observation) contains a metric pattern (`N stars`, rating, price) from the offscreen −25 scoring handicap and from `offscreen_low_value` (they are data, not chrome); (b) pin the top-K (e.g., 6) metric-bearing rows into the working set / surface even when below the fold.
- **Where**: `src/v2/brain1/rankOperationalItems.ts:43-44` (scoring), `src/v2/planner/PlannerWorkingSetSelector.ts:401-412` (`classifyLowValue` semantic exemption — extend the existing `allowSemanticOffscreen` role list to metric-bearing container rows), plus a new include reason `result_row` wired into `REASON_CODES` (`PromptLayoutEngine.ts:461`).
- **Token cost**: +2–6 surface lines (~150–450 B) on result pages only.
- **Overfit risk**: low — keys on generic metric patterns already used elsewhere (`AnswerContract.ts` `hasDimensionSignal`), not on GitHub specifics.
- **Expected flips**: `GitHub__0` (resource-watch/73 stars becomes visible → either the model picks it directly or `answer_does_not_match_top_ranked_evidence` rejects the wrong pick); helps `Coursera__0/10` card visibility marginally.

### P2 — Emit sort-provenance + partiality on the evidence snapshot, and add superlative→sort guidance — `(1-2 × high) ÷ low risk`
- **Mechanism**: (a) when result cards are built from a partial, unsorted-by-dimension list, render `sort=<observed label>:none:header` (e.g., from the rendered `[v2ref_1937] <button name="Sort by: Best match">`) and `partial=visible 3 of N cards` on the EVIDENCE SNAPSHOT; (b) one system-prompt sentence: *"If the goal asks for a superlative (most stars/cheapest/highest) and the surface shows a sort control whose label does not match that dimension, plan a click on the sort control (then the matching option) before answering; never report a superlative from a list you have not sorted or verified."*
- **Where**: `src/v2/agent/EvidenceLedger.ts` (card extraction — add header/sort capture), `renderEvidenceSnapshot`/`renderCompactEvidenceFacts` (`PromptLayoutEngine.ts:148-191`), guidance sentence in `PlannerPrompt.ts` base (conditionally strippable in conditional mode).
- **Token cost**: ~120 B/episode on result pages; +1 step when sort applies.
- **Overfit risk**: low (sort controls with "Sort by" labels are a universal pattern; the rule is conditional on a superlative goal).
- **Expected flips**: `GitHub__0` (model clicks "Sort by: Best match" → "Most stars", or at minimum refuses the unsorted claim and scrolls — combined with P1 the correct answer becomes reachable).

### P3 — Budget-aware synthesis + honest-terminal answer policy — `(1-2 × medium) ÷ low risk`
- **Mechanism**: when remaining planner steps ≤ 2 and `readEvidenceHistory`/surface readables contain goal-token matches, add a PROBLEMS line: `budget: 2 steps left — prefer done from gathered evidence over opening new pages; answer must still be grounded in evidence already read.` Separately, when a done answer matches `hasExplicitIncompleteResult` and ≥3 steps remain, convert the hard rejection into steering *before* finalization (today the hard rejection at finalization just fails the run: `V2AgentLoop.ts:848-856`).
- **Where**: `src/v2/agent/V2AgentLoop.ts` (episode budget tracking exists via `maxSteps`; add synthesis signal to `recovery`/`uncertainty`), `src/v2/planner/types.ts` (new recovery signal), `PlannerPrompt.ts`.
- **Token cost**: ~150 B on the last 2 episodes of each run.
- **Overfit risk**: low; the only risk is encouraging premature done — mitigated by requiring existing evidence matches.
- **Expected flips**: `BBC__News__10` (would at least produce a grounded-partial answer instead of `v2_max_steps_exhausted` with empty value; strict score unchanged but removes the empty-run tail); `ESPN__10` only in combination with P4/P5 (needs the postseason view first).

### P4 — Site-search-first navigation guidance — `(1-2 × medium) ÷ medium risk`
- **Mechanism**: conditional block (in the existing conditional-prompt machinery, `PlannerPrompt.ts:118-134`) engaged when the surface shows a search control **or** the last N reads returned zero matches and the site exposes none of the goal tokens: *"When on a large content site's section pages and on-page text does not contain goal terms, prefer the site's own search: type into the visible search control, or navigate to the site's search results URL (site domain + /search?q=<goal keywords>) instead of tunneling through section hubs."*
- **Where**: `PlannerPrompt.ts` (new conditional fragment + engagement predicate over `current.refs`), no runtime change.
- **Token cost**: ~350 B only when engaged (informational goal + zero-match loop), which is exactly the failure regime.
- **Overfit risk**: medium — "prefer search" can hurt on sites where search is weak (watch Booking/Google Flights regressions; gate on *informational/read* goals only, never transactional flows).
- **Expected flips**: `BBC__News__10` (both winning primitives — search box and search URL — are legal moves today); `ESPN__10` partially (the competitor's winning move was a URL-crafted deep link, same family).

### P5 — Click-no-navigation escalation — `(1-2 × medium) ÷ low risk`
- **Mechanism**: when a click on a link-ref succeeds but the URL is unchanged after re-observation **twice**, inject `recovery.state = click_no_navigation` with nextMechanisms `use_navigate_to_link_target | get_link_for_url | press_enter_on_link`; block a third click on the same ref (today the loop detector only blocks the literal repeat signature, and the planner moved between sibling card links: Coursera__10 `action_outcomes.json` steps 2-9).
- **Where**: `src/v2/agent/V2AgentLoop.ts` (Guard 1 area, lines 326-351 — it already computes `stateChanged`), recovery classifier that emits `zero_result_read_loop`/`navigation_oscillation` (extend states list + `RECOVERY_STATE_GUIDANCE`).
- **Token cost**: ~120 B only when engaged.
- **Overfit risk**: low — purely operational, no goal semantics.
- **Expected flips**: `Coursera__10` (stops the 8-click bleed, redirects the remaining budget to opening the course page); helps `ESPN__10` (the Gamecast tunneling had the same signature).

### P6 — Suggestions/list-page grounding advisory — `(2 × medium) ÷ medium risk`
- **Mechanism**: answer-contract advisory (steer-once, never hard-reject — same path as `missing_ranking_evidence`): when the done answer names an entity that matches a rendered **suggestion chip or result-card line** (elements whose names equal chip/card text) **and** no navigation to a non-results URL occurred after the last search-box type, emit `list_page_only_answer` with instruction "open the entity's detail page (click its link) or justify from a read of the entity's own page before done."
- **Where**: `src/v2/agent/AnswerContract.ts` (new advisory reason; chips/cards already flow through `EvidenceLedger` card extraction), `V2AgentLoop.ts:277-289` unchanged (advisory path exists).
- **Token cost**: 0 until fired; +1 step when fired.
- **Overfit risk**: medium — must key on "no content navigation since search" (URL-shape heuristic: same URL with query params after a search) rather than on the chip match alone, because Coursera__0's answer was legitimately card-grounded; as advisory it cannot destroy a delivered answer.
- **Expected flips**: `Coursera__10` (forces the course-page visit the judge demands — the module-4 claim only exists there); `Coursera__0` (would have clicked a course link; likely lands on the first card = competitor's answer).
- **Note**: for `Coursera__0/10` and `GitHub__0` the judge rejection itself is partly an extractor artifact (§3.4); fixing `collectFinalPageEvidence` (select goal-relevant refs or raise the cap beyond 40 DOM-order lines) is a scoring-pipeline change to evaluate separately and does not risk agent regressions.

### P7 — Compound-measurement completeness advisory — `(1 × low-medium) ÷ medium risk`
- **Mechanism**: when the goal requests a **named measurement object** without an explicit quantity (patterns: "the geomagnetic field/weather/nutrition/tide …" = determiner + compound noun, no `detail category` words), and the done answer matches exactly one result-pod title while the same page's observation contains ≥1 other pod title (visible or offscreen) sharing the pod-family header, emit advisory `possible_multi_quantity_answer: other pods = [...]`.
- **Where**: pod-title extraction lives beside `EvidenceLedger` card metrics (`X for <place>:Show <unit>` pattern is Wolfram-shaped; keep the trigger on generic "measurement object goal + ≥2 sibling pod titles" so it stays site-agnostic), advisory through `AnswerContract.ts`.
- **Token cost**: 0 until fired; ~80 B advisory line.
- **Overfit risk**: medium (advisory-only, so bounded); detection of "measurement object" is the weak link — keep the goal-side pattern list tiny and high-precision.
- **Expected flips**: `Wolfram__Alpha__10` (surfaces "Geomagnetic field strength … total 51.5 uT" as a sibling pod to read); `ESPN__10` (score **and** recap) partially.

### P8 — Read-the-focused-section before done (prose capture) — `(1 × medium) ÷ low risk`
- **Mechanism**: two halves: (a) DOM walk captures short paragraph text adjacent to links inside the focused anchor/section (currently only link labels survive — "user page", "Unsubmit" prose lost on ArXiv; `ObservationService.ts` ref extraction); (b) GOAL PROGRESS focus + `answer_candidate` labels on section links triggers a one-time `get` suggestion: *"When a navigation anchor matching the goal is in view, read its section (get on the section container) before answering; do not answer from link labels."*
- **Where**: `src/v2/substrate/ObservationService.ts` (+ `semanticHitTest.ts`), guidance in `PlannerPrompt.ts`.
- **Token cost**: +0.5–1.5 KB on pages where it engages (bounded to the focused section).
- **Overfit risk**: low-medium (prose capture increases surface size; cap it).
- **Expected flips**: `ArXiv__10` (the Delete/Unsubmit sentence becomes available; competitor's pass shows even partial prose suffices for the judge).

**Explicitly rejected / deprioritized**: relaxing `LEAN_SURFACE_PAYLOAD_CAP` (fires 1/65 episodes; relaxing costs tokens everywhere to fix nothing); increasing `maxSteps` 13→16 (head-to-head doc §6.4 — helps BBC/ESPN only if the extra steps aren't spent in the same loop; P3/P4/P5 address the loop itself at zero per-run token cost).

---

## 6. Validation plan (balanced30)

Primary harness: `tests/benchmark/webvoyager/run_webvoyager_lite.ts` (+ `judge.ts`); verify with `webvoyager_evaluation.json` strict score and the head-to-head comparison against the run-6 baseline (`logs/webvoyager-lite/webvoyager_lite_1788360177393`).

| Change | Must flip | Must NOT regress | Guard metric |
|---|---|---|---|
| P1 working-set result-row boost | `GitHub__0` | `Amazon__0`, `Apple__0`, `Google__Search__0`, `Google__Map__10` (list-heavy passes), `Huggingface__0/10` | userBytes ≤ current p90 + 1 KB; selection stays ≤ 80 refs |
| P2 sort provenance + superlative guidance | `GitHub__0` | `ArXiv__0`, `ESPN__0`, `BBC__News__0` (superlative-free goals must not gain steps) | plannerCalls ≤ current + 2 on non-superlative tasks |
| P3 budget synthesis | `BBC__News__10` (empty→answered), `ESPN__10` tail | `Booking__0/10`, `Google__Flights__0/10` (must not force premature done) | `incomplete_answer` failureReason count |
| P4 site-search-first | `BBC__News__10`, partial `ESPN__10` | `Google__Search__0/10`, `Booking`/`Flights` (gate to informational goals) | steps-to-first-search on news-like tasks |
| P5 click-no-navigation | `Coursera__10`, partial `ESPN__10` | `Coursera__0`, `Huggingface__10` (404 flows) | hard-block count per run |
| P6 list-page grounding advisory | `Coursera__0`, `Coursera__10` | `Amazon__0`, `Allrecipes__3`-type strict passes where list page *is* the answer surface | advisory fire rate on currently passing tasks ≈ 0 |
| P7 compound measurement | `Wolfram__Alpha__10` | `Wolfram__Alpha__0`, `Cambridge__Dictionary__0`-type single-value tasks | advisory fire rate |
| P8 prose capture + read-section | `ArXiv__10` | All strict passes (only additive evidence) | surface size p95 |
| Judge-evidence extractor fix (separate track) | `Coursera__0`, `Coursera__10`, `GitHub__0` re-scores | — | manual diff of `pageEvidence` for the 6 tasks |

Recommended sequencing: P1 + P2 (same subsystem, biggest single-task win, low risk) → judge-evidence extractor fix (scoring truth) → P5 + P6 (Coursera pair) → P4 + P3 (BBC/ESPN policy pair) → P7 + P8. Re-run balanced30 after each pair; a change ships only if the "must not regress" column holds.

---

## Appendix: key file-path evidence index

- Goals/verdicts/judge reasons: `logs/webvoyager-lite/webvoyager_lite_1788594583363/webvoyager_evaluation.json`, `report.json`, `webvoyager_artifacts.json`.
- Judge protocol + extractor: `tests/benchmark/webvoyager/judge.ts:19-27, 83-123`; usage `tests/benchmark/webvoyager/run_webvoyager_lite.ts:100`.
- Competitor step traces: `logs/webvoyager-lite/webvoyager_lite_1788360177393/traces/external/browser-control/webvoyager_lite_1788360177393_webvoyager_<Task>__<N>_a1/stderr.txt` (BBC: 4 steps incl. `open https://www.bbc.com/search?q=UK+climate+change+plan`; ESPN: `open .../group/80/year/2025/seasontype/3`; GitHub: `open github.com/search?q=...&type=repositories` then done citing 73 stars).
- Hidden GitHub row: `.../webvoyager_lite_1788594583363_webvoyager_GitHub__0_a1/observations/obs_1_6.json` (`v2ref_2022` "resource-watch/resource-watch", `v2ref_2029` "73 stars", `visibility:"offscreen"`); working-set stats in `planner/episode_5_obs_1_6-input.json` (`workingSetDiagnostics`).
- Rendered-surface quotes: reconstructed from the cited `planner/episode_*-input.json` files via the `PlannerRepresentationCompiler`+`PromptLayoutEngine` logic (`src/v2/planner/prc/*.ts`).
- Recovery firing: `planner/episode_4_obs_1_4-input.json` (BBC, `zero_result_read_loop`), `episode_7_obs_1_6-input.json` (BBC, `navigation_oscillation`), `Coursera__10/action_outcomes.json` (3 loop-detector hard blocks).
- Advisory steering: `GitHub__0/planner/episode_6_obs_1_6-input.json` (`answerFeedback` present), `src/v2/agent/V2AgentLoop.ts:223-298, 755-870`.
