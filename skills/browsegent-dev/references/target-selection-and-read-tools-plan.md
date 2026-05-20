# BrowseGent Target Selection and Read-Tools Plan

## Status Note

This plan is partially superseded by [system-gap-analysis-and-stabilization-roadmap.md](./system-gap-analysis-and-stabilization-roadmap.md).

Read-only DOM tools and the runtime page-change guard have already been implemented. The current next implementation target is now the deterministic targeting slice:

- internal element identity substrate
- backend-node/ref mapping
- CDP click pipeline with live hit testing
- minimal CDP perception enrichment only after the identity/click path is stable

The page archetype and soft action-intent parts below should be treated as later structural annotations, not the immediate next step and not hard filters.

## Executive Summary

BrowseGent is no longer weak because it cannot execute actions. It is now mostly limited by **target utility judgment**:

- which element is truly worth clicking
- when the right move is to inspect instead of click
- how to associate related fields inside repeated page regions

The current system is already strong at:

- semantic compression
- mutation tracking
- loop detection
- progress telemetry
- basic interaction scoring

The next step is not to copy browser-use's full architecture. The next step is to add the missing layer that answers:

**"What matters on this page for this task?"**

## What I Found In BrowseGent

### 1. Brain1 now detects interactivity better, but usefulness is still shallow

Current Brain1 in `/d:/BrowseGent/extension/content.ts` scores:

- selector quality
- interaction score
- actionability score
- keyword-style goal score

That is a good foundation, but it is still not enough to distinguish:

- useful result links vs navigation links
- same-page anchors vs meaningful navigation
- listing cards vs generic containers
- first-item fields vs unrelated repeated content

The main gap is that Brain1 still knows more about **clickability** than **task usefulness**.

### 2. Goal fit is still mostly lexical

`goalScore` is currently driven by regex keyword matching. That helps with recall, but it is weak for cases like:

- docs pages with many anchors
- article pages with sidebars and TOCs
- listings with repeated cards
- forms with multiple visually similar search/filter controls

This is why the system can still pick a valid element that is not the best element.

### 3. Region rescans exist, but region understanding is still underused

The Brain1 service in `/d:/BrowseGent/src/brain1/service.ts` already supports:

- targeted enrichment
- local region rescans

But region rescans currently only merge more nodes back into the pool. They do not yet produce strong region-level associations such as:

- "this company belongs to this job title"
- "this price belongs to this first product card"
- "this anchor is a table-of-contents jump inside an article"

### 4. Click execution is still simpler than the selection problem requires

Current executor/adapters do a good job of retrying and falling back, but:

- DOM click still uses direct `.click()`
- DOM click does not perform occlusion-aware preflight
- Playwright click does not have a richer semantic preflight path
- the system still relies heavily on the chosen selector already being right

That means execution is only as good as target choice.

### 5. BrowseGent lacks cheap read-only DOM tools

This is one of the highest-leverage gaps.

Right now the action set is still centered on:

- click
- type
- scroll
- wait
- get
- select

That means the LLM is often forced to choose between:

- clicking
- scrolling
- guessing

even when a safer answer would be:

- search the page for a phrase
- count matching elements
- inspect a repeated region
- list candidate links/buttons without acting

Browser-use solves part of this with lightweight tools like `search_page` and `find_elements`. We should adapt that idea in a BrowseGent-native way.

### 6. The graph remains compact, but structure is still underexposed

The serializer in `/d:/BrowseGent/src/graph/serializer.ts` is doing the right thing by staying compact. But the planner still does not get enough structural hints about:

- page archetype
- container/region type
- navigation chrome vs content area
- same-page jumps vs real navigation targets

This is a key reason why "worth clicking" is still under-modeled.

## What To Borrow From Browser-use

These ideas are worth adapting:

- richer interactive-element detection
- visible/actionable filtering before interaction
- explicit page statistics and structural hints
- cheap read-only DOM tools before mutating actions
- same-page stagnation / repeated-action awareness
- popup/overlay/occlusion awareness

## What Not To Copy

These are not the right next move for BrowseGent:

- full CDP DOM+AX+layout pipeline
- full MessageManager / compaction architecture
- full EventBus/watchdog system
- browser-use's entire prompt and history format
- large clickable-element trees as the main LLM surface

BrowseGent should keep:

- Brain1 = semantic snapshot + interaction understanding
- Brain2 = mutation / causality
- compact graph
- controlled executor

## The Right Architecture Direction

Do **not** add a public Brain 1.5.

Instead:

- keep one Brain1 boundary
- add a stronger **target utility model** inside Brain1/service orchestration
- add **read-only DOM tools** to reduce unnecessary clicks
- harden click semantics only after better target choice exists

So the internal flow should become:

`Brain1 base scan -> interaction scoring -> utility classification -> targeted enrichment -> region association -> compact graph + read-tools`

## Recommended Implementation Order

## Phase 1: Read-only DOM Tools and Runtime Page-change Guard

This is the safest high-leverage next move.

### Add lightweight read tools

Recommended initial tools:

- `search_page(pattern)`
- `find_elements(selector)`
- `count_elements(selector)`
- `inspect_region(selector)`

These should be:

- DOM-first
- cheap
- non-mutating
- usable without changing the page

### Add a runtime page-change guard

When a click causes:

- real URL change
- or meaningful same-page jump / hash movement that invalidates queued assumptions

the rest of the current mini-plan should stop and the agent should re-observe instead of continuing blindly.

### Why this comes first

Many tasks are not really click problems. They are:

