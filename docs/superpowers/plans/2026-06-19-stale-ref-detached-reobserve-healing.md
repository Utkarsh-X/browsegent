# Stale Ref Detached Reobserve Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-shot recovery for refs that detach during execution after they were already resolved as current, live targets.

**Architecture:** This is not historical selector resurrection. The retry is allowed only when a mutation action has already resolved a current ref, the browser then throws `element_detached`, and a fresh observation still resolves the same `refId` as live or safely self-healable. Fully missing refs and ambiguous refs must continue to fail honestly.

**Tech Stack:** TypeScript, Node test runner, Playwright fixture tests, BrowseGent v2 harness/runtime.

---

## Scope Rules

- Do not recover refs missing before execution starts. Existing `BrowseGentV2Harness rejects a stale ref without selector guessing` must keep passing.
- Do not retry `target_blocked`, `target_hidden`, `target_not_editable`, `target_not_clickable`, or `ambiguous_ref_resolution` in this slice.
- Do not use old selector candidates from historical refs when `RefService.resolve(refId, current)` returns invalid.
- Retry at most once.
- Record audit evidence for attempted, succeeded, and failed self-heal paths.

## Files

- Modify: `src/v2/harness/BrowseGentV2Harness.ts`
- Test: `tests/integration/v2/mvrRuntime.test.ts`
- Create: `tests/fixtures/v2/detaching-click.html`

## Task 1: Add RED Integration Test

- [ ] **Step 1: Create detaching fixture**

Create `tests/fixtures/v2/detaching-click.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Detaching Click Fixture</title>
</head>
<body>
  <button
    id="detaching-target"
    onmousedown="
      if (!document.body.dataset.replaced) {
        document.body.dataset.replaced = 'true';
        const replacement = document.createElement('button');
        replacement.id = 'detaching-target';
        replacement.textContent = 'Detaching target';
        replacement.onclick = () => {
          document.body.dataset.clicked = 'true';
          replacement.textContent = 'Clicked replacement';
        };
        this.replaceWith(replacement);
      }
    "
  >Detaching target</button>
</body>
</html>
```

- [ ] **Step 2: Add failing test**

Add this test after the stale-ref test in `tests/integration/v2/mvrRuntime.test.ts`:

```ts
test('BrowseGentV2Harness reobserves and retries once when a live ref detaches during click', async () => {
  const traceDir = await freshTraceDir('detaching_click');
  const harness = new BrowseGentV2Harness({
    headed: false,
    runId: 'run_detaching_click',
    traceDir,
  });

  try {
    const observation = await harness.open(fixtureUrl('detaching-click.html'));
    const target = observation.refs.find(ref => ref.name === 'Detaching target');
    assert.ok(target);

    const result = await harness.click(target.refId);
    const searchResult = await harness.searchPage('Clicked replacement');
    const manifest = await harness.flushTrace();

    assert.equal(result.success, true);
    assert.equal(result.kind, 'click');
    assert.equal(result.targetRef, target.refId);
    assert.equal(searchResult.value?.matches, 1);
    assert.ok(manifest.artifacts.observations.length >= 2);
    assert.ok(manifest.artifacts.graph.some(artifact => artifact.kind === 'ref_resolution_audit'));
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx.cmd tsx --test tests/integration/v2/mvrRuntime.test.ts
```

Expected: the new test fails because the first click returns an execution failure instead of reobserving and retrying. If it passes immediately, stop and inspect the fixture because it is not reproducing detachment.

## Task 2: Implement One-Shot Detached Retry

- [ ] **Step 1: Extract success-result construction**

In `src/v2/harness/BrowseGentV2Harness.ts`, add this private helper near `executeMutation`:

```ts
  private async buildSuccessfulMutationResult<TValue>(
    kind: 'click' | 'type' | 'select',
    refId: string,
    ref: NonNullable<ReturnType<RefService['resolve']>['ref']>,
    before: BrowserObservation,
    stepId: string,
    execution: { value?: TValue },
  ): Promise<V2ToolResult<TValue>> {
    await this.stabilizationService.waitForSettledState(this.session.currentPage());
    const after = await this.captureCurrentObservation();
    const evidence = this.transitionService.compare(before, after);
    return {
      success: true,
      kind,
      targetRef: refId,
      target: summarizeToolTarget(ref),
      value: execution.value,
      evidence,
      traceStepId: stepId,
    };
  }
```

- [ ] **Step 2: Replace current success construction**

Replace the existing success path in `executeMutation`:

```ts
      const execution = await run(ref);
      await this.stabilizationService.waitForSettledState(this.session.currentPage());
      const after = await this.captureCurrentObservation();
      const evidence = this.transitionService.compare(before, after);
```

with:

```ts
      const execution = await run(ref);
      const result = await this.buildSuccessfulMutationResult(kind, refId, ref, before, stepId, execution);
```

Keep the existing weakened-ref audit block before `recordActionEnd`.

