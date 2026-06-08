# Planner Completion + Recovery Evidence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BrowseGent V2 stop correctly when useful evidence is available, recover from correct validator refusals, and report benchmark trace failures clearly.

**Architecture:** Three focused control-plane changes around the existing V2 planner loop. No new tools, no prompt rewrites, no benchmark tuning, no validator weakening. Runtime remains operational; planner remains the semantic layer.

**Tech Stack:** TypeScript, Node test runner with `tsx`, BrowseGent V2 runtime/planner/benchmark code.

---

## Context

Read first:

- `docs/continuation-context-2026-06-02.md`
- `docs/superpowers/plans/2026-06-04-planner-completion-recovery-simple-plan.md`

## Non-Negotiables

- No benchmark-specific tuning or site-specific logic.
- No validator weakening or unsafe ambiguous ref execution.
- No broad prompt rewrites or new tool surfaces.
- No benchmark rerun until tests pass and user approves API usage.

---

### Task 1: Enrich Trace Error Failure Reasons In Benchmark Scoring

When `inferFailureType()` returns `'trace_error'`, the scored result's `failureReason` may be blank or only show a generic runtime reason like `v2_max_steps_exhausted`. This makes benchmark diagnosis unreliable. Fix: compose a descriptive `failureReason` that includes trace error codes.

**Files:**
- Modify: `tests/benchmark/v2/scoring.ts:9-30`
- Test: `tests/unit/v2/benchmarkScoring.test.ts`

- [ ] **Step 1: Write failing test — trace error enriches blank failure reason**

In `tests/unit/v2/benchmarkScoring.test.ts`, add at the end:

```ts
test('scoreBenchmarkResult enriches failure reason with trace error details when trace fails', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: false,
    value: 'useful answer',
    failureReason: 'v2_max_steps_exhausted',
    metrics: { plannerCalls: 3, toolExecutions: 5, durationMs: 100 },
  }, { ok: false, errors: ['missing_mutation_evidence'] });

  assert.equal(scored.failureType, 'trace_error');
  assert.match(scored.failureReason ?? '', /v2_max_steps_exhausted/);
  assert.match(scored.failureReason ?? '', /missing_mutation_evidence/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/unit/v2/benchmarkScoring.test.ts --test-name-pattern "enriches failure reason"`

Expected: FAIL because `failureReason` is not enriched yet — it will only contain `v2_max_steps_exhausted`.

- [ ] **Step 3: Write second failing test — no enrichment when trace is clean**

In `tests/unit/v2/benchmarkScoring.test.ts`, add at the end:

```ts
test('scoreBenchmarkResult does not enrich failure reason when trace passes', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: false,
    value: '',
    failureReason: 'planner_no_action',
    metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 10 },
  }, { ok: true, errors: [] });

  assert.equal(scored.failureReason, 'planner_no_action');
});
```

- [ ] **Step 4: Run test to verify it passes (baseline guard)**

Run: `node --test --import tsx tests/unit/v2/benchmarkScoring.test.ts --test-name-pattern "does not enrich"`

Expected: PASS — this test guards against breaking the clean-trace path.

- [ ] **Step 5: Implement `enrichFailureReason` in scoring.ts**

In `tests/benchmark/v2/scoring.ts`, add this function after the existing `inferFailureType` function (after line 83):

```ts
function enrichFailureReason(
  original: string | undefined,
  failureType: ScoredBenchmarkResult['failureType'],
  trace: BenchmarkTraceScore,
): string | undefined {
  if (failureType !== 'trace_error' || trace.errors.length === 0) {
    return original;
  }
  const traceDetail = `trace_error:${trace.errors.join(',')}`;
  if (original && original.length > 0) {
    return `${original}|${traceDetail}`;
  }
  return traceDetail;
}
```

Then modify `scoreBenchmarkResult` to use it. Change the return object (around line 22-29) from:

```ts
  return {
    ...result,
    partition: task.partition,
    passed,
    validation,
    trace,
    failureType,
  };
```

to:

```ts
  return {
    ...result,
    partition: task.partition,
    passed,
    validation,
    trace,
    failureType,
    failureReason: enrichFailureReason(result.failureReason, failureType, trace),
  };
```

- [ ] **Step 6: Run all benchmark scoring tests**

Run: `node --test --import tsx tests/unit/v2/benchmarkScoring.test.ts`

Expected: All tests in this file pass.

- [ ] **Step 7: Commit**

