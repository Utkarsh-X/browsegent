# BrowseGent v2 Stage A+B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first honest benchmark harness and expose a task-first BrowseGent public API that accepts browser-agent style input while preserving v2 replay and architecture boundaries.

**Architecture:** The benchmark harness lives under `tests/benchmark/v2` and depends only on public BrowseGent/v2 APIs. The public task API lives under `src/v2/public` and is reached from `BrowseGent.run(task, options)` through overloads, leaving the existing `BrowseGent.run(url, goal)` behavior intact.

**Tech Stack:** TypeScript, Node test runner, Playwright through existing v2 harness, existing `V2AgentLoop`, existing `auditTraceReplay`, local v2 fixtures, JSON/Markdown benchmark reports.

---

## Scope

This plan covers only Stage A and Stage B from the roadmap:

- Stage A: neutral benchmark core, BrowseGent adapter, local task registry, runner CLI, reports.
- Stage B: public task-first API compatible with browser-agent style input.

This plan does not add browser-use, Stagehand, Browserbase, or Browser Harness dependencies. Competitor adapters start only after the first-party harness and public API are stable.

Git handling: do not commit, stage, push, or open PRs during execution unless the user explicitly asks.

Secret handling: provider keys must be read from process environment or local `.env` only. Do not write keys into code, tests, docs, reports, traces, or shell history examples.

## File Structure

Create:

- `src/v2/public/types.ts`: public task-first API option and result contracts.
- `src/v2/public/BrowserAgentRunner.ts`: maps public task input to `V2AgentLoop`.
- `tests/benchmark/v2/types.ts`: benchmark task, adapter, result, and report contracts.
- `tests/benchmark/v2/scoring.ts`: deterministic task-value validation and trace audit scoring.
- `tests/benchmark/v2/report.ts`: aggregate benchmark results into summary metrics.
- `tests/benchmark/v2/adapters/BrowseGentAdapter.ts`: first-party adapter using the public task API.
- `tests/benchmark/v2/local_tasks.ts`: deterministic local v2 fixture benchmark tasks.
- `tests/benchmark/v2/run_benchmark.ts`: CLI runner for local benchmark runs.
- `tests/unit/v2/publicAgentRunner.test.ts`: unit tests for public API runner behavior.
- `tests/unit/v2/publicTaskApi.test.ts`: unit tests for `BrowseGent.run(task, options)` overload behavior.
- `tests/unit/v2/benchmarkScoring.test.ts`: unit tests for scoring and trace audit integration.
- `tests/unit/v2/benchmarkReport.test.ts`: unit tests for summary aggregation.
- `tests/unit/v2/browseGentBenchmarkAdapter.test.ts`: unit tests for adapter mapping.
- `docs/evaluation/v2-mvr-benchmarking.md`: user-facing local testing and benchmark guide.

Modify:

- `src/BrowseGent.ts`: add overloads and delegate task-first input to `BrowserAgentRunner`.
- `src/index.ts`: export new public task API types.
- `src/v2/index.ts`: export `BrowserAgentRunner` and public types.
- `package.json`: add `benchmark:v2` script.

## Boundary Rules

- Benchmark code must not import v2 runtime internals beyond public v2 exports.
- Scoring validates outputs and trace completeness; scoring must not influence runtime.
- Public API runner may validate input shape and map options; it must not infer workflow strategy.
- Browser mutations still happen only inside the existing v2 harness and tool dispatcher.
- Unsupported public options must produce warnings, not silent behavior.

## Task 1: Public API Contracts

**Files:**

- Create: `src/v2/public/types.ts`
- Modify: `src/v2/index.ts`
- Test: `tests/unit/v2/publicAgentRunner.test.ts`

- [ ] **Step 1: Write the failing import/export test**

Add this test to `tests/unit/v2/publicAgentRunner.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

test('v2 public API exports task-first option and result contracts', async () => {
  const v2 = await import('../../../src/v2');

  assert.equal(typeof v2.BrowserAgentRunner, 'function');
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicAgentRunner.test.ts
```

Expected: fail because `BrowserAgentRunner` is not exported.

- [ ] **Step 3: Create public API types**

Create `src/v2/public/types.ts`:

```ts
import type { V2AgentLoopResult } from '../agent/types';

export type BrowserAgentOutputMode =
  | 'text'
  | {
      type: 'json';
      schemaDescription?: string;
    };

export interface BrowserAgentViewport {
  width: number;
  height: number;
}

export interface BrowserAgentBrowserOptions {
  headless?: boolean;
  viewport?: BrowserAgentViewport;
  profileDir?: string;
  cdpUrl?: string;
}

export interface BrowserAgentTraceOptions {
  dir?: string;
  runId?: string;
}

export interface BrowserAgentRunOptions {
  url: string;
  model?: string;
  maxSteps?: number;
  browser?: BrowserAgentBrowserOptions;
  trace?: boolean | BrowserAgentTraceOptions;
  output?: BrowserAgentOutputMode;
}

export interface BrowserAgentRunResult {
  success: boolean;
  value: string;
  data?: unknown;
  failureReason?: string;
  tracePath?: string;
  warnings: string[];
  metrics: V2AgentLoopResult['metrics'];
}
```

- [ ] **Step 4: Add a minimal runner export**

Create `src/v2/public/BrowserAgentRunner.ts`:

```ts
export class BrowserAgentRunner {}
```

Modify `src/v2/index.ts`:

```ts
export { BrowserAgentRunner } from './public/BrowserAgentRunner';
export type {
  BrowserAgentBrowserOptions,
  BrowserAgentOutputMode,
  BrowserAgentRunOptions,
  BrowserAgentRunResult,
  BrowserAgentTraceOptions,
  BrowserAgentViewport,
} from './public/types';
```

