# 04 — Context, Memory, and Recovery Architecture

## 1. Planner Memory Model

### 1.1 Memory Philosophy

Memory exists to support **active reasoning**, not to preserve giant histories.

The system targets:

> **Active Semantic Working Context + Sparse Continuity Memory + Externalized Runtime Stability**

This means:
- Cognition stays focused
- Runtime stays grounded
- Memory stays bounded
- Context stays clean

### 1.2 Episodic Cognition Model

The planner thinks in **semantic episodes**, NOT continuous streams:

> **Each planner invocation is a focused cognitive episode over stabilized operational reality.**

Episodes are bounded reasoning bursts triggered by meaningful operational transitions — NOT by continuous DOM monitoring or real-time browser tracking. Between episodes, the runtime maintains operational continuity without planner involvement.

This is analogous to how coding agents think in edit→observe cycles, not continuous code monitoring.

### 1.3 Runtime Externalization Principle

> **Runtime externalizes operational continuity so the planner doesn’t carry browser history.**

The planner’s context does NOT contain:
- Browser topology evolution
- Ref lifecycle history
- Graph continuity records
- Stabilization attempt history

Instead, Brain1 and Brain2 provide **current-state projections** that already incorporate continuity context. The planner reasons over the result, not the process.

### 1.4 Memory Architecture

| Layer | Purpose | Owned By |
|---|---|---|
| Active working context | Current semantic reality for immediate reasoning | Planner |
| Compressed semantic trajectory | Recent meaningful actions and outcomes | Planner |
| Task continuity state | Goal, strategy, direction | Planner |
| Runtime continuity state | Refs, regions, transitions, freshness | Runtime (Brain2 + Graph) |
| Sparse semantic memory | Key observations worth preserving across context windows | Planner |

### 1.5 What Memory Is NOT

Memory should NOT become:
- Full lifelong browser memory
- Giant accumulated reasoning transcripts
- Persistent semantic evolution graphs
- Recursive abstraction layers (summarize summaries)
- Adaptive learning systems

### 1.6 Memory Boundaries

**Planner memory** stores:
- Task-level goals and strategy
- Compressed meaningful observations
- Semantic continuity summaries
- Uncertainty signals

**Runtime memory** (via Brain2 + Graph) stores:
- Ref validity and continuity linkage
- Region structure and relationships
- Transition history (recent, bounded)
- Invalidation state

These are **strictly separate**. Runtime graph topology never enters planner memory. Planner strategic state never enters runtime.

### 1.7 Memory Compaction

Context compaction must be:
- **Planner-mediated** — the planner (or planner-adjacent infrastructure) decides what to compress
- **Aggressive on stale content** — old observations decay quickly
- **Conservative on semantic continuity** — meaningful task progress summaries preserved
- **Bounded** — no infinite accumulation

### 1.8 Anti-Pattern: Infinite Summarization Recursion

**Explicitly rejected.** Summarizing summaries and compressing compressed context inevitably degrades meaning catastrophically. Memory should use **sparse retention** rather than recursive compression.

### 1.9 Context Compaction Triggers

Compaction occurs **between semantic phases**, NOT continuously:

| Trigger | Action |
|---|---|
| Semantic phase transition | Compress completed phase into trajectory summary |
| Token budget threshold | Drop lowest-priority historical context |
| Macrostate change | Invalidate stale pre-transition observations |
| Planner-requested compaction | Explicit context trimming after complex reasoning |

NOT: continuous background compression, proactive summarization, or runtime-triggered compaction.

Compaction is **planner-adjacent infrastructure**, not autonomous runtime behavior.

---

## 2. Context Lifecycle

### 2.1 The Core Problem

Without disciplined context lifecycle, the system WILL degrade over time. Context slowly accumulates:
- Runtime mechanics debris
- Historical retries and warnings
- Stale observations
- Duplicated information

Then the planner spends more cognition on **maintaining context coherence** than on **solving the task**. This is catastrophic.

### 2.2 Context Lifecycle Principles

| Principle | Description |
|---|---|
| Fresh > historical | Current state always more valuable than accumulated history |
| Semantic > mechanical | Only semantically meaningful information persists |
| Decay by default | Context entries have natural expiration |
| Promotion by evidence | Only observations producing meaningful progress get promoted to memory |
| Bounded accumulation | Hard limits on context size |

### 2.3 Context Compartments

