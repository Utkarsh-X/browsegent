# BrowseGent v2 Architecture Boundaries

## Purpose

This document defines subsystem ownership. Its job is to prevent responsibility drift during implementation.

## Ownership Summary

| Subsystem | Owns | Must Not Own |
|---|---|---|
| Planner | Semantic cognition, strategy, task sufficiency, next semantic step | Browser mechanics, ref resolution, action retries |
| Harness | Browser adapter, Playwright/CDP access, page lifecycle | Intent inference, workflow abstraction |
| Substrate | Browser truth, DOM/AX/layout facts, actionability facts | Projection, transition meaning, strategy |
| RefService | Identity assignment, resolution, weakening, invalidation | Semantic relevance, planner target choice |
| InputService | Mechanical click/type/scroll/select | Strategic fallback, alternate workflow |
| StabilizationService | Bounded waits, local settle checks | Semantic recovery |
| Brain1 | Operational projection of current state | Transition history, user intent, workflow meaning |
| Brain2 | Continuity interpretation and progress evidence | Strategy, goal interpretation, planner replacement |
| Graph | Shallow continuity topology | Knowledge graph, semantic memory, reasoning |
| TraceStore | Passive lineage and replay artifacts | Runtime decisions, evaluation influence |
| Evaluators | Diagnostics and reports | Runtime behavior shaping |

## Dependency Direction

Allowed dependency flow:

```text
Planner input composer
  -> Brain1 projections
  -> Brain2 summaries
  -> Graph snapshots
  -> Runtime services
  -> Substrate
  -> Harness
```

Forbidden dependency flow:

```text
Substrate -> Planner
Runtime -> LLM
Graph -> Planner strategy
Brain1 -> Brain2 ownership
Brain2 -> Brain1 projection ranking policy
TraceStore -> Runtime decisions
Evaluator -> Runtime behavior
```

## Planner Boundary

Planner owns:

- Goal interpretation.
- Strategy.
- Search/read/navigate/answer decisions.
- Sufficiency judgment.
- Escalation decisions.
- Semantic recovery.

Planner input may include:

- Operational projection.
- Transition summary.
- Execution evidence.
- Uncertainty signals.
- Recent bounded lineage.

Planner input must not include:

- Raw graph topology.
- Raw CDP details.
- Playwright handles.
- Internal selector candidate lists.
- Unbounded action history.

## Runtime Boundary

Runtime owns:

- Mechanical execution.
- Browser state capture.
- Ref resolution.
- Visibility and actionability checks.
- Bounded stabilization.
- Re-observation.
- Operational failure evidence.

Runtime must not:

- Pick a new semantic strategy.
- Decide answer sufficiency.
- Convert failure into a workflow recommendation.
- Add semantic labels beyond tightly bounded operational labels.

## Brain1 Boundary

Brain1 is an operational projection engine.

Allowed:

- Interactions view.
- Readables view.
- Region view.
- Navigation affordance view.
- Operational labels such as `form`, `modal`, `navigation`, `repeated_list`.
- Ranking by visibility, actionability, locality, structural prominence, continuity confidence.

Forbidden:

- Domain labels such as `shopping checkout`, `flight booking`, `job application`.
- User-intent inference.
- Strategy advice.
- Transition interpretation.
- Long-lived memory.

## Brain2 Boundary

Brain2 is a continuity interpreter.

Allowed:

- Transition class.
- Progress strength.
- Changed regions.
- Preserved refs.
- Weakened refs.
- Generation changes.
- Invalidation evidence.

Forbidden:

- Task success judgment.
- Strategic no-progress decisions.
- Workflow recovery.
- Domain interpretation.
- Planner replacement.

## Graph Boundary

Graph is passive runtime topology.

Allowed:

- Ref to region relationships.
- Region adjacency.
- Recent transition links.
- Generation-scoped state.
- Bounded history.

Forbidden:

- Knowledge graph behavior.
- Semantic memory.
- Reasoning queries.
- Learned identity.
- Unbounded session accumulation.

## Tool Boundary

Tools are operational primitives.

Allowed tool outputs:

- `success`
- `error`
- `targetRef`
- `value`
- `evidence`
- `traceStepId`

Forbidden tool outputs:

- Strategic recommendations.
- Domain explanations.
- User-goal conclusions.
- Hidden next actions.

## Boundary Review Checklist

Before implementing or reviewing a change:

- Which subsystem owns this behavior?
- Does any lower layer call upward into cognition?
- Does any runtime result contain strategic advice?
- Does the graph store meaning instead of topology?
- Does Brain1 rank operationally rather than semantically?
- Does Brain2 describe observable transition rather than goal progress?
- Can the behavior be replayed from trace artifacts?