- [ ] **Step 5: Run the focused test and confirm pass**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicAgentRunner.test.ts
```

Expected: pass.

## Task 2: BrowserAgentRunner Behavior

**Files:**

- Modify: `src/v2/public/BrowserAgentRunner.ts`
- Test: `tests/unit/v2/publicAgentRunner.test.ts`

- [ ] **Step 1: Add runner behavior tests**

Append these tests to `tests/unit/v2/publicAgentRunner.test.ts`:

```ts
import type { V2AgentLoopResult } from '../../../src/v2';

function makeLoopResult(overrides: Partial<V2AgentLoopResult> = {}): V2AgentLoopResult {
  return {
    success: true,
    value: 'done',
    steps: 1,
    tracePath: 'logs/v2-runs/run/trace.json',
    metrics: {
      plannerCalls: 1,
      inputTokens: 10,
      outputTokens: 5,
      plannerDurationMs: 7,
      toolExecutions: 1,
    },
    ...overrides,
  };
}

test('BrowserAgentRunner maps task-first input into a v2 agent loop run', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const calls: unknown[] = [];
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 6,
    defaultModel: 'gemini/gemini-3.1-flash-lite',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: input => {
      calls.push(input);
      return {
        run: async runInput => {
          calls.push(runInput);
          return makeLoopResult({ value: 'first price is $9' });
        },
      };
    },
  });

  const result = await runner.run('Find the first price', {
    url: 'https://example.test/products',
    maxSteps: 3,
    model: 'gemini/gemini-3.1-flash-lite',
    browser: { headless: true, viewport: { width: 1000, height: 700 } },
    trace: { dir: 'logs/bench', runId: 'public_api_unit' },
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'first price is $9');
  assert.equal(result.tracePath, 'logs/v2-runs/run/trace.json');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(calls[0], {
    headed: false,
    traceDir: 'logs/bench',
    runId: 'public_api_unit',
    viewport: { width: 1000, height: 700 },
  });
  assert.deepEqual(calls[1], {
    url: 'https://example.test/products',
    goal: 'Find the first price',
    maxSteps: 3,
    model: 'gemini/gemini-3.1-flash-lite',
  });
});

test('BrowserAgentRunner reports unsupported browser options as warnings', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult(),
    }),
  });

  const result = await runner.run('Read page', {
    url: 'https://example.test',
    browser: { cdpUrl: 'http://127.0.0.1:9222', profileDir: '.profile' },
    trace: false,
  });

  assert.equal(result.success, true);
  assert.match(result.warnings.join('\n'), /cdpUrl/);
  assert.match(result.warnings.join('\n'), /profileDir/);
  assert.match(result.warnings.join('\n'), /trace=false/);
});

test('BrowserAgentRunner parses JSON output mode and fails honestly on invalid JSON', async () => {
  const { BrowserAgentRunner } = await import('../../../src/v2');
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult({ value: '{"price":"$9"}' }),
    }),
  });

  const jsonResult = await runner.run('Extract price', {
    url: 'https://example.test',
    output: { type: 'json', schemaDescription: '{ "price": string }' },
  });

  assert.equal(jsonResult.success, true);
  assert.deepEqual(jsonResult.data, { price: '$9' });

  const failingRunner = new BrowserAgentRunner({
    defaultMaxSteps: 4,
    defaultModel: 'gemini/gemini-3.1-flash-lite',
    defaultTraceDir: 'logs/v2-runs',
    runtimeHeaded: false,
    loopFactory: () => ({
      run: async () => makeLoopResult({ value: 'not json' }),
    }),
  });

  const textResult = await failingRunner.run('Extract price', {
    url: 'https://example.test',
    output: { type: 'json' },
  });

  assert.equal(textResult.success, false);
  assert.match(textResult.failureReason ?? '', /output_json_parse_failed/);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicAgentRunner.test.ts
```

Expected: fail because the runner constructor and `run()` method do not exist.

- [ ] **Step 3: Implement `BrowserAgentRunner`**

Replace `src/v2/public/BrowserAgentRunner.ts` with:

```ts
import { v2AgentLoopFactory, type V2AgentLoopFactoryInput } from '../agent/createV2AgentLoop';
import type { V2AgentLoopResult } from '../agent/types';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from './types';

export interface BrowserAgentRunnerOptions {
  defaultMaxSteps: number;
  defaultModel: string;
  defaultTraceDir: string;
  runtimeHeaded: boolean;
  loopFactory?: (input: V2AgentLoopFactoryInput) => { run(input: { url: string; goal: string; maxSteps: number; model?: string }): Promise<V2AgentLoopResult> };
}

export class BrowserAgentRunner {
  private readonly loopFactory: NonNullable<BrowserAgentRunnerOptions['loopFactory']>;

  constructor(private readonly options: BrowserAgentRunnerOptions) {
    this.loopFactory = options.loopFactory ?? (input => v2AgentLoopFactory.create(input));
  }

  async run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult> {
    if (!task.trim()) {
      return this.failure('public_task_empty', []);
    }
    if (!options.url?.trim()) {
      return this.failure('public_url_missing', []);
    }

    const warnings = buildWarnings(options);
    const traceOptions = resolveTraceOptions(options.trace, this.options.defaultTraceDir);
    const headed = options.browser?.headless === undefined
      ? this.options.runtimeHeaded
      : !options.browser.headless;
    const maxSteps = Math.max(1, options.maxSteps ?? this.options.defaultMaxSteps);
    const loop = this.loopFactory({
      headed,
      traceDir: traceOptions.traceDir,
      runId: traceOptions.runId,
      viewport: options.browser?.viewport,
    });
    const loopResult = await loop.run({
      url: options.url,
      goal: buildGoal(task, options),
      maxSteps,
      model: options.model ?? this.options.defaultModel,
    });

    return applyOutputMode(loopResult, options, warnings);
  }