```powershell
git add tests/benchmark/v2/scoring.ts tests/unit/v2/benchmarkScoring.test.ts
git commit -m "fix(benchmark): enrich trace_error failure reasons with trace error details"
```

---

### Task 2: Add Action-Compatibility Recovery Guidance To Planner Retry

When `PlannerOutputSchema.validateActionCompatibility()` rejects an incompatible ref (e.g., `type` on a non-typeable ref), the `V2PlannerClient` retries with generic validation feedback. The planner never learns *which refs are compatible*. Fix: include compatible ref alternatives in the retry feedback.

**Files:**
- Modify: `src/v2/planner/V2PlannerClient.ts:144-146`
- Test: `tests/unit/v2/v2PlannerClient.test.ts`

- [ ] **Step 1: Write failing test — retry includes compatible ref alternatives**

In `tests/unit/v2/v2PlannerClient.test.ts`, add at the end:

```ts
test('V2PlannerClient includes action-compatible ref alternatives in retry feedback for type-on-non-typeable', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_compat_guidance');
  plannerInput.current.refs = {
    ref_button: {
      refId: 'ref_button',
      kind: 'button',
      role: 'button',
      name: 'Submit',
      text: 'Submit',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 10,
    },
    ref_input: {
      refId: 'ref_input',
      kind: 'input',
      role: 'textbox',
      name: 'Search',
      text: '',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 10,
    },
  };
  plannerInput.current.interactions = [
    { refId: 'ref_button', rank: 1 },
    { refId: 'ref_input', rank: 2 },
  ];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_button'],
      typeableRefs: ['ref_input'],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: [],
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 0,
      topRefs: [],
      omittedCount: 0,
    },
    failedRefs: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 2,
      selectedRefCount: 2,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };

  const providerUsers: string[] = [];
  const responses = [
    '{"plan":[{"tool":"type","ref":"ref_button","text":"hello"}],"confidence":"high"}',
    '{"plan":[{"tool":"type","ref":"ref_input","text":"hello"}],"confidence":"high"}',
  ];
  const client = new V2PlannerClient({
    provider: async (_system, user) => {
      providerUsers.push(user);
      return {
        text: responses.shift() ?? '{}',
        inputTokens: 5,
        outputTokens: 3,
      };
    },
  });

  const result = await client.call({ plannerInput });

  assert.equal(result.output.plan?.[0].ref, 'ref_input');
  assert.equal(providerUsers.length, 2);
  assert.match(providerUsers[1], /not compatible with tool "type"/);
  assert.match(providerUsers[1], /ref_input/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/unit/v2/v2PlannerClient.test.ts --test-name-pattern "action-compatible ref alternatives"`

Expected: FAIL because the retry feedback does not include `ref_input` as a compatible alternative — it only has the generic validation feedback.

- [ ] **Step 3: Implement `buildActionCompatibilityGuidance` in V2PlannerClient.ts**

In `src/v2/planner/V2PlannerClient.ts`, add this function before the existing `collectValidationContext` function (before line 191):

```ts
function buildActionCompatibilityGuidance(
  errors: string[],
  context: PlannerOutputValidationContext,
): string | undefined {
  const surface = context.actionSurface;
  if (!surface) return undefined;

  const lines: string[] = [];
  for (const error of errors) {
    const typeMatch = error.match(/ref "([^"]+)" is not compatible with tool "type"/);
    if (typeMatch && surface.typeableRefs.length > 0) {
      lines.push(`Typeable refs available: ${surface.typeableRefs.slice(0, 5).join(', ')}`);
    }

    const clickMatch = error.match(/ref "([^"]+)" is not compatible with tool "(click|close)"/);
    if (clickMatch && surface.clickableRefs.length > 0) {
      lines.push(`Clickable refs available: ${surface.clickableRefs.slice(0, 5).join(', ')}`);
    }

    const selectMatch = error.match(/ref "([^"]+)" is not compatible with tool "select"/);
    if (selectMatch && surface.selectableRefs.length > 0) {
      lines.push(`Selectable refs available: ${surface.selectableRefs.slice(0, 5).join(', ')}`);
    }
  }

  return lines.length > 0 ? [...new Set(lines)].join('\n') : undefined;
}
```

Import `PlannerOutputValidationContext` — it is already used in the file via `collectValidationContext`. No new import needed since the type comes from `PlannerOutputSchema`.

Add `PlannerOutputValidationContext` to the existing import at line 4:

