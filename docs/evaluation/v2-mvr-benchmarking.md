# BrowseGent v2 MVR Testing and Benchmarking

## Local Correctness Gate

Run:

```powershell
npm run check:v2:release
```

This proves build, unit tests, governance checks, integration tests, continuity stress, agent smoke, and trace replay behavior.

## Local Benchmark

Run:

```powershell
npm run benchmark:v2 -- gemini/gemini-3.1-flash-lite --partition all --repeat 1
```

Provider-backed runs read model and keys from local environment or `.env`. Do not put keys in commands, reports, docs, or committed files.

Use partitions to avoid overfitting:

```powershell
npm run benchmark:v2 -- gemini/gemini-3.1-flash-lite --partition dev --repeat 1
npm run benchmark:v2 -- gemini/gemini-3.1-flash-lite --partition holdout --repeat 1
```

## Output

Reports are written under:

```text
logs/v2-benchmark/<runId>/report.json
logs/v2-benchmark/<runId>/summary.md
logs/v2-benchmark/<runId>/readiness.json
logs/v2-benchmark/<runId>/readiness.md
```

Each result includes task id, adapter id, success, validation, trace audit status, failure type, planner calls, tool executions, duration, and trace path.

The readiness report checks:

- 20-30 unique local tasks.
- Both dev and holdout partitions represented.
- Pass rate at least 90%.
- Trace completeness exactly 100%.
- Every failed run has a failure classification.

## Anti-Overfitting Rule

Benchmark failures must be fixed through the generic failure-class funnel:

```text
benchmark failure
  -> inspect trace
  -> classify generic mechanism
  -> reproduce in local fixture
  -> add failing test
  -> implement bounded fix
  -> rerun local gate
  -> rerun benchmark split
```

Forbidden fixes include site-specific selectors, benchmark-keyword prompt tuning, hidden answer shortcuts, and domain-specific runtime branches.