  private failure(failureReason: string, warnings: string[]): BrowserAgentRunResult {
    return {
      success: false,
      value: '',
      failureReason,
      warnings,
      metrics: {
        plannerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        plannerDurationMs: 0,
        toolExecutions: 0,
      },
    };
  }
}

function buildGoal(task: string, options: BrowserAgentRunOptions): string {
  if (typeof options.output === 'object' && options.output.type === 'json' && options.output.schemaDescription) {
    return `${task}\n\nReturn JSON matching this schema description: ${options.output.schemaDescription}`;
  }

  return task;
}

function buildWarnings(options: BrowserAgentRunOptions): string[] {
  const warnings: string[] = [];
  if (options.browser?.cdpUrl) warnings.push('browser.cdpUrl is accepted but not used by the local v2 runner in this release slice.');
  if (options.browser?.profileDir) warnings.push('browser.profileDir is accepted but not used by the local v2 runner in this release slice.');
  if (options.trace === false) warnings.push('trace=false requested, but v2 agent mode always records traces for replayability.');
  return warnings;
}

function resolveTraceOptions(trace: BrowserAgentRunOptions['trace'], defaultTraceDir: string): { traceDir: string; runId?: string } {
  if (typeof trace === 'object' && trace !== null) {
    return {
      traceDir: trace.dir ?? defaultTraceDir,
      runId: trace.runId,
    };
  }

  return { traceDir: defaultTraceDir };
}

function applyOutputMode(
  loopResult: V2AgentLoopResult,
  options: BrowserAgentRunOptions,
  warnings: string[],
): BrowserAgentRunResult {
  if (typeof options.output === 'object' && options.output.type === 'json' && loopResult.success) {
    try {
      return {
        success: true,
        value: loopResult.value,
        data: JSON.parse(loopResult.value),
        tracePath: loopResult.tracePath,
        warnings,
        metrics: loopResult.metrics,
      };
    } catch (error) {
      return {
        success: false,
        value: loopResult.value,
        failureReason: `output_json_parse_failed:${error instanceof Error ? error.message : String(error)}`,
        tracePath: loopResult.tracePath,
        warnings,
        metrics: loopResult.metrics,
      };
    }
  }

  return {
    success: loopResult.success,
    value: loopResult.value,
    failureReason: loopResult.failureReason,
    tracePath: loopResult.tracePath,
    warnings,
    metrics: loopResult.metrics,
  };
}
```

- [ ] **Step 4: Extend v2 loop factory input for viewport**

Modify `src/v2/agent/createV2AgentLoop.ts`:

```ts
import type { BrowserSessionOptions } from '../substrate/types';
import { V2AgentLoop } from './V2AgentLoop';

export interface V2AgentLoopFactoryInput {
  headed: boolean;
  traceDir: string;
  runId?: string;
  viewport?: BrowserSessionOptions['viewport'];
}

export type V2AgentLoopFactory = (input: V2AgentLoopFactoryInput) => Pick<V2AgentLoop, 'run'>;

export const v2AgentLoopFactory: { create: V2AgentLoopFactory } = {
  create: input => new V2AgentLoop({
    headed: input.headed,
    traceDir: input.traceDir,
    runId: input.runId,
    viewport: input.viewport,
  }),
};

export function createV2AgentLoop(input: V2AgentLoopFactoryInput): Pick<V2AgentLoop, 'run'> {
  return v2AgentLoopFactory.create(input);
}
```

Modify `src/v2/agent/types.ts`:

```ts
import type { BrowserSessionOptions } from '../substrate/types';

export interface V2AgentLoopOptions {
  harnessFactory?: () => V2AgentHarnessRuntime;
  plannerClient?: V2PlannerClientLike;
  dispatcherFactory?: (runtime: V2ToolRuntime) => V2ToolDispatcherLike;
  traceDir?: string;
  headed?: boolean;
  runId?: string;
  viewport?: BrowserSessionOptions['viewport'];
}
```

Modify `src/v2/agent/V2AgentLoop.ts` in `createHarness()`:

```ts
return new BrowseGentV2Harness({
  headed: this.options.headed ?? true,
  traceDir: this.options.traceDir,
  runId: this.options.runId,
  runtimeMode: 'agent',
  viewport: this.options.viewport,
});
```

- [ ] **Step 5: Run the focused test and confirm pass**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicAgentRunner.test.ts
```

Expected: pass.

## Task 3: BrowseGent Task-First Run Overload

**Files:**

- Modify: `src/BrowseGent.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/v2/publicTaskApi.test.ts`

- [ ] **Step 1: Write the overload behavior test**

Create `tests/unit/v2/publicTaskApi.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { V2AgentLoopResult } from '../../../src/v2';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function seedEnv(): void {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
  process.env.BROWSEGENT_V2_RUNTIME = 'agent';
  process.env.BROWSEGENT_V2_HEADED = 'false';
}

function makeAgentResult(): V2AgentLoopResult {
  return {
    success: true,
    value: 'task answer',
    steps: 1,
    tracePath: 'logs/v2-runs/task-api/trace.json',
    metrics: {
      plannerCalls: 1,
      inputTokens: 2,
      outputTokens: 3,
      plannerDurationMs: 4,
      toolExecutions: 1,
    },
  };
}

test.afterEach(() => {
  restoreEnv();
});

test('BrowseGent.run supports task-first options without requiring init', async () => {
  seedEnv();
  const factoryModule = require('../../../src/v2/agent/createV2AgentLoop') as {
    v2AgentLoopFactory: {
      create: (input: unknown) => { run(input: unknown): Promise<V2AgentLoopResult> };
    };
  };
  const originalFactory = factoryModule.v2AgentLoopFactory.create;
  const calls: unknown[] = [];
  factoryModule.v2AgentLoopFactory.create = input => {
    calls.push(input);
    return {
      run: async runInput => {
        calls.push(runInput);
        return makeAgentResult();
      },
    };
  };

  try {
    const { BrowseGent } = await import('../../../src/BrowseGent');
    const bg = new BrowseGent({ maxSteps: 9, warmup: false });
    const result = await bg.run('Read the visible answer', {
      url: 'https://example.test',
      maxSteps: 5,
      browser: { headless: true },
      trace: { dir: 'logs/public-task-api', runId: 'api_test' },
    });

    assert.equal(result.success, true);
    assert.equal(result.value, 'task answer');
    assert.equal(result.tracePath, 'logs/v2-runs/task-api/trace.json');
    assert.equal(result.metrics.plannerCalls, 1);
    assert.deepEqual(calls[0], {
      headed: false,
      traceDir: 'logs/public-task-api',
      runId: 'api_test',
      viewport: undefined,
    });
    assert.deepEqual(calls[1], {
      url: 'https://example.test',
      goal: 'Read the visible answer',
      maxSteps: 5,
      model: 'gemini/gemini-3.1-flash-lite',
    });
  } finally {
    factoryModule.v2AgentLoopFactory.create = originalFactory;
  }
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicTaskApi.test.ts
```

