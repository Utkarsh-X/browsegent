# BrowseGent v2 Release Hardening Audit

## Scope

This audit records the current evidence after executing the Phase 16-20 release-hardening plan.

It does not claim every future BrowseGent v2 production-hardening item is complete. It records the current MVR and release-hardening evidence, plus any remaining out-of-scope production follow-up.

## Source Requirements Checked

- `docs/GOVERNANCE + ENGINEERING CONSTITUTION phase.md`
- `docs/governance/ENGINEERING_CODEX.md`
- `docs/governance/AI_ENGINEERING_RULES.md`
- `docs/governance/ARCHITECTURE_BOUNDARIES.md`
- `docs/governance/IMPLEMENTATION_DISCIPLINE.md`
- `docs/governance/RUNTIME_SAFETY_RULES.md`
- `docs/governance/TESTING_AND_REPLAY_RULES.md`
- `docs/governance/CONTINUITY_AND_RUNTIME_LAWS.md`
- `docs/governance/CI_AND_ENFORCEMENT.md`
- `docs/superpowers/plans/2026-05-20-browsegent-v2-release-hardening-plan.md`

## Evidence Commands

Fresh verification on 2026-05-20:

```powershell
cmd /c npm run check:v2:release
```

Observed result:

- Build passed.
- Unit tests passed: 191 pass, 0 fail.
- v2 governance checks passed.
- v2 integration tests passed: 17 pass, 0 fail.
- Continuity stress eval passed: 4 scenarios, 4 passed, 0 failed.
- Agent smoke eval passed: 3 scenarios, 3 passed, traceCompleteCount 3, traceIncompleteCount 0.
- Provider smoke eval completed in default skipped mode with `failureReason="provider_smoke_not_enabled"`.
- `git diff --check` passed.
- Trailing whitespace scan passed.
- Unfinished marker scan passed.

Additional targeted checks after tightening workflow hygiene coverage:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\releaseGateScript.test.ts
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\providerSmokeRunner.test.ts
```

Observed result:

- Release gate script tests passed: 3 pass, 0 fail.
- Provider smoke runner tests passed: 3 pass, 0 fail.

Opt-in live provider smoke check:

```powershell
$env:BROWSEGENT_RUN_PROVIDER_SMOKE='true'
$env:BROWSEGENT_V2_RUNTIME='agent'
$env:BROWSEGENT_V2_HEADED='false'
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_provider_smoke.ts
```

Observed result:

- The restricted-network sandbox run failed with `failureReason="provider_smoke_error:fetch failed"`.
- The same command passed after explicit network escalation.
- Passed run id: `provider_smoke_1779296023964`.
- Provider output passed `PlannerOutputSchema` validation with no validation errors.
- Metrics: `inputTokens=832`, `outputTokens=38`, `durationMs=38946`.

## Artifact Evidence

Inspected release-gate artifacts from a successful audit pass:

- Agent smoke report: `logs/v2-agent-smoke/agent_smoke_1779295681957/report.json`
- Agent smoke scenario results: `logs/v2-agent-smoke/agent_smoke_1779295681957/scenario-results.json`
- Continuity stress report: `logs/v2-stress/stress_1779295678959/report.json`
- Continuity stress scenario results: `logs/v2-stress/stress_1779295678959/scenario-results.json`
- Provider smoke report: `logs/v2-provider-smoke/provider_smoke_1779295684146/report.json`
- Live provider smoke report: `logs/v2-provider-smoke/provider_smoke_1779296023964/report.json`

Observed artifact result:

- Agent smoke includes three passed scenarios and complete trace evidence for all three.
- Continuity stress includes four passed scenarios, each with `traceComplete=true`.
- Provider smoke writes a report and remains skipped unless explicitly enabled.
- Live provider smoke produced a validated `done` output from the configured provider after network access was allowed.

## 2026-05-23 MVR Navigation Addendum

Fresh verification after adding the explicit v2 `navigate` runtime tool and local agent-smoke navigation scenario:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\agentSmokeRunner.test.ts
node .\node_modules\tsx\dist\cli.cjs tests\eval\v2\run_agent_smoke.ts
cmd /c npm run check:v2:release
```

Observed result:

- Agent smoke runner unit tests passed: 3 pass, 0 fail.
- Standalone agent smoke eval passed: 4 scenarios, 4 passed, traceCompleteCount 4, traceIncompleteCount 0.
- v2 release gate passed.
- Unit tests passed inside release gate: 196 pass, 0 fail.
- v2 integration tests passed inside release gate: 19 pass, 0 fail.
- Continuity stress eval passed inside release gate: 4 scenarios, 4 passed, 0 failed.
- Agent smoke eval passed inside release gate: 4 scenarios, 4 passed, traceCompleteCount 4, traceIncompleteCount 0.
- Provider smoke eval completed in default skipped mode with `failureReason="provider_smoke_not_enabled"`.
- `git diff --check`, trailing whitespace scan, and unfinished marker scan passed.

Navigation-specific evidence:

- Planner schema accepts `navigate` only with a supported `http`, `https`, or `file` URL and rejects unsafe schemes.
- Tool dispatch routes `navigate` to the v2 runtime and returns operational `missing_url` or `unsupported_url` failures for malformed steps.
- `BrowseGentV2Harness.navigate()` records pre-navigation observation, bounded navigation, post-navigation observation, transition evidence, and trace lineage.
- Unsafe navigation is rejected before browser mutation and records a failed trace step without an after-observation id.
- The default local agent smoke catalog includes `fixture-navigate`, a scripted planner scenario that navigates from `static-controls.html` to `spa-route-transition.html`.

