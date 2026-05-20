# BrowseGent v2 Implementation Discipline

## Purpose

This document defines how implementation work proceeds. It prevents broad rewrites, untested abstractions, and hidden coupling.

## Phase Rule

Implement one phase at a time.

The current phase must be named before code changes begin. Work outside the phase is allowed only when:

- It is required to compile the phase.
- It is required by a phase test.
- It is explicitly documented in the implementation summary.

## File Discipline

Every new file needs one clear responsibility.

Avoid:

- Catch-all utility files.
- Framework folders with no immediate runtime proof.
- Shared helpers before duplication proves a shared shape.
- Barrel exports that hide ownership.

Prefer:

- Focused services.
- Typed contracts.
- Explicit imports.
- Small pure helpers for deterministic logic.

## TDD Requirement

For every new runtime contract:

1. Add or update a test that describes the contract.
2. Run the test and confirm the expected failure when practical.
3. Implement the minimum code.
4. Run the focused test.
5. Run `npm run build`.
6. Run `npm run test:unit`.

Browser-backed features must also have integration tests or a documented environmental blocker.

## Minimal Implementation Rule

Do not implement future phase behavior early.

Examples:

- Phase 1 observation must not implement Brain1 projection.
- Phase 2 refs must not implement planner target selection.
- Phase 4 interactions must not implement strategic recovery.
- Phase 5 Brain1 must not implement transition interpretation.
- Phase 6 Brain2 must not implement task success judgment.

## Error Handling

Errors must be typed and operational.

Good:

```ts
{
  code: 'target_blocked',
  message: 'Target center point is covered by another element.',
  retryable: false
}
```

Bad:

```ts
{
  message: 'The site is not useful; try another path.'
}
```

## Configuration

All v2 runtime behavior is off by default.

Use explicit configuration:

- `BROWSEGENT_V2_RUNTIME=off`
- `BROWSEGENT_V2_RUNTIME=mvr`

No hidden auto-enable behavior is allowed.

## Review Discipline

Every implementation summary must include:

- Phase name.
- Files changed.
- Boundary check result.
- Tests run.
- Replay artifacts produced when applicable.
- v1 impact statement.
- Known limitations.

## Refactoring Rule

Refactoring is allowed when it reduces implementation risk.

Refactoring is not allowed when it:

- Changes v1 behavior without a v2 rollout need.
- Moves responsibilities across subsystem boundaries.
- Creates abstractions for unimplemented future phases.
- Makes tests broader but less precise.

## Completion Gate

Do not move to the next phase until:

- Phase tests pass.
- Build passes.
- Existing unit tests pass.
- Governance checklist passes.
- Any browser mutation has trace evidence.

If verification is incomplete, the phase remains incomplete.