Expected: fail because `BrowseGent.run(task, options)` only accepts `(url, goal)`.

- [ ] **Step 3: Add overloads and delegate to `BrowserAgentRunner`**

Modify imports in `src/BrowseGent.ts`:

```ts
import { BrowserAgentRunner } from './v2/public/BrowserAgentRunner';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from './v2/public/types';
```

Replace the public `run` signature and implementation with:

```ts
async run(url: string, goal: string): Promise<RunResult>;
async run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult>;
async run(first: string, second: string | BrowserAgentRunOptions): Promise<RunResult | BrowserAgentRunResult> {
  if (typeof second !== 'string') {
    return this._runTaskFirstAgent(first, second);
  }

  const runtime = getRuntimeConfig();
  const adapter = V1CompatibilityAdapter.create<RunResult, ExtractResult>({
    runtimeMode: runtime.v2.runtimeMode,
    runV1: async input => this._runV1(input.url, input.goal),
    extractV1: async input => this._extractV1(input.url, input.instruction, input.schemaDescription, input.parseResult),
    runV2Diagnostic: async input => this._runV2Diagnostic(input.url, input.goal),
    extractV2Diagnostic: async input => this._extractV2Diagnostic(input.url, input.instruction, input.schemaDescription),
    runV2Agent: async input => this._runV2Agent(input.url, input.goal),
    extractV2Agent: async input => this._extractV2Agent(input.url, input.instruction, input.schemaDescription, input.parseResult),
  });

  return adapter.run({ url: first, goal: second });
}
```

Add this private method to `src/BrowseGent.ts`:

```ts
private async _runTaskFirstAgent(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult> {
  const runtime = getRuntimeConfig();
  const model = resolveLlmSelection(options.model ?? this.opts.model).modelId;
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: this.opts.maxSteps,
    defaultModel: model,
    defaultTraceDir: runtime.v2.traceDir,
    runtimeHeaded: runtime.v2.headed,
  });

  return runner.run(task, options);
}
```

Modify `src/index.ts`:

```ts
export { BrowseGent } from './BrowseGent';
export type { BrowseGentOptions, RunResult, ExtractResult } from './BrowseGent';
export type {
  BrowserAgentBrowserOptions,
  BrowserAgentOutputMode,
  BrowserAgentRunOptions,
  BrowserAgentRunResult,
  BrowserAgentTraceOptions,
  BrowserAgentViewport,
} from './v2/public/types';
```

- [ ] **Step 4: Run the focused test and existing public agent integration test**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicTaskApi.test.ts
node .\node_modules\tsx\dist\cli.cjs --test tests\integration\v2\publicAgentMode.test.ts
```

Expected: both pass. Existing `(url, goal)` behavior remains covered by `publicAgentMode.test.ts`.

## Task 4: Benchmark Contracts, Scoring, and Reports

**Files:**

- Create: `tests/benchmark/v2/types.ts`
- Create: `tests/benchmark/v2/scoring.ts`
- Create: `tests/benchmark/v2/report.ts`
- Test: `tests/unit/v2/benchmarkScoring.test.ts`
- Test: `tests/unit/v2/benchmarkReport.test.ts`

- [ ] **Step 1: Write scoring tests**

Create `tests/unit/v2/benchmarkScoring.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreBenchmarkResult } from '../../benchmark/v2/scoring';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'fixture_static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: {
    minLength: 3,
    requireAny: ['answer', '\\$9'],
    forbid: ['error', 'captcha'],
  },
};

test('scoreBenchmarkResult passes when value and trace audit pass', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: true,
    value: 'answer is $9',
    tracePath: 'logs/trace.json',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 25 },
  }, { ok: true, errors: [] });

  assert.equal(scored.passed, true);
  assert.equal(scored.validation.passed, true);
  assert.equal(scored.trace.ok, true);
});

test('scoreBenchmarkResult records validation and trace failures', () => {
  const scored = scoreBenchmarkResult(task, {
    adapterId: 'browsegent',
    taskId: task.taskId,
    attempt: 1,
    success: true,
    value: 'captcha blocked',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 25 },
  }, { ok: false, errors: ['missing_trace_path'] });

  assert.equal(scored.passed, false);
  assert.equal(scored.validation.passed, false);
  assert.match(scored.validation.reasons.join('\n'), /forbid/);
  assert.equal(scored.trace.ok, false);
  assert.deepEqual(scored.trace.errors, ['missing_trace_path']);
});
```

- [ ] **Step 2: Write report aggregation tests**

Create `tests/unit/v2/benchmarkReport.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBenchmarkReport } from '../../benchmark/v2/report';
import type { ScoredBenchmarkResult } from '../../benchmark/v2/types';

