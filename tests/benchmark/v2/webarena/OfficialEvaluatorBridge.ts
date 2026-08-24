import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebArenaTaskConfig, WebArenaTrajectoryArtifact } from './webarenaTypes';

export interface WebArenaEvaluatorScore {
  taskId: number;
  score: number;
  rawStdout: string;
}

export interface OfficialEvaluatorBridgeOptions {
  /** Python executable used to invoke the official evaluator. Defaults to `python`. */
  pythonExecutable?: string;
  /**
   * Path to the official evaluator entry script inside the cloned
   * WebArena repository.
   */
  evaluatorScriptPath: string;
  /** Hard kill threshold for one evaluator invocation. */
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

/**
 * Thin bridge to the OFFICIAL upstream evaluator. This module never interprets
 * correctness itself — it hands the audited upstream pipeline a config file plus
 * a trajectory artifact and relays the score it prints.
 */
export class OfficialEvaluatorBridge {
  constructor(private readonly options: OfficialEvaluatorBridgeOptions) {}

  async evaluate(
    config: WebArenaTaskConfig,
    artifactPath: string,
  ): Promise<WebArenaEvaluatorScore> {
    // Upstream CLIs take file paths, and inline JSON breaks Windows argv length
    // limits — always stage the config on disk.
    const stagingDir = await mkdtemp(join(tmpdir(), 'webarena-eval-'));
    const configPath = join(stagingDir, 'task_config.json');
    try {
      await writeFile(configPath, JSON.stringify(config), 'utf8');
      const args = [
        this.options.evaluatorScriptPath,
        '--config_file', configPath,
        '--trajectory', artifactPath,
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
      const child = spawnImpl(command, args, { shell: false });
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

const EVALUATOR_TIMEOUT_MS = 120_000;

/**
 * Strictly parses the evaluator's reported score. Accepts a standalone numeric
 * line or an explicit "score: X"/"result = X" label; anything else throws rather
 * than silently coercing to zero. Deliberately does NOT scan arbitrary numbers —
 * log noise must never become a score.
 */
export function parseEvaluatorScore(stdout: string): number {
  const labeled = stdout.match(/(?:^|\n)\s*(?:score|result)\s*[:=]\s*(\d(?:\.\d+)?)\s*(?:\n|$)/i);
  if (labeled) return Number.parseFloat(labeled[1]);
  const bare = stdout.match(/(?:^|\n)\s*(\d(?:\.\d+)?)\s*(?:\n|$)/);
  if (bare) return Number.parseFloat(bare[1]);
  throw new Error(`unparsable_evaluator_output:${stdout.slice(0, 200)}`);
}
