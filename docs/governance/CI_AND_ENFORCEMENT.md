# BrowseGent v2 CI and Enforcement

## Purpose

Governance must be enforceable. This document defines how rules become checks, tests, and review gates.

## Enforcement Layers

Use four enforcement layers:

1. Type contracts.
2. Unit and integration tests.
3. Static boundary checks.
4. Review checklists backed by trace artifacts.

No single layer is sufficient.

## Required Commands

Baseline:

```powershell
npm run build
npm run test:unit
```

Browser-backed v2 checks:

```powershell
npx tsx --test tests/integration/v2/**/*.test.ts
```

Governance checks:

```powershell
npm run check:v2
```

Continuity stress checks:

```powershell
npx tsx tests/eval/v2/run_continuity_stress.ts
```

Full v2 release gate:

```powershell
npm run check:v2:release
```

## Static Boundary Checks

Introduce static checks as soon as matching code exists.

Checks should enforce:

- `src/v2/substrate/**` must not import `src/agent/**`.
- `src/v2/runtime/**` must not import planner or provider modules.
- `src/v2/graph/**` must not import LLM/provider modules.
- `src/v2/brain1/**` must not import `src/v2/brain2/**` directly unless through approved contract types.
- `src/v2/trace/**` must not be imported as a decision dependency by runtime services except for passive recording.
- `tests/eval/**` must not be imported by `src/**`.

Implemented check:

- `scripts/check_v2_boundaries.ts`

## Forbidden Runtime Text Checks

Runtime output should not contain strategic advice.

Static scans should flag phrases in `src/v2/runtime`, `src/v2/substrate`, `src/v2/brain1`, `src/v2/brain2`, and `src/v2/graph` such as:

- `try another`
- `better strategy`
- `not useful`
- `user wants`
- `should search`
- `task complete`
- `workflow`

This check must be reviewed carefully. The phrase `workflow` can appear in governance docs and tests, but not as runtime advice.

Implemented check:

- `scripts/check_v2_no_cognition_leakage.ts`

## Release Gate Script

The local and CI release gate is implemented by:

- `scripts/check_v2_release_gate.ts`
- `npm run check:v2:release`
- `.github/workflows/v2-release-gate.yml`

The gate runs build, unit tests, v2 governance checks, browser-backed v2 integration tests, continuity stress, agent smoke, offline provider-smoke skip validation, `git diff --check`, trailing-whitespace scanning, and unfinished-marker scanning.

The `rg` scans intentionally treat exit code `1` as success because it means no matches were found. Any other non-zero exit code fails the release gate.

## Replay Enforcement

Any test that mutates browser state must assert trace presence.

Required assertions:

- Trace file exists.
- Action step exists.
- Before observation id exists.
- After observation id exists.
- Target ref is recorded.
- Transition evidence is recorded.
- Error code is recorded for failed execution.

## CI Stages

Recommended CI order:

1. Install dependencies.
2. Run TypeScript build.
3. Run unit tests.
4. Run v2 boundary checks.
5. Run v2 no-cognition-leakage checks.
6. Run browser fixture integration tests.
7. Run continuity stress eval.
8. Run agent smoke eval.
9. Run provider smoke eval in default skipped mode.
10. Run hygiene scans.
11. Upload v2 trace artifacts for failed browser tests.

## Pull Request Gate

Every v2 implementation PR must include:

- Phase name.
- Governance files read.
- Files changed.
- Tests run.
- Trace artifacts produced if browser mutation exists.
- v1 behavior impact.
- Boundary review result.
- Known limitations.

## Enforceable Definition of Done

A v2 phase is not complete unless:

- Build passes.
- Unit tests pass.
- Required integration tests pass or an environmental blocker is documented.
- Static boundary checks pass.
- Replay artifacts exist for mutating behavior.
- No runtime cognition leakage is detected.
- Review checklist is answered.

## Governance Maintenance

Governance files should change only when:

- Implementation reveals a missing rule.
- A rule is unenforceable and needs sharpening.
- A subsystem boundary changes through explicit architecture review.

Governance files must not be changed to justify an implementation shortcut after the fact.