function result(overrides: Partial<ScoredBenchmarkResult>): ScoredBenchmarkResult {
  return {
    adapterId: 'browsegent',
    taskId: 'task_1',
    attempt: 1,
    success: true,
    passed: true,
    value: 'ok',
    metrics: { plannerCalls: 1, toolExecutions: 1, durationMs: 10 },
    validation: { passed: true, reasons: [], preview: 'ok' },
    trace: { ok: true, errors: [] },
    failureType: undefined,
    failureReason: undefined,
    ...overrides,
  };
}

test('buildBenchmarkReport aggregates pass, trace, failure, and cost-neutral metrics', () => {
  const report = buildBenchmarkReport({
    runId: 'bench_unit',
    adapterId: 'browsegent',
    startedAt: '2026-05-24T00:00:00.000Z',
    completedAt: '2026-05-24T00:00:01.000Z',
    model: 'gemini/gemini-3.1-flash-lite',
    results: [
      result({ taskId: 'a', passed: true, metrics: { plannerCalls: 1, toolExecutions: 2, durationMs: 10 } }),
      result({
        taskId: 'b',
        success: false,
        passed: false,
        failureType: 'action_error',
        failureReason: 'target_blocked',
        trace: { ok: false, errors: ['missing_mutation_evidence'] },
        metrics: { plannerCalls: 2, toolExecutions: 3, durationMs: 30 },
      }),
    ],
  });

  assert.equal(report.summary.totalRuns, 2);
  assert.equal(report.summary.passedRuns, 1);
  assert.equal(report.summary.passRate, 0.5);
  assert.equal(report.summary.traceCompleteRate, 0.5);
  assert.equal(report.summary.avgPlannerCalls, 1.5);
  assert.equal(report.summary.avgToolExecutions, 2.5);
  assert.equal(report.summary.avgDurationMs, 20);
  assert.equal(report.summary.failureTypes.action_error, 1);
});
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\benchmarkScoring.test.ts tests\unit\v2\benchmarkReport.test.ts
```

Expected: fail because benchmark modules do not exist.

- [ ] **Step 4: Create benchmark types**

Create `tests/benchmark/v2/types.ts`:

```ts
export type BenchmarkDifficulty = 'extraction' | 'navigation' | 'interaction' | 'recovery' | 'adversarial';

export type BenchmarkFailureType =
  | 'perception_error'
  | 'action_error'
  | 'planning_error'
  | 'environment_block'
  | 'validation_error'
  | 'trace_error'
  | 'runtime_crash'
  | 'unknown';

export interface BenchmarkValidationSpec {
  minLength?: number;
  requireAny?: string[];
  requireAll?: string[];
  forbid?: string[];
}

export interface BenchmarkTask {
  taskId: string;
  category: string;
  difficulty: BenchmarkDifficulty;
  url: string;
  goal: string;
  validation: BenchmarkValidationSpec;
  maxSteps?: number;
}

export interface BenchmarkAdapterRunOptions {
  runId: string;
  attempt: number;
  model?: string;
  maxSteps?: number;
  traceDir: string;
  headed: boolean;
}

