# Alumnium Benchmark Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local adapter for the Alumnium framework, enabling direct side-by-side benchmarking and telemetry comparison (token costs, steps, duration) against Browser-Use and BrowseGent.

**Architecture:** Create a Playwright-driven Python runner (`alumnium_runner.py`) that instantiates the Alumnium client layer and executes browser actions autonomously. A Node-side adapter (`AlumniumAdapter.ts`) launches this runner as a child process and reads back execution and token telemetry.

**Tech Stack:** TypeScript, Python, Alumnium, Playwright, Node.js child_process.

---

## File Structure Map
*   [NEW] `tests/benchmark/v2/adapters/AlumniumAdapter.ts`: Node-side adapter class wrapping Alumnium's runner execution.
*   [NEW] `tests/benchmark/v2/adapters/alumnium_runner.py`: Python runner wrapper that runs the Alumnium client and exports execution telemetry.
*   [MODIFY] `tests/benchmark/v2/adapter_factory.ts`: Registers `alumnium-local` as a valid benchmark adapter.
*   [NEW] `tests/unit/v2/alumniumAdapter.test.ts`: Unit test file verifying telemetry parsing, model resolution, and environment variables.

---

### Task 1: Create the Python Alumnium Runner

**Files:**
- Create: `tests/benchmark/v2/adapters/alumnium_runner.py`

- [ ] **Step 1: Write the python runner code**
Create `tests/benchmark/v2/adapters/alumnium_runner.py` with the following implementation:

```python
import argparse
import asyncio
import json
import os
import time
import traceback
from pathlib import Path
from typing import Any

def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

def classify_failure(message: str) -> str:
    lowered = message.lower()
    if "rate" in lowered or "quota" in lowered or "429" in lowered or "resource_exhausted" in lowered:
        return "rate_limited"
    if "captcha" in lowered or "verification required" in lowered or "access denied" in lowered or "challenge" in lowered:
        return "environment_block"
    if "planner" in lowered or "schema" in lowered or "invalid" in lowered:
        return "planning_error"
    return "runtime_crash"

def normalize_gemini_model_name(model: Any) -> str:
    value = str(model or os.environ.get("BROWSEGENT_GEMINI_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-3.1-flash-lite")
    return value.removeprefix("gemini/")

async def run_alumnium(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    try:
        from alumnium import Alumni
        from playwright.async_api import async_playwright

        model_name = normalize_gemini_model_name(payload.get("model"))
        # Force Google Gemini configurations in environment variables
        os.environ["ALUMNIUM_MODEL"] = f"google/{model_name}"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not bool(payload.get("headed")))
            context = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await context.new_page()

            # Initialize Alumnium client (Python client starts/resolves backend automatically)
            loop = asyncio.get_running_loop()
            al = Alumni((page, loop))

            # Navigate to the task's starting URL
            await page.goto(payload["url"])

            # 1. Execute task actions autonomously
            do_result = al.do(payload["goal"])

            # 2. Extract final answer from the page state using AI
            answer = al.get(payload["goal"])

            # 3. Extract telemetry from Alumnium stats property
            input_tokens = 0
            output_tokens = 0
            try:
                stats = al.client.stats
                input_tokens = stats.get("total", {}).get("input_tokens", 0)
                output_tokens = stats.get("total", {}).get("output_tokens", 0)
            except Exception:
                pass

            step_count = len(do_result.steps) + 1  # Action steps + extraction step

            write_json(output_path, {
                "success": bool(str(answer).strip()),
                "value": str(answer),
                "metrics": {
                    "plannerCalls": step_count,
                    "toolExecutions": step_count,
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                },
            })
            al.quit()
            await browser.close()
            return 0

    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        write_json(output_path, {
            "success": False,
            "value": "",
            "failureReason": message,
            "failureType": classify_failure(message),
            "traceback": traceback.format_exc(),
            "metrics": {
                "plannerCalls": 0,
                "toolExecutions": 0,
            },
        })
        return 1

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    return asyncio.run(run_alumnium(Path(args.input), Path(args.output)))

if __name__ == "__main__":
    raise SystemExit(main())
```

