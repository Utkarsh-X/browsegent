# BrowseGent v2 Runtime Safety Rules

## Purpose

Runtime safety protects the browser, the user environment, and architecture integrity. Safety here means bounded operational execution, not semantic caution.

## Mutation Principle

Every browser mutation must be:

- Explicitly requested by planner or test harness.
- Targeted by ref in v2 mode.
- Precondition-checked.
- Bounded by timeout or attempt limit.
- Re-observed after execution.
- Recorded in trace.

## Ref-First Execution

v2 execution targets refs, not raw selectors.

Selectors may exist as internal recovery hints. A low-confidence ref must not silently execute a broad selector fallback.

Execution is allowed only when:

- Ref exists.
- Ref belongs to current session.
- Ref is compatible with current generation or verified continuity.
- Ref confidence meets action threshold.
- Target is visible enough for the action.
- Target is enabled.
- Target is not known blocked.

## CDP and JavaScript Gates

Raw CDP and mutating JavaScript are powerful and must be gated.

Allowed:

- Read-only CDP queries for DOM, layout, backend node id, AX-like facts.
- Bounded input dispatch through an execution service.
- Mutating JavaScript only as an explicit fallback for a known mechanical interaction failure and only when trace records it.

Forbidden:

- Arbitrary planner-provided JavaScript execution.
- Hidden page mutation during observation.
- Runtime scripts that infer workflow meaning.
- JavaScript fallback without trace.
- CDP calls that bypass actionability checks.

## Retry Safety

Runtime retries are mechanical only.

Allowed retry causes:

- Transient timing race.
- Geometry not settled.
- Focus did not apply.
- Element temporarily obscured.

Retry limits:

- Small fixed attempt count per action.
- No unbounded retry loops.
- No strategy changes during retry.
- Every retry is trace-visible.

## Output Safety

Browser reads can return large data. Output must be bounded.

Rules:

- Truncate long text values in trace and planner context.
- Preserve enough preview for debugging.
- Store large artifacts separately only when required.
- Never put secrets from `.env` into traces.
- Never include raw cookies, local storage, or auth tokens in planner context.

## Navigation Safety

Navigation is a hard or macro transition candidate.

Rules:

- Record pre-navigation observation.
- Execute navigation through explicit tool or action.
- Wait for bounded load/settle.
- Capture post-navigation observation.
- Classify transition.
- Invalidate refs conservatively.

## Environment Safety

Do not make network-dependent behavior part of core unit tests.

v2 browser execution is headless by default. `BROWSEGENT_V2_HEADED=true` is the only supported way to request a visible v2 browser. `BrowseGentOptions.headless` controls the v1 browser path and must not silently override v2 agent-mode browser visibility.

Use local fixtures for:

- Rerender.
- Modal.
- Overlay.
- Delayed load.
- Layout shift.
- Virtualized list.
- Captcha-like block.

Real websites belong in diagnostic evals, not phase completion gates.

## Failure Safety

Runtime failure must be honest.

Good:

- `target_hidden`
- `target_disabled`
- `target_blocked`
- `stale_ref`
- `timeout`
- `navigation_interrupted`
- `low_confidence_ref`

Bad:

- `bad_strategy`
- `irrelevant_page`
- `try_search_again`
- `task_failed`

Semantic failure belongs to the planner.
