# Custom Benchmark Runner

This runner is for broader capability stress-testing without hardcoded site logic.

It supports:

- `BU Bench V1` subset sampling (from encrypted `BU_Bench_V1.enc`)
- custom JSON task files
- transient environment retries with configurable backoff

It reports **completion metrics** (not strict factual correctness unless your custom file provides strict validation patterns).

## Commands

List sampled BU tasks (no browser run):

```powershell
npm run eval:custom -- --source bu-bench --count 20 --seed 13 --list
```

Run a sampled BU subset:

```powershell
npm run eval:custom -- gemini/gemini-3.1-flash-lite --source bu-bench --count 10 --seed 13
```

Run one specific BU task from full set:

```powershell
npm run eval:custom -- gemini/gemini-3.1-flash-lite --source bu-bench --count 100 --task bu_<task_id>
```

Use stronger retry/backoff for provider/network instability:

```powershell
npm run eval:custom -- --source bu-bench --count 10 --env-retries 2 --env-retry-delay-ms 20000
```

Run with custom JSON tasks:

```powershell
npm run eval:custom -- --source file --file tests/eval/custom_tasks.json --count 20
```

## Optional quick-run toggle

To skip warmup for faster iteration:

```powershell
$env:EVAL_WARMUP='false'; npm run eval:custom -- --source bu-bench --count 5
```

## Report output

Reports are written to:

```text
logs/custom_eval_runs/<run_id>/report.json
```

