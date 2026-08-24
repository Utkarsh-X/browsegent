# WebArena benchmark pipeline (benchmark-side)

Drives the [official WebArena benchmark](https://github.com/web-arena-x/webarena) through
the v2 agent loop, scores every episode with the **official upstream evaluator**, and
produces a diagnosis report that attributes failures rather than hiding them.

Nothing here modifies `src/v2` — the entire pipeline lives benchmark-side.

## Pipeline

```
test.raw.json ──pin_manifest.ts──▶ manifests/*.json (sha256-pinned, never hand-edited)
                                        │
                                        ▼
                          run_webarena_pilot.ts  ── per task:
                            ├─ v2 agent loop (per-task browser isolation,
                            │   optional storage-state auth, run profiles for
                            │   model/pacing/attempts/max-steps)
                            ├─ traceFinalUrl.ts (final page URL from v2 observations)
                            ├─ artifact JSON {taskId, answer, finalUrl?, ...}
                            └─ OfficialEvaluatorBridge → webarena_official_eval.py
                                └─ imports OFFICIAL evaluation_harness.evaluator_router
                                   from the cloned repo; prints one result line
                            ▼
                        report.json (+ diagnosis: failureClass attribution matrix,
                                     winnable-vs-unwinnable split, efficiency view)
```

## Components

| File | Role |
|---|---|
| `webarenaTypes.ts` | True upstream nested config schema (`intent_template`, `eval.reference_answers`, `eval.program_html[{url,locator,required_contents}]`), site placeholder→env-var maps. |
| `pin_manifest.ts` | Pins pilot5/smoke20/core50/scaffold100 presets from `source/test.raw.json` with sha256 provenance. Regenerate; never hand-edit. |
| `WebArenaTaskSource.ts` | Pilot selection predicate + placeholder URL resolution (`__SHOPPING__` → `WEBARENA_SHOPPING`). |
| `run_webarena_pilot.ts` | Runner: manifest → per-task isolated runs → artifacts → official join → `report.json`. |
| `runProfiles.ts` | Named run profiles (model, pacing/min-interval, attempts, max steps); applied via env before any client exists. |
| `OfficialEvaluatorBridge.ts` | Spawns the Python bridge per episode, stages config to disk (Windows argv safety), strictly parses the single `WEBARENA_EVAL_RESULT:` line. |
| `webarena_official_eval.py` | Imports the OFFICIAL evaluator from the cloned repo. Reconstructs the trajectory tail (beartype-valid `Action`) and a `PseudoPage` over a fresh live page positioned at the episode's final URL — WebArena state is server-side, so url_match/program_html checks see what upstream saw. |
| `traceFinalUrl.ts` | Pure extraction of the last-observed URL from `<outDir>/traces/<runId>/observations/*.json`. |
| `bootstrapAuth.ts` | One-time login for `require_login` tasks using the official public benchmark accounts (upstream `browser_env/env_config.py`); saves Playwright storage state under `auth/` (gitignored). |

## Environment contract

| Variable | Meaning |
|---|---|
| `WEBARENA_SHOPPING`, `WEBARENA_SHOPPING_ADMIN`, ... | Resolved site base URLs substituted into task `start_url`s and mapped onto the official env names the evaluator asserts at import. |
| `WEBARENA_EVAL_PYTHON` | Python executable for the evaluator bridge (use the repo's `.venv`; official deps rarely match system python). |
| `BROWSEGENT_STORAGE_STATE` | Opt-in Playwright storage state enabling authenticated sessions (set by `--storage-state`). Unset ⇒ byte-for-byte default behavior. |

## Semantics worth knowing (verified against upstream source)

- **No standalone `evaluate.py` exists upstream.** Scoring flows through
  `evaluation_harness.evaluator_router(config_file)`; this bridge imports exactly that.
- **Trace flush timing.** The v2 loop flushes traces only when an episode *completes*
  (`complete()` → `flushTrace()`). A run that throws before its first observation —
  e.g. browser open failing against a down stack — writes no trace files at all.
  Consequently such tasks have no recoverable final URL and no scorable episode; the
  runner records them with `evaluationSkipped: "no_scorable_episode"` instead of
  attempting a meaningless join. This is deliberate: a 0 would conflate "agent failed"
  with "environment was down", and environment blockers must stay visible as telemetry.
- **fuzzy_match tasks need an LLM judge.** Upstream `llm_fuzzy_match` calls OpenAI
  (`gpt-4-1106-preview`) and raises without `OPENAI_API_KEY`. Such tasks surface as
  unscored with an evaluator error (diagnosis class `evaluator_side`, winnable:false) —
  documented behavior, not a bug.
- **`require_reset`.** When the official config sets it, provide `--reset-command`
  (executed via WSL bash, `{site}` substituted) or state leaks between tasks; the
  runner warns loudly when it is missing.

## Bringing up the shopping stack locally

The official images are ~60 GB tars (shopping ≈ 62.9 GB). `tmp_shopping_bringup.ts`
(git-excluded, resumable/idempotent) automates: Docker Desktop start → tar download
(CMU mirror, Range-resume) → `docker load` → container on :7770 → magento base-url
config. Requires ≥110 GB free headroom on the target drive.

```powershell
npx tsx tests/benchmark/v2/webarena/tmp_shopping_bringup.ts   # resumable
# then the end-to-end smoke:
powershell -File <job-tmp>\run_pilot5_smoke.ps1
```

## Running a pilot

```powershell
$env:WEBARENA_SHOPPING = 'http://localhost:7770'
$env:WEBARENA_EVAL_PYTHON = 'E:\webarena\.venv\Scripts\python.exe'
npx tsx tests/benchmark/v2/webarena/run_webarena_pilot.ts `
  --tasks tests/benchmark/v2/webarena/manifests/webarena_pilot5.json `
  --evaluator-repo E:\webarena `
  --profile flash-lite-fast `
  --storage-state tests/benchmark/v2/webarena/auth/shopping_state.json `
  --out-dir logs/webarena-pilot/<name>
```

The headline never reports internal passes as results: scored runs are counted only
through the official join; everything else lands in `diagnosis.unscored`.
