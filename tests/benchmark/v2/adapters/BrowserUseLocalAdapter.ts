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

const DEFAULT_BROWSER_USE_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface BrowserUseLocalProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type BrowserUseLocalProcessRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
) => Promise<BrowserUseLocalProcessResult>;

export interface BrowserUseLocalAdapterOptions {
  pythonCommand?: string;
  runnerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  processRunner?: BrowserUseLocalProcessRunner;
}

interface BrowserUseRunnerResult {
  success?: boolean;
  value?: string;
  failureReason?: string;
  failureType?: BenchmarkFailureType;
  metrics?: Partial<BenchmarkAdapterResult['metrics']>;
}

export class BrowserUseLocalAdapter implements BenchmarkAdapter {
  readonly adapterId = 'browser-use-local';
  readonly traceMode = 'external_artifact';

  private readonly pythonCommand: string;
  private readonly runnerPath: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly processRunner: BrowserUseLocalProcessRunner;

  constructor(options: BrowserUseLocalAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.pythonCommand = options.pythonCommand
      ?? this.env.BROWSEGENT_BROWSER_USE_PYTHON
      ?? this.env.BROWSER_USE_PYTHON
      ?? 'python';
    this.runnerPath = options.runnerPath
      ?? resolve(__dirname, 'browser_use_local_runner.py');
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
      BROWSER_USE_CONFIG_DIR: this.env.BROWSER_USE_CONFIG_DIR ?? join(artifactPath, 'browser-use-config'),
    };

    const processResult = await this.processRunner(this.pythonCommand, [
      this.runnerPath,
      '--input',
      inputPath,
      '--output',
      resultPath,
    ], {
      cwd: this.cwd,
      env: processEnv,
      timeoutMs: this.timeoutMs,
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
        failureReason: `Browser Use local runner exited with code ${processResult.exitCode}: ${sanitizedFailureReason}`.trim(),
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
      ?? DEFAULT_BROWSER_USE_GEMINI_MODEL,
  ) ?? DEFAULT_BROWSER_USE_GEMINI_MODEL;
}

async function readRunnerResult(resultPath: string): Promise<BrowserUseRunnerResult | undefined> {
  try {
    await access(resultPath);
    return JSON.parse(await readFile(resultPath, 'utf8')) as BrowserUseRunnerResult;
  } catch {
    return undefined;
  }
}

function metrics(startedAt: number, runnerResult: BrowserUseRunnerResult | undefined): BenchmarkAdapterResult['metrics'] {
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
): Promise<BrowserUseLocalProcessResult> {
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
        stderr: timedOut ? `${stderr}\nBrowser Use local runner timed out.`.trim() : stderr,
      });
    });
  });
}
