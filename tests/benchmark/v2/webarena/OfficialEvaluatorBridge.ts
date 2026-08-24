import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OFFICIAL_SITE_ENV_VARS,
  WEBARENA_SITE_ENV_VARS,
  type WebArenaSitePlaceholder,
  type WebArenaTaskConfig,
} from './webarenaTypes';

export interface WebArenaEvaluatorScore {
  taskId: number;
  score: number;
  rawStdout: string;
}

export interface OfficialEvaluatorBridgeOptions {
  /** Python executable of the evaluator venv. Defaults to `python`. */
  pythonExecutable?: string;
  /** Our bridge script that imports the OFFICIAL evaluation_harness from `webarenaRepoPath`. */
  bridgeScriptPath: string;
  /** Cloned web-arena-x/webarena checkout supplying the official evaluator code. */
  webarenaRepoPath: string;
  /**
   * Resolved local site base URLs (placeholder → base). Mapped onto the official
   * SHOPPING/REDDIT/... env vars upstream's browser_env.env_config asserts on.
   */
  siteBaseUrls?: Partial<Record<WebArenaSitePlaceholder, string>>;
  /** Hard kill threshold for one evaluator invocation. */
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

/**
 * Thin bridge to the OFFICIAL upstream evaluator pipeline. This module never
 * interprets correctness itself — it stages the task config, hands our Python
 * bridge the artifact, and relays the officially computed score.
 */
export class OfficialEvaluatorBridge {
  constructor(private readonly options: OfficialEvaluatorBridgeOptions) {}

  async evaluate(
    config: WebArenaTaskConfig,
    artifactPath: string,
  ): Promise<WebArenaEvaluatorScore> {
    // Upstream opens the config by path; inline JSON breaks Windows argv length
    // limits — always stage the config on disk.
    const stagingDir = await mkdtemp(join(tmpdir(), 'webarena-eval-'));
    const configPath = join(stagingDir, 'task_config.json');
    try {
      await writeFile(configPath, JSON.stringify(config), 'utf8');
      const args = [
        this.options.bridgeScriptPath,
        '--config-file', configPath,
        '--artifact', artifactPath,
        '--repo-path', this.options.webarenaRepoPath,
      ];
      const stdout = await this.spawnCapture(this.options.pythonExecutable ?? 'python', args);
      return { taskId: config.task_id, score: parseEvaluatorScore(stdout), rawStdout: stdout };
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private spawnCapture(command: string, args: string[]): Promise<string> {
    const spawnImpl = this.options.spawnImpl ?? spawn;
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, {
        shell: false,
        env: buildOfficialEnv(process.env, this.options.siteBaseUrls),
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`official_evaluator_timeout:${this.options.timeoutMs ?? EVALUATOR_TIMEOUT_MS}ms`));
      }, this.options.timeoutMs ?? EVALUATOR_TIMEOUT_MS);
      child.stdout?.on('data', chunk => { stdout += String(chunk); });
      child.stderr?.on('data', chunk => { stderr += String(chunk); });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`official_evaluator_failed:exit_${code}:${stderr.slice(-400)}`));
      });
    });
  }
}

const EVALUATOR_TIMEOUT_MS = 240_000;

/** Maps resolved site URLs onto the official env names upstream asserts on import. */
export function buildOfficialEnv(
  base: NodeJS.ProcessEnv,
  siteBaseUrls?: Partial<Record<WebArenaSitePlaceholder, string>>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const placeholder of Object.keys(WEBARENA_SITE_ENV_VARS) as WebArenaSitePlaceholder[]) {
    const resolved = siteBaseUrls?.[placeholder] ?? base[WEBARENA_SITE_ENV_VARS[placeholder]];
    if (resolved?.trim()) {
      env[OFFICIAL_SITE_ENV_VARS[placeholder]] = resolved.trim();
    }
  }
  return env;
}

/**
 * Strictly parses the bridge's single machine-readable result line
 * (`WEBARENA_EVAL_RESULT:{"score": X}`); anything else throws rather than
 * silently coercing to zero. Log noise must never become a score.
 */
export function parseEvaluatorScore(stdout: string): number {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^WEBARENA_EVAL_RESULT:(.+)$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]) as { score?: unknown };
        if (typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
          return parsed.score;
        }
      } catch {
        // fall through to the throw below
      }
    }
  }
  throw new Error(`unparsable_evaluator_output:${stdout.slice(0, 200)}`);
}
