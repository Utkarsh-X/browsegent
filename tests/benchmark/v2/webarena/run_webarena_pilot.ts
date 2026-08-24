import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowseGent } from '../../../../src/BrowseGent';
import type { BrowserAgentRunOptions } from '../../../../src';
import { diagnose, summarizeDiagnoses } from './diagnosis';
import type { DiagnosisRecord } from './diagnosis';
import { OfficialEvaluatorBridge } from './OfficialEvaluatorBridge';
import { applyProfileToEnv, resolveRunProfile } from './runProfiles';
import { selectPilotTasks, toBenchmarkTask } from './WebArenaTaskSource';
import { extractFinalUrl } from './traceFinalUrl';
import {
  WEBARENA_SITE_ENV_VARS,
  type WebArenaSitePlaceholder,
  type WebArenaTaskConfig,
  type WebArenaTrajectoryArtifact,
} from './webarenaTypes';

interface PilotOptions {
  manifestPath: string;
  outDir: string;
  profilePreset?: string;
  model?: string;
  attempts?: number;
  maxSteps?: number;
  headed: boolean;
  /** Executed between tasks when the official config sets require_reset. */
  resetCommand?: string;
  evaluatorRepoPath?: string;
  /** Playwright storage state satisfying require_login tasks (bootstrapAuth output). */
  storageState?: string;
}

