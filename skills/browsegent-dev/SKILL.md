---
name: browsegent-dev
description: Use this skill when working on BrowseGent v2 architecture, governance, runtime implementation, execution, DOM understanding, evaluation, or implementation planning. It enforces governance-first development, centralized planner cognition, non-cognitive runtime boundaries, ref-first runtime continuity, and validation-first iteration for this repository.
---

# BrowseGent Dev

## Overview

Use this skill for BrowseGent-specific engineering work: v2 governance, architecture decisions, implementation sequencing, runtime continuity, ref lifecycle, Brain1/Brain2 boundaries, evaluation, and controlled stabilization.

BrowseGent v2 is a bounded continuity-aware browser cognition runtime. The planner/LLM is the only semantic cognition layer. Runtime systems are mechanical, operational, observable, replayable, and non-cognitive.

## Use This Skill When

- Creating or reviewing BrowseGent governance docs
- Implementing BrowseGent v2 phases
- Updating implementation plans or phase contracts
- Refactoring runtime, execution, DOM understanding, Brain1, Brain2, graph, or planner I/O
- Reviewing eval failures and mapping them to generic runtime failure classes
- Using browser-use, browser-harness, or agent-browser as inspiration without copying architecture

## Required Load Order

Before editing v2 implementation code, read:

1. `/d:/BrowseGent/docs/governance/ENGINEERING_CODEX.md`
2. `/d:/BrowseGent/docs/governance/ARCHITECTURE_BOUNDARIES.md`
3. `/d:/BrowseGent/docs/governance/IMPLEMENTATION_DISCIPLINE.md`
4. The relevant section of `/d:/BrowseGent/docs/superpowers/plans/2026-05-19-browsegent-v2-phase-contracts.md`

For runtime mutation, also read:

1. `/d:/BrowseGent/docs/governance/RUNTIME_SAFETY_RULES.md`
2. `/d:/BrowseGent/docs/governance/TESTING_AND_REPLAY_RULES.md`
3. `/d:/BrowseGent/docs/governance/CONTINUITY_AND_RUNTIME_LAWS.md`

## Default Workflow

1. Identify the current implementation phase.
2. Inspect current source files before relying on prior conversation context.
3. Review subsystem ownership before designing code.
4. Define or update tests first.
5. Implement the smallest phase-aligned change.
6. Verify with build, tests, and replay artifacts when runtime mutation exists.
7. Review for cognition leakage, overengineering, and v1 regression.

## Repo Rules

- Governance docs in `/d:/BrowseGent/docs/governance/` are mandatory implementation constraints.
- Prefer BrowseGent-native abstractions over external systems.
- Do not reopen stable layers unless current evidence requires it.
- Treat benchmarks as diagnostics, not architecture drivers.
- Keep changes local to the current phase.
- Avoid speculative systems like memory, event buses, plugin layers, or orchestration managers unless a phase contract explicitly reaches them.
- Do not modify v1 behavior unless a v2 rollout boundary explicitly allows it.

## Current v2 Baseline

- Refined v2 architecture lives in `/d:/BrowseGent/docs/refined-architecture-v2.1/`.
- Implementation plans live in `/d:/BrowseGent/docs/superpowers/plans/`.
- Governance lives in `/d:/BrowseGent/docs/governance/`.
- The first implementation milestone is MVR runtime continuity: browser session, observe, refs, trace, interaction, reobserve, transition verification.

## External Reference Rule

Treat browser-use, browser-harness, and agent-browser as operational references only. Extract failure modes and proven mechanical patterns. Do not copy their architecture or add their subsystems unless BrowseGent's phase contract requires the capability.

## Validation Sequence

Run these after meaningful changes:

```powershell
npm run build
npm run test:unit
```

For v2 browser-backed runtime changes:

```powershell
npx tsx --test tests/integration/v2/**/*.test.ts
```

## Stop Conditions

Stop and reassess if a runtime component starts making semantic recommendations, a helper becomes a framework, a selector becomes the v2 planner-facing target, v1 must change unexpectedly, or a test depends on a specific benchmark/site trick.
