# 02 — Runtime Architecture

## 1. Runtime Overview

The runtime is the operational core of BrowseGent v2. It exists to solve one irreducible production problem:

> **Browser environments are unstable execution substrates.**

Browsers are async, rerender-heavy, visually unstable, event-fragmented, partially observable, and mutation-prone. The runtime stabilizes this chaos into structured, trustworthy operational state that the planner can reason over.

### 1.1 Runtime Identity

The runtime is:
- A **continuously stabilizing execution environment**
- A **mechanical semantics layer** between raw browser substrate and planner cognition

The runtime is NOT:
- An autonomous agent
- A hidden planner
- A semantic cognition engine
- An adaptive governance system

### 1.2 Runtime Components

```
Runtime
├── Substrate (browser truth: CDP, DOM, AX, layout)
├── Refs (stable interaction identity)
├── Brain1 (operational projection)
├── Brain2 (continuity interpretation)
├── Graph (continuity topology)
├── Stabilization (execution safety infrastructure)
└── Observation Management (structured state queries)
```

### 1.3 Runtime Pipeline

The canonical information flow through the runtime is strictly ordered:

```
Browser Reality
→ Runtime Signals + Prior Graph Continuity
→ Brain2 Continuity Interpretation
→ Graph Continuity Update
→ Brain1 Operational Projection
→ Planner Cognition
```

This order preserves clean ownership, deterministic flow, and cognition centralization.

---

## 2. Refs System

### 2.1 What Refs Are

Refs are **multi-layer identity capsules** that replace CSS selectors as the primary execution target. A Ref aggregates multiple identity signals into a single stable reference:

| Layer | Signal | Stability |
|---|---|---|
| Backend ID | CDP backendNodeId | Hard identity (highest confidence) |
| Accessibility | ARIA role, name, description | High structural stability |
| Semantic | Text content, labels, landmarks | Medium stability |
| Visual/Geometric | Bounding box, viewport position | Low stability (microstate) |
| Recovery Hints | DOM path, sibling context | Soft recovery signals |

### 2.2 Design Philosophy

Refs exist because browser interaction identity must survive browser instability. Instead of:
- screenshot clicking (fragile, expensive)
- raw selector dependence (brittle across rerenders)
- ephemeral DOM handles (lost on mutation)

Refs provide:
- **Stable, generation-scoped identity**
- **Multi-signal resolution** for recovery
- **Backend nodes as hard identity** with semantic/geometric signals as soft recovery

### 2.3 Ref Properties

Each ref carries bounded operational metadata:

| Property | Purpose |
|---|---|
| generation_id | Execution epoch scoping |
| continuity_confidence | Trust strength (0–1) |
| locality_anchor | Region continuity link |
| resurrection_signals | Recovery hints (DOM path, sibling context) |
| invalidation_reason | Explainability (why trust changed) |

NOT: semantic embeddings, ontology tags, learned identities, or adaptive memory.

### 2.4 Ref Lifecycle

- Refs are **assigned by the substrate** during observation
- Refs are **scoped to generations** — valid within a stable execution reality
- Refs may be **weakened or invalidated** by the RefService using Brain2 transition evidence
- Ref **resurrection** uses multi-signal matching: backend ID first, then accessibility semantics, then geometric anchoring
- **Confidence levels** track trust — high-confidence refs execute directly; weak refs may trigger re-observation

### 2.5 Identity Resolution

The identity resolution engine follows a hierarchy:
1. **Backend node ID match** → high confidence, direct reuse
2. **Accessibility semantics match** → moderate confidence, usable with verification
3. **Geometric/structural match** → weak confidence, requires enrichment
4. **No match found** → ref declared stale, planner informed

The system favors **false negatives** (requesting re-observation) over **false positives** (wrong action on ambiguous target). This is a critical production safety principle.

### 2.6 Transition Classes

Not all browser transitions are equal. Ref behavior varies by transition class:

**Class 1 — Microstate Transition**

Examples: scroll, hover, animation, focus change, viewport resize, lazy loading, geometry movement.

Behavior:
- Refs remain valid
- Graph unchanged
- Brain1 projections mostly stable
- Brain2 emits low-strength continuity event
- No generation change

**Class 2 — Structural Local Transition**

Examples: modal open, accordion expansion, partial results update, dropdown expansion, inline rerender, SPA component rerender.