| Compartment | Content | Freshness |
|---|---|---|
| **Active state** | Current Brain1 projections, Brain2 summary, task status | Always current |
| **Recent trajectory** | Last N meaningful semantic steps and outcomes | Rolling window |
| **Task continuity** | Goal, strategy, key decisions made | Persistent within task |
| **Uncertainty signals** | Low confidence areas, repeated failures, ambiguous observations | Transient |

### 2.4 Stale Decay

- Observations older than N semantic steps lose priority
- Failed action evidence decays faster than successful action evidence
- Runtime mechanics (retries, stabilization details) never enter long-lived context
- Microstate observations (geometry, visibility) are ephemeral by default

### 2.5 Context as Reasoning Fuel

The system is becoming:

> **A continuously reasoning semantic agent grounded in fresh operational reality rather than historical cognitive accumulation.**

The system stays adaptive, grounded, explainable, and cognitively coherent instead of becoming a giant accumulated reasoning transcript.

---

## 3. Recovery Semantics

### 3.1 The Core Principle

> **Failure handling must remain cognitively centralized.**

The runtime may detect failure. The planner owns the response.

### 3.2 Mechanical vs. Semantic Failure

| Type | Owner | Examples |
|---|---|---|
| **Mechanical failure** | Runtime | Click intercepted, stale ref, geometry invalid, element hidden, timeout, navigation interrupted |
| **Semantic failure** | Planner | Wrong search direction, no meaningful progress, irrelevant results, contradictory information, failed strategy |

This separation is critical. Mechanical failures are execution mechanics. Semantic failures require strategic reasoning.

### 3.3 The Degradation Principle

> **Failure is degradation-oriented, NOT binary.**

The system does NOT operate in pass/fail mode. Instead, it operates on a **continuum of operational confidence**:

```
high confidence → moderate confidence → low confidence → uncertain → dead-state
```

Each step down this ladder reduces operational trust but does NOT immediately trigger failure response. The planner is progressively informed of degrading conditions.

### 3.4 Failure Classification Taxonomy

| Failure Class | Description | Owner | Response |
|---|---|---|---|
| Transient mechanical | Fleeting execution race, timing issue | Runtime | Bounded retry (automatic) |
| Persistent mechanical | Repeated execution failure, element permanently blocked | Runtime → Planner | Report to planner as evidence |
| Continuity degradation | Refs weakened, regions unstable, projections unreliable | Brain2 → Planner | Downgrade confidence, expose uncertainty |
| Projection failure | Brain1 cannot produce coherent operational surface | Brain1 → Planner | Request re-observation or vision escalation |
| Strategic failure | Wrong approach, dead-end workflow, no progress | Planner | Replan semantically |
| Dead-state | No meaningful operational path available | Runtime → Planner | Expose as dead-state evidence |

### 3.5 Mechanical Stability Ladder

Runtime failure handling follows a **bounded escalation ladder** — from least to most disruptive:

```
1. Local Repair          → Retry action with stabilization (wait, refocus)
2. Localized Refresh     → Refresh affected ref/region identity
3. Projection Rebuild    → Brain1 regenerates affected projection views
4. Continuity Downgrade  → Weaken trust on affected refs/regions
5. Uncertainty Escalation → Expose elevated uncertainty to planner
6. Dead-State Exposure   → Report dead-state evidence to planner
```

The ladder is **mechanical and bounded** — the runtime never skips to strategic recovery or autonomous replanning. Each step is explainable and traceable.

### 3.6 Replanning Semantics

Replanning should emerge from **semantic interpretation**, NOT hardcoded orchestration policies:

BAD: `if retries > 3 then change strategy` (embeds cognition in runtime)

Instead:
- Runtime exposes: repeated weak progress, repeated invalidation, repeated interaction instability
- Planner decides: whether strategy should change

> **Replanning should remain natural cognition, not a special orchestration subsystem.**

The planner naturally reassesses, retries, explores, and adapts — just as coding agents do. No need for giant replanning infrastructures.

### 3.7 Failure Signal Design

Failure signals must be **observational**, not strategic:

GOOD:
```json
{
  "interaction_success": false,
  "reason": "visibility_blocked",
  "continuity_confidence": "moderate"
}
```

BAD:
```
"Current strategy ineffective. Consider alternate workflow."
```

The second example is hidden cognition leakage.

---

## 4. Uncertainty Handling

### 4.1 Explicit Uncertainty Exposure

