# 03 — Planner and Execution Architecture

## 1. Planner Philosophy

### 1.1 What the Planner Is

The planner is a **sparse strategic reasoning layer** — the sole semantic authority in the system.

The planner is:
- A high-level semantic decision maker
- A goal-level semantic orchestrator
- An intermittent semantic strategist
- The final cognitive authority

The planner is NOT:
- A browser operator or mechanics manager
- An execution engine or retry loop
- A runtime debugger or validator
- A continuous browser micromanager

### 1.2 The Core Principle

> **The planner thinks semantically, not mechanically.**

GOOD planner reasoning: "I should inspect the results region before paginating."
BAD planner reasoning: "Maybe the selector changed."

The planner thinks in concepts like: inspect, verify, search, compare, navigate, answer, refine, escalate.
NOT in: stale refs, overlays, DOM mutations, layout shifts, click retries.

### 1.3 Planner Responsibility Boundary

**Planner owns:**

| Responsibility | Category |
|---|---|
| Goal interpretation | Strategic |
| High-level strategy | Strategic |
| Choosing between read/navigate/interact | Strategic |
| Deciding next semantic step | Strategic |
| Deciding when answer is sufficient | Strategic |
| Escalation decisions | Strategic |
| Semantic interpretation of evidence | Cognitive |
| Replanning when strategy fails | Cognitive |

**Planner does NOT own:**

| Responsibility | Owner |
|---|---|
| Stale ref detection | Runtime |
| Actionability validation | Runtime |
| Visibility correctness | Runtime |
| Browser event interpretation | Brain2 |
| Execution retries (mechanical) | Runtime |
| Invalidation logic | Brain2 |
| Operational projection diffs | Brain1 |
| Transition and progress diffs | Brain2 |
| Overlay detection | Runtime |
| Capability routing | Runtime |

### 1.4 Planner Minimization

> **Every responsibility removed from the planner is a massive production win.**

The planner prompt must never accumulate "browser survival instructions." Instead, the runtime absorbs:
- Microstate churn
- Execution validation
- Invalidation handling
- Action interpretation

The planner should assume **runtime operational guarantees** — refs valid enough, actions executable enough, observations stabilized enough, summaries trustworthy enough — without continuously micromanaging runtime mechanics.

---

## 2. Planner/Runtime Boundary

### 2.1 The Clean Separation

| Runtime | Planner |
|---|---|
| Mechanics | Cognition |
| Stabilization | Reasoning |
| Continuity | Strategy |
| Invalidation | Interpretation |
| Execution safety | Decision making |
| Structured exposure | Task understanding |
| Operational truth | Semantic meaning |

### 2.2 Runtime Autonomy vs. Strategic Cognition

**Runtime Autonomy** (happens automatically):
- Invalidation handling, visibility refresh, stale detection
- Retry policies (bounded, mechanical), actionability checks
- Capability fallback, geometry refresh
- Postcondition observation, microstate stabilization

**Strategic Cognition** (planner-only):
- Interpret goals, choose direction, decide next semantic step
- Determine sufficiency, compare alternatives
- Decide escalation, answer user

### 2.3 The "Semantic Escalation Only" Law

The planner should only wake up when:
- Semantic ambiguity appears
- Strategic branching is required
- Macrostate meaning changed
- Answer sufficiency is uncertain
- Recovery path is unclear

NOT for:
- Tiny runtime mechanics
- Visibility refreshes
- Click retries
- Stale geometry
- Focus stabilization

### 2.4 The Stabilize → Expose → Cognize Model

The runtime’s relationship to planner cognition follows a strict sequencing principle:

```
Stabilize (runtime ensures coherent browser state)
    → Expose (Brain1/Brain2 compose operational projection)
    → Cognize (planner reasons over clean composed state)
```

> **The runtime doesn’t own cognition cadence or strategy, but it does control when coherent reality is available for cognition.**

The planner still thinks often — but about semantic progress, strategy, goals, and observations, NOT about stale refs, DOM races, click stabilization, or visibility math.

### 2.5 Planner Invocation Events

