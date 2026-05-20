# BrowseGent v2 Continuity and Runtime Laws

## Purpose

This document defines the laws for refs, generations, transitions, Brain1, Brain2, graph, and progress evidence.

## Law 1: Preserve Unless Invalidated

Browser state usually degrades partially, not totally.

The runtime should preserve refs, regions, and graph relationships unless evidence requires weakening or invalidation.

## Law 2: Weaken Before Destroying

When continuity confidence drops, downgrade trust before deleting identity.

Allowed states:

- `live`
- `weakened`
- `stale`
- `invalid`

Execution requires sufficient confidence. Low confidence should produce evidence, not silent fallback.

## Law 3: Generations Are Sparse

A generation represents a stable execution reality.

Generation should change for:

- Full navigation.
- Page reload.
- Frame replacement.
- Major route transition.
- Major content replacement.

Generation should not change for:

- Scroll.
- Hover.
- Focus.
- Minor animation.
- Small geometry movement.
- Loading tick.

## Law 4: Transitions Are Mechanical

Transition classes:

- `microstate`
- `structural_local`
- `structural_macrostate`
- `hard_reset`

Transition classification describes browser structure, not user-goal progress.

## Law 5: Progress Evidence Is Not Task Success

Progress strength:

- `none`
- `weak`
- `moderate`
- `strong`
- `negative`

This describes observable browser change. It does not mean the task is solved.

## Law 6: Brain1 Projects Current Operational State

Brain1 answers:

"What operational structure currently exists?"

Brain1 may expose:

- Interactions.
- Readables.
- Regions.
- Navigation affordances.
- Warnings.
- Focus.

Brain1 must not expose:

- Workflow meaning.
- User intent.
- Business domain interpretation.
- Strategic advice.

## Law 7: Brain2 Interprets Continuity

Brain2 answers:

"What changed meaningfully between observations?"

Brain2 may expose:

- Transition class.
- Progress strength.
- Changed regions.
- Ref preservation.
- Ref weakening.
- Generation change.
- Invalidation evidence.

Brain2 must not expose:

- Task success.
- Strategy quality.
- Recommendation to replan.
- Domain interpretation.

## Law 8: Graph Is Runtime Topology

The graph stores shallow runtime relationships:

- Ref belongs to region.
- Region contains refs.
- Region changed during transition.
- Ref preserved across generation.

The graph must not become:

- Knowledge graph.
- Semantic memory.
- Ontology.
- Workflow model.
- Planner-side reasoning surface.

## Law 9: Dead-State Is Evidence

Dead-state means operational continuity cannot be confidently maintained locally.

It does not mean the task is impossible.

Good dead-state evidence:

- No actionable refs.
- Repeated stale refs.
- Projection empty.
- Stabilization exhausted.
- Environment block detected.

Forbidden dead-state conclusion:

- "The user goal cannot be completed."

## Law 10: Trace Is the Judge

If a runtime behavior cannot be reconstructed from trace artifacts, it is not production-ready.

For every runtime mutation, trace must show:

- Before state.
- Target ref.
- Preconditions.
- Action result.
- After state.
- Transition evidence.
- Ref lifecycle effect.

## Continuity Review Checklist

Before accepting continuity code:

- Are generations sparse?
- Are refs weakened before invalidation?
- Are low-confidence refs rejected before wrong execution?
- Is progress evidence purely observational?
- Does Brain1 remain snapshot-oriented?
- Does Brain2 remain transition-oriented?
- Is graph bounded and shallow?
- Are all mutating transitions traceable?