- counting problems
- lookup problems
- "find whether this text exists" problems
- repeated-region inspection problems

Right now the system still clicks too often because it lacks safe inspection tools. The runtime guard reduces harm when a mutating action changes the page mid-plan.

### Important rule

These tools are for inspection and verification. They should not become a loophole for inventing new selectors outside the graph. They exist to reduce unnecessary mutation, not to bypass BrowseGent's selector discipline.

### Acceptance criteria

- the agent can answer count/listing/lookup tasks with fewer clicks
- queued plan steps stop after meaningful page change
- repeated click loops reduce on extraction-style pages
- these tools do not inflate the main graph excessively

## Phase 2: Page Archetype and Soft Action Intent Signals

This is the most important direct fix for "which element is worth clicking?"

### Add page archetype classification

Brain1/service should infer a lightweight page archetype such as:

- `article`
- `docs`
- `listing`
- `search_results`
- `form`
- `homepage`
- `error_or_blocked`

This must stay internal and compact.

### Add soft action-intent scoring per interactive node

Each interactive candidate should gain internal intent signals such as:

- `result_link`
- `same_page_jump`
- `primary_navigation`
- `submit`
- `search_trigger`
- `filter`
- `sort`
- `pagination`
- `dismiss`
- `secondary_utility`

These must be implemented as soft evidence, not rigid hard classes.

They should be derived from:

- tag / href / role
- surrounding region
- text / aria / placeholder
- position within likely nav/content containers

### Why this comes after read tools

This attacks the current gap directly, but it is safer once the agent already has non-mutating inspection tools and a page-change guard.

### Acceptance criteria

- same-page anchors are downranked when the task is extractive
- nav/sidebar/footer links are less likely to outrank result/content links
- search/filter controls are easier to distinguish

## Phase 3: Region Association for Repeated Layouts

This phase makes list pages and card pages much more reliable.

### Add region-level associations

For repeated containers, Brain1/service should derive relationships like:

- title + company + location belong to one job card
- title + price + rating belong to one product card
- heading + section anchor belong to one docs/article region

This should come from:

- local rescans
- DOM ancestry
- repeated sibling patterns
- region archetypes

### Important rule

Do not dump whole cards into the prompt. Store richer internal associations and expose only compact, ranked outputs.

### Acceptance criteria

- first-card extraction improves
- fewer wrong-field reads on repeated layouts
- region rescans produce higher-value data than raw extra nodes

## Phase 4: Intent-aware Progress Intelligence

Current progress guards are useful, but they are still generic.

### Add expected-effect hints tied to intent

Progress should depend partly on what the chosen candidate appeared to be:

- `same_page_jump`: hash change alone is weak
- `result_link`: URL or meaningful content change should usually appear
- `submit/search_trigger`: target value change plus result-region change matters
- `dismiss`: overlay disappearance matters
- repeated read-only inspections with the same result on the same page should eventually count as no-progress

### Why this matters

The biggest remaining risk is not only "wrong click before action". It is also:

- technically valid but semantically useless interaction
- fake progress from scroll/hash/focus changes
- repeated inspection that never advances the task

### Acceptance criteria

- weak anchor movement is no longer mistaken for strong progress
- post-action judgment becomes more semantic, not just mechanical
- progress remains conservative and does not overfit to benchmark sites

## Phase 5: Actionability and Click Semantics Hardening

This is where we adapt the best execution ideas from browser-use, but only after better target choice exists.

### Improve click preflight

Before clicking, add stronger checks for:

- visibility
- in-viewport relevance
- center-point hit testing
- occlusion-lite detection
- disabled/pointer-events state

### Improve click routing

Recommended policy:

- DOM-first when safe
- if DOM preflight says weak/occluded, prefer stronger runtime path
- keep JS/direct click fallback as one route, not the only route

### Why this is not first

If target choice is wrong, safer clicking still clicks the wrong thing.

### Acceptance criteria

- fewer silent wrong clicks
- better handling of overlays and weak same-page anchor targets
- clearer failure classification when a click should not proceed

## Phase 6: Scenario-Driven Evaluation

Do not optimize against fixed sites alone.

### Build scenario coverage around behaviors

Recommended scenarios:

- repeated same-page anchor jump
- repeated same-value read
- listing-card extraction
- docs-table-of-contents confusion
- search form with multiple similar controls
- popup/overlay blocking

### Success metric

Judge changes on:

- success rate
- steps to answer
- read vs click ratio
- no-progress aborts
- silent wrong-click reduction

## Historical Priority Order

This was the earlier recommendation before the browser-use Phase 2 and Agent Browser reference answers were folded back into the plan:

1. `Read-only DOM Tools + Runtime Page-change Guard`
2. `Page Archetype + Soft Action Intent Signals`
3. `Region Association`
4. `Intent-aware Progress Intelligence`
5. `Actionability / Click Semantics Hardening`
6. `Scenario Evaluation Expansion`

This order is no longer the active next-step order. Read-only tools and the page-change guard are implemented, and hard page archetype classification is now deferred.

## Active Next Implementation Target

The active next target is:

**Deterministic Targeting Slice: Element Identity Substrate + CDP Click Pipeline**

This should land before page archetype or hard action-intent classification because BrowseGent still lacks a browser-native identity and execution layer. See [system-gap-analysis-and-stabilization-roadmap.md](./system-gap-analysis-and-stabilization-roadmap.md) for the current source of truth.

Later, this plan's page/region/intent ideas can return as soft structural annotations and ranking signals, not hard filters.