| Triggers Planner Re-evaluation | Does NOT Trigger Planner |
|---|---|
| Meaningful macrostate transition | Microstate churn (scroll, hover, focus) |
| Runtime stabilization complete | Intermediate stabilization attempts |
| Strong/negative progress evidence | Weak/no-change evidence during bounded mechanical stabilization |
| Execution failure after bounded retries | Transient execution races (runtime absorbs) |
| Uncertainty exceeds threshold | Normal confidence levels |
| Dead-state exposure | Internal graph updates |
| Strategic ambiguity | Routine projection refresh |

---

## 3. Execution Lifecycle

### 3.1 The Core Loop

```
Planner proposes semantic intent
    ↓
Runtime executes operational mechanics
    ↓
Runtime stabilizes (retries, waits, validation)
    ↓
Brain2 summarizes transition outcome
    ↓
Brain1 updates structured exposure
    ↓
Planner receives evidence + updated state
    ↓
Planner reevaluates strategically
```

### 3.2 Phase-Oriented Execution

The execution lifecycle is phase-oriented and deterministic:

1. **Planner Decision** — Planner selects a semantic step based on current state
2. **Tool Dispatch** — Runtime translates semantic intent into operational execution
3. **Execution** — Substrate performs browser interaction
4. **Stabilization** — Runtime handles transient issues (retries, waits, focus)
5. **Observation** — Substrate captures post-action browser state
6. **Transition Interpretation** — Brain2 interprets what changed
7. **Exposure Update** — Brain1 rebuilds structured projections
8. **Planner Feedback** — Planner receives compact evidence and updated state

### 3.3 Execution Preconditions

Every action has preconditions validated by the runtime:
- Is the target ref still valid?
- Is the element actionable (visible, enabled, not occluded)?
- Is the geometry stable enough for interaction?

Failed preconditions are reported to the planner as evidence, not silently retried indefinitely.

### 3.4 Evidence-Based Success Verification

Actions are **state transition attempts**, not fire-and-forget events:
- After execution, the runtime observes the result
- Brain2 interprets whether meaningful change occurred
- The planner receives structured evidence of the outcome
- Verification depth scales with action risk class

---

## 4. Orchestration

### 4.1 Orchestration Philosophy

Orchestration is **deterministic coordination only**:
- Phase-oriented execution lifecycle
- Bounded runtime stabilization
- Non-cognitive coordination

Orchestration is NOT:
- Adaptive governance
- Hidden cognition
- Policy-engine intelligence
- Autonomous orchestration management

### 4.2 Rejected Orchestration Patterns

| Pattern | Why Rejected |
|---|---|
| Multi-agent planners | Coordination complexity without operational leverage |
| Recursive reasoning trees | Unnecessary for production browser tasks |
| Autonomous subplanners | Distributed cognition leakage |
| Manager/executor systems | Hidden cognition, debugging impossibility |
| Orchestration manager | Distributed reasoning |
| Recovery coordinator | Hidden strategic cognition |
| Planner supervisor | Cognition outside the planner |
| Retry policy engine | Strategic decisions embedded in runtime |
| Adaptive runtime router | Hidden intelligent routing |

### 4.3 Single Planner Architecture

Initially:
- One planner
- One cognition stream
- Runtime provides stabilized structure
- Planner reasons semantically

This is the healthiest production-grade starting point.

---

## 5. Tool Philosophy

### 5.1 Tools Are Operational Primitives

Tools are the planner's execution interface to the runtime. They must be:
- Operational (execute bounded actions)
- Composable (planner assembles workflows)
- Observational (return structured evidence)
- Non-intelligent (no domain reasoning inside tools)
- Bounded (clear input/output contracts)

### 5.2 Tool Design Principles

Inspired by the coding-agent comparison:

| Coding Agent | Browser Agent |
|---|---|
| `read_file()` | `inspect_region()` |
| Not `understand_entire_repository_and_fix_bug()` | Not `find_best_booking_option()` |

The planner issues semantic intent. Tools execute bounded operations. The planner interprets results.

### 5.3 Tool Categories

| Category | Examples |
|---|---|
| Observation tools | inspect_region, expand_readable, show_actions, reveal_navigation |
| Interaction tools | click, type, select, scroll, navigate |
| Focus tools | focus_near, focus_region |
| Verification tools | verify_state, check_progress |