---

### Task 2: Create the Node-side Alumnium Adapter

**Files:**
- Create: `tests/benchmark/v2/adapters/AlumniumAdapter.ts`

- [ ] **Step 1: Write the TS adapter code**
Create `tests/benchmark/v2/adapters/AlumniumAdapter.ts` with the following implementation:

```typescript
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { collectGeminiKeyPool, redactSecrets } from '../gemini_key_pool';
import type {
  BenchmarkAdapter,
  BenchmarkAdapterRunOptions,
  BenchmarkAdapterResult,
  BenchmarkFailureType,
  BenchmarkTask,
} from '../types';

const DEFAULT_ALUMNIUM_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface AlumniumProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AlumniumProcessRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
) => Promise<AlumniumProcessResult>;

export interface AlumniumAdapterOptions {
  pythonCommand?: string;
  runnerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  processRunner?: AlumniumProcessRunner;
}

interface AlumniumRunnerResult {
  success?: boolean;
  value?: string;
  failureReason?: string;
  failureType?: BenchmarkFailureType;
  metrics?: Partial<BenchmarkAdapterResult['metrics']>;
}

export class AlumniumAdapter implements BenchmarkAdapter {
  readonly adapterId = 'alumnium-local';
  readonly traceMode = 'external_artifact';

  private readonly pythonCommand: string;
  private readonly runnerPath: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly processRunner: AlumniumProcessRunner;

  constructor(options: AlumniumAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.pythonCommand = options.pythonCommand
      ?? this.env.BROWSEGENT_BROWSER_USE_PYTHON
      ?? this.env.BROWSER_USE_PYTHON
      ?? 'python';
    this.runnerPath = options.runnerPath
      ?? resolve(__dirname, 'alumnium_runner.py');
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.processRunner = options.processRunner ?? spawnProcess;
  }

  async run(task: BenchmarkTask, options: BenchmarkAdapterRunOptions): Promise<BenchmarkAdapterResult> {
    const startedAt = Date.now();
    const artifactPath = join(
      options.traceDir,
      'external',
      this.adapterId,
      `${options.runId}_${task.taskId}_a${options.attempt}`,
    );
    const inputPath = join(artifactPath, 'input.json');
    const resultPath = join(artifactPath, 'result.json');
    const stdoutPath = join(artifactPath, 'stdout.txt');
    const stderrPath = join(artifactPath, 'stderr.txt');
    const secrets = collectGeminiKeyPool(this.env).map(entry => entry.value);

    await mkdir(artifactPath, { recursive: true });
    await writeFile(inputPath, `${JSON.stringify({
      taskId: task.taskId,
      url: task.url,
      goal: task.goal,
      model: resolveGeminiModelName(options.model, this.env),
      maxSteps: options.maxSteps ?? task.maxSteps ?? 8,
      headed: options.headed,
      requestMinIntervalMs: options.requestMinIntervalMs,
    }, null, 2)}\n`, 'utf8');

    const processEnv: NodeJS.ProcessEnv = {
      ...this.env,
      BROWSER_USE_CONFIG_DIR: this.env.BROWSER_USE_CONFIG_DIR ?? join(artifactPath, 'alumnium-config'),
    };

    const requestMinIntervalMs = options.requestMinIntervalMs ?? 0;
    const maxSteps = options.maxSteps ?? task.maxSteps ?? 8;
    const dynamicTimeoutMs = Math.max(
      this.timeoutMs,
      (requestMinIntervalMs * maxSteps) + 180_000
    );

    const processResult = await this.processRunner(this.pythonCommand, [
      this.runnerPath,
      '--input',
      inputPath,
      '--output',
      resultPath,
    ], {
      cwd: this.cwd,
      env: processEnv,
      timeoutMs: dynamicTimeoutMs,
    });

    await writeFile(stdoutPath, redactSecrets(processResult.stdout, secrets), 'utf8');
    await writeFile(stderrPath, redactSecrets(processResult.stderr, secrets), 'utf8');

    const runnerResult = await readRunnerResult(resultPath);
    const sanitizedFailureReason = redactSecrets(
      runnerResult?.failureReason
        ?? runnerResult?.value
        ?? processResult.stderr
        ?? processResult.stdout,
      secrets,
    );

    if (processResult.exitCode !== 0) {
      return {
        adapterId: this.adapterId,
        taskId: task.taskId,
        attempt: options.attempt,
        success: false,
        value: runnerResult?.value ?? '',
        artifactPath,
        failureReason: `Alumnium local runner exited with code ${processResult.exitCode}: ${sanitizedFailureReason}`.trim(),
        failureType: runnerResult?.failureType ?? 'runtime_crash',
        metrics: metrics(startedAt, runnerResult),
      };
    }

    return {
      adapterId: this.adapterId,
      taskId: task.taskId,
      attempt: options.attempt,
      success: runnerResult?.success === true,
      value: runnerResult?.value ?? '',
      artifactPath,
      failureReason: runnerResult?.failureReason ? redactSecrets(runnerResult.failureReason, secrets) : undefined,
      failureType: runnerResult?.failureType,
      metrics: metrics(startedAt, runnerResult),
    };
  }
}

function normalizeGeminiModelName(model: string | undefined): string | undefined {
  return model?.replace(/^gemini\//, '');
}

function resolveGeminiModelName(model: string | undefined, env: NodeJS.ProcessEnv): string {
  return normalizeGeminiModelName(
    model
      ?? env.BROWSEGENT_GEMINI_MODEL
      ?? env.GEMINI_MODEL
      ?? DEFAULT_ALUMNIUM_GEMINI_MODEL,
  ) ?? DEFAULT_ALUMNIUM_GEMINI_MODEL;
}

async function readRunnerResult(resultPath: string): Promise<AlumniumRunnerResult | undefined> {
  try {
    await access(resultPath);
    return JSON.parse(await readFile(resultPath, 'utf8')) as AlumniumRunnerResult;
  } catch {
    return undefined;
  }
}

function metrics(startedAt: number, runnerResult: AlumniumRunnerResult | undefined): BenchmarkAdapterResult['metrics'] {
  return {
    plannerCalls: runnerResult?.metrics?.plannerCalls ?? 0,
    toolExecutions: runnerResult?.metrics?.toolExecutions ?? 0,
    durationMs: Date.now() - startedAt,
    inputTokens: runnerResult?.metrics?.inputTokens,
    outputTokens: runnerResult?.metrics?.outputTokens,
  };
}

function spawnProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<AlumniumProcessResult> {
  return new Promise(resolveProcess => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolveProcess({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolveProcess({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut ? `${stderr}\nAlumnium local runner timed out.`.trim() : stderr,
      });
    });
  });
}
```