interface PinnedManifest {
  preset: string;
  source: { file: string; sha256: string; totalTasks: number };
  tasks: WebArenaTaskConfig[];
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Accepts both a bare config array and a pinned manifest produced by pin_manifest.ts. */
function loadTaskConfigs(raw: string): { configs: WebArenaTaskConfig[]; provenance?: PinnedManifest['source'] } {
  const parsed = JSON.parse(raw) as WebArenaTaskConfig[] | PinnedManifest;
  if (Array.isArray(parsed)) return { configs: parsed };
  if (!Array.isArray(parsed.tasks)) throw new Error('webarena_manifest_missing_tasks');
  return { configs: parsed.tasks, provenance: parsed.source };
}

async function main(): Promise<void> {
  const options: PilotOptions = {
    manifestPath: readFlag('tasks') ?? 'tests/benchmark/v2/webarena/manifests/webarena_pilot5.json',
    outDir: readFlag('out-dir') ?? join(process.cwd(), 'logs', 'webarena-pilot'),
    profilePreset: readFlag('profile'),
    model: readFlag('model'),
    attempts: readFlag('attempts') ? Number(readFlag('attempts')) : undefined,
    maxSteps: readFlag('max-steps') ? Number(readFlag('max-steps')) : undefined,
    headed: hasFlag('headed'),
    resetCommand: readFlag('reset-command'),
    evaluatorRepoPath: readFlag('evaluator-repo'),
    storageState: readFlag('storage-state'),
  };

  // Resolve and apply the run profile BEFORE any client is constructed: pacing
  // and provider backoff are read from the environment at request time.
  const profile = resolveRunProfile({
    preset: options.profilePreset,
    overrides: {
      ...(options.model ? { model: options.model } : {}),
      ...(options.attempts !== undefined ? { attemptsPerTask: options.attempts } : {}),
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
    },
  });
  applyProfileToEnv(profile);
  // Opt-in authenticated sessions for require_login tasks (official storage states).
  if (options.storageState?.trim()) {
    process.env.BROWSEGENT_STORAGE_STATE = options.storageState.trim();
  }

  const raw = await readFile(options.manifestPath, 'utf8');
  const { configs, provenance } = loadTaskConfigs(raw);
  const { selected, excluded } = selectPilotTasks(configs);
  if (selected.length === 0) throw new Error('webarena_pilot_empty_selection');
  await mkdir(join(options.outDir, 'artifacts'), { recursive: true });

  const traceDir = join(options.outDir, 'traces');
  const bridge = options.evaluatorRepoPath
    ? new OfficialEvaluatorBridge({
        bridgeScriptPath: join(process.cwd(), 'tests', 'benchmark', 'v2', 'webarena', 'webarena_official_eval.py'),
        webarenaRepoPath: options.evaluatorRepoPath,
        siteBaseUrls: resolveSiteBaseUrlsFromEnv(),
        // Prefer an explicit evaluator venv (official deps rarely match system python).
        ...(process.env.WEBARENA_EVAL_PYTHON?.trim()
          ? { pythonExecutable: process.env.WEBARENA_EVAL_PYTHON.trim() }
          : {}),
      })
    : undefined;
  if (!bridge) {
    console.warn('No --evaluator-repo given: runs will be recorded as UNSCORED. Internal pass alone is never a benchmark result.');
  }

  const results: Array<Record<string, unknown>> = [];
  const diagnosisRecords: DiagnosisRecord[] = [];
  let officialPassed = 0;

  for (const config of selected) {
    if (config.require_reset && !options.resetCommand) {
      console.warn(`Task ${config.task_id} sets require_reset but no --reset-command is configured; state may leak between tasks.`);
    }
    for (let attempt = 1; attempt <= profile.attemptsPerTask; attempt += 1) {
      if (config.require_reset && options.resetCommand) {
        await execCapture(options.resetCommand.replace(/\{site\}/g, config.sites[0] ?? ''));
      }
      const task = toBenchmarkTask(config);
      const artifactId = `webarena_${config.task_id}_a${attempt}`;
      // Fresh client per attempt = fresh browser context (per-task isolation).
      const client = new BrowseGent({ maxSteps: profile.maxSteps, warmup: false });
      try {
        const runOptions: BrowserAgentRunOptions = {
          url: task.url,
          ...(profile.model ? { model: profile.model } : {}),
          maxSteps: profile.maxSteps,
          browser: { headless: !options.headed },
          output: 'text',
          trace: { dir: traceDir, runId: artifactId },
        };
        const runStartedAt = Date.now();
        const result = await client.run(task.goal, runOptions);
        const durationMs = Date.now() - runStartedAt;
        // The v2 loop records every observation (with URL) into the trace; the
        // last one is the episode's final page, which url_match/program_html
        // checks are defined against.
        const finalUrl = await extractFinalUrl(traceDir, artifactId);
        const artifact: WebArenaTrajectoryArtifact = {
          taskId: config.task_id,
          answer: result.value,
          ...(finalUrl ? { finalUrl } : {}),
          success: result.success,
          failureReason: result.failureReason,
        };
        const artifactPath = join(options.outDir, 'artifacts', `${artifactId}.json`);
        await writeFile(artifactPath, JSON.stringify(artifact, null, 2));

        let score: number | undefined;
        let evaluatorError: string | undefined;
        if (bridge) {
          try {
            score = (await bridge.evaluate(config, artifactPath)).score;
            if (score === 1) officialPassed += 1;
          } catch (error) {
            evaluatorError = error instanceof Error ? error.message : String(error);
          }
        }
        results.push({
          taskId: task.taskId,
          site: config.sites[0] ?? 'unknown',
          attempt,
          internalSuccess: result.success,
          answer: result.value,
          failureReason: result.failureReason,
          warnings: result.warnings,
          score,
          evaluatorError,
          plannerCalls: result.metrics.plannerCalls,
          toolExecutions: result.metrics.toolExecutions,
          durationMs,
        });
        diagnosisRecords.push(diagnose(task.taskId, {
          site: config.sites[0] ?? 'unknown',
          internalSuccess: result.success,
          failureReason: result.failureReason,
          warnings: result.warnings,
          score,
          evaluatorError,
          plannerCalls: result.metrics.plannerCalls,
          toolExecutions: result.metrics.toolExecutions,
          durationMs,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        results.push({
          taskId: task.taskId,
          site: config.sites[0] ?? 'unknown',
          attempt,
          internalSuccess: false,
          failureReason: reason,
        });
        diagnosisRecords.push(diagnose(task.taskId, {
          site: config.sites[0] ?? 'unknown',
          internalSuccess: false,
          failureReason: reason,
          plannerCalls: 0,
          toolExecutions: 0,
          durationMs: 0,
        }));
      }
    }
  }

  const diagnosis = summarizeDiagnoses(diagnosisRecords);
  const report = {
    startedAt: new Date().toISOString(),
    model: profile.model,
    profile: { ...profile },
    manifestProvenance: provenance,
    headline: {
      officialScored: officialPassed,
      scoredRuns: diagnosis.total - diagnosis.unscored.length,
      unscoredRuns: diagnosis.unscored.length,
      internalPassedForReferenceOnly: diagnosisRecords.filter(record => record.internalSuccess).length,
    },
    diagnosis,
    excludedTasks: excluded,
    results,
  };
  await writeFile(join(options.outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `WebArena pilot complete: OFFICIAL ${officialPassed}/${diagnosis.total - diagnosis.unscored.length} scored`
    + ` (${diagnosis.unscored.length} unscored); winnable pass-rate ${(diagnosis.winnable.passRate * 100).toFixed(1)}%`
    + ` over ${diagnosis.winnable.attempted} winnable runs`,
  );
  console.log(`Failure attribution: ${JSON.stringify(diagnosis.byClass)}`);
  console.log(`Report: ${join(options.outDir, 'report.json')}`);
}

function execCapture(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('wsl', ['bash', '-lc', command], (error, stdout, stderr) => {
      if (error) reject(new Error(`reset_failed:${stderr.slice(-200)}`));
      else resolve(String(stdout));
    });
  });
}

function resolveSiteBaseUrlsFromEnv(): Partial<Record<WebArenaSitePlaceholder, string>> {
  const resolved: Partial<Record<WebArenaSitePlaceholder, string>> = {};
  for (
    const [placeholder, envVar] of Object.entries(WEBARENA_SITE_ENV_VARS) as Array<[WebArenaSitePlaceholder, string]>
  ) {
    const value = process.env[envVar]?.trim();
    if (value) resolved[placeholder] = value;
  }
  return resolved;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