Additional release-gate independence verification after making the gate independent of local `.env` secrets:

```powershell
$root = (Resolve-Path .).Path; $envPath = Join-Path $root '.env'; $tmpPath = Join-Path $root '.env.codex-ci-check.tmp'; if ((Test-Path -LiteralPath $tmpPath)) { throw 'temporary .env path already exists' }; $exitCode = 0; try { if (Test-Path -LiteralPath $envPath) { Move-Item -LiteralPath $envPath -Destination $tmpPath }; cmd /c npm run check:v2:release; $exitCode = $LASTEXITCODE } finally { if (Test-Path -LiteralPath $tmpPath) { Move-Item -LiteralPath $tmpPath -Destination $envPath } }; exit $exitCode
```

Observed result:

- v2 release gate passed with `.env` temporarily absent.
- Unit tests passed inside release gate: 196 pass, 0 fail.
- v2 integration tests passed inside release gate: 19 pass, 0 fail.
- Continuity stress eval passed inside release gate: 4 scenarios, 4 passed, 0 failed.
- Agent smoke eval passed inside release gate: 4 scenarios, 4 passed, traceCompleteCount 4, traceIncompleteCount 0.
- Provider smoke eval completed in default skipped mode with `failureReason="provider_smoke_not_enabled"`.
- Governance checks, `git diff --check`, trailing whitespace scan, and unfinished marker scan passed.

Remote workflow verification:

- Workflow: `BrowseGent v2 Release Gate`
- Run id: `26308489357`
- Head SHA: `36a420afc6f9825c1a410d91c3ef5f16c5b9bde9`
- Status: completed
- Conclusion: success
- URL: `https://github.com/Utkarsh-X/browsegent/actions/runs/26308489357`

## Repository Integration Evidence

Local integration branch:

- Branch: `browsegent-v2-release-hardening`
- Current head: `36a420a fix: make release gate independent of local env`
- Remote: `origin`
- Pushed branch: `origin/browsegent-v2-release-hardening`
- Pull request URL offered by GitHub: `https://github.com/Utkarsh-X/browsegent/pull/new/browsegent-v2-release-hardening`

Integration notes:

- Repo-local skill files under `skills/browsegent-dev` and `skills/codex.md` are intentionally tracked even though `skills/` is ignored, because the v2 release gate scans them.
- `logs/` remains ignored and is not part of the integration commit.
- Remote GitHub Actions status is proven for head `36a420afc6f9825c1a410d91c3ef5f16c5b9bde9`; pull request creation remains optional integration workflow outside the MVR runtime evidence.

## Requirement Verdicts

| Requirement | Verdict | Evidence |
|---|---|---|
| Public agent mode is tested through `BrowseGent.run()` and `BrowseGent.extract()` without a live provider. | Proven | `tests/integration/v2/publicAgentMode.test.ts`, release gate integration result 19/19 passed |
| Trace replay auditing is centralized and reused by eval runners. | Proven | `src/v2/trace/TraceReplayAuditor.ts`, `tests/eval/v2/run_agent_smoke.ts`, `tests/eval/v2/run_continuity_stress.ts`, unit tests 196/196 passed |
| CI has an explicit v2 release gate workflow. | Proven locally and remotely | `.github/workflows/v2-release-gate.yml`, `scripts/check_v2_release_gate.ts`, release gate script tests, GitHub Actions run `26308489357` success |
| v2 browser-mode config semantics are documented and tested. | Proven | `src/v2/runtime/config.ts`, `docs/governance/RUNTIME_SAFETY_RULES.md`, `tests/unit/v2/runtimeConfigHardening.test.ts` |
| Provider smoke exists as an opt-in gate. | Proven | `tests/eval/v2/run_provider_smoke.ts`, provider smoke runner tests 3/3 passed, release gate skip report written, live provider smoke `provider_smoke_1779296023964` passed |
| Default offline gates pass without network or local `.env`. | Proven | no-`.env` `cmd /c npm run check:v2:release` exit code 0 |
| No new runtime cognition leakage appears. | Proven by current static gate | `npm run check:v2:no-cognition` passed inside release gate |
| v1 remains the default path. | Proven by integration coverage | `tests/integration/v2/v1Compatibility.test.ts`, release gate integration result 19/19 passed |
| Workflow files are covered by hygiene scans. | Proven | Release gate script test asserts `.github\workflows` in both scan command argument lists |

## Remaining Evidence Gaps

- No MVR runtime evidence gap remains in this audit.
- Pull request creation is still optional repository workflow and is not required to prove the MVR runtime.
- Full production readiness beyond the MVR and release-hardening scope should still be audited against future requirements before making broader production claims.

## Current Worktree State

Expected local state after integration:

- Current branch: `browsegent-v2-release-hardening`
- Working tree: clean except ignored `logs/`
- Tracked integration includes `.github/workflows/v2-release-gate.yml`, governance docs, refined architecture docs, implementation plans, v2 source, v2 tests/evals/fixtures, release-gate scripts, and repo-local skills.

## Audit Conclusion

The Phase 16-20 release-hardening milestone is complete under offline local verification, and the integration branch has been pushed to the configured GitHub remote.

The BrowseGent v2 MVR runtime evidence is complete for the scoped release-hardening audit: local no-`.env` release gate passed and remote GitHub Actions passed for head `36a420afc6f9825c1a410d91c3ef5f16c5b9bde9`.
