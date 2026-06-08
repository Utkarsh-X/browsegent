# BrowseGent v2 Master System Brief

**Document Purpose:** Transfer complete system understanding of BrowseGent v2 to a senior engineer joining the project. This document assumes you understand the existing architecture discussions, Brain1, Brain2, Graph, Planner, Runtime, Continuity philosophy, and Implementation philosophy. Your task is to understand how they fit together into a complete system.

**Optimize For:** Complete understanding, not brevity. Explain the evolution, not just the result. Expose weaknesses, not hide them.

---

## 1. PROJECT EVOLUTION

### 1.1 BrowseGent v1: The Original Ideas

BrowseGent v1 emerged from a straightforward premise: **browsers are chaotic execution environments, and LLMs are powerful reasoning engines. Can we connect them?**

The v1 architecture operated on these core ideas:

1. **Screenshot-first cognition**: Observe the page through vision models to understand layout and content.
2. **DOM filtering**: Reduce the gigantic DOM tree down to actionable nodes (inputs, buttons, readable text) through rule-based filtering.
3. **Selector-based interaction**: Target elements by CSS selectors. If clicks fail, retry with adjusted selectors.
4. **Simple agent loop**: observe → plan → act → re-observe, repeating until done or exhausted.
5. **Brain1 as DOM compressor**: Extract and score DOM elements to reduce token usage for LLM context.
6. **Brain2 as mutation tracker**: Watch for DOM mutations and associate them with the actions that caused them (clicks, fetches, timers).
7. **Graph as history**: Store mutation deltas to show the LLM what changed after each action.

This was a reasonable starting architecture. The system actually worked reasonably well on many tasks.

### 1.2 Major Problems in v1

But as the system evolved, **fundamental production problems emerged**:

#### Problem 1: Selector Brittleness

CSS selectors are fragile. They break when:
- The page rerenders (React reconciliation)
- The DOM structure changes slightly
- Selectors are overfitted to one page instance

v1's strategy was: **try the selector, if it fails, retry with a different selector**. But this created runaway retry loops. Retry logic spread into the agent logic, the executor logic, and safety guards. The system became deeply entangled with mechanical retry concerns.

#### Problem 2: Distributed Intelligence Everywhere

Because the selector-based approach was so fragile, v1 started embedding **scattered tactical intelligence** throughout the runtime to compensate:
- Selector validation heuristics
- Ambiguity detection rules
- Click retry policies
- Recovery strategies
- State inference logic

Each component got smarter to handle selector instability. This created **distributed semi-intelligence** — the runtime had opinions about strategy, recovery, workflow, and task success that should have belonged only to the planner.

This made the system **unreplayable**. If you captured a trace, you couldn't reconstruct what the system "saw" or "decided" at each step. The runtime had hidden decisions.

#### Problem 3: Planner Overload

Because the runtime was fragile and unreliable, the planner's prompt grew **gigantic** trying to handle edge cases:
- Watch out for stale selectors
- If clicks fail, try scrolling first
- Check if elements are visible
- Handle loading states
- Detect loops and dead-ends

The planner became a **browser survival manual** instead of a semantic decision-maker. Every runtime failure became the planner's responsibility to manage. Token usage exploded.

#### Problem 4: Continuity Degradation

As the browser state evolved (navigation, rerenders, modal changes), v1 had no principled way to track **what stayed the same**. When a page rerendered, v1's heuristic was roughly: **throw out old selectors and rescan from scratch**.