export interface BenchmarkAdapterResult {
  adapterId: string;
  taskId: string;
  attempt: number;
  success: boolean;
  value: string;
  tracePath?: string;
  failureReason?: string;
  failureType?: BenchmarkFailureType;
  metrics: {
    plannerCalls: number;
    toolExecutions: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface BenchmarkAdapter {
  adapterId: string;
  run(task: BenchmarkTask, options: BenchmarkAdapterRunOptions): Promise<BenchmarkAdapterResult>;
}

export interface BenchmarkValidationResult {
  passed: boolean;
  reasons: string[];
  preview: string;
}

export interface BenchmarkTraceScore {
  ok: boolean;
  errors: string[];
}

export interface ScoredBenchmarkResult extends BenchmarkAdapterResult {
  passed: boolean;
  validation: BenchmarkValidationResult;
  trace: BenchmarkTraceScore;
}

export interface BenchmarkReport {
  runId: string;
  adapterId: string;
  startedAt: string;
  completedAt: string;
  model?: string;
  summary: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    passRate: number;
    traceCompleteRate: number;
    avgPlannerCalls: number;
    avgToolExecutions: number;
    avgDurationMs: number;
    failureTypes: Record<string, number>;
  };
  results: ScoredBenchmarkResult[];
}
```

- [ ] **Step 5: Implement scoring and reporting**

Create `tests/benchmark/v2/scoring.ts`:

```ts
import type { BenchmarkAdapterResult, BenchmarkTask, BenchmarkTraceScore, BenchmarkValidationResult, ScoredBenchmarkResult } from './types';

export function scoreBenchmarkResult(
  task: BenchmarkTask,
  result: BenchmarkAdapterResult,
  trace: BenchmarkTraceScore,
): ScoredBenchmarkResult {
  const validation = validateValue(task, result.value);
  const passed = result.success && validation.passed && trace.ok;

  return {
    ...result,
    passed,
    validation,
    trace,
    failureType: result.failureType ?? inferFailureType(result, validation, trace),
  };
}

function validateValue(task: BenchmarkTask, value: string): BenchmarkValidationResult {
  const reasons: string[] = [];
  const normalized = value.trim();
  const spec = task.validation;

  if (spec.minLength !== undefined && normalized.length < spec.minLength) {
    reasons.push(`minLength:${spec.minLength}`);
  }

  if (spec.requireAny && spec.requireAny.length > 0 && !spec.requireAny.some(pattern => new RegExp(pattern, 'i').test(normalized))) {
    reasons.push(`requireAny:${spec.requireAny.join('|')}`);
  }

  if (spec.requireAll) {
    for (const pattern of spec.requireAll) {
      if (!new RegExp(pattern, 'i').test(normalized)) {
        reasons.push(`requireAll:${pattern}`);
      }
    }
  }

  if (spec.forbid) {
    for (const pattern of spec.forbid) {
      if (new RegExp(pattern, 'i').test(normalized)) {
        reasons.push(`forbid:${pattern}`);
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    preview: normalized.slice(0, 240),
  };
}

function inferFailureType(
  result: BenchmarkAdapterResult,
  validation: BenchmarkValidationResult,
  trace: BenchmarkTraceScore,
): ScoredBenchmarkResult['failureType'] {
  if (!trace.ok) return 'trace_error';
  if (!validation.passed) return 'validation_error';
  if (result.failureReason?.match(/blocked|hidden|disabled|stale|target/i)) return 'action_error';
  if (result.failureReason?.match(/captcha|access denied/i)) return 'environment_block';
  if (!result.success) return 'unknown';
  return undefined;
}
```

Create `tests/benchmark/v2/report.ts`:

```ts
import type { BenchmarkReport, ScoredBenchmarkResult } from './types';

export interface BuildBenchmarkReportInput {
  runId: string;
  adapterId: string;
  startedAt: string;
  completedAt: string;
  model?: string;
  results: ScoredBenchmarkResult[];
}

export function buildBenchmarkReport(input: BuildBenchmarkReportInput): BenchmarkReport {
  const totalRuns = input.results.length;
  const passedRuns = input.results.filter(result => result.passed).length;
  const traceCompleteRuns = input.results.filter(result => result.trace.ok).length;

  return {
    runId: input.runId,
    adapterId: input.adapterId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    model: input.model,
    summary: {
      totalRuns,
      passedRuns,
      failedRuns: totalRuns - passedRuns,
      passRate: ratio(passedRuns, totalRuns),
      traceCompleteRate: ratio(traceCompleteRuns, totalRuns),
      avgPlannerCalls: average(input.results.map(result => result.metrics.plannerCalls)),
      avgToolExecutions: average(input.results.map(result => result.metrics.toolExecutions)),
      avgDurationMs: average(input.results.map(result => result.metrics.durationMs)),
      failureTypes: countFailureTypes(input.results),
    },
    results: input.results,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function countFailureTypes(results: ScoredBenchmarkResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (!result.passed) {
      const key = result.failureType ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}
```

- [ ] **Step 6: Run focused tests and confirm pass**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\benchmarkScoring.test.ts tests\unit\v2\benchmarkReport.test.ts
```

Expected: pass.

## Task 5: BrowseGent Benchmark Adapter

**Files:**

- Create: `tests/benchmark/v2/adapters/BrowseGentAdapter.ts`
- Test: `tests/unit/v2/browseGentBenchmarkAdapter.test.ts`

- [ ] **Step 1: Write adapter mapping test**

Create `tests/unit/v2/browseGentBenchmarkAdapter.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowseGentBenchmarkAdapter } from '../../benchmark/v2/adapters/BrowseGentAdapter';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: { minLength: 2 },
};

test('BrowseGentBenchmarkAdapter maps benchmark tasks to public task API calls', async () => {
  const calls: unknown[] = [];
  const adapter = new BrowseGentBenchmarkAdapter({
    clientFactory: () => ({
      run: async (goal: string, options: unknown) => {
        calls.push({ goal, options });
        return {
          success: true,
          value: 'answer',
          tracePath: 'logs/v2-runs/trace.json',
          warnings: [],
          metrics: {
            plannerCalls: 2,
            inputTokens: 10,
            outputTokens: 5,
            plannerDurationMs: 20,
            toolExecutions: 1,
          },
        };
      },
    }),
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    maxSteps: 4,
    traceDir: 'logs/bench',
    headed: false,
  });

  assert.equal(result.adapterId, 'browsegent');
  assert.equal(result.taskId, 'static_read');
  assert.equal(result.success, true);
  assert.equal(result.value, 'answer');
  assert.equal(result.tracePath, 'logs/v2-runs/trace.json');
  assert.equal(result.metrics.plannerCalls, 2);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.deepEqual(calls[0], {
    goal: 'Read answer',
    options: {
      url: 'file:///fixture.html',
      model: 'gemini/gemini-3.1-flash-lite',
      maxSteps: 4,
      browser: { headless: true },
      trace: { dir: 'logs/bench', runId: 'bench_unit_static_read_a1' },
      output: 'text',
    },
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\browseGentBenchmarkAdapter.test.ts
```

Expected: fail because the adapter does not exist.

- [ ] **Step 3: Implement the adapter**

Create `tests/benchmark/v2/adapters/BrowseGentAdapter.ts`:

```ts
import { BrowseGent } from '../../../../src/BrowseGent';
import type { BrowserAgentRunOptions, BrowserAgentRunResult } from '../../../../src';
import type { BenchmarkAdapter, BenchmarkAdapterRunOptions, BenchmarkAdapterResult, BenchmarkTask } from '../types';

export interface BrowseGentBenchmarkAdapterOptions {
  clientFactory?: () => {
    run(task: string, options: BrowserAgentRunOptions): Promise<BrowserAgentRunResult>;
  };
}

export class BrowseGentBenchmarkAdapter implements BenchmarkAdapter {
  readonly adapterId = 'browsegent';

  constructor(private readonly options: BrowseGentBenchmarkAdapterOptions = {}) {}

  async run(task: BenchmarkTask, options: BenchmarkAdapterRunOptions): Promise<BenchmarkAdapterResult> {
    const startedAt = Date.now();
    const client = this.options.clientFactory?.() ?? new BrowseGent({ maxSteps: options.maxSteps ?? task.maxSteps ?? 8, warmup: false });

    try {
      const result = await client.run(task.goal, {
        url: task.url,
        model: options.model,
        maxSteps: options.maxSteps ?? task.maxSteps,
        browser: { headless: !options.headed },
        trace: { dir: options.traceDir, runId: `${options.runId}_${task.taskId}_a${options.attempt}` },
        output: 'text',
      });

      return {
        adapterId: this.adapterId,
        taskId: task.taskId,
        attempt: options.attempt,
        success: result.success,
        value: result.value,
        tracePath: result.tracePath,
        failureReason: result.failureReason,
        metrics: {
          plannerCalls: result.metrics.plannerCalls,
          toolExecutions: result.metrics.toolExecutions,
          durationMs: Date.now() - startedAt,
          inputTokens: result.metrics.inputTokens,
          outputTokens: result.metrics.outputTokens,
        },
      };
    } catch (error) {
      return {
        adapterId: this.adapterId,
        taskId: task.taskId,
        attempt: options.attempt,
        success: false,
        value: '',
        failureReason: error instanceof Error ? error.message : String(error),
        failureType: 'runtime_crash',
        metrics: {
          plannerCalls: 0,
          toolExecutions: 0,
          durationMs: Date.now() - startedAt,
        },
      };
    }
  }
}
```

- [ ] **Step 4: Run focused test and confirm pass**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\browseGentBenchmarkAdapter.test.ts
```

Expected: pass.

## Task 6: Local Benchmark Tasks and Runner CLI

**Files:**

- Create: `tests/benchmark/v2/local_tasks.ts`
- Create: `tests/benchmark/v2/run_benchmark.ts`
- Modify: `package.json`
- Test: `tests/unit/v2/benchmarkRunnerSmoke.test.ts`

- [ ] **Step 1: Write runner smoke test with fake adapter**

Create `tests/unit/v2/benchmarkRunnerSmoke.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runBenchmark } from '../../benchmark/v2/run_benchmark';
import type { BenchmarkAdapter } from '../../benchmark/v2/types';

test('runBenchmark writes report and scored results with a fake adapter', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'benchmark-runner-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const fakeAdapter: BenchmarkAdapter = {
    adapterId: 'fake',
    run: async (task, options) => ({
      adapterId: 'fake',
      taskId: task.taskId,
      attempt: options.attempt,
      success: true,
      value: 'Fixture page is visible',
      tracePath: undefined,
      metrics: { plannerCalls: 1, toolExecutions: 0, durationMs: 5 },
    }),
  };

  const summary = await runBenchmark({
    runId: 'benchmark_unit',
    outputRoot,
    adapter: fakeAdapter,
    tasks: [{
      taskId: 'static_visible',
      category: 'local_fixture',
      difficulty: 'extraction',
      url: 'file:///fixture.html',
      goal: 'Report visible page',
      validation: { requireAny: ['visible'] },
    }],
    repeat: 1,
    traceAudit: async () => ({ ok: true, errors: [] }),
  });

  assert.equal(summary.summary.totalRuns, 1);
  assert.equal(summary.summary.passedRuns, 1);

  const report = JSON.parse(await readFile(join(outputRoot, 'benchmark_unit', 'report.json'), 'utf8'));
  assert.equal(report.runId, 'benchmark_unit');
  assert.equal(report.results[0].passed, true);
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\benchmarkRunnerSmoke.test.ts
```

Expected: fail because runner modules do not exist.

- [ ] **Step 3: Create local task registry**

Create `tests/benchmark/v2/local_tasks.ts`:

```ts
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BenchmarkTask } from './types';

function fixtureUrl(name: string): string {
  return pathToFileURL(resolve('tests/fixtures/v2', name)).toString();
}

export const LOCAL_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    taskId: 'static_controls_visible',
    category: 'local_fixture',
    difficulty: 'extraction',
    url: fixtureUrl('static-controls.html'),
    goal: 'Report that the static controls page is visible',
    validation: { minLength: 2, requireAny: ['visible', 'static', 'controls'], forbid: ['error', 'captcha'] },
    maxSteps: 4,
  },
  {
    taskId: 'modal_open',
    category: 'local_fixture',
    difficulty: 'interaction',
    url: fixtureUrl('modal.html'),
    goal: 'Open the modal and report that it opened',
    validation: { minLength: 2, requireAny: ['modal', 'opened', 'open'], forbid: ['error', 'captcha'] },
    maxSteps: 5,
  },
  {
    taskId: 'spa_navigation',
    category: 'local_fixture',
    difficulty: 'navigation',
    url: fixtureUrl('spa-route.html'),
    goal: 'Navigate to the SPA fixture route and report the transition',
    validation: { minLength: 2, requireAny: ['route', 'transition', 'spa'], forbid: ['error', 'captcha'] },
    maxSteps: 5,
  },
  {
    taskId: 'blocked_overlay',
    category: 'local_fixture',
    difficulty: 'recovery',
    url: fixtureUrl('blocked-overlay.html'),
    goal: 'Attempt the blocked control and report the mechanical block honestly',
    validation: { minLength: 2, requireAny: ['blocked', 'overlay', 'cannot', 'target'], forbid: ['site-specific'] },
    maxSteps: 5,
  },
];
```

- [ ] **Step 4: Implement benchmark runner**

Create `tests/benchmark/v2/run_benchmark.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { auditTraceReplay } from '../../../src/v2';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import { buildBenchmarkReport } from './report';
import { scoreBenchmarkResult } from './scoring';
import { LOCAL_BENCHMARK_TASKS } from './local_tasks';
import type { BenchmarkAdapter, BenchmarkReport, BenchmarkTask, BenchmarkTraceScore } from './types';

export interface RunBenchmarkOptions {
  runId?: string;
  outputRoot?: string;
  adapter?: BenchmarkAdapter;
  tasks?: BenchmarkTask[];
  model?: string;
  repeat?: number;
  count?: number;
  headed?: boolean;
  traceAudit?: (tracePath: string | undefined, expectedPlannerCalls: number, expectedToolExecutions: number) => Promise<BenchmarkTraceScore>;
}

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<BenchmarkReport> {
  const runId = options.runId ?? `benchmark_${Date.now()}`;
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'v2-benchmark');
  const runRoot = join(outputRoot, runId);
  const traceDir = join(runRoot, 'traces');
  const adapter = options.adapter ?? new BrowseGentBenchmarkAdapter();
  const tasks = (options.tasks ?? LOCAL_BENCHMARK_TASKS).slice(0, options.count);
  const repeat = Math.max(1, options.repeat ?? 1);
  const startedAt = new Date().toISOString();
  const scoredResults = [];

  await mkdir(runRoot, { recursive: true });

  for (const task of tasks) {
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const result = await adapter.run(task, {
        runId,
        attempt,
        model: options.model,
        maxSteps: task.maxSteps,
        traceDir,
        headed: options.headed ?? false,
      });
      const trace = await (options.traceAudit ?? auditBenchmarkTrace)(
        result.tracePath,
        Math.max(1, result.metrics.plannerCalls),
        result.metrics.toolExecutions,
      );
      scoredResults.push(scoreBenchmarkResult(task, result, trace));
    }
  }

