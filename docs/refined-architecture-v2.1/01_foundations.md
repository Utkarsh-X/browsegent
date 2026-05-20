# 01 — Architectural Foundations

## 1. Architecture Identity

BrowseGent v2 is a **centrally cognitive browser runtime** operating over a **continuity-aware browser substrate**.

It is NOT:
- a browser automation framework
- a multi-agent orchestration system
- a screenshot-first browser parser
- a semantic ontology engine
- a research prototype

It IS:
- a production-grade browser intelligence runtime
- designed for operational reliability, explainability, and deterministic execution
- centrally cognitive: one planner, one reasoning stream, one semantic authority
- mechanically deep: the runtime stabilizes browser chaos so the planner can think clearly

---

## 2. Design Philosophy

### 2.1 Core Thesis

The v1 generation of browser agents competes on **how smart the planner is**. BrowseGent v2 competes on **how trustworthy the runtime is**.

The fundamental architectural correction is:

> **Runtime stabilization reduces planner complexity**
> instead of
> **Planner complexity compensates for runtime weakness**

This is the deepest strategic insight driving the entire architecture.

### 2.2 The Shift from v1

| v1 Pattern | v2 Correction |
|---|---|
| Selector-centric interaction | Ref-first stable identity |
| Screenshot-first cognition | DOM-grounded, vision-escalated |
| Planner compensates for runtime | Runtime stabilizes for planner |
| Giant monolithic prompts | Sparse semantic context |
| Retry-loop agents | Evidence-based cognition |
| Distributed semi-intelligence | Centralized cognition |

### 2.3 Bounded Production Intelligence

The architecture intentionally targets:

```
bounded production intelligence
```

NOT:

```
unbounded sophistication
```

This means:
- Strong primitives
- Strong boundaries
- Strong runtime truth
- Explainable behavior
- Conservative execution
- Selective sophistication
- Incremental evolution

---

## 3. Production Philosophy

### 3.1 Priority Ordering

| Priority | Importance |
|---|---|
| Determinism | extremely high |
| Explainability | extremely high |
| Observability | extremely high |
| Stable execution | extremely high |
| Debuggability | extremely high |
| Semantic compactness | high |
| Adaptivity | medium |
| Autonomous cleverness | medium |
| Full autonomy magic | low |

### 3.2 The "Pay Rent" Rule

Every subsystem and every abstraction must provide clear operational leverage — reliability, debuggability, or cost reduction. If an abstraction cannot justify its existence through a concrete production problem it eliminates, it is excised.

The test for every component:

> "What production failure disappears if this exists?"

If the answer is weak: remove or simplify it.

### 3.3 Minimum Sufficient Architecture

The target is NOT the most advanced possible architecture. The target is:

> **The minimum architecture that solves the dominant failure modes reliably.**

This discipline determines whether BrowseGent becomes an extraordinary runtime or a beautiful but heavy architecture.

---

## 4. Centralized Cognition

This is the single most important architectural constraint.

### 4.1 The Principle

The planner (LLM) is the **sole semantic reasoning authority**. All other subsystems — substrate, Brain1, Brain2, graph, tools, orchestration — must remain deterministic, operational, bounded, and non-cognitive.

### 4.2 What This Means Operationally

| Layer | Allowed | Forbidden |
|---|---|---|
| Substrate | Browser truth, DOM/AX queries, ref assignment | Semantic interpretation, strategic decisions |
| Brain1 | Operational projection, affordance exposure, locality grouping | Domain inference, intent reasoning, semantic narration |
| Brain2 | Continuity interpretation, transition tracking, invalidation | Strategy, goal interpretation, replanning |
| Graph | Continuity topology, locality persistence, relationship storage | Semantic reasoning, knowledge representation |
| Tools | Operational primitives, bounded capabilities | Intelligent workflows, autonomous actions |
| Orchestration | Deterministic coordination, phase lifecycle | Adaptive governance, hidden cognition |

### 4.3 Mechanical vs. Cognitive Semantics

