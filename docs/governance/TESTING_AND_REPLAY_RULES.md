# BrowseGent v2 Testing and Replay Rules

## Purpose

Tests prove runtime truth. Replay proves explainability. Both are required because browser-agent failures are often silent, partial, or misleading.

## Test Pyramid

Use this order:

1. Pure unit tests for contracts and deterministic helpers.
2. Service tests for runtime components.
3. Browser fixture integration tests.
4. Continuity stress tests.
5. Real-site diagnostic evals.

Real-site evals cannot replace unit or fixture tests.

## Required Commands

Run after implementation phases:

```powershell
npm run build
npm run test:unit
```

Run for browser-backed v2 phases:

```powershell
npx tsx --test tests/integration/v2/**/*.test.ts
```

Run for continuity diagnostics:

```powershell
npx tsx tests/eval/v2/run_continuity_stress.ts
```

## Fixture Requirements

Fixture pages must cover browser hostility:

- Static controls.
- Repeated controls.
- DOM replacement.
- Local rerender.
- Modal transition.
- Blocked overlay.
- SPA route transition.
- Delayed load.
- Layout shift.
- Virtualized list.
- No-action state.
- Captcha-like block.

Fixtures should be local, deterministic, and small.

## Replay Requirements

Every mutating v2 action must support replay through trace artifacts.

Required trace lineage:

- Run id.
- Runtime mode.
- Initial observation.
- Action start.
- Target ref.
- Preconditions.
- Execution result.
- Post-action observation.
- Transition evidence.
- Warnings and errors.

Required artifact paths:

```text
logs/v2-runs/<runId>/trace.json
logs/v2-runs/<runId>/observations/<observationId>.json
logs/v2-runs/<runId>/transitions/<transitionId>.json
logs/v2-runs/<runId>/projections/<projectionId>.json
logs/v2-runs/<runId>/graph/<graphSnapshotId>.json
logs/v2-runs/<runId>/planner/<episodeId>-input.json
logs/v2-runs/<runId>/planner/<episodeId>-output.json
```

Not every phase creates every artifact. Each phase contract defines which artifacts are required.

## Test Quality Rules

Tests must assert specific behavior.

Weak:

```ts
assert.ok(result);
```

Strong:

```ts
assert.equal(result.error?.code, 'target_blocked');
assert.equal(result.success, false);
```

Tests must cover:

- Normal path.
- Failure path.
- Boundary ownership.
- Serialization.
- v1 non-regression when applicable.

## Replay Validation

For a browser-mutating phase, completion requires answering:

- Can the trace show what ref was targeted?
- Can the trace show why execution was allowed or rejected?
- Can the trace show what changed after execution?
- Can the trace show whether refs were preserved, weakened, or invalidated?
- Can a reviewer understand the failure without rerunning the browser?

If not, replayability is insufficient.

## Benchmark Discipline

Benchmarks are diagnostic.

Do not:

- Hard-code benchmark sites.
- Tune runtime behavior to fixed benchmark questions.
- Treat pass rate as proof of architecture correctness.
- Use real-site eval success to skip contract tests.

Do:

- Use benchmarks to find failure classes.
- Reproduce failure classes in fixtures.
- Add tests for the generic runtime issue.
- Keep scenario classes rotating.

## Failure Classification in Tests

Failed tests should identify the subsystem:

- `contract_error`
- `observation_error`
- `ref_lifecycle_error`
- `interaction_error`
- `transition_error`
- `projection_error`
- `continuity_error`
- `planner_io_error`
- `v1_regression`

This is diagnostic metadata, not runtime cognition.