---

### Task 3: Register the Adapter in the Factory

**Files:**
- Modify: `tests/benchmark/v2/adapter_factory.ts`

- [ ] **Step 1: Edit adapter_factory.ts**
Modify the file to register the `AlumniumAdapter` class:

```typescript
<<<<
import { BrowserUseLocalAdapter } from './adapters/BrowserUseLocalAdapter';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import type { BenchmarkAdapter } from './types';

export type BenchmarkAdapterId = 'browsegent' | 'browser-use-local';
====
import { BrowserUseLocalAdapter } from './adapters/BrowserUseLocalAdapter';
import { AlumniumAdapter } from './adapters/AlumniumAdapter';
import { BrowseGentBenchmarkAdapter } from './adapters/BrowseGentAdapter';
import type { BenchmarkAdapter } from './types';

export type BenchmarkAdapterId = 'browsegent' | 'browser-use-local' | 'alumnium-local';
>>>>
```

```typescript
<<<<
export function createBenchmarkAdapter(
  adapterId: BenchmarkAdapterId = 'browsegent',
  options: CreateBenchmarkAdapterOptions = {},
): BenchmarkAdapter {
  switch (adapterId) {
    case 'browsegent':
      return new BrowseGentBenchmarkAdapter();
    case 'browser-use-local':
      return new BrowserUseLocalAdapter({ env: options.env });
  }
}

export function readBenchmarkAdapterId(value: string | undefined): BenchmarkAdapterId {
  if (value === undefined || value === 'browsegent' || value === 'browser-use-local') {
    return value ?? 'browsegent';
  }
  throw new Error(`Unsupported benchmark adapter "${value}". Use browsegent or browser-use-local.`);
}
====
export function createBenchmarkAdapter(
  adapterId: BenchmarkAdapterId = 'browsegent',
  options: CreateBenchmarkAdapterOptions = {},
): BenchmarkAdapter {
  switch (adapterId) {
    case 'browsegent':
      return new BrowseGentBenchmarkAdapter();
    case 'browser-use-local':
      return new BrowserUseLocalAdapter({ env: options.env });
    case 'alumnium-local':
      return new AlumniumAdapter({ env: options.env });
  }
}

export function readBenchmarkAdapterId(value: string | undefined): BenchmarkAdapterId {
  if (value === undefined || value === 'browsegent' || value === 'browser-use-local' || value === 'alumnium-local') {
    return value ?? 'browsegent';
  }
  throw new Error(`Unsupported benchmark adapter "${value}". Use browsegent, browser-use-local, or alumnium-local.`);
}
>>>>
```