Behavior:
- Affected region refs weakened (confidence reduced)
- Unaffected graph preserved
- Partial Brain1 regeneration
- Brain2 emits moderate continuity transition
- Usually same generation

**Class 3 — Structural Macrostate Transition**

Examples: search results replaced, SPA route change, tab switch, major content replacement, workflow step transition.

Behavior:
- Many refs downgraded
- Graph continuity partially rebuilt
- Brain1 views regenerated
- Brain2 emits strong transition summary with macrostate-change evidence
- Generation transition — but preserve continuity opportunistically

**Class 4 — Hard Reset Transition**

Examples: full navigation, page reload, auth redirect, browser crash/recovery, frame replacement.

Behavior:
- Refs invalidated aggressively
- Graph continuity mostly discarded
- Brain1 rebuilt from scratch
- Brain2 emits hard reset transition
- Hard generation reset — the only truly destructive transition

### 2.7 The Trust Degradation Principle

> **Transitions should weaken trust before destroying identity.**

Current browser systems often do: identity vanished → rebuild everything. This is catastrophic.

Instead, the runtime operates on: identity confidence degraded. Browser instability is usually partial continuity degradation, NOT total reality replacement. This is a production-critical architecture advantage.

---

## 3. Runtime Substrate

### 3.1 Substrate Responsibilities

The substrate is the foundation layer. It owns:
- CDP access and browser protocol communication
- DOM queries and AX (accessibility) tree queries
- Layout/geometry computation
- Ref assignment and initial identity construction
- Visibility and actionability determination
- Navigation and frame state
- Event capture

### 3.2 Substrate Non-Responsibilities

The substrate must NEVER:
- Interpret semantic meaning
- Infer planner strategy
- Make autonomous decisions
- Classify content by domain
- Optimize workflows

The substrate provides **browser truth**. Period.

### 3.3 Substrate-Runtime Relationship

The substrate is entirely decoupled from planner logic. It feeds raw browser reality upward to Brain1, Brain2, and the graph. Higher layers compress and structure this reality for the planner.

---

## 4. Brain1 — Operational Projection

### 4.1 What Brain1 Is

Brain1 is an **operational projection engine**. It transforms browser complexity into planner-usable structured state through intentional, planner-oriented operational projection.

Brain1 is:
- An operational projection and structuring layer
- An affordance exposure system
- A locality-aware compression engine
- **Snapshot-oriented** — reflects current operational surface

Brain1 is NOT:
- A planner or planner replacement
- A cognition engine
- A semantic understanding system
- A domain interpreter
- A workflow inference engine
- A DOM summarizer or browser explainer

### 4.2 The Core Principle

> **Brain1 compresses operational complexity, NOT semantic complexity.**

Semantic complexity belongs to the planner. Operational reduction belongs to the runtime. Brain1 is the boundary surface where that compression happens.

> **Brain1 should project operational affordances first.**

The planner primarily needs: actionable structure, navigational structure, interaction affordances, task-relevant operational state, and continuity-visible structure. NOT: verbose semantic descriptions, narrative explanations, or generalized understanding.

### 4.3 The "No Runtime Intelligence" Correction

A critical architectural correction established that:

> **Brain1 projects operational affordances and structure, not semantic conclusions.**

Brain1 classifies **affordances** (clickable, editable, grouped, readable, navigational), NOT **intentions** (checkout flow, best flight, purchase optimization).

| Allowed | Dangerous |
|---|---|
| Grouping interaction surfaces | Inventing workflows |
| Exposing structural hierarchy | Inferring user intent |
| Projecting visible affordances | Assuming hidden state |
| Preserving ambiguity | Over-resolving ambiguity |

**Good Brain1 projection:**
```
Search Results Region
- 10 flight cards visible
- Sort dropdown available
- Filters: stops, airline, emissions
- Result card refs exposed
```

**Bad Brain1 projection (semantic narration — forbidden):**
```
This page appears to help users search for flights and compare travel options.
```

### 4.4 Three Projection Layers

Brain1 organizes projections into three bounded layers:

**Layer 1 — Structural Projection** (default runtime layer)

Pure operational structure: regions, lists, forms, modals, navigation groups, interaction surfaces. No interpretation.

**Layer 2 — Affordance Projection**

