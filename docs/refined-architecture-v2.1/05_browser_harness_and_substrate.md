# 05 — Browser Harness and Substrate

## 1. Browser Harness Philosophy

### 1.1 The Core Principle

> **The browser harness is a substrate adapter, not an intelligence layer.**

The harness:
- Exposes browser capabilities
- Normalizes browser behavior
- Stabilizes execution primitives
- Surfaces runtime events
- Enables structured interaction

The harness must NEVER:
- Reason semantically
- Infer intent
- Autonomously optimize workflows
- Become cognitive middleware

### 1.2 Why the Harness Exists

> **The browser itself is hostile infrastructure.**

Browser environments are:
- Async and event-fragmented
- Rerender-heavy and visually unstable
- Partially observable and mutation-prone

This hostility is WHY refs, Brain1, Brain2, the continuity graph, and stabilization phases became necessary. The harness exists to **make browser reality operationally tractable** — not to implement intelligence.

### 1.3 Harness Responsibilities

**Correct harness responsibilities:**
- DOM access and queries
- Execution control (navigation, interaction)
- Interaction primitives (click, type, scroll, select)
- Navigation events and frame structure
- Viewport state and geometry
- Network signals
- Observability hooks (DOM snapshots, event traces, render timing)

**Incorrect harness responsibilities (belong above):**
- Semantic interpretation
- Workflow understanding
- Task-level abstractions
- Domain-aware routing
- Strategic decision-making

---

## 2. Playwright/CDP Abstraction Philosophy

### 2.1 The Abstraction Boundary

The runtime should think in **runtime abstractions**, not Playwright internals:

| Planner/Runtime Reasons Over | Harness Encapsulates |
|---|---|
| Refs | Backend node IDs |
| Regions | DOM subtrees |
| Interactions | Click handlers, event dispatch |
| Continuity | Mutation observers |
| Observations | AX tree queries, getComputedStyle |

The planner never sees CSS selectors, Playwright handles, CDP protocol details, or DOM event API specifics. Those are **substrate implementation details**.

### 2.2 Why This Matters

This abstraction boundary ensures:
- **Portability** — if Playwright changes, CDP changes, or custom browser layers emerge, the architecture survives
- **Stability** — runtime concepts (ref, region, observation) remain stable across browser updates
- **Clarity** — planner reasoning never contaminated by browser protocol mechanics

### 2.3 Replaceability Principle

> **The harness should remain replaceable.**

The architecture should survive a complete harness swap (e.g., from Playwright to custom CDP, or to a different browser automation framework) because the runtime abstractions above the harness are stable.

---

## 3. Headed vs. Headless Philosophy

### 3.1 Initial Design Target

> **Headed-first operational visibility.**

Even if headless is supported later, the initial design optimizes for headed execution because during architecture validation, visibility is critical:
- Behavioral verification
- Runtime debugging
- Failure analysis
- Architecture understanding
- Execution replay verification

### 3.2 Headless as Operational Optimization

Headless execution is NOT an architecture problem:

```
It is an operational optimization problem.
```

Do not prematurely distort architecture around:
- Resource optimization
- Stealth execution
- Hyperscale automation

before validating the cognition-runtime interaction model itself.

### 3.3 Current Priority

During architecture validation phase:
- Headed execution with full observability
- Visual debugging and inspection available
- Behavioral verification through visual confirmation

Headless optimization is a future-phase concern.

---

## 4. DOM-Grounded Runtime

### 4.1 The Core Principle

> **DOM-grounded runtime first. Vision escalation only when necessary.**

The primary cognition substrate is structured DOM/accessibility tree data, not screenshots. This is a fundamental architectural decision that diverges from many current browser agents.

### 4.2 Why DOM-First

| Property | DOM-First | Screenshot-First |
|---|---|---|
| Operational structure | Stable, queryable | Pixel-dependent, fragile |
| Cognition cost | Low (structured data) | High (vision model) |
| Observability | Strong (inspectable tree) | Weak (opaque pixels) |
| Token efficiency | High (compressed text) | Low (image tokens) |
| Actionability | Directly determinable | Inferred, unreliable |
| Execution targeting | Precise (ref-based) | Approximate (coordinate-based) |

### 4.3 What DOM-Grounding Provides

- Refs grounded in backend node IDs and accessibility semantics
- Brain1 projections derived from structured DOM/AX data
- Brain2 transitions detected through mutation observation
- Actionability determined through computed styles and ARIA roles
- Regions constructed from DOM locality and structural patterns

---

## 5. Vision Escalation Philosophy

### 5.1 Vision as Escalation, Not Default

Vision should remain:

```
a planner-requested escalation substrate
```

NOT:

```
primary cognition driver
```

> **Vision escalation is always planner-requested, NEVER runtime-autonomous.**