- [ ] **Step 3: Add detached retry helper**

Add this private helper near `executeMutation`:

```ts
  private async retryAfterDetachedMutation<TValue>(
    input: {
      kind: 'click' | 'type' | 'select';
      refId: string;
      before: BrowserObservation;
      stepId: string;
      run: (ref: NonNullable<ReturnType<RefService['resolve']>['ref']>) => Promise<{ value?: TValue }>;
    },
  ): Promise<V2ToolResult<TValue> | undefined> {
    await this.stabilizationService.waitForSettledState(this.session.currentPage());
    const refreshed = await this.captureCurrentObservation();
    const resolution = this.refService.resolve(input.refId, refreshed);
    const decision = shouldAttemptWeakenedRefSelfHeal(input.kind, resolution.ref);

    const ref = resolution.ref;
    if (!ref || (resolution.state !== 'live' && !decision.allow)) {
      const auditId = this.recordRefResolutionAudit({
        observation: refreshed,
        targetRef: input.refId,
        actionKind: input.kind,
        failureCode: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref',
        diagnostics: {
          detachedRetry: true,
          resolutionState: resolution.state,
          resolutionReason: resolution.reason,
          confidence: resolution.confidence,
        },
        selfHeal: {
          attempted: true,
          result: 'failed',
          reason: decision.reason,
        },
      });
      return this.failureResult<TValue>(input.kind, input.refId, input.stepId, {
        code: resolution.state === 'weakened' ? 'low_confidence_ref' : 'stale_ref',
        message: 'Target detached and did not resolve to a safe live ref after re-observation.',
        retryable: false,
        diagnostics: {
          refResolutionAuditId: auditId,
          detachedRetry: true,
          resolutionState: resolution.state,
        },
      });
    }

    try {
      const execution = await input.run(ref);
      const result = await this.buildSuccessfulMutationResult(input.kind, input.refId, ref, input.before, input.stepId, execution);
      this.recordRefResolutionAudit({
        observation: refreshed,
        targetRef: input.refId,
        actionKind: input.kind,
        selfHeal: {
          attempted: true,
          result: 'succeeded',
          reason: 'verified_runtime_resolution_required',
        },
      });
      return result;
    } catch (retryError) {
      const mapped = mapExecutionError(retryError);
      const auditId = this.recordRefResolutionAudit({
        observation: refreshed,
        targetRef: input.refId,
        actionKind: input.kind,
        failureCode: mapped.code,
        diagnostics: {
          ...(mapped.diagnostics ?? {}),
          detachedRetry: true,
        },
        selfHeal: {
          attempted: true,
          result: 'failed',
          reason: 'verified_runtime_resolution_required',
        },
      });
      return this.failureResult<TValue>(input.kind, input.refId, input.stepId, {
        code: mapped.code,
        message: mapped.message,
        retryable: false,
        diagnostics: {
          ...(mapped.diagnostics ?? {}),
          refResolutionAuditId: auditId,
          detachedRetry: true,
        },
      });
    }
  }
```

- [ ] **Step 4: Call helper only for `element_detached`**

In the `catch (error)` block of `executeMutation`, replace:

```ts
      const result = this.failureResult<TValue>(kind, refId, stepId, mapExecutionError(error));
```

with:

```ts
      const mappedError = mapExecutionError(error);
      const detachedRetryResult = mappedError.code === 'element_detached'
        ? await this.retryAfterDetachedMutation({ kind, refId, before, stepId, run })
        : undefined;
      const result = detachedRetryResult ?? this.failureResult<TValue>(kind, refId, stepId, mappedError);
```

Do not retry any other error code.

## Task 3: Verify and Commit

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npx.cmd tsx --test tests/integration/v2/mvrRuntime.test.ts
```

Expected: all tests pass, including the existing stale-ref rejection and full-block rejection tests.

- [ ] **Step 2: Run broader verification**

Run:

```powershell
npm.cmd run build
npm.cmd run check:v2
npm.cmd run test:unit
```

Expected: all pass.

- [ ] **Step 3: Inspect diff**

Run:

```powershell
git diff -- src/v2/harness/BrowseGentV2Harness.ts tests/integration/v2/mvrRuntime.test.ts tests/fixtures/v2/detaching-click.html
```

Expected: only detached-ref retry code and tests changed.

- [ ] **Step 4: Commit**

Run:

```powershell
git add -- src/v2/harness/BrowseGentV2Harness.ts tests/integration/v2/mvrRuntime.test.ts tests/fixtures/v2/detaching-click.html
git commit -m "fix(v2): reobserve detached refs once"
```

## Self-Review

- Scope is one failure mode: `element_detached` after current ref resolution.
- Existing invalid/stale ref rejection remains intact.
- No website-specific selector logic.
- No benchmark-specific behavior.
- No AX-tree or visual fallback added.
- Retry count is exactly one.