```ts
import { PlannerOutputSchema, type PlannerOutputValidationContext } from './PlannerOutputSchema';
```

Then modify the retry block (lines 144-146) from:

```ts
      if (attempt === 1) {
        userMessage = `${baseUserMessage}\n\n${buildV2PlannerValidationFeedback(lastErrors)}`;
      }
```

to:

```ts
      if (attempt === 1) {
        const guidance = buildActionCompatibilityGuidance(
          lastErrors,
          collectValidationContext(input.plannerInput),
        );
        const feedbackSuffix = guidance ? `\nChoose a compatible ref:\n${guidance}` : '';
        userMessage = `${baseUserMessage}\n\n${buildV2PlannerValidationFeedback(lastErrors)}${feedbackSuffix}`;
      }
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test --import tsx tests/unit/v2/v2PlannerClient.test.ts --test-name-pattern "action-compatible ref alternatives"`

Expected: PASS.

- [ ] **Step 5: Run all planner client tests**

Run: `node --test --import tsx tests/unit/v2/v2PlannerClient.test.ts`

Expected: All tests in this file pass.

- [ ] **Step 6: Commit**

```powershell
git add src/v2/planner/V2PlannerClient.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "feat(v2): add action-compatible ref guidance to planner validation retry"
```

---

### Task 3: Add Completion Gate — Finalization Planner Call At Max Steps

When the planner reaches `maxSteps` with `lastSuccessfulEvidenceValue` present, the agent returns `success: false`. Fix: before returning `v2_max_steps_exhausted`, make one finalization planner call asking the planner to produce `done` with the collected evidence. If the planner returns a `plan` (more actions) instead of `done` or `escalate`, do NOT execute the plan — fall through to `v2_max_steps_exhausted`. The finalization call only converts evidence into a `done` answer; it never adds more actions.

**Files:**
- Modify: `src/v2/agent/V2AgentLoop.ts:208-226`
- Test: `tests/unit/v2/v2AgentLoop.test.ts`

- [ ] **Step 1: Write failing test — finalization converts evidence into done**

In `tests/unit/v2/v2AgentLoop.test.ts`, add at the end:

```ts
test('V2AgentLoop attempts finalization when useful evidence exists at max steps', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Observed answer' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Observed answer' },
    traceStepId: 'tool_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read answer',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Observed answer');
  assert.equal(planner.inputs.length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "attempts finalization"`

Expected: FAIL because the agent loop currently returns `{ success: false, value: 'Observed answer', failureReason: 'v2_max_steps_exhausted' }` without making a third finalization call — only 2 planner inputs are recorded.

- [ ] **Step 3: Write second failing test — finalization falls through when planner refuses**

In `tests/unit/v2/v2AgentLoop.test.ts`, add at the end:

```ts
test('V2AgentLoop falls through to max_steps_exhausted when finalization planner refuses to finish', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'scroll' }], confidence: 'low' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Observed answer' },
    traceStepId: 'tool_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read answer',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.value, 'Observed answer');
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(planner.inputs.length, 3);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "falls through to max_steps"`

Expected: FAIL — same reason, only 2 planner inputs.

- [ ] **Step 5: Implement finalization in V2AgentLoop.ts**

In `src/v2/agent/V2AgentLoop.ts`, add a private method to the `V2AgentLoop` class, after the `complete` method (after line 273):

```ts
  private async attemptFinalization(
    harness: V2AgentHarnessRuntime,
    plannerClient: V2PlannerClientLike,
    observation: BrowserObservation,
    graphSnapshot: import('../graph/types').ContinuityGraphSnapshot,
    goal: string,
    evidenceValue: string,
    metrics: { plannerCalls: number; inputTokens: number; outputTokens: number; plannerDurationMs: number; toolExecutions: number },
  ): Promise<V2AgentLoopResult | undefined> {
    const projection = this.projectionService.project(observation, graphSnapshot);
    const finalizationInput = this.plannerInputComposer.compose({
      episodeId: `episode_finalization_${observation.observationId}`,
      goal: `${goal}\n\nEvidence collected: "${evidenceValue}". If this answers the goal, return done with the answer. Otherwise escalate with reason.`,
      projection,
      graphSnapshot,
    });
    harness.recordPlannerInput?.(finalizationInput.episodeId, finalizationInput);
    metrics.plannerCalls += 1;
    try {
      const result = await plannerClient.call({ plannerInput: finalizationInput });
      harness.recordPlannerOutput?.(finalizationInput.episodeId, {
        attempts: 1,
        rawText: result.rawText,
        validation: { ok: true, errors: [] },
        output: result.output,
        metrics: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs: result.durationMs,
        },
      });
      metrics.inputTokens += result.inputTokens;
      metrics.outputTokens += result.outputTokens;
      metrics.plannerDurationMs += result.durationMs;

      if (result.output.done === true) {
        return await this.complete(harness, {
          success: true,
          value: result.output.val ?? evidenceValue,
          steps: metrics.plannerCalls,
          metrics,
        });
      }
    } catch {
      // Finalization planner call failed — fall through to max_steps_exhausted
    }
    return undefined;
  }
```