### 5.4 Tool Outputs

Tool outputs are **structured evidence**, not strategic interpretation:

GOOD: `{ "clicked": true, "region_changed": false, "new_modal": true }`
BAD: `"Button clicked. You should now look at the modal to complete checkout."`

### 5.5 Tool API Surface Disclaimer

> Tool names throughout this corpus (inspect_region, expand_readable, etc.) are **illustrative**, not locked API surfaces. Implementation may produce different names, signatures, and decompositions. The principles — operational, composable, bounded, non-cognitive — are the locked contract.

---

## 6. Semantic Steps

### 6.1 Unit of Planner Cognition

The planner reasons in **semantic steps**, not raw tool calls or browser events:

| Unit | Assessment |
|---|---|
| Raw tool call | Too mechanical |
| Browser event | Catastrophic |
| Giant plan | Too rigid |
| **Semantic step** | Correct unit |

### 6.2 Good Semantic Steps

- Search for flights
- Inspect results
- Compare options
- Expand details
- Verify constraints
- Continue navigation

### 6.3 Bad Semantic Steps (these are runtime mechanics)

- Click x/y coordinates
- Wait 200ms
- Retry DOM selector
- Inspect render mutation

### 6.4 The Principle

> **Planner thinks in semantic transitions, not browser operations.**

---

## 7. Cognition Loop — Think-Act-Observe

### 7.1 The Natural Agent Loop

The planner operates in a natural cognition loop:
- **Think** — Assess current state, decide next semantic step
- **Act** — Issue tool call (semantic intent → operational execution)
- **Observe** — Receive structured evidence and updated Brain1/Brain2 state
- **Think** — Reassess, adapt, continue or replan

This is the same loop that makes coding agents successful.

### 7.2 Two Modes of Planner Operation

| Mode | Description |
|---|---|
| **Strategic Planning** | Higher-level: task decomposition, direction selection, goal reasoning, long-horizon planning. Strongest at initial stages, recovery moments, complex branching. |
| **Operational Reasoning** | Continuous: selecting next action, interpreting results, adapting locally, retrying strategically, inspecting runtime state. The normal browser-agent cognition loop. |

### 7.3 Stateless-ish Between Cycles

The planner should remain relatively stateless between reasoning cycles:
- Runtime preserves continuity, structure, and transition state
- Planner mainly preserves semantic direction, task intent, and current strategy
- No massive evolving internal cognition graphs

### 7.4 The Key Insight

> **The planner should consume situations, not systems.**

The planner sees **current semantic reality**, not internal architecture machinery. This dramatically reduces cognitive overload, reasoning pollution, and planner fragility.

---

## 8. Retry Semantics

### 8.1 Mechanical vs. Strategic Retries

| Type | Owner | Examples |
|---|---|---|
| **Runtime Retry** (mechanical) | Runtime | Transient click stabilization, execution races, focus retry, actionability wait, geometry refresh |
| **Planner Retry** (strategic) | Planner | Wrong interaction path, no progress after action, alternative navigation, changed strategy, different query |

This separation is critical. Runtime retries are **execution stabilization**, not cognition. Strategic retries are **semantic replanning**, owned by the planner.

### 8.2 Runtime Retry Constraints

Runtime retries must be:
- Bounded (limited attempts)
- Deterministic (same conditions → same behavior)
- Explainable (traceable in execution lineage)
- Local (no strategic escalation)

The runtime must NEVER escalate into strategy:

GOOD: "retry click after transient overlay"
BAD: "search alternative workflow because interaction failed twice"

---

## 9. Execution Coordination

### 9.1 Planner-Led Lifecycle

All execution is planner-led:
- Planner decides what happens
- Runtime decides how it executes safely
- Brain2 decides what changed meaningfully
- Brain1 decides what to expose next
- Planner decides what it means

### 9.2 Event Flow

```
Planner Decision
    → Tool Dispatch
    → Substrate Execution
    → Runtime Stabilization
    → Brain2 Transition Interpretation
    → Brain1 Exposure Update
    → Evidence Assembly
    → Planner Feedback
```