There was no concept of:
- Partial continuity (some refs survived, some didn't)
- Confidence degradation (refs got weaker before they became invalid)
- Meaningful transition classification (what kinds of changes happened?)
- Graph topology of continuity (which regions survived together?)

The system leaked continuity constantly and couldn't preserve operational identity across browser chaos.

#### Problem 5: Planner Input Explosion

v1's approach to exposing browser state to the planner was: **dump everything, compress a little**. The graph context contained:
- All captured nodes with their text
- All recent mutations with their timing
- All selector patterns
- All historical action attempts
- Fragments of retry logic outcomes

The planner received a fire hose of mechanical details instead of clean operational structure. Context windows filled up; token costs exploded; the planner spent cognition on parsing noise.

### 1.3 Why v2 Was Created

The fundamental realization that drove v2 was:

> **The problem is not that the planner is insufficiently clever.**
> **The problem is that the runtime is insufficiently trustworthy.**

The solution was not to make the planner smarter. The solution was to **build a runtime that the planner can actually trust**.

Instead of: "planner compensates for runtime weakness"
Become: "runtime stabilizes for planner"

This required a **fundamental architectural correction**.

### 1.4 Major Architectural Changes

#### Change 1: From Selectors to Refs

**Old:** CSS selectors are the primary execution target. They're brittle. Retry when they fail.

**New:** Stable **refs** (reference objects) become the primary execution target. A ref encapsulates multiple identity signals:
- Backend node IDs (from CDP)
- Accessibility semantics (ARIA role, name)
- Text content and labels
- Visual/geometric signals
- Recovery hints (DOM path, sibling context)

When a ref can't be resolved, the system doesn't blindly fall back. It **reports the failure** as evidence to the planner rather than silently retrying.

#### Change 2: From Screenshot-First to DOM-First Cognition

**Old:** Vision models interpret the page screenshot. This is expensive, noisy, and unstable.

**New:** DOM-grounded cognition by default. The runtime exposes:
- Structured DOM/accessibility tree data
- Stable DOM facts (role, name, actionability)
- Computational evidence (visibility, occlusion, geometry)

Vision is **escalation only** — the planner can request visual inspection when semantic ambiguity is too high. But it's not the default path.

This reduces cost by 10-100x and improves stability dramatically.

#### Change 3: Refs Scoped to Generations

**Old:** No clear concept of "operational stability windows." Selectors are assumed valid until proven wrong.

**New:** Browser state is divided into **generations** — periods of operational stability:
- A generation begins when the page is in a coherent state
- It ends when a macrostate transition occurs (navigation, major rerender, modal change)
- Refs are **generation-scoped** — a ref is valid until its generation ends

When a generation ends, refs don't instantly become invalid. They **downgrade in confidence**. Low-confidence refs are weakened before they're destroyed.

#### Change 4: Transition Classification

**Old:** Page changed. Rescan everything. Start over.

**New:** Transitions are classified into types:
- **Microstate**: scroll, hover, animation, focus (refs stay valid, refs may refresh)
- **Structural local**: modal open, accordion expand, partial update (affected refs weaken, unaffected preserved)
- **Structural macrostate**: search results replace, route change, major workflow step (many refs downgraded, generation transition possible)
- **Hard reset**: full page navigation, reload, auth redirect (refs invalidated aggressively, new generation)

Each transition type gets different runtime handling. Not everything requires full reconstruction.

#### Change 5: Mechanical Stabilization Layer

**Old:** Retry logic scattered throughout. Heuristics embedded in safety guards. Runtime decisions about recovery.

**New:** Dedicated **stabilization infrastructure**:
- Bounded retry policies (mechanical, deterministic)
- Actionability verification (visibility, enablement, occlusion checks)
- Geometry refresh (handle layout shifts)
- Confidence-based filtering (low-confidence refs rejected before execution)

All mechanical stabilization happens **before** the planner sees state. The planner receives already-stabilized observations.

#### Change 6: Centralized Cognition

**Old:** Hidden intelligence throughout the runtime. Safety guards make strategic decisions. Recovery logic makes strategy choices.

**New:** **One semantic authority: the planner.**

Everything else is mechanical:
- Substrate: provides browser truth, no interpretation
- Brain1: exposes operational affordances, no strategy
- Brain2: interprets transitions mechanically, no goals
- Graph: stores topology, not knowledge
- Tools: execute primitives, no autonomy
- Runtime: stabilizes mechanically, no planning

The planner is the only semantic cognition layer. Everything below it is deterministic, bounded, and observable.

### 1.5 Major Philosophy Changes

#### Philosophy 1: From "Clever Runtime" to "Trustworthy Runtime"

**v1 Philosophy:** The runtime should be as smart as possible to reduce planner burden.

**v2 Philosophy:** The runtime should be as **trustworthy and explainable** as possible. Simple predictable systems win in production.

#### Philosophy 2: From "Maximize Autonomy" to "Maximize Observability"

**v1 Philosophy:** The agent should be as autonomous as possible, requiring minimal human oversight.

**v2 Philosophy:** Every decision should be **traceable**. Replay should show exactly what the system saw and decided. Observability is a first-class property.

#### Philosophy 3: From "Fail-Fast Retry" to "Confidence Degradation"

**v1 Philosophy:** If something fails, retry. Retry again if it fails again. Fail only after exhaustion.

**v2 Philosophy:** Maintain continuity through partial confidence reduction. Downgrade trust before destroying identity. Let the planner decide if recovery is necessary based on actual evidence.

#### Philosophy 4: From "Planner Compensates" to "Runtime Enables"

**v1 Philosophy:** Planner should handle edge cases; if something doesn't work, it's the planner's fault.

**v2 Philosophy:** Runtime should eliminate edge cases before the planner sees them. The planner thinks about *goals*, not *browser mechanics*.

---

## 2. CURRENT V2 VISION

### 2.1 What BrowseGent v2 Is

BrowseGent v2 is a **centrally cognitive browser runtime** — a production-grade system that:

1. **Observes the browser** deterministically through a structured substrate (DOM, accessibility tree, CDP)
2. **Stabilizes browser chaos** through dedicated runtime infrastructure (refs, Brain1, Brain2, graph, continuity)
3. **Exposes clean operational state** to the planner through compressed, evidence-grounded projections
4. **Executes semantic intents** from the planner into bounded, observable browser interactions
5. **Produces traceable evidence** of every step for debugging, validation, and replay

### 2.2 What Problem It Solves

The fundamental production problem: **Browsers are hostile, unstable execution substrates.**

Browsers are:
- **Asynchronous**: events and mutations arrive unpredictably
- **Rerender-heavy**: React, Vue, Angular constantly reshuffle the DOM
- **Visually unstable**: geometry shifts, animations, lazy loading, infinite scroll
- **Partially observable**: frames, shadow DOM, web workers, service workers
- **Event-fragmented**: clicks, timers, fetches, network events interleave

v2 solves this by building a **stability layer** that turns this chaos into structured, queryable, trustworthy operational state. The planner doesn't fight the browser directly. It reasons over what the runtime has stabilized.

### 2.3 What Makes It Different

#### Compared to Screenshot-First Agents

**Screenshot agents** use vision models to interpret page layout and content.

**v2 is DOM-first** with vision escalation. DOM queries are orders of magnitude cheaper and more precise. Vision is used only when semantic ambiguity is unavoidable.

#### Compared to Selector-Based Automation

**Selector automation** targets elements by CSS selectors and retries when selectors fail.

**v2 uses ref-backed targeting** with multi-signal identity. Refs survive browser instability better than selectors. When identity can't be recovered, the system reports evidence rather than silently retrying.

#### Compared to Multi-Agent Orchestration

**Multi-agent systems** have multiple specialized planners coordinating through a manager.

**v2 is single-planner, centralized cognition**. One semantic reasoning stream. No hidden planners, no distributed decision-making. This makes the system traceable and debuggable.

#### Compared to Semantic Ontology Systems

**Ontology systems** build knowledge graphs of pages and tasks, trying to understand domain structure.

**v2 remains operationally shallow**. The runtime doesn't try to understand *what pages mean* or *what tasks entail*. It exposes structure operationally. The planner does semantic interpretation.

### 2.4 What Makes It Innovative

The most original architectural contribution is the **Runtime Semantics Layer**:
- Brain1 compresses operational complexity
- Brain2 interprets continuity transitions
- The graph stores continuity topology
- Stabilization handles browser instability

This combination makes the system:
- **Mechanically deep** (the runtime is internally sophisticated)
- **Cognitively shallow** (the planner stays focused)
- **Continuity-aware** (tracking what survives across browser chaos)
- **Operationally explainable** (every step is traceable)

Existing browser agents are either:
- Cognitively complex (giant prompts, hidden retry logic, distributed decisions)
- Mechanically shallow (simple retry loops, screenshot processing, selector targeting)

v2 is **the inverse**: mechanically sophisticated, cognitively simple. This is genuinely novel.

### 2.5 What It Is NOT Trying to Become

**v2 is intentionally NOT:**

- A general browser automation framework (it's agent-specific)
- A multi-agent orchestration engine (single planner by design)
- A semantic ontology system (runs operationally, not semantically)
- A screenshot-first visual agent (DOM-first by design)
- An infinite-loop general AI (bounded, production-oriented)
- A perfect autonomous system (conservative execution, evidence-based)
- A generic knowledge graph system (shallow continuity topology only)

v2 targets **operational reliability and production truthfulness** rather than theoretical sophistication or benchmark chasing.

---

## 3. COMPLETE ARCHITECTURE WALKTHROUGH

### 3.1 The Layered Stack

```
┌─────────────────────────────────────────┐
│           PLANNER (LLM)                  │  ← Semantic cognition layer
│  sole semantic reasoning authority       │
├─────────────────────────────────────────┤
│  Brain1 (Operational Projection)        │  ← Compression layer
│  Brain2 (Continuity Interpretation)     │
├─────────────────────────────────────────┤
│  Runtime Graph                          │  ← Continuity topology
├─────────────────────────────────────────┤
│  Runtime Stabilization                  │  ← Mechanical correction
│  ├─ RefService                          │
│  ├─ TransitionService                   │
│  ├─ StabilizationService                │
│  └─ InputService (interaction)          │
├─────────────────────────────────────────┤
│  Browser Substrate                      │  ← Browser truth
│  ├─ BrowserSession                      │
│  ├─ ObservationService                  │
│  ├─ CdpBridge                           │
│  └─ Harness (Playwright adapter)        │
├─────────────────────────────────────────┤
│      Chrome/Chromium via Playwright     │
│      (the hostile infrastructure)       │
└─────────────────────────────────────────┘
```

### 3.2 Subsystem Responsibilities Matrix

#### **Subsystem: Browser**

The raw browser environment.

**Responsibilities:** Render pages, run JavaScript, maintain DOM, generate events.

**What It Must Never Do:** Nothing. It's the environment, not under v2 control.

**Inputs:** Navigation commands, interaction events.

**Outputs:** DOM state, accessibility tree, network events, mutations.

**Interactions:** Receives commands from Harness. Emits state changes observed by CdpBridge/ObservationService.

**Boundaries:** Complete isolation. The runtime never assumes browser stability.

---

#### **Subsystem: Browser Harness (Playwright Adapter)**

The interface between v2 runtime and the browser via Playwright.

**Responsibilities:**
- CDP protocol abstraction
- DOM query execution
- Interaction dispatch (click, type, scroll)
- Navigation control
- Frame management
- Network monitoring hooks

**What It Must Never Do:**
- Interpret semantic meaning
- Make strategic decisions
- Retry autonomously (beyond substrate primitives)
- Classify content by domain

**Inputs:** Interaction requests, queries, navigation targets.

**Outputs:** Raw DOM nodes, geometry, layout data, navigation confirmations.

**Interactions:** Upstream: called by ObservationService and InputService. Downstream: calls Playwright APIs and CDP.

**Boundaries:** Pure adapter layer. No business logic. Purely technical integration.

---

#### **Subsystem: Substrate (BrowserSession, ObservationService, CdpBridge)**

Collects and structures raw browser truth into queryable facts.

**Responsibilities:**
- Manage browser session lifecycle
- Execute DOM and accessibility queries
- Resolve CDP backend node IDs
- Capture interaction candidates
- Compute geometry and visibility
- Assign initial ref identities
- Maintain session state

**What It Must Never Do:**
- Interpret transitions
- Classify changes
- Infer continuity
- Make confidence judgments about ref validity

**Inputs:** Query requests, interaction targets, navigation commands.

**Outputs:** BrowserObservation (structured facts: candidates, visibility, geometry, actionability).

**Interactions:**
- Called by: ObservationService, RefService, Brain1
- Calls: Harness, CdpBridge
- Produces: Raw facts for downstream interpretation

**Boundaries:** All "browser truth" originates here. Above the substrate, facts are interpretation (Brain2) or compression (Brain1).

---

#### **Subsystem: Refs (RefService)**

Assigns, tracks, and resolves stable interaction identities.

**Responsibilities:**
- Assign generation-scoped refs during observation
- Preserve refs when identity confidence remains high
- Weaken refs when soft identity signals match
- Invalidate refs when confidence falls below execution threshold
- Resolve refs to current interactions (resurrection)
- Reject ambiguous resurrection
- Track ref lifecycle and confidence degradation

**What It Must Never Do:**
- Make strategic execution decisions
- Infer task meaning from continuity
- Classify transitions
- Decide retry policy

**Inputs:**
- New observations (candidates to assign refs)
- Previous observations (for resurrection)
- Brain2 continuity evidence

**Outputs:**
- RefResolution: is this ref still valid? Can we execute on it?
- RefComparison: did refs survive the transition?
- Ref state: live, weakened, stale, invalid

**Interactions:**
- Assigns refs during substrate observation
- Receives continuity evidence from Brain2
- Provides execution-ready refs to tools
- Feeds ref lifecycle to trace

**Boundaries:** Ref mechanics are completely isolated from execution strategy. The runtime decides identity. The planner decides execution.

---

#### **Subsystem: Brain1 (Operational Projection)**

Compresses browser complexity into structured operational views.

**Responsibilities:**
- Walk the DOM tree (including shadow roots)
- Classify nodes as: trigger (interactive), input (form field), data (readable content), table_cell (tabular data)
- Score confidence (visibility, selector stability, interactionability)
- Preserve ambiguity where confidence is low
- Group nodes into spatial regions
- Rank nodes by planner-usefulness
- Cap output at token-efficient sizes

**What It Must Never Do:**
- Infer user intent
- Classify content by domain
- Make strategic recommendations
- Narrate workflow
- Interpret semantic meaning

**Inputs:** Browser DOM, accessibility tree, goal text (for relevance scoring).

**Outputs:**
- FilteredNode[]: typed, scored, confidence-labeled nodes
- Metrics: walk statistics, scoring breakdown
- Errors: problematic regions

**Interactions:**
- Reads: DOM, accessibility tree, geometry
- Produces: operational views for planner
- Consumed by: Planner context composition

**Boundaries:** Brain1 exposes **affordances** (what can be done), not **intentions** (what should be done).

---

#### **Subsystem: Brain2 (Continuity Interpretation)**

Interprets browser transitions and invalidation evidence.

**Responsibilities:**
- Attribute DOM mutations to their causes (clicks, fetches, timers, etc.)
- Classify transition types (microstate, structural_local, structural_macrostate, hard_reset)
- Assess transition strength (none, weak, moderate, strong, negative)
- Generate invalidation evidence (which refs/regions were affected?)
- Detect generation boundaries
- Track confidence degradation patterns

**What It Must Never Do:**
- Decide task success
- Recommend strategy change
- Infer workflow meaning
- Make autonomous recovery decisions

**Inputs:**
- Before-observation (Brain1 snapshot before action)
- After-observation (Brain1 snapshot after action)
- Mutation events (if available)
- Causal chain evidence (what initiated the action?)

**Outputs:**
- TransitionEvidence: transition class, strength, affected regions
- RefInvalidationSummary: which refs should be weakened/invalidated?
- GenerationTransition: did we cross a generation boundary?

**Interactions:**
- Reads: Brain1 projections, mutation data
- Consumes: Ref changes
- Produces: Transition summaries for planner context
- Feeds: RefService with invalidation evidence

**Boundaries:** Brain2 is **mechanical interpretation**, not semantic interpretation. It answers "what changed?" not "is the task progressing?"

---

#### **Subsystem: Graph (Continuity Topology)**

Stores shallow runtime relationships for continuity querying.

**Responsibilities:**
- Store Brain1 snapshot (initial state)
- Append Brain2 deltas (mutation records)
- Track ref continuity across generations
- Store region relationships
- Answer queries like: "which refs survived this transition?"
- Maintain bounded delta history (cap at ~50 recent)

**What It Must Never Do:**
- Become a knowledge graph
- Store semantic relationships
- Infer ontology
- Make strategic recommendations
- Act as planner memory

**Inputs:**
- Brain1 snapshots
- Brain2 deltas
- Ref lifecycle events

**Outputs:**
- Snapshot query: what nodes exist?
- Delta query: what changed recently?
- Continuity query: which refs survived?
- Status query: what is page state?

**Interactions:**
- Accumulates: snapshots and deltas
- Queries: by planner context composition
- Updates: when refs change confidence

**Boundaries:** The graph is **purely structural**. No semantics. No adaptation. Just topology.

---

#### **Subsystem: Stabilization (StabilizationService, TransitionService)**

Mechanical correction of browser instability before planner sees it.

**Responsibilities:**
- Refresh stale ref geometry (handle layout shifts)
- Retry transient mechanical failures (bounded: ~3 attempts)
- Validate actionability preconditions (visible? enabled? not blocked?)
- Detect stabilization exhaustion (when to give up)
- Produce stabilization evidence (what stabilization was needed?)

**What It Must Never Do:**
- Make execution strategy decisions
- Infer task meaning
- Autonomously recover from semantic failures
- Embed domain-specific heuristics

**Inputs:**
- Interaction preconditions (ref + intended action)
- Execution failures (error + retry evidence)

**Outputs:**
- StabilizationResult: success/failure, evidence, retry count
- RefreshResult: updated geometry, visibility
- Evidence for planner: why did stabilization fail?

**Interactions:**
- Triggered by: InputService before/after execution
- Reads: RefService, substrate queries
- Produces: Evidence for planner context
- Fails over: transient errors reported, semantic failures escalated

**Boundaries:** Stabilization is **bounded and mechanical**. Unlimited retries are forbidden. Strategic recovery is planner responsibility.

---

#### **Subsystem: Tools (InputService, V2ToolDispatcher)**

Execution primitives for the planner.

**Responsibilities:**
- Validate planner tool requests
- Resolve refs to actual interactions
- Execute bounded actions (click, type, scroll, navigate, press, etc.)
- Record execution with start/end trace events
- Re-observe after mutation actions
- Produce execution evidence (success/failure, what changed?)

**What It Must Never Do:**
- Interpret tool results semantically
- Make retry decisions
- Autonomously escalate or recover
- Execute unvalidated planner requests

**Inputs:** Planner output steps (tool requests).

**Outputs:** V2ToolResult (success, evidence, trace context).

**Interactions:**
- Reads: RefService, substrate
- Executes: Harness interactions
- Records: Trace store
- Produces: Evidence for planner re-evaluation

**Boundaries:** Tools are execution primitives, not orchestration logic.

---

#### **Subsystem: Trace (TraceStore)**

Captures evidence for debugging, replay, and validation.

**Responsibilities:**
- Record action starts (what was the precondition?)
- Record action ends (what was the outcome?)
- Capture observations (before/after state)
- Store planner input/output
- Serialize for replay
- Organize for auditing

**What It Must Never Do:**
- Filter evidence (all mutations recorded)
- Interpret outcomes
- Make quality judgments
- Drop "noise"

**Inputs:** All runtime state changes, action boundaries, observations.

**Outputs:** TraceManifest (organized artifacts), replay data.

**Interactions:**
- Called by: every system that mutates state
- Reads: runtime state snapshots
- Produces: trace artifacts for auditing

**Boundaries:** Trace is write-only (append-only). No interpretation. Complete record.

---

#### **Subsystem: Planner (LLM)**

The sole semantic reasoning authority.

**Responsibilities:**
- Interpret goals
- Reason about strategy
- Select high-level semantic steps (inspect, verify, search, compare, navigate, answer, escalate)
- Decide execution direction
- Determine sufficiency
- Handle semantic ambiguity
- Escalate when strategy is uncertain

**What It Must Never Do:**
- Manage browser mechanics
- Retry transient failures
- Classify browser events
- Embed continuity recovery heuristics
- Reason about ref lifecycles
- Track DOM identity

**Inputs:** Compact operational state from runtime (Brain1/Brain2/graph).

**Outputs:** Semantic intents (tool calls with refs, not selectors).

**Interactions:**
- Receives: RuntimeComposedInput (compressed, evidence-grounded state)
- Produces: PlannerOutput (semantic steps)
- Executed by: V2ToolDispatcher (mechanical translation)
- Re-evaluates: after each tool execution produces evidence

**Boundaries:** The planner is completely isolated from browser mechanics. All browser truth is pre-processed by Brain1/Brain2/graph.

---

### 3.3 Information Flow

**Upward (Browser → Planner):**

```
Browser DOM/AX/Events
    ↓
Substrate (BrowserSession, ObservationService)
    ↓ produces raw facts: candidates, geometry, visibility
Brain1 (Operational Projection)
    ↓ compresses: types, scores, affordances
Brain2 (Continuity Interpretation)
    ↓ interprets: transitions, invalidation, confidence
Graph (Continuity Topology)
    ↓ stores: snapshots, deltas, relationships
PlannerInputComposer
    ↓ compacts: evidence-grounded state representation
Planner
    ↓ reasons: goals, strategy, next semantic step
```

**Downward (Planner → Browser):**

```
Planner Output (semantic intents with refs)
    ↓
V2ToolDispatcher (route to runtime tools)
    ↓
InputService (resolve refs, validate actionability)
    ↓
Harness (dispatch browser interaction)
    ↓
Browser DOM/AX (executes action)
    ↓
ObservationService (re-capture state)
    ↓ Brain1/Brain2/Graph update
Planner receives evidence
    ↓ re-evaluates
```

**Critical Principle:** Information only moves **UP after substrate has captured truth and Brain1/Brain2/Graph have processed it**. The planner never receives raw browser facts.

---

## 4. COMPLETE EXECUTION LIFECYCLE

### 4.1 Full Walkthrough: "Find the Cheapest Phone Across Multiple Websites"

This is a realistic task requiring:
- Navigation to multiple sites
- Search within each
- Price extraction
- Comparison
- Answer

**Assumed initial state:** Browser session open, ready to navigate.

---

### Phase 1: Browser Launch and Initial Observation

**What happens:**
```typescript
1. BrowserSession.open(url)
   - Launch Chromium via Playwright
   - Navigate to first URL
   - Wait for page stability

2. ObservationService.capture()
   - Query DOM (getDocument, querySelectorAll)
   - Query accessibility tree
   - Compute geometry and visibility
   - List interactive candidates (buttons, inputs, links)
   - List readable candidates (text, prices, descriptions)
   - Assign raw identities (selector, bounding box, ARIA role)

3. RefService.assign()
   - For high-priority nodes: assign generation-scoped refs
   - Example: v2ref_1, v2ref_2, v2ref_3...
   - Store multi-signal identity: backend node ID + accessibility + geometry + selector

4. Brain1.scan(goal: "find cheapest phone")
   - Walk DOM filtered for goal relevance
   - Classify: which are search inputs? which are price data?
   - Score nodes: visibility (visible), interaction (clickable), actionability (not disabled)
   - Output: ~30-80 filtered nodes with scores

5. Brain2 (initial state, no transitions yet):
   - Record: this is page-init state, no meaningful transitions

6. Graph.createGraph():
   - Store Brain1 snapshot
   - Initialize deltas to empty
   - Set status to 'loading'

7. TraceStore.recordObservation():
   - Capture observation timestamp
   - Record Brain1 snapshot
   - Mark generation boundary (generation 1)
```

**Planner receives:**
```json
{
  "page_url": "https://example-phone-store.com",
  "generation": 1,
  "goal": "find the cheapest phone",
  "visible_actions": [
    { "ref": "v2ref_1", "type": "input", "text": "Search phones...", "role": "searchbox" },
    { "ref": "v2ref_2", "type": "button", "text": "Search", "role": "button" },
    { "ref": "v2ref_5", "type": "data", "text": "iPhone 15 - $999" },
    { "ref": "v2ref_6", "type": "data", "text": "Samsung S24 - $899" }
  ],
  "readable_content": "Our current phones: iPhone 15 ($999), Samsung S24 ($899), Google Pixel 8 ($799)",
  "progress": "none",
  "mutation_evidence": []
}
```

**Planner's semantic reasoning:**

> I see a phone store with a search box and some phone listings visible. I can see current prices listed: iPhone ($999), Samsung ($899), Pixel ($799). To find the cheapest, I should:
> 1. Search for all phones to see full inventory
> 2. Extract prices from all results
> 3. Compare

> My first action: search for "phones" to see more inventory

**Planner output:**
```json
{
  "plan": [
    { "tool": "click", "ref": "v2ref_1", "confidence": "high" },
    { "tool": "type", "ref": "v2ref_1", "text": "phones", "confidence": "high" },
    { "tool": "click", "ref": "v2ref_2", "confidence": "high" }
  ]
}
```

---

### Phase 2: First Action — Click Search Box

**What happens:**

```typescript
1. V2ToolDispatcher.dispatch("click", "v2ref_1")
   - Validate: is v2ref_1 still valid?
   - RefService.resolve(v2ref_1) → returns interaction target

2. RefResolver resolution logic:
   - Backend node ID still points to same element? YES → high confidence
   - Accessibility attributes match? YES (searchbox role)
   - Element visible and not blocked? YES
   - Geometry stable? YES
   → RefResolution: VALID, high confidence, proceed

3. TraceStore.recordActionStart()
   - Record preconditions: ref valid, geometry {x: 100, y: 50, width: 200, height: 40}
   - Record tool: "click"

4. InputService.click(ref, page)
   - Stabilization check: is target visible and not occluded?
   - Compute element center: (200, 70)
   - Call Harness.click(page, x, y)

5. Harness.click() [Playwright path]:
   - locator.click() via Playwright CDP
   - OR: manually dispatch mousedown, click, mouseup via CDP if element doesn't respond

6. Browser fires click event, focus shifts to search input

7. TraceStore.recordActionEnd()
   - Record: success, timestamp, execution duration (e.g., 45ms)

8. Post-action: Re-observe
   - ObservationService.capture() again
   - Notice: search input now has focus, keyboard ready
   - Brain1 re-scan with same goal
   - Brain2 compare before/after
```

**Brain2 transition analysis:**

```
Before: search input unfocused
After: search input focused
Transition type: MICROSTATE (focus change)
Affected region: search control region
Ref continuity: search input ref survived (focus doesn't break identity)
Strength: WEAK (focus change is mechanical, not task progress)
```

**Planner receives after action:**
```json
{
  "last_action_result": {
    "tool": "click",
    "ref": "v2ref_1",
    "success": true,
    "evidence": {
      "element_now_focused": true,
      "transition_type": "microstate"
    }
  },
  "updated_state": {
    "page_url": "https://example-phone-store.com",
    "generation": 1,
    "focus": "v2ref_1",
    "visible_actions": [...],
    "progress": "none"
  }
}
```

---

### Phase 3: Second Action — Type Search Term

**Planner decides:** search box is ready, type "phones"

```typescript
1. V2ToolDispatcher.dispatch("type", "v2ref_1", text: "phones")

2. RefResolver.resolve(v2ref_1):
   - Still valid? YES
   - Is it typeable (input/editable)? YES
   - Visible? YES
   → VALID

3. InputService.type(ref, "phones", page):
   - For each character:
     - Dispatch keydown event
     - Dispatch keypress event
     - Dispatch keyup event
   - OR: use locator.fill() if available
   - Character timing: ~50ms per character (realistic typing speed)

4. Harness implements keystrokes via CDP keyboard events

5. Browser receives keystrokes, input field populated: "phones"

6. If onChange/onInput handlers exist: fire network requests (e.g., autocomplete)

7. TraceStore records action execution

8. Re-observe (implicit after every action):
   - Input field now contains "phones"
   - Possibly autocomplete dropdown appeared (if API responded)
```

**Brain2 analysis:**

```
Transition type: STRUCTURAL_LOCAL (local UI update + possible network request)
Affected region: search input + autocomplete dropdown (if present)
Ref continuity: input ref survived, autocomplete refs NEW
Strength: MODERATE (user intention visible, but not yet task progress)
```

---

### Phase 4: Third Action — Click Search Button

**Planner decides:** search box populated, click search button

```typescript
1. V2ToolDispatcher.dispatch("click", "v2ref_2")

2. RefResolver checks v2ref_2 (search button):
   - Still in same location? YES
   - Still enabled? YES
   - Visible? YES
   → VALID

3. InputService.click(v2ref_2)
   - Dispatch click to button

4. Browser fires click event
   - JavaScript handler: POST /api/search?q=phones

5. Network request in flight (~200ms)

6. DOM changes: search results start appearing

7. TraceStore records action start/end

8. Re-observe:
   - Previous results replaced
   - New results appear: iPhone 15 ($999), Samsung S24 ($899), Google Pixel 8 ($799), OnePlus 12 ($599), Motorola Edge ($499), Nothing Phone ($449)
   - Original refs are now STALE (different nodes)
   - New result refs appear
```

**Brain2 transition analysis:**

```
Before: 3 phone listings visible
After: 6 phone listings visible
Initiator: click on search button
Transport: fetch (POST /api/search)
Transition type: STRUCTURAL_MACROSTATE (major content replacement)
Confidence: HIGH (clear cause-effect from fetch)
Affected regions: entire results section
Ref continuity: old price refs are WEAKENED (same display text but different backend nodes)
Generation boundary?: NO (same page, same session, still search context)
Progress strength: STRONG (we now have search results with prices)
```

**Planner receives:**

```json
{
  "last_action_result": {
    "tool": "click",
    "ref": "v2ref_2",
    "success": true,
    "evidence": {
      "transition_type": "structural_macrostate",
      "mutation_cause": { "initiator": "click", "transport": "fetch", "url": "/api/search" },
      "new_data_appeared": true,
      "result_count": 6,
      "progress": "strong"
    }
  },
  "updated_state": {
    "generation": 1,
    "visible_results": [
      { "ref": "v2ref_10", "type": "data", "text": "iPhone 15 - $999" },
      { "ref": "v2ref_11", "type": "data", "text": "Samsung S24 - $899" },
      { "ref": "v2ref_12", "type": "data", "text": "Google Pixel 8 - $799" },
      { "ref": "v2ref_13", "type": "data", "text": "OnePlus 12 - $599" },
      { "ref": "v2ref_14", "type": "data", "text": "Motorola Edge - $499" },
      { "ref": "v2ref_15", "type": "data", "text": "Nothing Phone - $449" }
    ],
    "progress": "strong"
  }
}
```

**Planner's reasoning:**

> Great! I can see 6 phones now with prices: iPhone ($999), Samsung ($899), Pixel ($799), OnePlus ($599), Motorola ($499), Nothing ($449). The cheapest visible is Nothing Phone at $449. But the task asks for the cheapest "across multiple websites" — I need to check other sites too. Let me continue to the next website.

**Planner output:** Navigate to second site

---

### Phase 5: Navigation to Second Site

**Planner decides:** need to check another site for comparison

```typescript
1. V2ToolDispatcher.dispatch("navigate", url: "https://second-phone-store.com")

2. Harness.navigate(url):
   - page.goto(url, { waitUntil: 'domContentLoaded' })

3. Browser navigates, page loads

4. TraceStore records navigation action

5. Re-observe:
   - Completely different DOM
   - New page structure
   - New phone listings
```

**Brain2 transition analysis:**

```
Transition type: HARD_RESET (full page navigation)
Generation boundary: YES (generation 2 starts here)
Affected refs: ALL old refs INVALID (different page entirely)
Ref continuity: NONE (hard navigation breaks continuity completely)
Progress strength: NONE (navigation is not task progress, it's a tactic)
```

**Key point:** Generation changed. Old refs from generation 1 are no longer valid. New refs will be assigned for generation 2.

---

### Phase 6: Continued Task Loop

The cycle repeats for the second site:

1. Brain1 scans for phone listings
2. Planner decides: search for "budget phones" (cheaper segment)
3. Type search term
4. Execute search
5. Brain2 detects strong transition (results loaded)
6. Planner extracts prices: cheapest is $399
7. Planner compares across sites: Site 1: $449, Site 2: $399
8. Planner continues to Site 3...

(Steps abbreviated for brevity)

---

### Phase 7: Task Completion — Answer

After visiting 3 sites and extracting prices:
- Site 1: Nothing Phone $449
- Site 2: Budget Phone $399
- Site 3: Ultra Phone $349 (cheapest)

**Planner reasoning:**

> I've checked three sites. The cheapest phone I found is the "Ultra Phone" at $349 on the third site. I have enough information to answer the question.

**Planner output:**

```json
{
  "status": "done",
  "answer": "The cheapest phone across the sites I checked is the Ultra Phone at $349 (available on site-3.com)"
}
```

**Trace captures:**

```
[Generation 1: Site 1]
  Observation #1 → Click search box → Type "phones" → Click search button → Found 6 phones, cheapest $449
  
[Generation 2: Site 2]
  Navigation to Site 2
  Observation #1 → Search for "budget phones" → Found 5 phones, cheapest $399
  
[Generation 3: Site 3]
  Navigation to Site 3
  Observation #1 → Search for "cheap phones" → Found 8 phones, cheapest $349
  
[Final]
  Planner answer: "Ultra Phone $349"
```

**Replay capability:**

From the trace, another engineer can:
1. See exactly what the planner saw at each step (Brain1 projections)
2. See exactly what changes occurred (Brain2 transitions)
3. Reconstruct the exact sequence of decisions (planner inputs/outputs)
4. Replay from any checkpoint
5. Debug which decision led to which outcome

---

### 4.2 Execution Phases at a Glance

| Phase | Owner | What Happens | Input | Output |
|-------|-------|--------------|-------|--------|
| Observe | Substrate | Capture DOM, AX, refs | Browser state | BrowserObservation |
| Project | Brain1 | Filter DOM, classify, score | BrowserObservation | FilteredNode[] |
| Interpret | Brain2 | Compare before/after | Before/After snapshots | TransitionEvidence |
| Compose | Runtime | Compress into planner input | Brain1/Brain2/Graph | PlannerInput |
| Plan | Planner | Semantic reasoning | PlannerInput | PlannerOutput |
| Dispatch | Tools | Validate and route | PlannerOutput | Tool execution |
| Execute | Harness | Browser interaction | Execution request | ExecutionResult |
| Stabilize | Runtime | Handle transients | ExecutionResult | StabilizationResult |
| Re-observe | Substrate | Capture post-action state | Browser state | BrowserObservation |
| Update | Graph/Brain2 | Record transition | New observation | UpdatedGraph |
| Loop | Planner | Re-evaluate | Updated state | Next semantic step |

---

## 5. BRAIN1 DEEP DIVE

### 5.1 Purpose and Identity

Brain1 is an **operational projection engine**. It transforms browser complexity into planner-usable structured state.

**What Brain1 IS:**
- A DOM walker and classifier
- A confidence scorer
- An affordance exposer
- A complexity compressor
- Snapshot-oriented (represents current operational surface)

**What Brain1 IS NOT:**
- A planner or planner replacement
- A cognition engine
- A semantic understanding system
- A domain interpreter
- A workflow inference engine
- A browser explainer

### 5.2 Core Design Principle

> **Brain1 compresses operational complexity, NOT semantic complexity.**

**Operational complexity** = "how many nodes exist? which are interactive? which are visible?"
**Semantic complexity** = "what does this form mean? is this a checkout flow? should we click this?"

Brain1 handles operational complexity. The planner handles semantic complexity.

Another way to state it:

> **Brain1 projects operational affordances.**

Examples of affordances:
- "This is a clickable button"
- "This is an editable input field"
- "This is a readable text region"
- "These 5 items form a group"

NOT affordances:
- "You should click this button"
- "This is a payment form"
- "This is the wrong search result"
- "You should try a different strategy"

### 5.3 Operational Projection Model

Brain1's job is to answer: **"What operational structure currently exists?"**

#### Step 1: DOM Walk and Classification

Brain1 walks the DOM tree (including shadow roots) and classifies each element:

**Type: Trigger** (interactive controls that initiate actions)
- Buttons
- Links
- Form submits
- Clickable divs with event handlers
- Select dropdowns

**Type: Input** (elements that accept user input)
- Text inputs
- Text areas
- Contenteditable divs
- File inputs
- Number/email/date inputs
- Select dropdowns (technically triggers but sometimes inputs)

**Type: Data** (readable content)
- Paragraphs, divs, spans with substantial text
- Headings
- List items
- Table cells with content
- Prices, descriptions, attributes

**Type: Table_Cell** (tabular data specifically)
- Cells in data tables
- Important for extraction

#### Step 2: Confidence Scoring

For each node, Brain1 computes three independent scores:

**Selector Score** (0-100)
- How stable is the CSS selector?
- High if: ID-based, data-testid, aria-label stable
- Low if: position-based, class-based (classes change frequently)
- Median if: semantic HTML (role, type attributes)

**Interaction Score** (0-100)
- How clearly interactive is this element?
- High if: standard buttons, inputs, links
- Median if: clickable divs with event handlers
- Low if: deeply nested, small touch target, unusual interaction pattern

**Actionability Score** (0-100)
- Can we actually interact with this?
- High if: visible, enabled, not occluded
- Median if: slightly offscreen or behind semi-transparent overlay
- Low if: hidden, disabled, or deeply occluded

#### Step 3: Confidence Derivation

From the three scores, Brain1 derives confidence:

```typescript
if (visibility === 'visible' && selectorScore >= 78 && interactionScore >= 55 && actionabilityScore >= 55) {
  confidence = 'high'
} else if (visibility !== 'hidden' && selectorScore >= 48 && actionabilityScore >= 34) {
  confidence = 'medium'
} else {
  confidence = 'low'
}
```

**Why these thresholds?**
- High confidence: all three dimensions strong (stable selector + clearly interactive + definitely actionable)
- Medium confidence: weaker selector but still actionable (recovery hints available)
- Low confidence: uncertain actionability or selector (planner should avoid if better options exist)

### 5.4 Views and Affordance Exposure

Brain1 exposes nodes as structured **views**:

#### Interaction View
"What can I interact with?"

```json
{
  "interactions": [
    { "ref": "v2ref_1", "type": "button", "text": "Search", "confidence": "high" },
    { "ref": "v2ref_2", "type": "input", "text": "Search...", "confidence": "high" },
    { "ref": "v2ref_5", "type": "link", "text": "Browse All", "confidence": "medium" }
  ]
}
```

#### Readable View
"What can I read?"

```json
{
  "readable": [
    { "ref": "v2ref_10", "type": "data", "text": "Price: $99", "region": "product-card" },
    { "ref": "v2ref_11", "type": "data", "text": "In Stock", "region": "product-card" }
  ]
}
```

#### Regional View
"What regions exist and what's inside them?"

```json
{
  "regions": [
    {
      "name": "search-region",
      "contains": ["v2ref_1", "v2ref_2"],
      "purpose": "search controls"
    },
    {
      "name": "results-region",
      "contains": ["v2ref_10", "v2ref_11", "v2ref_12", ...],
      "purpose": "search results"
    }
  ]
}
```

### 5.5 Node Lifecycle and Metadata

Each node carries metadata for identity and recovery:

```typescript
interface FilteredNode {
  type: 'trigger' | 'input' | 'data' | 'table_cell'
  tag: string  // 'button', 'input', 'div', etc.
  value: string  // text content (capped at 200 chars)
  sel: string  // CSS selector
  selType: 'id' | 'aria' | 'name' | 'testid' | 'positional'  // selector quality
  
  meta: FilteredNodeMeta {
    nodeId: string  // stable hash
    refId: string  // v2ref_N (assigned during observation)
    stableHash: string  // FNV-1a hash over signature
    identityGeneration: number  // generation this node was assigned in
    backendNodeId: number  // CDP backend node ID
    
    selectorScore: number
    interactionScore: number
    actionabilityScore: number
    confidence: 'high' | 'medium' | 'low'
    
    visibility: 'visible' | 'offscreen' | 'hidden'
    disabled: boolean
    role: string  // ARIA role
  }
}
```

### 5.6 Refresh Behavior

Brain1 is **re-scanned after every action**:

1. **Action executes** (click, type, navigate, etc.)
2. **Browser state changes** (DOM mutates, DOM loads, page navigates)
3. **Brain1 re-scans** the new DOM
4. **New FilteredNode[] produced** with new confidence scores
5. **Brain2 compares** before/after
6. **Refs are re-resolved** or invalidated based on Brain2 evidence

This constant refreshing means Brain1 always reflects current operational state. Stale Brain1 data cannot accumulate.

### 5.7 Planner Interaction

The planner receives Brain1 projections compressed into context:

```json
{
  "operational_structure": {
    "interactions": [
      { "ref": "v2ref_1", "type": "button", "text": "Submit", "confidence": "high" }
    ],
    "readable": [
      { "ref": "v2ref_5", "type": "data", "text": "Price: $599", "confidence": "high" }
    ],
    "regions": [...]
  }
}
```

The planner uses this to:
- Select targets for interaction (which button to click?)
- Determine what's readable (can I extract this price?)
- Understand structural hierarchy (what's grouped together?)

### 5.8 What Was Intentionally Removed

Earlier designs considered features Brain1 no longer has:

**Removed: Semantic classification by domain**

Old: "This looks like a product price based on the text format and surrounding context"
New: "This is readable text in a certain region; planner decides if it's a price"

**Removed: Workflow inference**

Old: "This looks like a checkout flow: input field → button pattern"
New: "These are interactive elements in proximity; planner decides if it's a flow"

**Removed: Image-based understanding**

Old: "This image contains a product photo"
New: "There's an image element here; planner can request visual escalation if needed"

**Removed: Predictive affordances**

Old: "You should probably click this button next"
New: "Here's a button; planner decides if/when to click"

### 5.9 Important Design Decisions

#### Decision 1: Node Type Discreteness

Brain1 classifies into 4 discrete types (trigger, input, data, table_cell), not a spectrum.

**Why?** Discrete types are easier for the planner to reason about. Spectrum types (confidence: 0.65 on "is this clickable?") create uncertainty. Discrete types create clarity.

#### Decision 2: Confidence Thresholds as Constants

The confidence thresholds (high=78/55/55, medium=48/34, low=else) are hard constants, not adaptive.

**Why?** Adaptive thresholds would introduce hidden logic in the runtime. Hard thresholds make the system transparent and debuggable.

#### Decision 3: Capping Output at 240 Nodes

Brain1 outputs at most 240 nodes (with per-type caps: 40 inputs, 60 triggers, 110 data, 30 table).

**Why?** Context budget. A 240-node projection is ~2-3k tokens. That leaves room for transitions, history, and planner reasoning. Unlimited node lists would blow the context window.

#### Decision 4: Re-scan After Every Action

Brain1 re-scans the entire DOM after every planner action.

**Why?** Ensures Brain1 never becomes stale. Costs ~100-200ms per scan but prevents accumulated stale state.

---

## 6. BRAIN2 DEEP DIVE

### 6.1 Purpose and Identity

Brain2 is a **continuity interpreter**. It mechanically classifies browser transitions and generates invalidation evidence.

**What Brain2 IS:**
- A transition classifier
- A confidence degrader
- An invalidation generator
- Continuity-transition oriented

**What Brain2 IS NOT:**
- A task success judge
- A strategy recommender
- A replanning engine
- A semantic interpreter

### 6.2 Core Design: Transition Interpretation

Brain2 answers one question: **"What changed meaningfully between observations?"**

NOT: "Did the task progress?" or "Should we replan?"

ONLY: "What changed, mechanically, in the browser?"

### 6.3 Transition Classes

Brain2 classifies transitions into four types based on the **scope and nature of change**:

#### Transition Type 1: Microstate

**What:** Tiny mechanical changes that don't affect operational structure.

**Examples:**
- Scroll (geometry changed, DOM unchanged)
- Hover (pseudo-states changed, DOM unchanged)
- Focus (focus state changed, DOM unchanged)
- Animation (visual state changed, DOM unchanged)
- Lazy loading of off-screen content (content added, but not in viewport)

**Ref behavior:** Refs remain **live**. Confidence unchanged.

**Brain1 behavior:** Projections mostly stable (maybe slight geometry updates).

**Generation boundary:** NO (same generation).

**Transition strength:** WEAK or NONE (this isn't task progress, it's browser churn).

**Example:**

```
Before: 100 nodes, visible results region, scroll position: 0
User scrolls down
After: 100 nodes, visible results region shifted, scroll position: 500
Brain2 classification: microstate (geometry changed, no new affordances)
Ref continuity: preserved
```

#### Transition Type 2: Structural Local

**What:** Localized structural changes affecting part of the page.

**Examples:**
- Modal or dialog opens
- Accordion section expands
- Dropdown menu appears
- Partial region re-renders
- Inline form validation messages appear
- SPA component re-renders

**Ref behavior:** Affected region refs are **weakened** (confidence reduced). Unaffected refs remain live.

**Brain1 behavior:** Re-scan affected region. Unaffected regions stable.

**Generation boundary:** NO (same generation, but partial continuity break).

**Transition strength:** MODERATE (visible change but not macrostate change).

**Example:**

```
Before: filter form (visible, refs v2ref_1...v2ref_5), results (refs v2ref_10...v2ref_20)
User clicks "Advanced Filters"
After: filter form expands (different nodes, refs v2ref_1...v2ref_8), results shifted but same (refs v2ref_10...v2ref_20)

Brain2 classification: structural_local
Affected regions: filter form
Affected refs: v2ref_1...v2ref_5 weakened (new nodes appeared in that region)
Unaffected refs: v2ref_10...v2ref_20 preserved

Generation boundary?: NO (filtered results are still on the same page)
```

#### Transition Type 3: Structural Macrostate

**What:** Major content replacement, workflow transition, SPA route change.

**Examples:**
- Search results replaced (user searched, fetched new results)
- Product details replaced (user selected a product)
- SPA route changed (user navigated within app)
- Tab contents switched
- Major workflow step transition (search → select → checkout)
- Page reload (different endpoint, same session)

**Ref behavior:** Many refs are **downgraded**. Some may be invalidated. New refs created.

**Brain1 behavior:** Major re-scan. Many new nodes. Previous snapshots become context only.

**Generation boundary:** Possibly YES (depends on semantics, but mechanics suggest new page generation).

**Transition strength:** STRONG (major structural change, likely task progress).

**Example:**

```
Before: search page with search box, 0 results
User searches for "phones"
Fetches: POST /api/search?q=phones → returns results
After: search page with search box, 12 result items (different DOM nodes)

Brain2 classification: structural_macrostate
Mutation cause: fetch (POST /api/search)
Confidence: HIGH (clear cause-effect: user action → fetch → results)
Affected regions: entire results section
Ref continuity: search box ref survived, result refs new

Generation boundary?: Maybe — same page URL but completely new content. Could be same generation or transition boundary.
Progress strength: STRONG (user action → observable results)
```

#### Transition Type 4: Hard Reset

**What:** Complete page replacement or navigation.

**Examples:**
- Full page navigation (page.goto())
- Page reload (F5)
- Auth redirect
- Browser crash/recovery
- Major auth flow redirect
- Frame replacement

**Ref behavior:** All refs **invalidated** (entire page new).

**Brain1 behavior:** Complete re-scan from scratch.

**Generation boundary:** YES (mandatory new generation).

**Transition strength:** NONE (navigation is a tactic, not task progress).

**Example:**

```
Before: Site A, URL example.com/search, 100 nodes, refs v2ref_1...v2ref_100
User navigates to: Site B, URL other.com/browse
After: Site B, URL other.com/browse, 85 nodes, refs v2ref_101...v2ref_185 (new generation!)

Brain2 classification: hard_reset
All refs from generation 1: INVALID
New generation 2 begins
Generation 1 refs can NOT be used in generation 2
```

### 6.4 Invalidation Model

When Brain2 detects a transition, it uses evidence to determine which refs should be invalidated:

#### Confidence Degradation Ladder

```
HIGH CONFIDENCE (ref is definitely valid)
    ↓
    Backend node ID still points to same element? Confidence stays HIGH
    ↓
MEDIUM CONFIDENCE (ref probably valid but not certain)
    ↓
    Accessibility attributes match? Confidence MEDIUM
    ↓
LOW CONFIDENCE (ref might be valid but uncertain)
    ↓
    Stable hash matches? Confidence LOW
    ↓
INVALID (ref is definitely not valid)
    ↓
    Element not found by any signal? Ref INVALID
```

#### Invalidation Evidence Sources

Brain2 generates invalidation evidence from:

1. **Ref resurrection signals:** Did the same element come back after being removed?
   - Backend node ID preserved? HIGH confidence
   - ARIA attributes match? MEDIUM confidence
   - Stable hash matches? LOW confidence

2. **Mutation witness:** Did Brain2 observe the element being removed?
   - Observed removal in DOM mutation: HIGH confidence invalidation
   - Not observed but absent from new snapshot: MEDIUM confidence

3. **Geometry change:** Did the element move significantly?
   - Geometry completely different: Confidence reduced
   - Geometry similar: Confidence maintained

4. **Visibility change:** Did the element become hidden?
   - Element hidden: Confidence reduced
   - Element offscreen: Confidence reduced
   - Element visible: Confidence maintained

### 6.5 Dead-State Model

Dead-state is when the runtime can no longer maintain operational continuity.

**What Dead-State IS:**
- No actionable refs in current state
- Repeated ref resurrection failures (all stale)
- Previous actions had no observable effect
- Stabilization exhausted (retries failed)
- Environment block detected (page hung, network down, auth required)

**What Dead-State IS NOT:**
- Task is impossible
- User should try a different strategy
- Workflow ended unsuccessfully

Dead-state is purely **operational evidence**, not strategic judgment.

**Example:**

```
Scenario: User on product page, clicked "Add to Cart" button
Transition detected: button disappeared (refs now stale)
Re-observe: Cart button gone, no new content appeared
Stabilization: try re-observing, refresh geometry, no change
Brain1: no new affordances appeared
Brain2: transition strength = NEGATIVE (no observable outcome)

Result: Dead-state exposure
Evidence: "Last action produced no observable change; no new affordances; cannot continue"

Planner receives: dead-state evidence
Planner decides: maybe try a different mechanism, or escalate
(Runtime doesn't decide this)
```

### 6.6 Graph Relationship

Brain2 feeds its outputs into the Graph:

- Each transition generates a **MutationDelta** record
- Deltas are appended to graph.deltas (bounded at ~50 recent)
- Brain2 also updates ref states in the graph
- Graph.lastCause points to most recent non-noise transition

The graph becomes the **persistent record** of transitions during the session.

### 6.7 Planner Relationship

The planner receives Brain2 summaries in context:

```json
{
  "last_transition": {
    "type": "structural_macrostate",
    "strength": "strong",
    "caused_by": "fetch:/api/products (high confidence)",
    "affected_regions": ["results-section"],
    "ref_preservation": "high (search box survived)",
    "generation_change": false,
    "progress": "strong"
  },
  "dead_state_evidence": null
}
```

Planner uses this to:
- Understand what observable change occurred
- Judge if planner's action had intended effect
- Detect stuck situations (dead-state)
- Detect opportunity situations (strong progress)
- Decide if replanning is needed

### 6.8 Exactly How Brain2 Thinks About Browser Change

Brain2's mental model:

> **Browser state is a continuous field of nodes and relationships. Most changes are continuities with noise. Some changes are structural transitions. Rarely, the page resets entirely.**
>
> **When observing a change:**
> 1. Compare before/after snapshots at the node level
> 2. Classify the scope: microstate (geometry), structural_local (region), structural_macrostate (major), hard_reset (navigation)
> 3. Assess how much ref continuity is preserved
> 4. For each ref, determine if it survived or was replaced
> 5. Assign confidence based on identity signals
> 6. Emit transition evidence for planner

### 6.9 Important Design Decisions

#### Decision 1: Transition Classes as Discrete Types

Brain2 uses 4 discrete transition types, not a spectrum of "change magnitude."

**Why?** Discrete types are operationally clear. Spectrum types require threshold decisions.

#### Decision 2: Confidence Strictly From Identity Signals

Confidence is determined only by backend node ID, accessibility attributes, geometry — NOT by semantic meaning.

**Why?** Semantic judgment belongs to the planner. The runtime sticks to mechanical identity signals.

#### Decision 3: Dead-State as Negation, Not Strategy

Dead-state is defined as "cannot continue operationally" not "strategy has failed."

**Why?** The runtime has no strategy. It can only report operational capability.

#### Decision 4: No Autonomous Recovery in Brain2

Brain2 reports evidence; it doesn't decide recovery direction.

**Why?** Recovery is strategy. Strategy is planner.

---

## 7. GRAPH DEEP DIVE

### 7.1 Graph Purpose

The graph is a **runtime topology store** — it maintains shallow relationships for continuity querying and debugging.

**What Graph IS:**
- A continuity topology store
- A bounded delta history
- A locality relationship tracker
- An event log (limited)

**What Graph IS NOT:**
- A knowledge graph
- A semantic memory
- A workflow model
- An ontology
- A learning system

### 7.2 Node Structure

The graph stores two core structures:

#### Snapshot: Brain1 Output

```typescript
interface SemanticGraph {
  snapshot: FilteredNode[]  // Latest Brain1 scan result
}
```

The snapshot is a **snapshot** — it's replaced wholesale on each Brain1 re-scan. It's not accumulated.

**Limitations:**
- Only stores latest state, not history of all states
- Size-bounded (max 240 nodes)
- Ephemeral per generation

**Why?** Full history would be massive. The planner doesn't need all history; it needs current state and recent deltas.

#### Deltas: Brain2 Transition Records

```typescript
interface MutationDelta {
  timestamp: number
  nodeSelector: string
  nodeTag: string
  oldValue: string  // what value changed from
  newValue: string  // what value changed to
  mutationType: 'added' | 'removed' | 'textChanged' | 'attributeChanged'
  chain: CausalChain  // what caused this mutation
  isNoise: boolean  // was this filtered as noise?
}

interface SemanticGraph {
  deltas: MutationDelta[]  // Recent Brain2 transition records
}
```

Deltas are **appended** as transitions are observed. Old deltas are dropped when the buffer exceeds ~50 records.

**Limitations:**
- Bounded buffer (only ~50 recent)
- No unlimited history
- Noise is marked but included

**Why?** Context budget. 50 deltas is ~500 tokens. Unlimited deltas would explode context size.

### 7.3 Edge Structure

Relationships stored in the graph:

#### Relationship 1: Ref Belongs to Region

```
Ref v2ref_10 → belongs to region "product_list"
Ref v2ref_11 → belongs to region "product_list"
Ref v2ref_12 → belongs to region "product_list"
```

#### Relationship 2: Region Contains Refs

```
Region "product_list" → contains [v2ref_10, v2ref_11, v2ref_12, v2ref_13, v2ref_14]
```

#### Relationship 3: Ref Preserved Across Generation

```
Generation 1, Ref v2ref_1 (search button) → preserved into Generation 2
```

#### Relationship 4: Ref Changed in Generation

```
Generation 1, Ref v2ref_10...v2ref_20 (results) → invalidated in Generation 2
Generation 2, Refs v2ref_100...v2ref_115 (new results) → replace old
```

These relationships are **shallow**. They don't contain semantic meaning. They're purely structural topology.

### 7.4 Continuity Topology

The graph answers: **"What topology survived the transition?"**

**Example:**

```
Generation 1:
  search-region: contains refs v2ref_1 (search box), v2ref_2 (button)
  results-region: contains refs v2ref_10...v2ref_20 (products)
  
User searches for "phones"
Fetches results
Transition detected: results replaced

Generation 1→2 analysis:
  search-region: survived (search box still there, refs still valid)
  results-region: replaced (completely new product refs)
  
Generation 2:
  search-region: contains refs v2ref_1 (same search box), v2ref_2 (same button)
  results-region: contains refs v2ref_100...v2ref_120 (new results)
```

The graph stores this topology so the planner can ask: "Where can I still interact? What changed?"

### 7.5 Locality

Refs are grouped by **locality** — spatial/structural proximity.

**Examples of localities:**
- Search controls: [search box input, search button]
- Product card: [product image, product title, product price, add-to-cart button]
- Filter panel: [category filter, price range filter, brand filter]

**Purpose:** When a region changes, we know which refs are affected together.

**Usage:** If the results region changes, the planner knows that results refs (v2ref_10...v2ref_20) are probably all affected, but search controls are probably not.

### 7.6 Lifespan

Each graph object has a **lifespan**:

```
Generation 1:
  ├─ Observation #1 → Brain1 snapshot + deltas
  └─ Graph stores: snapshot, deltas

User action → transitions

Generation 2:
  ├─ Observation #1 → Brain1 snapshot + deltas
  └─ Graph: clear old snapshot, store new snapshot, append new deltas
```

**Snapshot lifespan:** One generation (replaced on each observation).
**Delta lifespan:** Bounded history (50 recent records across all generations).

### 7.7 Pruning

The graph prunes old data to stay memory-bounded:

```typescript
const MAX_DELTAS = 50;  // Hard cap

if (graph.deltas.length > MAX_DELTAS) {
  graph.deltas.shift();  // Remove oldest
}
```

**Why aggressive pruning?** The planner doesn't need all history. Older deltas become less relevant. Token budget is finite.

### 7.8 Limitations

The graph is intentionally limited:

#### Limitation 1: No Learned Patterns

The graph does NOT store:

```
// BAD:
{
  pattern: "on product pages, price is always in bottom-right",
  confidence: 0.92
}
```

Learned patterns would be adaptive semantics. That's not graph's job.

#### Limitation 2: No Semantic Knowledge

The graph does NOT store:

```
// BAD:
{
  "this region is a checkout flow",
  "these buttons are payment methods",
  "this data type is a product"
}
```

Semantic knowledge is planner's job.

#### Limitation 3: No Workflow State

The graph does NOT store:

```
// BAD:
{
  workflow_phase: "search",
  progress_stage: "results_loaded",
  decision_state: "comparing_products"
}
```

Workflow is planner's strategy.

#### Limitation 4: No Optimization Data

The graph does NOT store:

```
// BAD:
{
  "selector is usually reliable here",
  "this action usually takes ~200ms",
  "previous similar tasks took 5 steps"
}
```

Optimization is planner's decision.

### 7.9 Why Graph Still Exists

After all the simplifications and centralization, the graph still exists because:

1. **Continuity queries:** "Did this ref survive?" requires topology tracking
2. **Debugging:** "What changed over time?" requires delta history
3. **Evidence preservation:** Trace needs historical record
4. **Locality grouping:** Planner needs to know which refs are spatially related
5. **Dead-state detection:** "No refs in region?" requires region tracking

The graph is **not an optimization**. It's an **essential continuity tracking mechanism**.

---

## 8. PLANNER + RUNTIME CONTRACT

### 8.1 Planner Responsibilities

**What Planner Owns:**

| Responsibility | Category |
|---|---|
| Goal interpretation | Strategic |
| High-level strategy | Strategic |
| Choosing between read/navigate/interact | Strategic |
| Deciding next semantic step | Strategic |
| Determining answer sufficiency | Strategic |
| Escalation decisions | Strategic |
| Semantic interpretation of evidence | Cognitive |
| Replanning when strategy fails | Cognitive |
| Comparing alternatives | Cognitive |
| Making tradeoffs between paths | Cognitive |

**What Planner Must NEVER Do:**

| Forbidden | Owner |
|---|---|
| Stale ref detection | Runtime (RefService) |
| Actionability validation | Runtime (InputService) |
| Visibility correctness | Runtime (Brain1) |
| Browser event interpretation | Runtime (Brain2) |
| Execution retries | Runtime (Stabilization) |
| Invalidation logic | Runtime (Brain2) |
| Operational projection diffs | Runtime (Brain1) |
| Transition classification | Runtime (Brain2) |
| Overlay detection | Runtime (Substrate) |
| Capability routing | Runtime (ToolDispatcher) |

### 8.2 Runtime Responsibilities

**What Runtime Owns:**

| Component | Responsibility |
|---|---|
| Substrate | Browser truth collection, DOM queries, ref assignment |
| Brain1 | Operational projection, complexity compression |
| Brain2 | Transition interpretation, invalidation evidence |
| Graph | Continuity topology, delta history |
| RefService | Ref lifecycle, confidence tracking |
| InputService | Interaction execution, precondition validation |
| Stabilization | Mechanical retries (bounded), transient error handling |
| TraceStore | Evidence persistence |
| ToolDispatcher | Tool routing, validation |

**What Runtime Must NEVER Do:**

| Forbidden | Owner |
|---|---|
| Semantic interpretation | Planner |
| Strategic decision-making | Planner |
| Task success judgment | Planner |
| Goal-based filtering | Planner |
| Workflow inference | Planner |
| Recovery strategy | Planner |
| Replanning | Planner |
| Autonomously deciding next step | Planner |
| Hidden planners anywhere | Planner |

### 8.3 Planner Inputs (What Runtime Exposes)

The planner receives a **RuntimeComposedInput**:

```typescript
interface RuntimeComposedInput {
  // Static context
  page_url: string
  generation: number
  goal: string
  
  // Operational structure
  visible_actions: ActionRef[]  // triggers and inputs from Brain1
  readable_content: ReadableRef[]  // data from Brain1
  regions: RegionInfo[]  // locality grouping
  
  // Continuity evidence
  last_action_result: {
    tool: string
    ref: string
    success: boolean
    evidence: TransitionEvidence  // from Brain2
  }
  
  // Recent history (compact)
  action_history: CompressedLineage  // recent semantic steps (not all deltas)
  
  // Warnings and signals
  dead_state_evidence?: string  // if we're stuck
  continuation_summary?: string  // if continuing from previous
}
```

**Key properties of planner input:**

- **Compressed:** Brain1 exposes ~40-80 nodes max, not full DOM
- **Evidence-grounded:** All values backed by runtime facts
- **Operationally-focused:** Only affordances, not intentions
- **Transition-aware:** Recent changes from Brain2
- **Goal-aligned:** Brain1 scores by relevance to goal
- **Bounded:** Fixed size, no infinite accumulation

### 8.4 Planner Outputs (What Planner Decides)

The planner returns a **PlannerOutput**:

```typescript
interface PlannerOutput {
  status: 'plan' | 'done' | 'escalate' | 'unable'
  
  plan?: {
    steps: PlannerOutputStep[]  // semantic intents with refs
    confidence: 'high' | 'medium' | 'low'
    reasoning: string  // why this plan?
  }
  
  answer?: string  // if status === 'done'
  
  escalation?: {
    reason: string  // why escalate?
    requested_capability: 'vision' | 'human_input' | 'different_model'
  }
  
  failure?: {
    reason: string  // why unable?
  }
}

interface PlannerOutputStep {
  tool: 'click' | 'type' | 'navigate' | 'inspect' | 'press' | 'scroll'
  ref: string  // v2ref_N, NOT selector
  // tool-specific params:
  text?: string  // for 'type'
  url?: string  // for 'navigate'
  key?: string  // for 'press'
}
```

**Key properties of planner output:**

- **Ref-first:** Always uses refs, never selectors
- **Semantic intents:** High-level steps, not low-level mechanics
- **Bounded plan:** Usually 1-5 steps per invocation
- **Justified:** Includes reasoning for transparency
- **Single-stream:** One semantic reasoning thread

### 8.5 Invocation Model

**When planner is invoked:**

| Event | Triggers Planner | Does NOT Trigger |
|---|---|---|
| Meaningful macrostate transition | YES | Microstate (scroll, hover, focus) |
| Runtime stabilization complete | YES | Intermediate stabilization attempts |
| Strong/negative progress evidence | YES | Weak/no-change evidence |
| Execution failure after retries | YES | Transient network hiccups |
| Uncertainty exceeds threshold | YES | Normal confidence levels |
| Dead-state exposure | YES | Internal graph updates |
| Strategic ambiguity | YES | Routine projection refresh |

**How planner is invoked:**

```typescript
// In the agent loop
while (!done && steps < maxSteps) {
  // Stabilization happens automatically, not by planner request
  await runtime.stabilize()
  
  // Re-observe and interpret transitions
  observation = await runtime.observe()
  evidence = brain2.interpret(observation)
  
  // Compose planner input
  plannerInput = runtime.compose()
  
  // Call planner (only once per meaningful transition)
  plannerOutput = await planner.call(plannerInput)
  
  // Dispatch and execute
  if (plannerOutput.plan) {
    for (const step of plannerOutput.plan) {
      result = await runtime.executeTool(step)
      steps++
    }
  }
  
  // Check terminal conditions
  if (plannerOutput.status === 'done') {
    break
  }
}
```

**Frequency:** Planner is called once per meaningful runtime transition. Usually 1-5 times per task. Not continuously.

### 8.6 Event Model

The runtime communicates to the planner through **events** (packaged as input context):

#### Event: Action Succeeded

```json
{
  "last_action_result": {
    "tool": "click",
    "ref": "v2ref_1",
    "success": true,
    "evidence": {
      "transition_type": "structural_macrostate",
      "progress": "strong",
      "new_content_appeared": true
    }
  }
}
```

**Planner reads:** My last action worked well and caused observable change.

#### Event: Action Failed with Evidence

```json
{
  "last_action_result": {
    "tool": "click",
    "ref": "v2ref_1",
    "success": false,
    "evidence": {
      "failure_reason": "target_blocked",
      "blocked_by": "modal_overlay",
      "alternatives": ["v2ref_2", "v2ref_3"]
    }
  }
}
```

**Planner reads:** My click was blocked. Here are alternative refs to try.

#### Event: Dead-State

```json
{
  "dead_state_evidence": "Last action produced no observable change. Current Brain1 projection shows no new actionable refs. Stabilization exhausted.",
  "visible_actions": []  // empty
}
```

**Planner reads:** We're stuck. No forward path is apparent. Need strategy change.

### 8.7 Execution Semantics

**Serial execution:** The planner issues a plan, the runtime executes **in order**, reporting after each step.

```
Planner: [click v2ref_1, type v2ref_1 "search", click v2ref_2]
Runtime:
  Step 1: click v2ref_1 → success
  Step 2: type v2ref_1 "search" → success
  Step 3: click v2ref_2 → success
Runtime sends: [success, success, success] with evidence
Planner re-evaluates: given these outcomes, what next?
```

NOT parallel, NOT speculative, NOT branching.

### 8.8 Exactly How Cognition Remains Centralized

**The key mechanism:**

1. **Substrate provides facts**, not interpretation
2. **Brain1 exposes structure**, not strategy
3. **Brain2 interprets transitions**, not goals
4. **Runtime routes execution**, not decisions
5. **Planner reasons**, not the runtime

If the runtime tries to:
- Decide "maybe try a different approach" → cognition leakage
- Autonomously retry forever → cognition leakage
- Classify "this is a checkout flow" → cognition leakage

The architecture breaks.

If the planner:
- Micromanages ref resolution → centralized cognition maintained
- Decides "this transition means we should replan" → centralized cognition maintained
- Interprets "the user probably wants..." → centralized cognition maintained

Centralization is preserved.

---

## 9. IMPLEMENTATION PLAN STATUS

### 9.1 Implementation Phases Overview

The v2 implementation is organized into **phases**, each with specific contracts and deliverables.

#### Phase 0: Plan-to-Code Guardrails ✓ COMPLETE

- Runtime types and config
- v2 mode configuration
- Error type definitions
- Status: DONE

#### Phase 1: Browser Session and Observation ✓ COMPLETE

- BrowserSession opens/closes
- ObservationService captures state
- CdpBridge enriches identities
- Tests: observation shape, fixture controls
- Status: DONE

#### Phase 2: Ref Lifecycle ✓ COMPLETE

- RefService assigns/resolves refs
- Ref fingerprinting (multi-signal)
- Ref resurrection logic
- Tests: ref stability, multi-generation
- Status: DONE

#### Phase 3: Stabilization ✓ COMPLETE

- StabilizationService handles transients
- Actionability validation
- Bounded retries
- Tests: preconditions, failure evidence
- Status: DONE

#### Phase 4: Tool Dispatch ✓ COMPLETE

- V2ToolDispatcher routes tools
- InputService executes actions
- Tools: click, type, scroll, navigate, press, get, search, inspect_region
- Tests: tool routing, execution success/failure
- Status: DONE

#### Phase 5: Brain1 Projection ✓ COMPLETE

- Brain1 scans DOM
- Classifies: trigger, input, data, table_cell
- Scores confidence
- Outputs FilteredNode[]
- Tests: classification, scoring, compression
- Status: DONE

#### Phase 6: Brain2 Interpretation ✓ COMPLETE

- Brain2 compares observations
- Classifies transitions: microstate, structural_local, structural_macrostate, hard_reset
- Generates invalidation evidence
- Tests: transition classification, ref invalidation
- Status: DONE

#### Phase 7: Continuity Graph ✓ COMPLETE

- Graph stores snapshots and deltas
- Queries: continuity, topology, relationships
- Pruning: bounded delta history
- Tests: graph accumulation, queries
- Status: DONE

#### Phase 8: Trace Store ✓ COMPLETE

- TraceStore records all mutations
- Action lifecycle events
- Observation snapshots
- Serialization for replay
- Tests: trace completeness, artifact generation
- Status: DONE

#### Phase 9: Harness Integration ✓ COMPLETE

- BrowseGentV2Harness coordinates components
- Orchestration logic
- Tool dispatch coordination
- Tests: end-to-end observation → action → re-observation
- Status: DONE

#### Phase 10: Planner Bridge ✓ COMPLETE

- V2PlannerClient calls LLM
- PlannerPrompt generates system/user message
- Output validation (refs, not selectors)
- Tests: client calls, validation, retry on invalid
- Status: DONE

#### Phase 11: Runtime Tool Dispatch (Current/Recent)

- Fully implement click, type, press, scroll, navigate
- Bounded select() tool for select elements
- Precondition validation (actionability, visibility)
- Re-observation after mutations
- Recovery signals (ambiguous refs, incompatible actions)
- Status: MOSTLY DONE (select tool needs completion)

#### Phase 12: Planner Input Composition

- RuntimeInputComposer compacts Brain1/Brain2/Graph into planner context
- Goal-aligned node prioritization
- Evidence extraction
- Token counting and context budgeting
- Tests: composition correctness, token efficiency
- Status: IN PROGRESS

#### Phase 13: Serial Agent Loop

- V2AgentLoop implements think → act → observe cycle
- Maxsteps enforcement
- Terminal condition detection
- Trace artifact collection
- Tests: loop execution, completeness
- Status: IN PROGRESS

#### Phase 14: MVR (Minimal Viable Runtime) Verification

- Local fixture-based execution
- End-to-end observe → action → re-observe → transition → trace
- Replay verification (can we reconstruct from trace?)
- Boundary enforcement (no v1 changes, no hidden cognition)
- Status: IN PROGRESS

#### Phase 15: Production Readiness (Future)

- Rollout mode switching (off/mvr/agent)
- Public API integration
- Extended tool support
- Advanced recovery
- Vision escalation
- Status: FUTURE

### 9.2 MVR (Minimal Viable Runtime) Definition

**MVR is a diagnostic, not a full agent.**

**What MVR proves:**
- Browser session can be opened and observed deterministically
- Observations produce generation-scoped refs
- Refs can be resolved or rejected honestly
- A simple interaction can execute through refs
- Browser can be re-observed after interaction
- Transition evidence can be computed mechanically
- Entire sequence can be replayed from trace artifacts

**What MVR does NOT include:**
- Planner loop (MVR is diagnostic only)
- Benchmark tuning
- Vision escalation
- Multi-tab orchestration
- Hidden strategic recovery
- Domain-specific heuristics

**MVR success criteria:**
- `npm run build` passes
- `npm run test:unit` passes
- Local fixture tests pass
- `npm run check:v2` passes (no hidden cognition)
- Trace artifacts are complete and replayable

### 9.3 Current Milestone

**Current State:** Phase 11 (Runtime Tool Dispatch) mostly complete, Phase 12-13 in progress.

**Verified to work:**
- Observation and ref assignment
- Brain1 projection
- Brain2 transition interpretation
- Tool dispatch and execution
- Stabilization and retry handling
- Trace recording

**Most important next gap:** Complete bounded `select(ref, value)` tool end-to-end.

**Reasoning:**
- Planner output schema already permits `select`
- Working-set action lanes already expose `selectableRefs`
- Ref capabilities already derive `selectable`
- Failure taxonomy already has `target_not_selectable`
- Runtime doesn't yet implement actual `select`
- ArXiv WebVoyager test naturally wants select, so it's discovered as a blocker

**Recommended minimal implementation:**
1. Add `select(refId, value)` to V2ToolRuntime
2. Dispatch in V2ToolDispatcher
3. InputService.select() using RefResolver (resolve ref → locate element → use Playwright selectOption for native, conservative for custom)
4. BrowseGentV2Harness.select() with trace lifecycle
5. Unit/integration tests
6. Verify on fixture

### 9.4 Expected Rollout Order

1. **Phase 14:** MVR verification (diagnostic mode, off by default)
2. **Phase 15:** Production readiness (agent mode, off by default)
3. **Opt-in enablement:** `BROWSEGENT_V2_RUNTIME=mvr` or `BROWSEGENT_V2_RUNTIME=agent`
4. **v1 unchanged:** No default behavior changes until explicit rollout
5. **Public API integration:** New BrowserAgentRunner and BrowserAgentV2 classes alongside v1
6. **Gradual transition:** Customers opt-in, provide feedback, v2 matures

### 9.5 Integration Strategy

**With v1:**

- v1 remains at `src/BrowseGent.ts` and `src/executor/*`
- v2 is at `src/v2/` completely isolated
- No shared dependencies between v1 and v2 runtime code
- v1 agents can coexist with v2 agents in same workspace

**With existing providers:**

- v2 uses existing `src/providers/` for LLM calls
- Existing provider transport (callProvider, request pacer, API budget)
- No new provider infrastructure needed

**With test infrastructure:**

- v2 has own test fixtures and integration tests
- v2 stress tests: MVR smoke tests under `tests/v2/`
- WebVoyager benchmark can run both v1 and v2
- No shared test infrastructure (keeps isolation)

---

## 10. DESIGN LAWS

These are the fundamental laws that govern v2. They are not aspirational. They are not flexible. They are architectural constraints.

### Law 1: Centralized Cognition

**Statement:**
The planner (LLM) is the sole semantic reasoning authority. All other subsystems remain deterministic, operational, and bounded.

**What this means:**
- Runtime cannot infer intent
- Runtime cannot classify domain meaning
- Runtime cannot make strategic recovery decisions
- Runtime cannot autonomously replan
- Hidden planners anywhere are forbidden

**Why it matters:**
- LLMs are most expensive, least deterministic layer
- Distributed cognition becomes untraceable
- Centralized cognition enables model portability

**Enforcement:**
- Every component audited: `check:v2:no-cognition`
- All runtime choices made by deterministic rules
- All semantic choices traced to planner

### Law 2: Continuity-First Design

**Statement:**
Browser state partially degrades, not totally. The runtime preserves refs and relationships unless evidence requires weakening or invalidation.

**What this means:**
- Refs are weakened before destroyed
- Regions preserve continuity across transitions
- Generations track stable execution windows
- Partial failure is okay; silent hidden failure is not

**Why it matters:**
- Browsers are partially unstable
- Preserving partial state is more valuable than rebuilding constantly
- Task continuity survives partial browser changes

**Enforcement:**
- Ref lifecycle: live → weakened → stale → invalid (not: valid → invalid)
- No silent fallback to broad selectors
- Evidence required for every invalidation decision

### Law 3: Replayability

**Statement:**
Execution can be completely reconstructed from trace artifacts. If runtime behavior cannot be replayed, it is not production-ready.

**What this means:**
- Every mutating action recorded with preconditions and postconditions
- Planner input/output captured exactly
- Brain1/Brain2 projections stored at decision points
- Trace format enables complete replay without re-running browser

**Why it matters:**
- Debugging becomes possible
- Architecture becomes testable
- Regression detection becomes feasible
- Non-replayable systems are black boxes

**Enforcement:**
- TraceStore records all mutation boundaries
- TraceReplayAuditor verifies reconstruction
- CI validates trace completeness

### Law 4: Sparse Cognition

**Statement:**
The planner receives structured operational state, not raw browser facts. Compression is aggressive. Context accumulation is bounded.

**What this means:**
- Brain1 outputs max 240 nodes, not all DOM nodes
- Brain2 emits transitions, not complete mutation logs
- Graph stores ~50 recent deltas, not full history
- Planner context is tight and token-efficient

**Why it matters:**
- LLM context is expensive
- Planner cost scales with context size
- Tight context = focused reasoning

**Enforcement:**
- No unlimited context accumulation
- Aggressive pruning of old observations
- Token budgets enforced
- Context compaction between phases

### Law 5: Conservative Execution

**Statement:**
The runtime favors false negatives (requesting re-observation) over false positives (wrong action on ambiguous target).

**What this means:**
- Low-confidence refs are rejected before execution
- Ambiguous targets require additional evidence before acting
- Stabilization is bounded; after retries are exhausted, failure is reported
- Runtime never silently compensates for missing information

**Why it matters:**
- Ambiguous actions are worse than no action
- Planner can respond to evidence; planner cannot undo wrong action
- Conservative safety avoids feedback loops

**Enforcement:**
- Ref confidence thresholds prevent weak execution
- Ambiguity detection blocks action
- Action precondition validation strict

### Law 6: Bounded Autonomy

**Statement:**
Runtime may stabilize, retry, and validate mechanically, but only within strict bounds. Strategic recovery decisions belong to the planner.

**What this means:**
- Retries are bounded (~3 attempts max)
- Retry logic is deterministic (not heuristic)
- Stabilization is mechanical (not semantic)
- Failure escalated to planner after mechanical exhaustion

**Why it matters:**
- Unbounded retries create loops
- Unbounded autonomy becomes hidden planning
- Planner needs to know when runtime has given up

**Enforcement:**
- Retry counters enforced
- No adaptive backoff strategies
- Clear escalation boundaries

### Law 7: Mechanical Semantics

**Statement:**
The runtime exposes operational structure and mechanical interpretation, never semantic conclusions.

**What this means:**
- Brain1 exposes affordances (clickable, editable), not intentions (you should click this)
- Brain2 interprets transitions (macrostate changed), not meaning (task progressed)
- Graph stores topology, not knowledge
- Tools return evidence, not recommendations

**Why it matters:**
- Semantic interpretation is planner's domain
- Runtime straying into semantics creates distributed cognition
- Mechanical semantics are provably determistic

**Enforcement:**
- All Brain1/Brain2/Graph outputs audited for semantic leakage
- Tools never emit strategic advice
- Strict distinction between operational and semantic layer

### Law 8: Anti-Overengineering

**Statement:**
Every abstraction must justify itself. No speculative mega-systems. No "might be useful someday" infrastructure.

**What this means:**
- The graph exists because it answers concrete continuity queries
- RefService exists because refs survive browser instability better than selectors
- Brain2 exists because transition classification is needed
- Future features are not preemptively architected

**Why it matters:**
- Complex architecture becomes brittle
- Speculative infrastructure creates maintenance burden
- Proven production problems drive architecture, not theory

**Enforcement:**
- Every component tested with concrete production scenarios
- No dead code or speculatively-prepared infrastructure
- Components removed when unused

### Law 9: Determinism

**Statement:**
Given the same browser state and runtime configuration, the system produces the same interpretation and exposure.

**What this means:**
- Observation is deterministic (same DOM queries produce same nodes)
- Ref assignment is deterministic (same identity signals produce same refs)
- Brain1 classification is deterministic (same scoring rules)
- Brain2 interpretation is deterministic (same transition rules)

**Why it matters:**
- Non-deterministic systems are unreliable
- Non-deterministic systems cannot be tested
- Debugging non-deterministic behavior is impossible

**Enforcement:**
- No random choices in runtime logic
- No hidden adapting state
- All scoring rules hardcoded constants
- Tests verify determinism explicitly

### Law 10: Explainability

**Statement:**
Every runtime decision and action must be explained through trace and evidence. The planner must be able to understand why the runtime did what it did.

**What this means:**
- Action failures emit evidence (not just success/fail)
- Ref invalidation explains reason (not just "invalid")
- Transition summaries justify classification
- Trace captures preconditions and postconditions

**Why it matters:**
- Black-box systems are not debuggable
- Explainability enables verification
- Evidence-based decisions can be reasoned about

**Enforcement:**
- All errors typed with codes and explanations
- Trace includes evidence artifacts
- Dead-state emits diagnostic information

---

## 11. CURRENT OPEN QUESTIONS

These are the unresolved questions and areas of ongoing uncertainty in v2.

### Question 1: Vision Escalation Scope

**The Question:** When should the planner request visual inspection? What are the precise triggers?

**Current Thinking:**
- Request vision when semantic ambiguity is high (DOM alone insufficient)
- Request vision when planner confidence drops below threshold
- Request vision only planner-driven, never autonomous

**Unresolved:**
- What exact confidence threshold triggers vision request?
- How to quantify "semantic ambiguity"?
- What if vision is unavailable (headless mode)?

**Impact:** Vision escalation is optional for MVR but will be needed for production robustness.

### Question 2: Multi-Tab and Frame Support

**The Question:** How should v2 handle multi-tab workflows and iframes?

**Current Thinking:**
- Single-tab focus initially
- Frame support through CDP nodeId (should work already)
- Multi-tab deferred to future phase

**Unresolved:**
- How to track refs across tab switches?
- How to handle frame boundary crossings?
- How to coordinate planner across windows?

**Impact:** Some real-world workflows need multi-tab. This will limit initial applicability.

### Question 3: Long-Task Context Management

**The Question:** How to preserve planner context across 50+ step tasks without unlimited accumulation?

**Current Thinking:**
- Compress old steps into trajectory summaries
- Planner requests context refresh when needed
- No recursive summarization (meaning degrades)

**Unresolved:**
- How often to refresh? After every 10 steps? 20 steps?
- How to decide what trajectory details to preserve?
- How to handle conflicting evidence?

**Impact:** Long tasks may lose context fidelity. Tradeoff between cost and accuracy.

### Question 4: Advanced Recovery Strategies

**The Question:** When dead-state is detected, should runtime propose recovery strategies?

**Current Thinking:**
- Runtime detects and reports dead-state
- Planner decides recovery direction
- No autonomous recovery suggestions

**Unresolved:**
- Should runtime suggest "try scrolling" or "try a different search term"?
- When is suggestion helpful vs. overstepping?
- What about obvious mechanical failures (element hidden, wrong region)?

**Impact:** Recovery quality depends on how much runtime can suggest vs. must leave to planner.

### Question 5: Streaming vs. Batch Tool Execution

**The Question:** Should planner issue one tool at a time or batches?

**Current Thinking:**
- Batch execution (planner issues plan, runtime executes all steps)
- Streaming would mean: execute first tool, wait for result, planner re-evaluates, issue next tool

**Trade-offs:**
- Batch: more efficient, but planner can't adjust mid-plan based on observations
- Streaming: more adaptive, but higher latency (LLM call per tool)

**Unresolved:**
- Is batch good enough for deterministic workflows?
- When does mid-plan adaptation matter?

**Impact:** Architecture currently assumes batch. Switching to streaming would require planner loop changes.

### Question 6: Cost vs. Accuracy Tradeoff

**The Question:** How much should v2 optimize for token efficiency vs. planner accuracy?

**Examples:**
- Re-scan Brain1 after every action (expensive, accurate) vs. reuse snapshot (cheap, potentially stale)
- Store full delta history (expensive, debuggable) vs. prune aggressively (cheap, less observable)
- Call planner after every observation (expensive, adaptive) vs. batch multiple observations (cheap, less responsive)

**Current Thinking:**
- Production-ready systems should bias toward accuracy
- Optimize for cost only after proving accuracy

**Unresolved:**
- What cost/accuracy tradeoff is acceptable?
- When to switch from accuracy-first to efficiency-first?
- How to measure the tradeoff empirically?

**Impact:** Cost will dominate long-term viability. This needs data-driven decision.

### Question 7: Generalization Across Sites

**The Question:** How well does v2 generalize to completely different website types?

**Known Challenges:**
- Canvas-based UIs (visual only, no DOM structure)
- Web workers and service workers (hidden mutations)
- Virtualized lists and infinite scroll (DOM is ephemeral)
- Custom accessibility (non-standard ARIA)
- Layout shift chaos (geometry constantly unstable)

**Current Thinking:**
- v2 should handle most standard websites
- Canvas and custom UIs may require vision escalation
- Virtualized lists may require special handling

**Unresolved:**
- What percentage of real websites can v2 handle without special cases?
- When does v2 degrade gracefully vs. fail?
- How to add site-specific support without violating architecture?

**Impact:** Real-world applicability depends on generalization.

### Question 8: Benchmark Relationship

**The Question:** What's the right way to use benchmarks to validate v2 without becoming benchmark-driven?

**Current Thinking:**
- Benchmarks are diagnostic pressure, not optimization targets
- Use benchmarks to find weak spots, not to tune scores
- If benchmark score improves, trace must show why (structural fix, not hack)

**Unresolved:**
- How to prevent benchmark tuning pressure?
- How to judge if a fix is general vs. overfit?
- When to trust benchmark signal vs. dismiss as noise?

**Impact:** Wrong benchmark relationship will compromise architecture integrity.

---

## 12. IF THE ARCHITECT LEFT TOMORROW

If the original architect disappeared and you had to maintain and evolve BrowseGent v2 correctly, what would you absolutely need to understand?

### 12.1 The Core Insight

The foundation everything rests on:

> **Browser agents fail when they try to be smart about browser mechanics.** The correct strategy is to **make the runtime trustworthy and let the planner be smart.**

This is NOT the obvious default for most agent systems. Most try to embed intelligence in the runtime: smart selectors, learned patterns, heuristic recovery, semantic ontologies.

v2 inverts this completely. v2 says: **runtime is mechanical, planner is cognitive, never mix.**

If you violate this principle — if you start embedding intelligence in the runtime to "help" the planner — you will break the architecture. You'll create:
- Hidden decisions the planner can't see
- Unreplayable behavior
- Distributed cognition that becomes untraceable
- Accumulated hidden complexity

**Defend this boundary religiously.** Every PR that touches runtime logic should ask: "Is this semantic interpretation or mechanical operation?" If it's semantic, it belongs in the planner or in the planner's training data, not in the runtime.

### 12.2 The Architecture is Purpose-Built for Production

The architecture is not designed for:
- Maximum benchmark performance
- Theoretical sophistication
- Complex multi-agent orchestration
- Adaptive learning systems
- Autonomous brilliance

It's designed for:
- **Production reliability**: the system works predictably
- **Debuggability**: failures are traceable
- **Cost-effectiveness**: token usage is controlled
- **Scalability**: the system doesn't degrade under load
- **Maintainability**: a new engineer can understand why things work

If a change makes the system "smarter" but breaks debuggability, **reject it**.

### 12.3 Continuity is the Core Problem

Most browser agents treat browser state as:
- Completely stable (assume DOM doesn't change)
- OR completely unstable (rebuild from scratch every time)

Neither is true. Browsers are **partially unstable**.

v2's secret sauce is handling partial continuity:
- Some refs survive a transition
- Some are weakened
- Some are invalidated
- But not all-or-nothing

This partial continuity is what lets v2 preserve operational state across the chaos that is real browser behavior.

**If you see code that's doing all-or-nothing invalidation ("if anything changed, throw everything away"), that's a code smell.** The architecture is built on partial preservation.

### 12.4 Refs Are the Real Innovation

Most browser agents use selectors (CSS queries). v2 uses **refs**.

The ref is a multi-signal identity capsule:
- Backend node ID (hard identity from CDP)
- Accessibility semantics (recovers if DOM reorders)
- Geometry and visual position (weak recovery signal)
- Stable hash (recovers after small DOM changes)

This is why v2 can survive browser instability that would break pure selector-based systems.

**The ref is so important that it deserves constant attention.** When ref lifecycle bugs happen, trace them carefully. The ref model is the load-bearing wall.

### 12.5 Brain1/Brain2/Graph Form a Coherent Unit

These three subsystems are deeply interconnected:

- **Brain1** produces the snapshot view of current state
- **Brain2** interprets what changed (compares snapshots)
- **Graph** stores the history of snapshots and transitions
- **Refs** link across all three (identity thread)

They are NOT interchangeable. Don't try to move Brain1's job to Brain2 or vice versa. Each has a specific responsibility.

**If you find yourself debugging complex behavior involving all three, trace carefully:**
1. What did Brain1 capture?
2. How did Brain2 interpret the transition?
3. What did the graph store?
4. How did that lead to the problem?

### 12.6 The Planner Contract is Rigid

The contract between planner and runtime is:

**Planner receives:** Compressed operational state (via Brain1/Brain2/Graph)
**Planner produces:** Semantic steps (tool calls with refs)
**Runtime executes:** Tools (mechanical translation of semantic intents)
**Runtime returns:** Evidence (what happened, not what to do next)

This contract is not flexible. If you find yourself tempted to:
- Give the planner raw selectors → stop
- Give the planner strategic recommendations → stop
- Have the runtime interpret planner intent → stop
- Have the runtime autonomously decide next steps → stop

You're breaking the contract. Fix it immediately.

### 12.7 Trace is Your Debug Weapon

When something goes wrong:
1. Look at the trace first
2. Understand what the planner saw at each step
3. Understand what the runtime did at each step
4. Understand what the browser state was before/after
5. Reconstruct why the failure happened

**If the trace is incomplete or doesn't capture the failure, fix the trace first.** Every mutating operation must be traced. If it's not traceable, it's not production-ready.

The trace is not a debugging luxury. It's a first-class property. Treat it as core infrastructure, not a nice-to-have.

### 12.8 The Anti-Patterns Are Real Risks

The architecture document lists the anti-patterns that were **explicitly considered and rejected**:

- Distributed cognition
- Multi-agent orchestration
- Semantic ontologies
- Screenshot-first cognition
- Hidden recovery systems
- Adaptive runtime governance
- Learning systems in runtime

These weren't rejected arbitrarily. Each was tried or considered, and each created problems. **If you're tempted to bring any of these back, read the rejection rationale first.** The reasons still apply.

### 12.9 Production Reality Over Elegance

The architecture sometimes makes tradeoffs that feel inelegant:

- Hard constants instead of adaptive thresholds
- Bounded history instead of unlimited observation
- Discrete transition types instead of spectrum
- Mechanical retries instead of intelligent recovery

These are **not accidental.** They're intentional design choices that prioritize:
- Debuggability over elegance
- Predictability over adaptivity
- Simplicity over sophistication

When you're tempted to "improve" something, ask: **"Does this maintain debuggability and predictability?"** If it doesn't, it's not an improvement.

### 12.10 The Benchmark Relationship is Fragile

Benchmarks are incredibly seductive. A shiny percentage score is compelling.

But the architecture explicitly says: **benchmarks validate, they don't drive.**

If you find yourself tuning for a specific benchmark score:
- Stop
- Ask: is this a general improvement or benchmark-specific?
- If it's specific, undo it

The moment benchmarks start shaping architecture decisions, you'll start making tradeoffs that hurt production reliability.

### 12.11 Cost Will Dominate Long-Term

The biggest long-term pressure on v2 will be **cost**.

Token usage per task will be the real metric that matters in production. Every optimization opportunity will be tempting:
- Skip re-scans (save tokens, risk staleness)
- Prune history more aggressively (save tokens, lose observability)
- Reduce planner calls (save tokens, risk responsiveness)

You'll have to make these tradeoffs, but make them carefully. Measure the tradeoff:
- How much token savings?
- How much accuracy/reliability lost?
- Is it worth it?

**Don't optimize for cost at the expense of reliability.** Production systems prioritize reliability first.

### 12.12 The Simplicity is Real

One of the deepest insights in the architecture is:

> **This is less sophisticated than it looks.**

Most browser agents are architecturally simpler but operationally chaotic. v2 is architecturally more complex (more subsystems) but operationally simple (each subsystem is straightforward).

The complexity is **organized and structured**, not hidden and magical.

When something doesn't work, you can trace it. When something needs to change, you can change one component without rippling everywhere.

**Preserve this simplicity.** Resist the urge to add magical intelligence. The system's strength is clarity, not cleverness.

### 12.13 Document Decisions

As you make changes and evolve the system, **document your decisions**.

- Why did you change the confidence threshold?
- What problem was it causing?
- What tradeoff did you accept?
- How will you know if this was right?

The architecture documents exist because future engineers need to understand not just *what* was built, but *why*.

If you make a significant change, update the docs. Future-you (or the next architect) will thank you.

---

## CONCLUSION

BrowseGent v2 is a **production-grade centrally cognitive browser runtime** built on the insight that **trustworthy mechanics enable focused cognition**.

The system is:
- **Mechanically deep** (runtime handles browser chaos)
- **Cognitively shallow** (planner stays focused on goals)
- **Operationally explainable** (every step is traceable)
- **Production-oriented** (reliability over brilliance)

It solves the fundamental problem: **browsers are hostile, unstable execution substrates**. By building a stabilization layer (Substrate, Brain1, Brain2, Graph, Refs, Continuity), v2 lets the planner reason over clean, trustworthy operational state instead of fighting browser chaos.

The architecture is not perfect. There are open questions about vision escalation, long-task context, advanced recovery, and cost tradeoffs. But the core design is sound and has been validated through implementation.

If you're maintaining or evolving v2, remember:
1. **Defend the boundary between planner and runtime**
2. **Continuity is the hard problem v2 solves**
3. **Trace is your first debugging tool**
4. **Simplicity is a feature, not a limitation**
5. **Production reliability > benchmark cleverness**

Good luck. The system is in your hands now.
