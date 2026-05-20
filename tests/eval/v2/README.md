# BrowseGent v2 Continuity Stress

This diagnostic runner exercises local continuity stress fixtures with the public v2 harness.

Run manually:

```powershell
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_continuity_stress.ts
```

Outputs:

- `logs/v2-stress/<runId>/report.json`
- `logs/v2-stress/<runId>/scenario-results.json`
- Per-scenario v2 traces under `logs/v2-runs/<runId>_<scenarioId>/trace.json`

The runner is diagnostic only. It reports ref survival, wrong-ref count, transition class distribution, trace completeness, and projection size. It does not tune runtime thresholds.
