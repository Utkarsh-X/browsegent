# BrowseGent Continuation Context - 2026-06-02

This file captures the current state so another implementation model can continue without losing context.

## Current Restore Point

- Current branch restore commit: `6e443dd chore: create v2 hardening restore point`
- Worktree after commit currently has these untracked files:
  - `debug.log`
  - `docs/continuation-context-2026-06-02.md`
  - `new-keys.yaml`
- Do not commit `new-keys.yaml`; it is presumed to contain API key material.
- Do not commit `debug.log`; it is a throwaway/debug artifact.
- `docs/continuation-context-2026-06-02.md` is this handoff file and is safe to commit if the user wants it saved in git.

## Operating Principles

- No benchmark-specific tuning.
- No site-specific hacks for WebVoyager, ArXiv, GitHub, Google Maps, Wolfram Alpha, Allrecipes, etc.
- Treat benchmark results only as diagnostic signals.
- Prefer minimal general fixes that improve production browser-agent correctness.
- Keep Brain1/Brain2/graph architecture intact.
- Runtime/substrate must stay operational, not semantic/cognitive.
- Planner is the semantic cognition layer.
- Do not expose raw selectors, backend node IDs, or CDP IDs to planner inputs.
- Use refs and action-surface lanes as the planner/runtime contract.
- Preserve traceability: action start/end, observations, transitions, failures, planner artifacts.

## Recent Verified Implementation State

The V2 ref-identity and step-execution hardening plan has been implemented and verified.

Completed areas:

- Failure classification cleanup.
- DOM facts and ref capabilities.
- Backend identity and fingerprint stability.
- Verified ref resolution replacing blind selector `.first()`.
- Safe mini-plan continuation with fresh ref validation.
- Bounded explicit `press` tool.
- Final verification gates.

Important new/changed modules:

- `src/v2/runtime/refCapabilities.ts`
- `src/v2/substrate/RefResolver.ts`
- `src/v2/substrate/KeyboardService.ts`
- `src/v2/planner/PlannerWorkingSetSelector.ts`
- `src/v2/planner/V2PlannerResponseSchema.ts`
- `src/v2/runtime/RecoveryState.ts`
- `src/providers/apiBudget.ts`
- `src/providers/requestPacer.ts`
- Benchmark infrastructure under `tests/benchmark/v2` and `tests/benchmark/webvoyager`.

Verification already passed before the restore commit:

- `npm.cmd run check:v2`
- `npm.cmd run build`
- `npm.cmd run test:unit` -> 340/340 tests passed
- `node --test --import tsx tests/integration/v2/mvrRuntime.test.ts` -> 15/15 tests passed
- `git diff --check` passed before commit after one trailing-space cleanup
- Secret scan of staged diff found no API keys

## Latest MVR5 Benchmark Run

Latest report:

- `D:\BrowseGent\logs\webvoyager-lite\webvoyager_lite_1780375900855\report.json`
- Command used:
  `npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 16`

Run summary:

- Pass rate: `40%` / `2 of 5`
- Trace complete rate: `80%`
- Avg planner calls: `5.6`
- Avg tool executions: `6`
- Failure types: all reported as `planning_error`
- Passed:
  - `webvoyager_Google__Map__10`
  - `webvoyager_Wolfram__Alpha__0`
- Failed:
  - `webvoyager_Allrecipes__3`
  - `webvoyager_ArXiv__0`
  - `webvoyager_GitHub__0`

Interpretation:

- This is an improvement over earlier 20% runs, but not yet a quality win.
- Wolfram was clean and efficient.
- Google Maps passed but still used a longer path.
- Allrecipes failed with `planner_client_error:fetch failed`; treat as environment/API/network for now, not core BrowseGent logic.
- GitHub failed because the planner tried to `type` into a non-typeable ref. Validator correctly rejected it. This is action-selection/recovery quality, not runtime execution.
- ArXiv produced `ambiguous_ref_resolution` failures. This is actually good runtime behavior: the resolver refused unsafe ambiguous execution instead of blindly clicking the wrong element.

Important trace finding:

- GitHub planner raw output:
  `{"plan":[{"tool":"click","ref":"v2ref_260"},{"tool":"type","ref":"v2ref_260","text":"climate change data visualization"},{"tool":"press","ref":"v2ref_260","key":"Enter"}],"confidence":"high"}`