The runtime may expose conditions that suggest vision might be useful (ambiguity, weak continuity, low-confidence operational state). But the **planner decides** whether visual cognition is required. The runtime never autonomously captures or processes screenshots.

### 5.2 When Vision Is Appropriate

Vision (screenshots, multimodal analysis) should be used when:
- Semantic ambiguity is high (DOM structure alone insufficient)
- Visual reasoning is required (charts, graphs, visual layouts)
- DOM is insufficient (canvas elements, complex visual UIs)
- Grounding verification needed (confirming DOM interpretation matches visual reality)
- Edge cases where structured data fails

### 5.3 When Vision Should NOT Be Used

- Continuous page interpretation (too expensive, too noisy)
- Always-on semantic understanding (unnecessary with structured DOM data)
- Primary interaction targeting (coordinate-based clicking is fragile)
- Default planner state composition (vision tokens expensive)

### 5.4 Architecture Implication

The architecture is:

> **DOM-grounded with vision-assisted escalation**

This means:
- Operational structure remains stable (DOM-based)
- Cognition remains bounded (structured data primary)
- Costs remain controlled (vision only when needed)
- Observability remains strong (structured traces)

---

## 6. Browser Substrate Integration

### 6.1 What the Substrate Provides

The substrate is the lowest layer of the runtime stack:

```
Substrate
├── CDP Connection Management
├── DOM Queries (getDocument, querySelectorAll, etc.)
├── Accessibility Tree Queries
├── Layout/Geometry Computation
├── Navigation Management
├── Frame/Tab Management
├── Event Capture and Routing
├── Interaction Dispatch (click, type, scroll)
├── Mutation Observation
├── Network State Monitoring
└── Ref Assignment (initial identity construction)
```

### 6.2 Substrate Contract

The substrate guarantees:
- **Truthful browser state** — what it reports is what the browser contains
- **Deterministic queries** — same browser state produces same query results
- **Atomic interactions** — actions are dispatched as atomic operations
- **Observable mutations** — changes in DOM/AX state are captured and reported

The substrate does NOT guarantee:
- Operational projection (that's Brain1)
- Transition meaning (that's Brain2)
- Strategic recommendations (that's the planner)

### 6.3 Browser Interaction Explicitness

> **Browser interaction should remain explicit.**

Avoid:
- Hidden automation flows inside the harness
- Autonomous retries inside the harness
- Semantic interaction abstractions at the harness level
- Invisible orchestration in the harness

These would become distributed cognition leakage — the same anti-pattern the architecture repeatedly corrected.

---

## 7. Runtime/Browser Relationship

### 7.1 The Layered Stack

```
┌─────────────────────────────────────────┐
│              PLANNER                     │  ← Semantic cognition
│  (sole reasoning authority)              │
├─────────────────────────────────────────┤
│       BRAIN1    │    BRAIN2              │  ← Structured exposure │ Continuity
├─────────────────────────────────────────┤
│           RUNTIME GRAPH                  │  ← Continuity topology
├─────────────────────────────────────────┤
│         RUNTIME SUBSTRATE                │  ← Browser truth
├─────────────────────────────────────────┤
│       BROWSER HARNESS                    │  ← Substrate adapter
├─────────────────────────────────────────┤
│      BROWSER (Chrome/Chromium)           │  ← Hostile infrastructure
└─────────────────────────────────────────┘
```

### 7.2 Information Flow

**Upward (browser → planner):**
- Browser emits raw events/state
- Harness normalizes into substrate primitives
- Substrate provides refs, DOM state, geometry
- Brain1 compresses into structured views
- Brain2 interprets transitions into evidence
- Planner receives clean semantic state

**Downward (planner → browser):**
- Planner issues semantic intent (tool call)
- Runtime translates to execution plan
- Substrate dispatches browser interaction
- Harness executes via Playwright/CDP
- Browser performs action

### 7.3 Isolation Principle

Browser complexity stays **isolated below cognition**:
- The planner never touches browser APIs
- The runtime never exposes browser protocol details upward
- The harness absorbs browser-specific complexity
- Runtime abstractions remain stable even as browsers evolve

---

## 8. Browser Ownership Philosophy

### 8.1 Current Position

The current architecture uses Chromium-based browsers via Playwright/CDP. The system does NOT currently own custom browser components.

### 8.2 Future Direction

Owning more of the browser stack (custom rendering hooks, deeper event access, custom browser layers) is directionally correct long-term but explicitly deferred:

> The current bottleneck is validating the cognition-runtime architecture itself, not browser engine ownership.

This sequencing discipline is critical — do not optimize the harness before validating the architecture.

### 8.3 Observability Over Stealth

Current priority strongly favors **maximum observability**:
- DOM snapshots, event traces, render timing
- Navigation history, interaction outcomes
- Visual verification and debugging

Over:
- Stealth, anti-detection, ultra-performance optimization

Those are later-stage production concerns, not architecture-validation-phase priorities.
