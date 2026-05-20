# BrowseGent v2 Engineering Codex

## Purpose

This is the primary governance document for BrowseGent v2 implementation.

Its purpose is to prevent implementation drift while the v2 architecture is converted into code. It is not motivational documentation. It is an engineering control surface.

BrowseGent v2 must remain:

- Bounded.
- Replayable.
- Observable.
- Deterministic where runtime behavior is concerned.
- Continuity-oriented.
- Planner-cognitive and runtime-non-cognitive.
- Production-realistic.

## Source Order

When guidance conflicts, use this order:

1. Current user instruction.
2. Repository governance in `docs/governance/`.
3. Refined v2 architecture in `docs/refined-architecture-v2.1/`.
4. Implementation plans in `docs/superpowers/plans/`.
5. Existing v1 implementation patterns.
6. External inspiration documents.

External systems such as browser-use, browser-harness, and agent-browser are references, not authorities.

## Non-Negotiable Architecture Law

Only the planner or LLM may perform semantic cognition.

Runtime systems may expose:

- Browser truth.
- Operational facts.
- Actionability.
- Visibility.
- Freshness.
- Continuity confidence.
- Transition evidence.
- Failure evidence.
- Replay artifacts.

Runtime systems must not infer:

- User intent.
- Workflow meaning.
- Domain meaning.
- Strategic recovery.
- Task sufficiency.
- Best next semantic step.

If a runtime component starts answering "what should the agent do next?", it is violating the architecture.

## Required Work Sequence

Every implementation slice follows this sequence:

1. Analysis.
2. Plan alignment.
3. Boundary review.
4. Test definition.
5. Minimal implementation.
6. Verification.
7. Replay validation when runtime mutation is involved.
8. Architectural impact review.

Skipping directly to implementation is a governance failure.

## Phase Completion Definition

A phase is complete only when all are true:

- The phase proves a foundational runtime assumption.
- Exact planned files exist or planned omissions are explicitly justified.
- Tests cover success and failure behavior.
- TypeScript build passes.
- Unit tests pass.
- Browser-backed tests pass when the phase touches browser runtime.
- Mutating runtime behavior is replayable.
- v1 behavior remains unchanged unless an explicit rollout flag enables v2.
- Runtime output contains no strategic advice.
- No benchmark-specific behavior was added.

## Decision Rules

When choosing between two designs:

- Prefer explicit contracts over implicit coupling.
- Prefer smaller modules over flexible frameworks.
- Prefer typed data over comments explaining shape.
- Prefer observable failure over silent fallback.
- Prefer rejecting an uncertain action over executing the wrong target.
- Prefer deterministic behavior over adaptive cleverness.
- Prefer traceable degradation over binary pass/fail.
- Prefer local repair over global orchestration.

## Forbidden Engineering Patterns

Do not add:

- Hidden planner-like code.
- Runtime strategy engines.
- Workflow classifiers.
- Domain-specific page heuristics.
- Benchmark-tuned branches.
- Autonomous recovery policies.
- Generic plugin architecture.
- Broad event buses.
- Long-lived semantic memory.
- Unbounded graph growth.
- Silent selector fallbacks.
- Raw CDP or mutating JavaScript execution without safety gates.

## Required Review Questions

Before merging or moving to the next phase, answer:

- What runtime assumption did this prove?
- Which subsystem owns the new behavior?
- What data crosses the boundary?
- What evidence proves it works?
- What evidence proves failure is handled honestly?
- What trace artifact reconstructs the behavior?
- What prevents this from becoming hidden cognition?
- What prevents v1 regression?

## Governance File Map

- `ENGINEERING_CODEX.md`: top-level laws and completion definition.
- `AI_ENGINEERING_RULES.md`: rules for AI agents and autonomous implementation.
- `ARCHITECTURE_BOUNDARIES.md`: subsystem ownership and dependency direction.
- `IMPLEMENTATION_DISCIPLINE.md`: phase workflow and code discipline.
- `RUNTIME_SAFETY_RULES.md`: safety rules for browser mutation, CDP, JS, retries, and secrets.
- `TESTING_AND_REPLAY_RULES.md`: required tests, replay artifacts, and validation gates.
- `CONTINUITY_AND_RUNTIME_LAWS.md`: refs, generations, transitions, Brain1, Brain2, graph, and progress evidence.
- `CI_AND_ENFORCEMENT.md`: how governance becomes mechanically enforceable.

## Implementation Entry Gate

Before editing v2 implementation code, an agent must read:

- `docs/governance/ENGINEERING_CODEX.md`
- `docs/governance/ARCHITECTURE_BOUNDARIES.md`
- `docs/governance/IMPLEMENTATION_DISCIPLINE.md`
- The relevant phase section in `docs/superpowers/plans/2026-05-19-browsegent-v2-phase-contracts.md`

For runtime mutation, also read:

- `docs/governance/RUNTIME_SAFETY_RULES.md`
- `docs/governance/TESTING_AND_REPLAY_RULES.md`
- `docs/governance/CONTINUITY_AND_RUNTIME_LAWS.md`

## Final Rule

Architecture corruption is more dangerous than slow progress.

If a change is useful but violates subsystem ownership, replayability, runtime boundedness, or centralized cognition, do not merge it.