- Validation rejected:
  `Step 2 ref "v2ref_260" is not compatible with tool "type"`
- This means action-surface validation is working. The planner needs better recovery/change-of-mechanism after incompatible refs.

ArXiv trace note:

- One trace showed raw planner output with a `select` step containing `value`, but validation said `select requires "value"`.
- Re-testing current local `PlannerOutputSchema` with that raw output validated successfully.
- Therefore that exact `select requires value` issue may have been stale-code/runtime mismatch or already fixed.
- However, the broader issue remains: planner/schema/action lanes expose `select`, but V2 runtime does not yet implement bounded `select(ref, value)`.

## Current Most Important Next Gap

The cleanest next production-quality fix is bounded `select(ref, value)` end-to-end.

Reason:

- Planner output schema already permits `select`.
- Working-set action lanes already expose `selectableRefs`.
- Ref capabilities already derive `selectable`.
- Failure taxonomy already has `target_not_selectable`.
- Runtime/dispatcher/harness currently do not implement actual `select`.
- ArXiv indicates the planner naturally wants a select operation.

Recommended minimal implementation:

1. Add `select(refId, value)` to `V2ToolRuntime`.
2. Dispatch `tool: "select"` in `V2ToolDispatcher`.
3. Add `InputService.select(ref, value, page)` using verified `RefResolver`.
4. Use Playwright `locator.selectOption` for native `<select>`.
5. For non-native combobox/select-like controls, be conservative:
   - Either reject as `target_not_selectable` for now, or implement only a clearly bounded keyboard/click path if it is general and well-tested.
   - Avoid site-specific combobox handling.
6. Add `BrowseGentV2Harness.select()` with trace start/end, re-observation, transition evidence, failure evidence.
7. Add fixtures and tests:
   - Native select succeeds.
   - Non-select ref rejected as `target_not_selectable`.
   - Dispatcher validates missing `value`.
   - Planner schema and prompt already mostly support select but should be checked.

Recommended verification:

- Focused unit/integration tests for select.
- `npm.cmd run check:v2`
- `npm.cmd run build`
- `npm.cmd run test:unit`
- `node --test --import tsx tests/integration/v2/mvrRuntime.test.ts`
- Anti-overfit scan on `src/v2`.

## Second Next Gap

Improve recovery after:

- `ambiguous_ref_resolution`
- action-incompatible refs rejected by planner validation
- repeated invalid planner output

Recommended direction:

- Do not loosen validator just to improve score.
- Do not allow unsafe ambiguous clicks.
- Feed clearer recovery signals into planner input:
  - blocked action
  - incompatible tool/ref reason
  - allowed alternative lanes for the same region/goal
  - failed ref facts and nearby alternatives
- Recovery should encourage a different mechanism:
  - inspect/read/search/scroll
  - use a typeable ref instead of clickable ref
  - select only selectable refs
  - avoid repeating the same ambiguous target

## Benchmark Commands

BrowseGent MVR5:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browsegent --request-rpm 8 --key-index 16
```

Browser Use MVR5 comparison:

```powershell
npm.cmd run benchmark:webvoyager-lite -- gemini/gemini-3.1-flash-lite --source-root D:\agent-tools\WebVoyager --slice mvr5 --adapter browser-use --request-rpm 8 --key-index 16
```

Use a fresh key index when running new benchmark attempts. Avoid frequent reruns until a general code improvement lands.

## Suggested Immediate Workflow For Next Model

1. Read this file.
2. Read `docs/superpowers/plans/2026-06-01-ref-identity-step-execution-contract-implementation-plan.md`.
3. Inspect current `V2ToolDispatcher`, `InputService`, and `BrowseGentV2Harness`.
4. Implement bounded native `select`.
5. Add tests first or at least add regression tests before implementation.
6. Run focused tests.
7. Run full verification gates.
8. Only then run one MVR5 BrowseGent smoke if the user approves API usage.

## My Engineering Recommendation

Do not chase the 40% score directly.

The system is now exposing the right kind of failures:

- ambiguous target refused,
- incompatible action rejected,
- network errors separated from runtime errors,
- traces are sufficiently inspectable.

The next step is not prompt tuning. The next step is completing missing general action semantics (`select`) and improving recovery signal quality so the planner changes strategy when the runtime correctly refuses unsafe or incompatible actions.

This is the fastest responsible path toward a production-quality browser agent without overfitting to WebVoyager.