### 9.3 Sparse Strategic Cognition

- Substrate runs continuously
- Brain2 interprets continuously
- Planner invoked after meaningful transitions or after bounded no-progress evidence must be exposed

Instead of LLM every tiny step, the system achieves:
- Fewer LLM calls
- Cleaner state
- Less noise
- Better reasoning density
- Lower token cost
- Better reliability

### 9.4 Cognitive Density

Every planner invocation should contain **maximum semantic signal** and **minimum runtime noise**. The runtime compresses browser chaos into clean semantic state.

---

## 10. Planner Context Composition

### 10.1 The Problem

Planner context is where architecture quality, reasoning quality, cost, scalability, hallucination resistance, and planner stability all collide. Most agent systems fail HERE — not because the model is weak, but because the planner context becomes cognitively polluted.

### 10.2 The Principle

> **Planner context must be semantically dense and mechanically sparse.**

### 10.3 What Should Exist in Context

| Category | Purpose |
|---|---|
| Current task objective | Strategic grounding |
| Current semantic state | Reasoning reality |
| Relevant Brain1 projections | Actionable/readable structure |
| Brain2 transition summary | What changed meaningfully |
| Recent semantic trajectory | Continuity |
| Uncertainty/confidence signals | Informed decision-making |

### 10.4 What Should NOT Exist in Context

- Runtime mechanics and browser internals
- Historical debris and stale observations
- Raw retries and execution logs
- Duplicated observations
- Event timing and stabilization mechanics
- Invalidation details and graph topology

### 10.5 Context Compartmentalization

Planner context should be **compartmentalized**:
- Active semantic state (fresh, current)
- Compressed trajectory (recent meaningful actions and outcomes)
- Task continuity (goal, strategy, direction)
- Uncertainty signals (where confidence is low)

Not a single giant undifferentiated context blob.

---

## 11. Planner I/O Protocol

### 11.1 Planner Input Shape

The planner receives a structured operational state, NOT raw runtime internals:

| Input Component | Source | Content |
|---|---|---|
| objective | Task definition | Current task goal |
| operational_state | Brain1 | Current projections (interactions, readables, regions, navigation) |
| continuity_state | Brain2 | Transition summary, progress evidence, freshness signals |
| execution_state | Runtime | Last action outcome, execution evidence |
| uncertainty_state | Runtime | Low confidence areas, ambiguous observations |
| recent_lineage | Lineage | Compressed recent semantic trajectory |
| active_constraints | Task | Token budget, attempt limits, escalation state |

The input must remain **operationally structured and declarative**. No internal runtime mechanics, graph topology, or stabilization details leak into planner input.

### 11.2 Planner Output Shape

The planner emits declarative semantic intent:

| Output Component | Purpose |
|---|---|
| semantic_action | What to do next (inspect, click, navigate, verify, answer) |
| target_context | Which refs, regions, or interaction targets |
| constraints | Any execution constraints (careful, verify, escalate) |
| escalation_requests | Vision escalation, expanded inspection, deeper projection |
| reasoning_summary | Compressed reasoning chain (for lineage and debugging) |

Planner output is **semantic intent**, not execution commands. The runtime translates intent into browser mechanics.

---

## 12. Execution Queue and Event Model

### 12.1 Single Execution Queue

Initially, the system operates on a **single, serial execution queue**:
- One planner decision at a time
- One action execution at a time
- One stabilization cycle at a time
- One projection refresh at a time

NO parallelism, concurrency, or speculative execution in the initial implementation. Complexity from concurrency is deferred until the serial model is validated.

### 12.2 Runtime Event Model

Runtime events are **passive operational signals**, NOT orchestration triggers:

| Event Type | Examples | Purpose |
|---|---|---|
| Stabilization events | wait_complete, retry_exhausted, geometry_settled | Execution coordination |
| Transition events | region_changed, refs_invalidated, generation_bumped | Brain2 input |
| Exposure events | projection_refreshed, view_regenerated | Brain1 lifecycle |
| Evidence events | progress_detected, uncertainty_elevated | Planner input composition |

Events exist for observability, lineage, and coordination — NOT for orchestration intelligence or adaptive routing.
