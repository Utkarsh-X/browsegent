# Track A Paced Local Benchmark

Date: 2026-05-25

Purpose: compare BrowseGent v2 and Browser Use local on the 24 deterministic local MVR tasks under an explicit Gemini request pacing mode. This run uses `--request-rpm 12`, which records a `5000ms` minimum request interval in each report. Key values are never written to reports.

## Commands

```powershell
npm.cmd run benchmark:v2 -- gemini/gemini-3.1-flash-lite --adapter browsegent --partition all --repeat 1 --key-index 1 --request-rpm 12
```

```powershell
$env:BROWSEGENT_BROWSER_USE_PYTHON='D:\agent-tools\browser-use-local\.venv\Scripts\python.exe'
npm.cmd run benchmark:v2 -- gemini/gemini-3.1-flash-lite --adapter browser-use-local --partition all --repeat 1 --key-index 2 --request-rpm 12
```

```powershell
npm.cmd run benchmark:v2:compare -- --out logs/v2-benchmark/track-a-paced-comparison.json logs/v2-benchmark/benchmark_1779712219462/report.json logs/v2-benchmark/benchmark_1779713172240/report.json
```

## Results

| Adapter | Run | Pass Rate | Trace/Artifact | Avg Duration | Failure Types |
| --- | --- | ---: | ---: | ---: | --- |
| BrowseGent | `benchmark_1779712219462` | 24/24, 100.0% | 100.0% | 12994ms | none |
| Browser Use local | `benchmark_1779713172240` | 23/24, 95.8% | 100.0% | 54033ms | `runtime_crash:1` |

Browser Use local failed on `list_gamma_item` with a browser session startup timeout. BrowseGent's earlier unpaced run had 10 rate-limit failures, so the paced run is the valid accuracy comparison for current free-tier constraints.

## Artifacts

```text
logs/v2-benchmark/benchmark_1779712219462/report.json
logs/v2-benchmark/benchmark_1779713172240/report.json
logs/v2-benchmark/track-a-paced-comparison.json
logs/v2-benchmark/track-a-paced-comparison.md
```