The architecture draws a strict boundary between two kinds of semantics:

**Mechanical Semantics (runtime-allowed):**
- actionable, grouped, changed, invalidated, visible, blocked, newly appeared, interaction triggered update

**Cognitive Semantics (planner-only):**
- user intention, business meaning, optimization logic, preference reasoning, domain interpretation, strategic tradeoffs

This distinction is foundational and must never be violated.

### 4.4 The Deepest Runtime Principle

> **The runtime helps cognition see clearly without helping cognition think.**

Brain1 compresses **operational complexity**, NOT semantic complexity. Semantic complexity belongs to the planner. Operational reduction belongs to the runtime. This division is what keeps the architecture coherent.

The runtime collectively reduces browser instability before cognition — none of the runtime systems individually try to be intelligent.

### 4.5 Why Centralized Cognition Matters

- LLMs are the most expensive, least deterministic, most model-sensitive layer
- Every responsibility removed from the planner is a massive production win
- Distributed cognition creates untraceable, unreplayable behavior
- Centralized cognition enables model portability — when models improve, the architecture improves naturally

---

## 5. Architectural Constraints

### 5.1 Locked Principles

These are considered stable architectural truths, not speculative ideas:

| Principle | Status |
|---|---|
| Substrate-first architecture | locked |
| Ref-first execution | locked |
| Layered observation | locked |
| Brain2 as continuity interpreter | locked |
| Microstate vs macrostate separation | locked |
| Runtime-owned mechanics | locked |
| Planner-owned strategy | locked |
| Semantic escalation model | locked |
| Conservative runtime autonomy | locked |
| Explainable runtime behavior | locked |
| Planner minimization | locked |
| Brain1 as operational projection | locked |
| Graph as continuity topology | locked |
| Failure as degradation (not binary) | locked |
| Dead-state semantics | locked |
| Sparse episodic cognition | locked |
| Context compaction philosophy | locked |
| Continuity-oriented runtime model | locked |
| Benchmark validates (not governs) architecture | locked |

### 5.2 Irreversible Decisions

These are the decisions that are hardest to undo later and were therefore designed most carefully:

- Ref model
- Observation model
- Invalidation philosophy
- Execution semantics
- Brain1/Brain2 boundaries
- Planner responsibilities
- Substrate responsibilities
- Tool architecture

### 5.3 The "No Hidden Cognition" Rule

Runtime systems must never incorporate:
- Heuristic planning
- Distributed orchestration intelligence
- Keyword-based semantic matching
- Domain-specific pattern recognition
- Dictionary-style classification engines
- Self-modifying adaptive behavior

The system is NOT a dictionary. It is NOT a keyword-based classifier. Intelligence is the exclusive territory of the LLM.

---

## 6. Anti-Patterns and Rejected Directions

The architecture **explicitly and repeatedly** rejected the following approaches. These rejections are first-class architectural decisions.

### 6.1 Rejected Architectural Patterns

| Rejected Pattern | Why Rejected |
|---|---|
| Distributed cognition | Untraceable, unreplayable, fragile |
| Multi-agent orchestration | Coordination complexity without leverage |
| Autonomous runtime adaptation | Creates hidden, unpredictable behavior |
| Giant semantic ontology systems | Over-architecture, brittle, site-specific |
| Screenshot-first cognition | Expensive, unstable, noisy |
| Hidden recovery systems | Distributed cognition leakage |
| Adaptive runtime governance | Policy-engine intelligence is cognition |
| Excessive architectural sophistication | Architecture theater without production value |
| Uncontrolled parallel cognition | Debugging impossibility |
| Semantic runtime heuristics | Domain-specific brittleness |
| Keyword-based classification | "Dictionary architecture" — not generalizable |
| Learning systems in runtime | Unpredictable, hard to debug, hidden behavior |
| Infinite summarization recursion | Meaning degrades catastrophically |
| Graph-as-intelligence | Ontology obsession without operational value |
| Runtime-controlled cognition cadence | Runtime deciding when planner thinks |