Operational capabilities exposed: sortable, expandable, selectable, scrollable, editable, paginated. Still NOT semantic cognition — just interaction affordance visibility.

**Layer 3 — Operational Labels** (strictly bounded)

Light operational convenience labels only: "Search Results", "Cart", "Filters", "Inbox". These labels emerge conservatively from accessibility structure, DOM semantics, and interaction clustering — NOT from keyword dictionaries, trained workflow taxonomies, or semantic heuristics.

### 4.5 Four Core Responsibilities

Brain1 has exactly four core responsibilities:

1. **Operational Selection** — Deciding what deserves planner attention (actionable controls, answer-like data, meaningful regions, navigation structures)
2. **Operational Structuring** — Transforming flat browser elements into meaningful structural clusters (regions)
3. **Operational Compression** — Dramatically reducing tokens, noise, repetition, and irrelevant structure while preserving affordances, relationships, and execution opportunities
4. **Operational Exposure** — Projecting compressed state through specialized views

### 4.6 Projection Views

Brain1 produces four specialized views (projections over shared browser truth):

| View | Content | Classification Signals |
|---|---|---|
| **Interaction** | Actionable controls, triggers, inputs | clickable, editable, focusable, role=button, select/menu/tab |
| **Readable/Data** | Text content, structured values | Text density, tables, headings, descriptions, answer-like entities |
| **Region** | Spatial/structural groupings | DOM locality, repeated patterns, visual grouping, structural clustering |
| **Navigation** | Route-changing controls | Pagination, tabs, step controls, menus, next/back |

These views:
- Are **filtered operational projections**, not invented semantic universes
- Derive from **shared browser truth** via mostly deterministic filtering
- May **overlap** — a button can appear in both Interaction and Navigation views
- Are **runtime-generated** (transient projections), not persisted giant semantic state
- Are **planner lenses**, not strict database partitions
- Must remain **freshness-aware** — exposing continuity confidence and stale uncertainty

### 4.7 View Generation Pipeline

```
Observation
    ↓
Candidate Extraction
    ↓
Lightweight Classification (affordance-based, NOT LLM-based)
    ↓
Region Grouping
    ↓
Operational Ranking
    ↓
View Projection
```

Brain1 does **not** run its own LLM. If ambiguous region labeling or difficult page understanding requires cognition, Brain1 exposes uncertainty and the planner may request an explicit inspection or vision step. Any LLM-derived interpretation remains planner-owned, not Brain1-owned.

### 4.8 Relevance and Exposure Control

Brain1 determines what the planner sees through **task-conditioned exposure**, not task interpretation:

**Safe relevance signals:**
- Visibility, actionability, structural prominence
- Readable density, planner-declared interest
- Locality, recent interaction proximity, causal freshness

**Dangerous relevance signals (forbidden):**
- Inferred user goals, domain assumptions
- Business semantics, hidden workflow interpretation

Key principles:
- **Brain1 should rank, not decide** — the planner remains the final cognitive authority
- **Relevance should be stable unless macrostate changes** — no hyper-reactive reordering
- **Exposure should be progressive** — structure first, details only when requested (planner-directed, not runtime curiosity)
- **Projection density is planner-controlled** — runtime exposes projection expansion capabilities; planner requests deeper inspection when needed

### 4.9 Region Construction

Regions are **operational compression boundaries**, NOT semantic categories.

**Allowed region labels:** scrollable interaction cluster, dense repeated card structure, expandable interaction group, modal, form, results list, navigation sidebar, toolbar
**Forbidden region labels:** "shopping section," "checkout flow," "flight booking process" — those are semantic interpretations (planner territory only)

Region construction is purely **structural**: DOM locality, visual containment, repeated sibling structures, interaction clustering, grouped structural relationships, bounded visibility areas.

**Region depth should be shallow** — page → major regions → optional lightweight subregions. No semantic tree forests.

### 4.10 Projection Properties

Every Brain1 projection should preserve:

| Property | Why |
|---|---|
| locality | Cognitive focus |
| affordances | Actionable reasoning |
| continuity markers | Trust grounding |
| freshness state | Stale prevention |
| structural hierarchy | Navigation reasoning |
| ref visibility | Execution grounding |

Avoid: semantic ontologies, workflow graphs, inferred user intent, autonomous summarization narratives.

### 4.11 Serialization