Then modify the post-loop section (lines 210-226). Replace:

```ts
      if (lastSuccessfulEvidenceValue) {
        return await this.complete(harness, {
          success: false,
          value: lastSuccessfulEvidenceValue,
          failureReason: 'v2_max_steps_exhausted',
          steps: metrics.plannerCalls,
          metrics,
        });
      }

      return await this.complete(harness, {
        success: false,
        value: '',
        failureReason: 'v2_max_steps_exhausted',
        steps: metrics.plannerCalls,
        metrics,
      });
```

with:

```ts
      if (lastSuccessfulEvidenceValue) {
        const finalizationResult = await this.attemptFinalization(
          harness, plannerClient, observation, graphSnapshot,
          input.goal, lastSuccessfulEvidenceValue, metrics,
        );
        if (finalizationResult) return finalizationResult;

        return await this.complete(harness, {
          success: false,
          value: lastSuccessfulEvidenceValue,
          failureReason: 'v2_max_steps_exhausted',
          steps: metrics.plannerCalls,
          metrics,
        });
      }

      return await this.complete(harness, {
        success: false,
        value: '',
        failureReason: 'v2_max_steps_exhausted',
        steps: metrics.plannerCalls,
        metrics,
      });
```

You will also need to import `ContinuityGraphSnapshot` at the top — check if it's already imported via the `ContinuityGraph` import. If not, add:

```ts
import type { ContinuityGraphSnapshot } from '../graph/types';
```

- [ ] **Step 6: Run both finalization tests**

Run: `node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts --test-name-pattern "finalization|falls through"`

Expected: Both finalization tests pass.

- [ ] **Step 7: Run all agent loop tests**

Run: `node --test --import tsx tests/unit/v2/v2AgentLoop.test.ts`

Expected: All tests in this file pass.

- [ ] **Step 8: Commit**

```powershell
git add src/v2/agent/V2AgentLoop.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "feat(v2): add finalization planner call when evidence exists at max steps"
```

---

### Task 4: Full Verification Gate

Run all gates to verify nothing was broken.

- [ ] **Step 1: Run focused select verification (regression guard)**

Run: `node --test --import tsx tests/unit/v2/toolDispatcher.test.ts tests/unit/v2/inputServiceErrorMapping.test.ts tests/unit/v2/brain1Projection.test.ts tests/unit/v2/plannerOutputSchema.test.ts tests/unit/v2/plannerPrompt.test.ts tests/unit/v2/v2AgentLoop.test.ts tests/unit/v2/v2PlannerClient.test.ts tests/integration/v2/mvrRuntime.test.ts`

Expected: All tests pass.

- [ ] **Step 2: Run V2 architecture gate**

Run: `npm.cmd run check:v2`

Expected: Boundaries + cognition leakage checks pass.

- [ ] **Step 3: Run TypeScript build**

Run: `npm.cmd run build`

Expected: `tsc --noEmit` clean.

- [ ] **Step 4: Run full unit suite**

Run: `npm.cmd run test:unit`

Expected: All tests pass.

- [ ] **Step 5: Run V2 integration suite**

Run: `node --test --import tsx tests/integration/v2/mvrRuntime.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Run anti-overfit scan**

Run:

```powershell
rg -n "Allrecipes|ArXiv|GitHub__|Google_Map|Wolfram|WebVoyager|webvoyager_lite_|booking|amazon|maps\.google|arxiv\.org|wolframalpha" src/v2
```

Expected: Exit code `1` (no matches). If `rg` is unavailable, use `grep_search` tool with the same pattern.

- [ ] **Step 7: Run whitespace check**

Run: `git diff --check`

Expected: Clean (only LF/CRLF warnings are acceptable).