### 6.2 The "Semantic Interpretation Inflation" Warning

Brain1, Brain2, and the graph each faced drift toward becoming "thinking systems." This was caught and corrected each time. The correction:

> **The runtime exposes operational structure, not intelligence.**

Brain1 projects operational affordances and structure, not semantic conclusions.
Brain2 interprets continuity transitions, not strategic intentions.
The graph stores continuity topology, not semantic knowledge.

---

## 7. Subsystem Ownership Philosophy

### 7.1 Ownership Map

```
Planner
├── Goal interpretation
├── High-level strategy
├── Semantic step selection (inspect, verify, search, compare, navigate, answer)
├── Sufficiency determination
├── Escalation decisions
├── Replanning
└── All semantic meaning

Runtime
├── Substrate (DOM, CDP, layout, ref assignment)
├── Brain1 (operational projection)
├── Brain2 (continuity interpretation)
├── Graph (continuity topology)
├── Execution stabilization
├── Observation management
└── Tool execution mechanics

Forbidden Zone
├── Runtime strategic decisions
├── Hidden planners anywhere
├── Domain-aware classification
├── Cognitive orchestration
└── Autonomous recovery strategy
```

### 7.2 The Correct Runtime Philosophy

> **Conservative Autonomous Runtime**

The runtime may:
- stabilize, retry, validate, refresh, recover small issues

But with:
- bounded attempts
- explainable transitions
- observable state
- no hidden strategic decisions

---

## 8. Operational Principles

### 8.1 Reliability Over Cleverness
Avoid magical autonomy. Predictable systems win in production.

### 8.2 Determinism Over Emergent Behavior
The runtime must be explainable. Same inputs should produce same interpretations.

### 8.3 Conservative Execution
Safe mutation handling. Favor false negatives (requesting re-observation) over false positives (wrong action on ambiguous target).

### 8.4 Layered Intelligence
Substrate before planner. Browser truth before semantic reasoning.

### 8.5 Selective Sophistication
Complexity must justify itself through operational leverage. No speculative mega-systems.

### 8.6 Operational Observability
Traces and debugging are first-class runtime properties, not afterthoughts.

### 8.7 Incremental Evolution
The architecture should evolve through production evidence, not theoretical ambition.

---

## 9. Inspirations and Divergences

### 9.1 What Was Extracted

| Source | What Extracted |
|---|---|
| REF-based browser systems | Interaction identity must survive browser instability — refs as stable interaction targets |
| Browser Harness systems | Browser as operational substrate, deterministic runtime assistance, structured browser state |
| Coding agents (Codex, Cursor) | Centralized cognition, operational tool primitives, think→act→observe loops, bounded orchestration |

### 9.2 What Was NOT Copied

The system did NOT copy any source architecture. It extracted **operational truths** and composed them into an original architecture.

### 9.3 Key Divergences

| Compared To | BrowseGent v2 Divergence |
|---|---|
| REF systems | Evolved beyond interaction-focused to runtime continuity-focused |
| Browser Harness | Aggressively centralized cognition instead of runtime-managed coordination |
| Coding agents | Added much deeper runtime stabilization infrastructure (Brain1, Brain2, graph, continuity) because browsers are fundamentally more hostile execution substrates than code editors |

### 9.4 The Original Contribution

The most original part of the architecture is **the Runtime Semantics Layer**:
- Brain1 (structured semantic exposure)
- Brain2 (runtime continuity interpretation)
- Continuity graph (runtime topology)
- Invalidation-aware stabilization

This layer makes the system **mechanically deep but cognitively centralized** — a rare and powerful architecture shape.

---

## 10. Architecture Identity Summary

```
A centrally cognitive agent
operating over a continuity-aware browser runtime substrate
```

The architecture is:
- **Mechanically deep** — runtime is internally sophisticated enough to stabilize browsers
- **Cognitively shallow** — one planner, one reasoning stream, one semantic authority
- **Operationally explainable** — every component has bounded, inspectable behavior
- **Production-oriented** — every abstraction earns its place through operational leverage