The serialization format should be **extremely boring**:

```json
{
  "regions": [],
  "interactions": [],
  "readables": [],
  "navigation": [],
  "warnings": [],
  "focus": {}
}
```

Simple. Flat-ish. Structured. Deterministic. Optimized for **planner readability**, not semantic purity.

### 4.12 Planner Query Interface

Simple, controlled queries (illustrative — names are NOT a locked API surface):
- `inspect_region()` — reveal region details
- `expand_readable()` — show deeper text content
- `show_actions()` — list available interactions
- `focus_near(ref)` — prioritize nearby elements
- `reveal_navigation()` — show navigation affordances

No arbitrary semantic querying languages.

### 4.13 Brain1 Explicit Non-Responsibilities

- Cognition, strategy, domain interpretation
- Workflow inference, business semantics
- Recovery, causality, planning
- Learning systems, adaptive memory, evolving ontologies

---

## 5. Brain2 — Continuity Interpretation

### 5.1 What Brain2 Is

Brain2 is a **continuity interpretation engine** — transition-oriented infrastructure that exists to solve one irreducible production problem:

> **Runtime continuity under browser instability.**

Brain2 is:
- A transition compression layer
- A continuity interpreter
- A freshness tracker
- A progress evidence provider
- **Transition-oriented** — it interprets what changed, not what exists

Brain2 is NOT:
- A thinking layer or second planner
- An autonomous reasoning engine
- A workflow interpreter
- A semantic optimizer
- A strategic recovery system
- A state machine designer

### 5.2 The Core Principle

> **Brain2 interprets transitions, not intentions.**

**Good Brain2 output:**
```json
{
  "transition_type": "structural_local",
  "changed_regions": ["results"],
  "new_readables_count": 18,
  "invalidated_refs": 12,
  "preserved_regions": ["navigation", "filters"],
  "continuity_confidence": "moderate"
}
```

**Bad Brain2 output (semantic narration — forbidden):**
```
"The search appears to have produced relevant results. User might want to explore the cheapest option."
```

### 5.3 Four Core Responsibilities

1. **Freshness & Invalidation** — What became stale, what remains trustworthy, what requires refresh, what survived transition
2. **Transition Interpretation** — Route changes, modal openings, result updates, region changes, visibility changes, interaction consequences (mechanical causal interpretation, NOT domain understanding)
3. **Progress Evidence** — Did execution produce meaningful observable change? (NOT: did user goal succeed)
4. **Runtime Continuity** — Maintaining interaction, region, ref, and planner context continuity

### 5.4 Progress Semantics

Brain2 exposes bounded progress evidence:

| State | Meaning |
|---|---|
| none | No meaningful observable change |
| weak | Local/microstate change |
| moderate | Structural/region change |
| strong | Meaningful macrostate transition |
| negative | Contradictory/unexpected transition |

This is enough. Simple. Bounded. Operationally useful. Brain2 reports **evidence, not conclusions**.

### 5.5 Generation Semantics

A generation represents **a stable execution reality** — not time, not every DOM mutation, not every render cycle.

**Good generation triggers:** Navigation committed, modal takeover, major results replacement, route transition, frame replacement, full semantic region restructuring

**Bad generation triggers:** Hover changes, tiny rerenders, animation, geometry shifts, scroll, loading ticks

Generations must be **sparse**. Generation explosion destroys ref validity, planner continuity, and runtime state stability.

### 5.6 Continuity Preservation

Most browser instability is NOT total instability. After a scroll, refs are mostly valid, regions mostly same, planner context mostly same — only geometry and visibility changed. This is **partial invalidation**.

**Foundational principle:** Preserve unless invalidated.

Continuity is more important than freshness maximalism. Brain2 preserves trusted runtime continuity unless meaningful evidence contradicts it.

### 5.7 Invalidation Granularity

Keep invalidation simple:

| Scope | Example |
|---|---|
| Ref-level | Target stale |
| Region-level | Results replaced |
| View-level | Interaction exposure changed |
| Generation-level | Execution reality changed |

No 50-level invalidation taxonomies. No "runtime bureaucracy."

**Critical principle:** Invalidation should weaken trust, not instantly destroy state. Downgrade continuity confidence rather than deleting everything.

### 5.8 Transition Summaries

Brain2 exposes **compact transition summaries** to the planner, never raw browser events:

```json
{
  "progress": "strong",
  "changed_regions": ["results"],
  "invalidated_refs": 12,
  "preserved_regions": ["navigation"],
  "generation_changed": false
}
```

Summaries must remain **observational**, not interpretive.

### 5.9 Brain2 ↔ Planner Boundary

| Brain2 Owns | Planner Owns |
|---|---|
| Freshness | Strategy |
| Invalidation | Intent |
| Transition interpretation | Goal reasoning |
| Continuity tracking | Semantic meaning |
| Runtime evidence | Decision making |
| Progress evidence | Task success judgment |

### 5.10 Determinism Constraint

Brain2 must remain deterministic. Same browser state transitions should produce same runtime interpretations. No stochastic runtime behavior, hidden adaptive logic, or evolving runtime heuristics.

### 5.11 Brain1 ↔ Brain2 Boundary

- **Brain1:** "What operational structure currently exists?" (snapshot-oriented)
- **Brain2:** "What changed meaningfully between observations?" (transition-oriented)

Brain1 is stateless-ish (reflects current operational surface). Brain2 owns continuity, transitions, progress, invalidation interpretation, and causal meaning.

Brain1 projects the current operational surface. Brain2 interprets how that surface changed. They are complementary, not competitive.

---

## 6. Microstate vs. Macrostate

### 6.1 Definition

| Type | Characteristics | Examples |
|---|---|---|
| **Microstate** | Volatile, high-churn, execution-level | Geometry, scroll position, hover state, visibility, focus |
| **Macrostate** | Semantic, meaningful, structural | Page content, region structure, results data, navigation state, form values |

### 6.2 Operational Separation

- Microstate stays in the substrate — changes do NOT trigger planner re-evaluation
- Macrostate triggers Brain2 invalidation evidence and planner re-evaluation
- The planner should wake up mainly when **meaningful macrostate changed**

This separation is a MASSIVE optimization — the runtime absorbs microstate churn while the planner focuses on meaningful structural and task-level transitions.

---

## 7. Continuity Graph

### 7.1 What the Graph Is

The graph is a **passive continuity topology** — lightweight infrastructure that exists because browser continuity is fundamentally relational. It exists to:
- Store runtime relationships between refs, regions, and interactions
- Maintain continuity linkage across browser transitions
- Coordinate structural relationships between Brain1 and Brain2
- Support localized invalidation
- Provide projection support for Brain1 views

The graph is justified because: refs relate to regions, regions relate to other regions, interactions link to refs and regions. Without relational topology, the runtime loses locality, adjacency, and continuity context. The graph is the minimum relational structure to preserve these properties.

### 7.2 What the Graph Is NOT

- A knowledge graph or knowledge representation system
- A semantic ontology engine
- A symbolic reasoning infrastructure
- An autonomous reasoning system
- A memory engine
- A planner replacement
- A deep hierarchical structure (should remain temporally shallow, no levels/hierarchies beyond basic ref→region)

### 7.3 Graph Design Principles

| Priority | Importance |
|---|---|
| Continuity | extremely high |
| Inspectability | extremely high |
| Cheap invalidation | extremely high |
| Shallow relationships | high |
| Deterministic updates | high |
| Compactness | high |
| Semantic richness | low |

### 7.4 Update Philosophy

> **Update minimally, preserve aggressively.**

When browser state changes:
- Preserve unaffected graph sections
- Update only impacted runtime structures
- Invalidate only necessary relationships
- Graph updates follow Brain2 transitions — mechanically reactive, NOT autonomously interpretive

### 7.5 Invalidation Model

| Scope | Meaning |
|---|---|
| Node invalidation | Ref/region stale |
| Edge invalidation | Relationship stale |
| View invalidation | Projection stale |
| Generation invalidation | Execution epoch replaced |

Bounded invalidation semantics. No cascading invalidation engines or universal consistency systems.

### 7.6 Continuity Mechanics

- Continuity should remain **local** — region-local, interaction-local, generation-adjacent
- No whole-page semantic continuity solving or giant graph reconciliation passes
- The graph maintains **runtime continuity evidence**, not philosophical identity proof

### 7.7 History Retention

