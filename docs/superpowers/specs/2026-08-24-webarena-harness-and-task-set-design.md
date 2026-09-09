# WebArena Harness & Task-Set Design (robustness + diagnosis-first)

Date: 2026-08-24
Status: implemented scaffold; manifest pinning pending official dataset download
Supersedes details of: 2026-08-23-webarena-verified-50-evaluation-design.md §3/§6

## 1. Task-set decision (answers "50, 60, or 100?")

**Pin 100 once; run nested variants.** One frozen manifest ordering per stage:

| Variant | Tasks | Purpose |
| --- | ---: | --- |
| `pilot5` | 5 | shopping-only bring-up smoke |
| `smoke20` | 20 | all six sites touched, fast iteration |
| `core50` | ~50 | **headline benchmark number** (comparable to the staged design commitment) |
| `scaffold100` | ~100 | diversity ceiling — pinned NOW so we never re-sample after seeing results |

Why not 50 flat: re-sampling tasks after observing failures is a silent overfitting
vector. Pinning 100 up front and filtering at runtime keeps every future comparison
honest while runtime cost stays controllable.

### Stratification quotas (site axis)

| Site | core50 | scaffold100 | Rationale |
| --- | ---: | ---: | --- |
| shopping | 12 | 22 | richest interaction surface (checkout/forms/search) |
| reddit | 10 | 18 | posting/voting = state mutation with clean evaluators |
| gitlab | 10 | 18 | multi-page workflows, issues/MRs |
| shopping_admin | 6 | 14 | data tables, filters |
| map | 6 | 14 | routing/direction parsing |
| wikipedia | 6 | 14 | deep navigation/extraction |

Within each stratum: distinct `intent_template_id` preferred over repeats
(template diversity), stable `task_id` ordering. Unachievable/negative-constraint
tasks are kept wherever the dataset provides them inside a stratum — they measure
honest refusal, which our evidence-gated completion must own.

Diversity guardrail (user's concern): variants are *frozen subsets*, never
re-rolls. If a signal looks site-specific, we expand that stratum in scaffold100,
not by swapping core50 membership.

## 2. Harness robustness requirements (lessons from webvoyager-lite)

1. **Config-driven profiles** — model/pacing/attempts/timeouts in one place per run
   (OpenRouter-first via the existing provider; any model string, any min-interval).
2. **Upstream resilience** — shared pacer + exponential backoff on 429/5xx surfaced
   as telemetry (`provider_pacing_wait`, retry counts), never silently absorbed.
3. **Per-task isolation** — reset between mutating tasks (`require_reset` honored;
   honest warning when unconfigured); fresh browser context per task.
4. **Evaluator join mandatory** — internal pass alone is never the reported score;
   official evaluator output is joined per task or explicitly marked unscored.
5. **Environment-block separation** — env failures excluded from denominators with
   explicit counts (same discipline as webvoyager env-adjusted scores).
6. **Provenance everywhere** — manifests record source file sha256; reports record
   model, pacing profile, adapter version.

## 3. Diagnosis-first telemetry (the benchmark's real job)

Per task, a joined diagnosis record answers: *where did it go wrong?*

- `failureClass`: perception / grounding / action / planner_strategy / recovery /
  budget / environment_block / evaluator_side / passed
- pointers into existing artifacts: planner inputs, ref states, transition evidence,
  latency phases, evidence-coverage statuses (all already captured by v2 traces)
- evaluator verdict + eval_type breakdown

Summary layer emits:
- **failure-attribution matrix** (site × failureClass)
- **winnable vs unwinnable split** (env/evaluator-side separated from agent misses)
- **efficiency view**: steps/tokens/provider-time vs success (SOTA-efficiency tracking)

Nothing here adds cognition to `src/v2/` — all attribution lives benchmark-side,
joining artifacts the loop already records.

## 4. Implementation state

- `tests/benchmark/v2/webarena/webarenaTypes.ts` — official-schema types
- `WebArenaTaskSource.ts` — placeholder resolution, pilot exclusion reasons
- `OfficialEvaluatorBridge.ts` — spawn bridge (config staged to temp file for
  Windows argv safety, hard timeout, strict score parsing)
- `runProfiles.ts` — pure profile presets (`flash-lite-fast`, `openrouter-default`)
  applied through the provider layer's existing per-request env vars; any model,
  any pacing, retries surfaced not hidden
- `diagnosis.ts` — failureClass classification, site×class attribution matrix,
  winnable/unwinnable split, efficiency medians (all pure, benchmark-side only)
- `run_webarena_pilot.ts` — runner: pinned-manifest aware, profile→env before
  client construction, fresh client per attempt, require_reset honored with an
  honest warning when unconfigured, evaluator join mandatory (unscored runs are
  listed explicitly and internal pass reported reference-only), report embeds the
  diagnosis summary
- `pin_manifest.ts` — deterministic manifest pinning with presets above + provenance
- Unit tests: `tests/unit/v2/webarenaPilot.test.ts`,
  `tests/unit/v2/webarenaDiagnosis.test.ts`

### Known limitations (accepted for pilot5)

- `finalUrl` is not captured (BrowserAgentRunResult does not expose it yet), so
  `url_match` eval types cannot be scored; shopping pilot5 tasks are answer-based
  (`string_match`). Revisit only if a chosen variant needs it.
- Tasks using `program_html` evaluation are excluded with explicit reasons rather
  than approximated.

Pending shell access: kill orphaned test runners → unit suites + tsc green →
commits → clone webarena repo (E:) → download `test.raw.json` → pin manifests →
docker compose shopping stack → single-task smoke.