---

### Task 4: Write Unit Tests for the Adapter

**Files:**
- Create: `tests/unit/v2/alumniumAdapter.test.ts`

- [ ] **Step 1: Write the unit test suite**
Create `tests/unit/v2/alumniumAdapter.test.ts` with the following implementation:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AlumniumAdapter } from '../../benchmark/v2/adapters/AlumniumAdapter';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  partition: 'dev',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: { minLength: 2 },
  maxSteps: 4,
};

test('AlumniumAdapter writes sanitized artifacts and maps runner result', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'alumnium-local-adapter-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new AlumniumAdapter({
    pythonCommand: 'python',
    env: { GEMINI_API_KEY: 'secret-key' },
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: true,
        value: 'answer from Alumnium',
        metrics: {
          plannerCalls: 4,
          toolExecutions: 4,
          inputTokens: 25,
          outputTokens: 15,
        },
      }));
      return {
        exitCode: 0,
        stdout: 'stdout secret-key',
        stderr: 'stderr secret-key',
      };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'alumnium-local');
  assert.equal(result.success, true);
  assert.equal(result.value, 'answer from Alumnium');
  assert.equal(result.metrics.plannerCalls, 4);
  assert.equal(result.metrics.toolExecutions, 4);
  assert.equal(result.artifactPath?.includes('alumnium-local'), true);

  const stdout = await readFile(join(result.artifactPath ?? '', 'stdout.txt'), 'utf8');
  const stderr = await readFile(join(result.artifactPath ?? '', 'stderr.txt'), 'utf8');
  assert.equal(stdout, 'stdout [REDACTED_SECRET]');
  assert.equal(stderr, 'stderr [REDACTED_SECRET]');

  const input = JSON.parse(await readFile(join(result.artifactPath ?? '', 'input.json'), 'utf8'));
  assert.equal(input.goal, 'Read answer');
  assert.equal(input.url, 'file:///fixture.html');
  assert.equal(input.model, 'gemini-3.1-flash-lite');
  assert.equal(input.headed, false);
  assert.equal(input.requestMinIntervalMs, 5000);
});
```

- [ ] **Step 2: Run unit tests**
Run: `npm run test:unit tests/unit/v2/alumniumAdapter.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full codebase test suite**
Run: `npm run test:unit`
Expected: 570/570 tests PASS

- [ ] **Step 4: Verify codebase build**
Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Run V2 boundary checks**
Run: `npm run check:v2`
Expected: PASS