- Retain only recent interactions, transitions, invalidations, and continuity relationships
- Only enough to support Brain2 interpretation, planner continuity, execution debugging, and loop prevention
- **History should decay naturally** — browser runtime state is ephemeral
- No giant runtime histories or persistent semantic evolution graphs

### 7.8 Memory Boundaries

The graph should remain **runtime state**, NOT long-term agent memory:
- Runtime graph is execution-scoped
- If future memory systems exist, they store planner-level summaries, task-level outcomes, and strategic abstractions — NOT runtime graph topology

### 7.9 Planner Exposure

The planner should NEVER reason directly over graph mechanics (nodes, edges, graph traversal logic, invalidation topology). The planner consumes Brain1 views, Brain2 summaries, and structured exposure. The graph is **invisible infrastructure**.

### 7.10 Serialization

Keep it boring:
- Adjacency lists
- Structured JSON-ish runtime state
- Lightweight node references
- Deterministic snapshots
- No graph query DSLs, ontology systems, or graph databases

---

## 8. Runtime Interaction Protocol

### 8.1 The Canonical Pipeline

The four runtime subsystems interact in a strictly ordered pipeline:

```
Runtime signals + prior Graph (continuity topology + memory)
    → feed →
Brain2 (continuity interpretation)
    → updates →
Graph (continuity topology)
    → supports →
Brain1 (operational projection)
    → feeds →
Planner (semantic cognition)
```

### 8.2 Ownership Clarity

| Subsystem | Owns | Does NOT Own |
|---|---|---|
| Graph | Topology, locality, continuity linkage | Interpretation, projection, strategy |
| Brain2 | Transition interpretation, freshness, progress | Projection, cognition, strategic recovery |
| Brain1 | Operational projection, affordance exposure | Continuity tracking, strategy, domain meaning |
| Planner | Semantic reasoning, strategic decisions | Runtime mechanics, browser truth, topology |

### 8.3 Planner-Facing State Composition

The planner receives a composed operational state that emerges from the pipeline:

```
Planner Input = Brain1 Projections + Brain2 Transition Summary + Uncertainty Signals
```

The planner NEVER receives raw graph topology, raw DOM data, raw browser events, or individual subsystem internal state.

### 8.4 Stabilization-Coupled Projection Refresh

Brain1 projections are refreshed **after runtime stabilization completes**, NOT on every DOM mutation:

```
Action Execution
    → Stabilization (waits, retries, layout settle)
    → Brain2 interprets transition
    → Graph updates continuity
    → Brain1 regenerates projections
    → Planner receives composed state
```

This prevents "projection thrashing" — excessive regeneration that wastes compute and confuses the planner.

---

## 9. Structured Observations

### 9.1 Observation Philosophy

Observations are the runtime's primary output to the planner. They must be:
- **Semantically dense** — maximum signal per token
- **Mechanically sparse** — minimum runtime noise
- **Structured** — not raw browser events
- **Stable** — consistent format across transitions

### 9.2 Layered Observation Model

Not every action requires the same depth of observation:

| Tier | When Used | Cost |
|---|---|---|
| Lazy Observation | Trivial actions, low risk | Minimal |
| Selective Enrichment | Moderate actions, some uncertainty | Moderate |
| Aggressive Verification | Critical actions, high risk | High |

The observation tier is determined by **action risk class**, not by runtime intelligence.

### 9.3 Evidence-Based Execution

Actions are treated as **negotiated state transition attempts**, not discrete fire-and-forget events. Every action:
1. Has preconditions (is the target valid? is it actionable?)
2. Produces observable evidence (did something change?)
3. Is verified through appropriate observation tier

This model eliminates the "click and hope" pattern that plagues v1 browser agents.

---

## 10. Runtime Evidence Model

### 10.1 What Runtime Exposes

The runtime exposes **evidence**, never strategic conclusions:

GOOD runtime output:
```json
{
  "results_region_updated": true,
  "new_readables": 18,
  "navigation_unchanged": true
}
```

BAD runtime output:
```
"Current strategy ineffective. Consider alternate workflow."
```

The second example is hidden cognition leakage and is strictly forbidden.

### 10.2 Evidence Categories

- Execution evidence (action outcomes)
- Continuity evidence (what survived transition)
- Uncertainty evidence (low confidence, ambiguous observations)
- Progress evidence (observable state changes)
- Invalidation evidence (what became stale)

All evidence is **observational and operational fact**, not cognition.
