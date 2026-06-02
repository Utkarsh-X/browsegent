# BrowseGent v2 AI Engineering Rules

## Purpose

These rules govern how AI agents work in this repository. They exist because BrowseGent v2 is architecture-sensitive: a helpful-looking implementation can still damage the system if it moves cognition into the runtime, hides behavior, or optimizes for a benchmark instead of runtime truth.

## Required Start Procedure

Before modifying BrowseGent v2 code, an AI agent must:

1. Read `docs/governance/ENGINEERING_CODEX.md`.
2. Read the governance file most relevant to the work.
3. Read the relevant refined architecture document.
4. Read the relevant implementation phase contract.
5. Inspect current source files before assuming prior work exists.
6. State the phase being worked on.

## Autonomy Model

AI agents have autonomy to:

- Choose the smallest implementation that satisfies the phase contract.
- Add tests required to prove the phase.
- Refactor local code if it improves clarity and preserves boundaries.
- Stop and revise the plan if evidence contradicts the plan.

AI agents do not have autonomy to:

- Change architecture identity.
- Expand phase scope without evidence.
- Add hidden cognition.
- Add domain-specific heuristics.
- Add benchmark-specific behavior.
- Change v1 behavior outside explicit rollout boundaries.
- Skip validation because the change "looks safe".

## The Eight-Step Work Loop

Every non-trivial implementation follows:

1. Analysis: inspect files and current behavior.
2. Planning: map the change to the phase contract.
3. Boundary review: confirm subsystem ownership.
4. Test definition: write or identify exact tests first.
5. Minimal implementation: implement only what tests and phase require.
6. Verification: run build and relevant tests.
7. Replay validation: inspect trace artifacts for mutating browser behavior.
8. Architecture impact review: check governance violations.

## No Hidden Cognition Rule

AI agents must reject implementations where runtime code:

- Infers what the user wants.
- Chooses a new strategy.
- Interprets page business meaning.
- Decides that a task is complete.
- Decides that a workflow is wrong.
- Converts repeated failure into a semantic alternative.

Allowed runtime output:

```json
{
  "progress": "weak",
  "reason": "no_structural_change",
  "targetRefState": "weakened"
}
```

Forbidden runtime output:

```json
{
  "advice": "try a different search result"
}
```

## Evidence Before Claims

An AI agent must not claim:

- Build passes.
- Tests pass.
- v1 is unchanged.
- Governance is satisfied.
- A phase is complete.

until it has run or inspected direct evidence proving that claim.

## External Reference Rule

External architecture references may be used to understand problems, not to copy systems.

Allowed:

- Extracting a failure mode.
- Extracting an operational pattern.
- Comparing tradeoffs.
- Designing a BrowseGent-native implementation.

Forbidden:

- Copying architecture wholesale.
- Importing a framework shape because another project uses it.
- Adding a subsystem before BrowseGent has evidence it needs it.

## Communication Rule

AI agents should communicate:

- Current phase.
- Files being changed.
- Why the change belongs to that phase.
- What validation will prove it.
- Any blockers or uncertainty.

They should not provide broad reassurance, hype, or success claims without evidence.

## Assumption Surfacing Rule

Before implementing any change, an AI agent must:

- State its assumptions explicitly. If uncertain about scope, intent, or expected behavior, ask before proceeding.
- If multiple valid interpretations of a requirement exist, present them. Do not pick silently.
- If a simpler approach exists than the one implied, say so. Push back when warranted.
- If something is unclear, stop. Name what is confusing. Ask.

Suppressing confusion to appear capable is a governance failure.

## Verifiable Goal Rule

AI agents must transform vague task descriptions into verifiable success criteria before implementation.

Examples:

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after. Boundary ownership unchanged."

For multi-step tasks, state a brief plan with verification checkpoints:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let an agent loop independently. Weak criteria ("make it work") require constant clarification and risk architectural drift.

## Stop Conditions

Stop and reassess when:

- The implementation needs a subsystem not in the phase contract.
- A runtime component starts requiring semantic decisions.
- Tests require site-specific assumptions.
- A simple contract becomes a framework.
- A planned file grows beyond a focused responsibility.
- v1 behavior must change to continue.

Stopping is correct when it preserves architecture integrity.