  const report = buildBenchmarkReport({
    runId,
    adapterId: adapter.adapterId,
    startedAt,
    completedAt: new Date().toISOString(),
    model: options.model,
    results: scoredResults,
  });

  await writeFile(join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(runRoot, 'summary.md'), renderMarkdownSummary(report), 'utf8');
  return report;
}

async function auditBenchmarkTrace(
  tracePath: string | undefined,
  expectedPlannerCalls: number,
  expectedToolExecutions: number,
): Promise<BenchmarkTraceScore> {
  if (!tracePath) return { ok: false, errors: ['missing_trace_path'] };
  const audit = await auditTraceReplay({
    tracePath,
    expectedPlannerCalls,
    expectedToolExecutions,
    requireAgentMode: true,
  });
  return { ok: audit.ok, errors: audit.errors };
}

function renderMarkdownSummary(report: BenchmarkReport): string {
  return [
    `# BrowseGent v2 Benchmark ${report.runId}`,
    '',
    `Adapter: ${report.adapterId}`,
    `Model: ${report.model ?? 'default'}`,
    `Runs: ${report.summary.totalRuns}`,
    `Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
    `Trace complete rate: ${(report.summary.traceCompleteRate * 100).toFixed(1)}%`,
    `Avg planner calls: ${report.summary.avgPlannerCalls.toFixed(2)}`,
    `Avg tool executions: ${report.summary.avgToolExecutions.toFixed(2)}`,
    '',
  ].join('\n');
}

if (require.main === module) {
  const model = process.argv.find(arg => !arg.startsWith('--') && !arg.endsWith('run_benchmark.ts'));
  const countArg = readFlag('--count');
  const repeatArg = readFlag('--repeat');
  runBenchmark({
    model,
    count: countArg ? Number(countArg) : undefined,
    repeat: repeatArg ? Number(repeatArg) : undefined,
  })
    .then(report => {
      console.log(JSON.stringify(report.summary, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
```

Modify `package.json` scripts:

```json
"benchmark:v2": "tsx tests/benchmark/v2/run_benchmark.ts"
```

- [ ] **Step 5: Run focused test and command smoke**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\benchmarkRunnerSmoke.test.ts
npm run benchmark:v2 -- --count 1 --repeat 1
```

Expected: unit test passes. Benchmark command writes `logs/v2-benchmark/<runId>/report.json`; live result may pass or fail depending on provider and planner behavior, but it must produce a structured report.

## Task 7: Documentation and Verification

**Files:**

- Create: `docs/evaluation/v2-mvr-benchmarking.md`

- [ ] **Step 1: Write evaluation guide**

Create `docs/evaluation/v2-mvr-benchmarking.md`:

```md
# BrowseGent v2 MVR Testing and Benchmarking

## Local Correctness Gate

Run:

```powershell
npm run check:v2:release
```

This proves build, unit tests, governance checks, integration tests, continuity stress, agent smoke, and trace replay behavior.

## Local Benchmark

Run:

```powershell
npm run benchmark:v2 -- --count 4 --repeat 1
```

Provider-backed runs read model and keys from local environment or `.env`. Do not put keys in commands, reports, docs, or committed files.

## Output

Reports are written under:

```text
logs/v2-benchmark/<runId>/report.json
logs/v2-benchmark/<runId>/summary.md
```

Each result includes task id, adapter id, success, validation, trace audit status, failure type, planner calls, tool executions, duration, and trace path.

## Anti-Overfitting Rule

Benchmark failures must be fixed through the generic failure-class funnel:

```text
benchmark failure
  -> inspect trace
  -> classify generic mechanism
  -> reproduce in local fixture
  -> add failing test
  -> implement bounded fix
  -> rerun local gate
  -> rerun benchmark split
```

Forbidden fixes include site-specific selectors, benchmark-keyword prompt tuning, hidden answer shortcuts, and domain-specific runtime branches.
```

- [ ] **Step 2: Run verification**

Run:

```powershell
node .\node_modules\tsx\dist\cli.cjs --test tests\unit\v2\publicAgentRunner.test.ts tests\unit\v2\publicTaskApi.test.ts tests\unit\v2\benchmarkScoring.test.ts tests\unit\v2\benchmarkReport.test.ts tests\unit\v2\browseGentBenchmarkAdapter.test.ts tests\unit\v2\benchmarkRunnerSmoke.test.ts
npm run build
npm run test:unit
npm run check:v2:release
```

Expected: all commands pass. If provider-backed benchmark smoke fails due provider/network/model behavior, keep the structured report and classify the failure; do not tune runtime from that single result.

## Self-Review Checklist

- Stage A has task, adapter, scoring, report, runner, and local registry coverage.
- Stage B has public types, runner, BrowseGent overload, and export coverage.
- Existing `BrowseGent.run(url, goal)` remains covered by integration tests.
- Benchmark code does not alter runtime behavior.
- Public API warnings expose unsupported options honestly.
- Trace replay remains part of benchmark scoring.
- No secrets are written into docs or code.