The runtime should expose uncertainty explicitly — not hide instability:

- Low continuity confidence
- Unstable region identity
- Repeated invalidation
- Ambiguous observations
- Weak progress

These are operationally valuable signals for the planner.

### 4.2 The Principle

> **The planner should reason over evidence, not control flow.**

Runtime provides uncertainty, failures, instability signals, and transition outcomes. Planner interprets what they mean, whether they matter, and what to do next.

### 4.3 No Strategic Conclusions from Runtime

GOOD: "results continuity weakened"
BAD: "planner should re-search"

This distinction must remain sacred.

---

## 5. Infinite Loop Prevention

### 5.1 The Problem

Infinite loops are one of the hardest practical browser-agent problems. The system must prevent them without the runtime becoming a strategic controller.

### 5.2 The Approach

Loop prevention works through:
- Planner-visible continuity summaries showing repeated patterns
- Repeated weak-progress exposure from Brain2
- Repeated transition similarity signals
- Planner-level recognition of stuck states

NOT through:
- Runtime forcibly redirecting strategy
- Hardcoded retry limits that trigger strategic changes
- Hidden orchestration overrides

### 5.3 Evidence for Loop Detection

Runtime may expose:
```
Repeated similar interaction attempts observed.
Minimal macrostate change detected.
```

Planner decides:
```
"I am likely stuck. Need alternate approach."
```

This is the correct architecture — evidence-based, not control-flow-based.

---

## 6. Dead-State Handling

### 6.1 Definition

A dead state occurs when:
- No meaningful progress is possible through any available action
- All interaction paths have been exhausted or are producing no change
- Browser state is fundamentally blocked (error pages, captchas, authentication walls)

### 6.2 Handling Philosophy

Dead states are **planner-recognized, planner-resolved**:
- Runtime provides evidence of exhaustion (weak/no progress, repeated failures, no available actions)
- Planner makes the strategic decision to escalate, abort, or try fundamentally different approach
- Runtime never autonomously decides "this task is impossible"

### 6.3 Dead-State as Mechanical Evidence

> **Dead-state = "operational continuity can no longer be confidently maintained locally."**

Dead-state is NOT a semantic judgment that "the task has failed." It is a **mechanical evidence signal** that the runtime has exhausted its bounded local recovery capabilities and operational coherence is degrading below useful thresholds.

Dead-state detection must remain **mechanically evidence-based**, not semantically inferred:

**Good dead-state evidence:**
- All interaction refs exhausted or stale
- Repeated stabilization failures beyond threshold
- Brain1 cannot produce meaningful projections
- Brain2 detects contradictory transition loop

**Bad dead-state detection (forbidden):**
- "This page doesn’t seem useful for the user’s goal"
- "The workflow appears to be wrong"

Those are semantic judgments — planner territory only.

---

## 7. Retry Boundaries

### 7.1 Mechanical Retry Boundaries (Runtime)

| Parameter | Constraint |
|---|---|
| Attempt limit | Bounded (small, fixed) |
| Retry scope | Local to single action execution |
| Retry type | Identical action with stabilization (wait, refresh, refocus) |
| Escalation | Report failure evidence to planner |

### 7.2 Strategic Retry Boundaries (Planner)

| Parameter | Approach |
|---|---|
| Detection | Through evidence: weak progress, repeated failures |
| Decision | Planner reasoning (natural cognition) |
| Scope | Semantic level — different approach, different query, different path |
| Limit | Task-level budget (token, time, attempt) |

### 7.3 The Boundary

Runtime retries are mechanical stabilization. They never change strategy.
Planner retries are semantic adaptation. They require cognitive interpretation.

---

## 8. Evidence-Centric Cognition

### 8.1 The Architecture Pattern

The full system converges toward:

```
Centralized semantic cognition
+
Mechanically stabilizing runtime
+
Evidence-driven adaptation
```

This means:
- Cognition remains coherent (one planner, one stream)
- Runtime remains bounded (deterministic, mechanical)
- Adaptation remains explainable (evidence → reasoning → decision)
- Orchestration remains simple (no hidden coordinators)

### 8.2 Why This Works

| Property | Benefit |
|---|---|
| Evidence-based | Decisions traceable to observations |
| Centralized | Single source of strategic reasoning |
| Bounded runtime | Predictable mechanical behavior |
| No hidden cognition | Full observability and replayability |
| Natural adaptation | LLM reasoning handles novelty without special systems |
