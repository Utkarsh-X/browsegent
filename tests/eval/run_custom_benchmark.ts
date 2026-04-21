import { config } from 'dotenv';
config();

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { BrowseGent } from '../../src/BrowseGent';
import { getRuntimeConfig, resolveLlmSelection } from '../../src/config/runtime';

type TaskDifficulty = 'extraction' | 'navigation' | 'reasoning' | 'recovery' | 'adversarial';
type LlmUsageStatus = 'in_range' | 'underuse' | 'overuse';
type EvalFailureType =
  | 'perception_error'
  | 'action_error'
  | 'planning_error'
  | 'environment_block'
  | 'validation_error'
  | 'runtime_crash'
  | 'unknown';

interface LlmExpectationRange {
  min: number;
  max: number;
  target?: number;
}

type LlmExpectation = number | LlmExpectationRange;

interface TaskValidationSpec {
  minLength?: number;
  requireAny?: RegExp[];
  requireAll?: RegExp[];
  forbid?: RegExp[];
}

interface RawCustomTask {
  id?: string;
  category?: string;
  difficulty?: TaskDifficulty;
  url: string;
  goal: string;
  description?: string;
  expectedLlmCalls?: LlmExpectation;
  minLength?: number;
  requireAny?: string[];
  requireAll?: string[];
  forbid?: string[];
}

interface CustomBenchmarkTask {
  id: string;
  category: string;
  difficulty: TaskDifficulty;
  url: string;
  goal: string;
  description: string;
  expectedLlmCalls: LlmExpectation;
  validation: TaskValidationSpec;
}

interface ValueValidationResult {
  passed: boolean;
  reasons: string[];
  preview: string;
}

interface LlmUsageResult {
  expectation: LlmExpectationRange;
  calls: number;
  status: LlmUsageStatus;
  deviationFromTarget?: number;
}

interface CustomTaskResult {
  taskId: string;
  attempt: number;
  category: string;
  difficulty: TaskDifficulty;
  url: string;
  goal: string;
  completed: boolean;
  metExpectedLlmCalls: boolean;
  llmUsage: LlmUsageResult;
  value: string;
  validation: ValueValidationResult;
  failureType?: EvalFailureType;
  failureReason?: string;
  metrics: {
    llmCallCount: number;
    expectedLlmCalls: LlmExpectationRange;
    inputTokens: number;
    outputTokens: number;
    llmDurationMs: number;
    totalSteps: number;
    totalTimeMs: number;
    snapshotNodes: number;
    totalDOMNodes: number;
    snapshotTokens: number;
    attributionRate: number;
    causeBreakdown: Record<string, number>;
    estimatedCostUsd: number;
    model: string;
    progress: {
      assessedActions: number;
      strongActions: number;
      weakActions: number;
      noEffectActions: number;
      noProgressAborts: number;
      decisionCounts: {
        accept: number;
        watch: number;
        warn: number;
        abort: number;
      };
      signalCounts: Record<string, number>;
    };
  };
}

interface CustomEvalReport {
  runId: string;
  timestamp: string;
  model: string;
  source: 'bu-bench' | 'file';
  sourcePath?: string;
  repeats: number;
  tasks: CustomTaskResult[];
  summary: {
    totalTasks: number;
    uniqueTasks: number;
    completed: number;
    failed: number;
    completionRate: number;
    validationFailures: number;
    metLlmExpectations: number;
    llmUsageDistribution: Record<LlmUsageStatus, number>;
    failureTypes: Record<string, number>;
    avgLlmCallsPerTask: number;
    avgSnapshotTokensPerTask: number;
    avgInputTokensPerTask: number;
    totalCostUsd: number;
    avgTimeMs: number;
    byCategory: Record<string, { completed: number; total: number; avgLlmCalls: number }>;
    byDifficulty: Record<string, { completed: number; total: number; avgLlmCalls: number }>;
  };
}

const BASE_FORBID_PATTERNS: RegExp[] = [
  /^\s*$/,
  /\berror\b/i,
  /\bblocked\b/i,
  /\bcaptcha\b/i,
  /\baccess denied\b/i,
  /\bunavailable\b/i,
  /\bfailed\b/i,
  /\bregion not found\b/i,
];

const DEFAULT_EXPECTATION: LlmExpectationRange = { min: 2, max: 20, target: 8 };

interface CustomRunOptions {
  modelOverride?: string;
  source: 'bu-bench' | 'file';
  sourcePath?: string;
  buEncPath: string;
  count: number;
  seed: number;
  categories?: string[];
  taskFilter?: string | null;
  repeatCount: number;
  envRetryCount: number;
  envRetryDelayMs: number;
}

interface BuBenchTaskRow {
  task_id?: string;
  category?: string;
  confirmed_task?: string;
}

function parseIntInRange(raw: string | null | undefined, fallback: number, min: number, max: number, label: string): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${label} "${raw}". Expected integer ${min}..${max}.`);
  }
  return n;
}

function resolveLlmExpectation(expectation: LlmExpectation): LlmExpectationRange {
  if (typeof expectation === 'number') {
    if (expectation <= 0) return { min: 0, max: 1, target: 0 };
    return { min: Math.max(1, expectation - 1), max: expectation + 3, target: expectation };
  }
  return expectation;
}

function evaluateLlmUsage(calls: number, expectation: LlmExpectation): LlmUsageResult {
  const resolved = resolveLlmExpectation(expectation);
  let status: LlmUsageStatus = 'in_range';
  if (calls < resolved.min) status = 'underuse';
  if (calls > resolved.max) status = 'overuse';
  return {
    expectation: resolved,
    calls,
    status,
    deviationFromTarget: resolved.target !== undefined ? calls - resolved.target : undefined,
  };
}

function looksLikeEnvironmentBlock(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('api_quota_exceeded')
    || normalized.includes('resource_exhausted')
    || normalized.includes('429')
    || normalized.includes('503')
    || normalized.includes('timeout')
    || normalized.includes('net::err')
    || normalized.includes('enotfound')
    || normalized.includes('econnreset')
    || normalized.includes('fetch failed')
    || normalized.includes('service unavailable')
    || normalized.includes('temporarily unavailable')
    || normalized.includes('connection reset')
    || normalized.includes('gateway')
    || normalized.includes('rate limit')
    || normalized.includes('captcha')
    || normalized.includes('access denied')
    || normalized.includes('verification')
  );
}

function classifyFailure(
  runSuccess: boolean,
  failureReason: string | undefined,
  validation: ValueValidationResult,
  progress: CustomTaskResult['metrics']['progress'],
  crashError?: string
): EvalFailureType {
  if (crashError) {
    return looksLikeEnvironmentBlock(crashError) ? 'environment_block' : 'runtime_crash';
  }

  const reason = (failureReason ?? '').toLowerCase();
  if (runSuccess && !validation.passed) {
    if (looksLikeEnvironmentBlock(`${failureReason ?? ''} ${validation.preview}`)) return 'environment_block';
    if (progress.assessedActions === 0) return 'perception_error';
    if (progress.noEffectActions >= 2 && progress.strongActions === 0) return 'action_error';
    return 'validation_error';
  }

  if (!runSuccess) {
    if (looksLikeEnvironmentBlock(reason)) return 'environment_block';
    if (
      reason.includes('no_progress_detected')
      || reason.includes('max_steps_exceeded')
      || reason.includes('dead end')
      || reason.includes('llm response unusable')
    ) {
      return 'planning_error';
    }
    if (progress.noEffectActions >= 2 && progress.strongActions === 0) return 'action_error';
    if (progress.weakActions > progress.strongActions && progress.assessedActions > 0) return 'perception_error';
    return 'unknown';
  }

  return 'unknown';
}

function parsePattern(raw: string): RegExp {
  const trimmed = raw.trim();
  const regexLiteral = /^\/(.+)\/([a-z]*)$/i.exec(trimmed);
  if (regexLiteral) {
    return new RegExp(regexLiteral[1]!, regexLiteral[2]);
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function createValidationFromRaw(raw?: Partial<RawCustomTask>): TaskValidationSpec {
  return {
    minLength: raw?.minLength ?? 8,
    requireAny: raw?.requireAny?.map(parsePattern) ?? [/[A-Za-z0-9]/],
    requireAll: raw?.requireAll?.map(parsePattern),
    forbid: raw?.forbid?.map(parsePattern) ?? [...BASE_FORBID_PATTERNS],
  };
}

function validateValue(task: CustomBenchmarkTask, value: string): ValueValidationResult {
  const trimmed = value.trim();
  const reasons: string[] = [];
  const spec = task.validation;

  if (typeof spec.minLength === 'number' && trimmed.length < spec.minLength) {
    reasons.push(`value shorter than minLength=${spec.minLength}`);
  }
  if (spec.requireAny && spec.requireAny.length > 0 && !spec.requireAny.some((pattern) => pattern.test(trimmed))) {
    reasons.push(`none of requireAny patterns matched (${spec.requireAny.length})`);
  }
  if (spec.requireAll && spec.requireAll.length > 0) {
    const missing = spec.requireAll.filter((pattern) => !pattern.test(trimmed));
    if (missing.length > 0) reasons.push(`missing requireAll matches (${missing.length}/${spec.requireAll.length})`);
  }
  if (spec.forbid && spec.forbid.length > 0) {
    const matchedForbidden = spec.forbid.filter((pattern) => pattern.test(trimmed));
    if (matchedForbidden.length > 0) reasons.push(`matched forbidden pattern(s) (${matchedForbidden.length})`);
  }

  return {
    passed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    preview: trimmed.slice(0, 160),
  };
}

function inferDifficulty(category: string): TaskDifficulty {
  const c = category.toLowerCase();
  if (c.includes('write') || c.includes('mind2web')) return 'navigation';
  if (c.includes('browsecomp')) return 'adversarial';
  if (c.includes('gaia')) return 'reasoning';
  if (c.includes('read')) return 'reasoning';
  return 'reasoning';
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function balancedSampleByCategory<T extends { category: string }>(items: T[], count: number, seed: number): T[] {
  if (count >= items.length) return [...items];
  const rng = mulberry32(seed);
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category || 'unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  for (const list of grouped.values()) {
    shuffleInPlace(list, rng);
  }

  const categories = [...grouped.keys()].sort();
  const selected: T[] = [];
  while (selected.length < count) {
    let progressed = false;
    for (const category of categories) {
      const bucket = grouped.get(category)!;
      const next = bucket.shift();
      if (!next) continue;
      selected.push(next);
      progressed = true;
      if (selected.length >= count) break;
    }
    if (!progressed) break;
  }
  return selected;
}

function runPythonSnippet(script: string, args: string[]): string {
  const candidates: Array<{ cmd: string; fixedArgs: string[] }> = [
    { cmd: 'python', fixedArgs: ['-c'] },
    { cmd: 'py', fixedArgs: ['-3', '-c'] },
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return execFileSync(candidate.cmd, [...candidate.fixedArgs, script, ...args], {
        encoding: 'utf8',
        maxBuffer: 30 * 1024 * 1024,
      });
    } catch (err) {
      errors.push(`${candidate.cmd}: ${String(err)}`);
    }
  }
  throw new Error(`Failed to run Python for BU Bench decryption. Details: ${errors.join(' | ')}`);
}

function decryptBuBenchTasks(encPath: string): BuBenchTaskRow[] {
  const script = `
import base64, hashlib, json, sys
from pathlib import Path
from cryptography.fernet import Fernet

enc_path = Path(sys.argv[1])
if not enc_path.exists():
  raise FileNotFoundError(f"Missing BU benchmark file: {enc_path}")
key = base64.urlsafe_b64encode(hashlib.sha256(b'BU_Bench_V1').digest())
raw = Fernet(key).decrypt(base64.b64decode(enc_path.read_text()))
tasks = json.loads(raw)
print(json.dumps(tasks))
`;
  const output = runPythonSnippet(script, [encPath]);
  const parsed = JSON.parse(output) as BuBenchTaskRow[];
  if (!Array.isArray(parsed)) {
    throw new Error('Decrypted BU benchmark payload is not an array.');
  }
  return parsed;
}

function parseTaskUrl(task: string): string | null {
  const match = task.match(/website:\s*(https?:\/\/[^\s]+)/i);
  return match?.[1]?.trim() ?? null;
}

function normalizeGoal(task: string): string {
  return task
    .replace(/\\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s*website:\s*https?:\/\/[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadBuBenchSubset(encPath: string, count: number, seed: number, categories?: string[]): CustomBenchmarkTask[] {
  const rows = decryptBuBenchTasks(encPath);
  const categoryFilter = categories && categories.length > 0
    ? new Set(categories.map((c) => c.toLowerCase()))
    : null;

  const mapped: CustomBenchmarkTask[] = [];
  for (const row of rows) {
    const rawTask = row.confirmed_task?.trim();
    if (!rawTask) continue;
    const url = parseTaskUrl(rawTask);
    if (!url) continue;
    const category = row.category?.trim() || 'bu-bench';
    if (categoryFilter && !categoryFilter.has(category.toLowerCase())) continue;
    const taskId = row.task_id?.trim() || `bu_${mapped.length + 1}`;
    mapped.push({
      id: `bu_${taskId}`,
      category,
      difficulty: inferDifficulty(category),
      url,
      goal: normalizeGoal(rawTask),
      description: `BU Bench V1 task (${category})`,
      expectedLlmCalls: DEFAULT_EXPECTATION,
      validation: {
        minLength: 10,
        requireAny: [/[A-Za-z0-9]/],
        forbid: [...BASE_FORBID_PATTERNS],
      },
    });
  }

  return balancedSampleByCategory(mapped, Math.max(1, count), seed);
}

function loadTasksFromFile(filePath: string, count: number, seed: number, categories?: string[]): CustomBenchmarkTask[] {
  const absolute = path.resolve(filePath);
  const rawContent = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(rawContent) as RawCustomTask[] | { tasks: RawCustomTask[] };
  const rawTasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new Error(`Custom benchmark file ${absolute} has no tasks.`);
  }

  const categoryFilter = categories && categories.length > 0
    ? new Set(categories.map((c) => c.toLowerCase()))
    : null;

  const normalized: CustomBenchmarkTask[] = rawTasks
    .filter((t) => t && typeof t.url === 'string' && typeof t.goal === 'string')
    .map((t, idx) => {
      const category = (t.category ?? 'custom').trim();
      return {
        id: t.id?.trim() || `custom_${idx + 1}`,
        category,
        difficulty: t.difficulty ?? inferDifficulty(category),
        url: t.url.trim(),
        goal: t.goal.trim(),
        description: t.description?.trim() || `Custom task ${idx + 1}`,
        expectedLlmCalls: t.expectedLlmCalls ?? DEFAULT_EXPECTATION,
        validation: createValidationFromRaw(t),
      };
    })
    .filter((t) => !categoryFilter || categoryFilter.has(t.category.toLowerCase()));

  return balancedSampleByCategory(normalized, Math.max(1, count), seed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listTasks(tasks: CustomBenchmarkTask[]): void {
  console.log(`\nLoaded ${tasks.length} custom benchmark task(s):`);
  for (const task of tasks) {
    const expectation = resolveLlmExpectation(task.expectedLlmCalls);
    console.log(`- ${task.id} [${task.category}] ${task.url}`);
    console.log(`  goal=${task.goal.slice(0, 120)}${task.goal.length > 120 ? '...' : ''}`);
    console.log(`  difficulty=${task.difficulty} llm=${expectation.min}-${expectation.max}`);
  }
  console.log('');
}

async function runCustomBenchmark(options: CustomRunOptions): Promise<void> {
  const runtime = getRuntimeConfig();
  const llmSelection = resolveLlmSelection(options.modelOverride);
  const model = llmSelection.modelId;
  const runId = `${Date.now()}_${options.source}_r${options.repeatCount}_${model.replace(/[^a-z0-9]/gi, '_')}`;
  const runDir = `logs/custom_eval_runs/${runId}`;
  fs.mkdirSync(runDir, { recursive: true });
  process.env.LOG_DIR = runDir;

  const tasks = options.source === 'bu-bench'
    ? loadBuBenchSubset(options.buEncPath, options.count, options.seed, options.categories)
    : loadTasksFromFile(options.sourcePath!, options.count, options.seed, options.categories);

  const filteredTasks = options.taskFilter
    ? tasks.filter((t) => t.id === options.taskFilter)
    : tasks;
  if (filteredTasks.length === 0) {
    throw new Error(`No tasks available after filtering (task=${options.taskFilter ?? 'all'}).`);
  }

  console.log('\n================================================');
  console.log('  BrowseGent - Custom Benchmark Runner');
  console.log('================================================');
  console.log(`  Model:    ${model}`);
  console.log(`  Source:   ${options.source}`);
  console.log(`  SourcePath:${options.source === 'bu-bench' ? options.buEncPath : options.sourcePath}`);
  console.log(`  Repeat:   ${options.repeatCount}`);
  console.log(`  Tasks:    ${filteredTasks.length}`);
  console.log(`  Seed:     ${options.seed}`);
  console.log(`  EnvRetry: ${options.envRetryCount} (base delay ${options.envRetryDelayMs}ms)`);
  console.log(`  RunID:    ${runId}`);
  console.log(`  Headless: ${runtime.eval.headless}`);
  console.log(`  Warmup:   ${runtime.eval.warmup}`);
  console.log('================================================\n');

  const bg = new BrowseGent({ model, headless: runtime.eval.headless, warmup: runtime.eval.warmup });
  await bg.init();

  const results: CustomTaskResult[] = [];
  for (let attempt = 1; attempt <= options.repeatCount; attempt++) {
    if (options.repeatCount > 1) {
      console.log(`\n================ Attempt ${attempt}/${options.repeatCount} ================`);
    }

    for (let i = 0; i < filteredTasks.length; i++) {
      const task = filteredTasks[i]!;
      console.log(`\n  [${i + 1}/${filteredTasks.length}] ${task.id} (attempt ${attempt})`);
      console.log(`  ${task.url}`);
      console.log(`  Goal: ${task.goal}`);

      for (let retryAttempt = 0; retryAttempt <= options.envRetryCount; retryAttempt++) {
        if (retryAttempt > 0) {
          console.log(`  -> Retry ${retryAttempt}/${options.envRetryCount} after transient environment block`);
        }

        try {
          const result = await bg.run(task.url, task.goal);
          const validation = validateValue(task, result.value);
          const llmUsage = evaluateLlmUsage(result.metrics.llmCallCount, task.expectedLlmCalls);
          const completed = result.success && validation.passed;
          const metExpected = llmUsage.status === 'in_range';
          const failureType = completed
            ? undefined
            : classifyFailure(result.success, result.failureReason, validation, result.metrics.progress);
          const shouldRetry = !completed && failureType === 'environment_block' && retryAttempt < options.envRetryCount;

          console.log(
            `  -> ${completed ? 'COMPLETE' : 'INCOMPLETE'} | LLM: ${result.metrics.llmCallCount} (range ${llmUsage.expectation.min}-${llmUsage.expectation.max}) ${metExpected ? 'OK' : llmUsage.status.toUpperCase()}`
          );
          console.log(`  -> Value: "${validation.preview}"`);
          if (!validation.passed) {
            console.log(`  -> Validation: FAIL (${validation.reasons.join('; ')})`);
          }
          if (!completed) {
            console.log(`  -> FailureType: ${failureType ?? 'unknown'}`);
            if (result.failureReason) console.log(`  -> FailureReason: ${result.failureReason}`);
          }
          console.log(
            `  -> Tokens: ${result.metrics.snapshotTokens} graph | ${result.metrics.inputTokens}in ${result.metrics.outputTokens}out LLM`
          );
          console.log(`  -> Time: ${result.metrics.totalTimeMs}ms | Cost: $${result.metrics.estimatedCostUsd.toFixed(6)}`);

          if (shouldRetry) {
            const delayMs = options.envRetryDelayMs * (retryAttempt + 1);
            console.log(`  -> Retrying after ${delayMs}ms due to transient environment block`);
            await sleep(delayMs);
            continue;
          }

          results.push({
            taskId: task.id,
            attempt,
            category: task.category,
            difficulty: task.difficulty,
            url: task.url,
            goal: task.goal,
            completed,
            metExpectedLlmCalls: metExpected,
            llmUsage,
            value: result.value,
            validation,
            failureType,
            failureReason: result.failureReason,
            metrics: {
              llmCallCount: result.metrics.llmCallCount,
              expectedLlmCalls: llmUsage.expectation,
              inputTokens: result.metrics.inputTokens,
              outputTokens: result.metrics.outputTokens,
              llmDurationMs: result.metrics.llmDurationMs,
              totalSteps: result.metrics.totalSteps,
              totalTimeMs: result.metrics.totalTimeMs,
              snapshotNodes: result.metrics.snapshotNodes,
              totalDOMNodes: result.metrics.totalDOMNodes,
              snapshotTokens: result.metrics.snapshotTokens,
              attributionRate: result.metrics.attributionRate,
              causeBreakdown: result.metrics.causeBreakdown,
              estimatedCostUsd: result.metrics.estimatedCostUsd,
              model,
              progress: result.metrics.progress,
            },
          });
          break;
        } catch (err) {
          const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          const llmUsage = evaluateLlmUsage(0, task.expectedLlmCalls);
          const validation: ValueValidationResult = {
            passed: false,
            reasons: ['run crashed before value validation'],
            preview: '',
          };
          const failureType = classifyFailure(
            false,
            `crash: ${errStr}`,
            validation,
            {
              assessedActions: 0,
              strongActions: 0,
              weakActions: 0,
              noEffectActions: 0,
              noProgressAborts: 0,
              decisionCounts: { accept: 0, watch: 0, warn: 0, abort: 0 },
              signalCounts: {},
            },
            errStr
          );
          const shouldRetry = failureType === 'environment_block' && retryAttempt < options.envRetryCount;

          console.log(`  -> CRASH: ${errStr.slice(0, 180)}`);
          console.log(`  -> FailureType: ${failureType}`);

          if (shouldRetry) {
            const delayMs = options.envRetryDelayMs * (retryAttempt + 1);
            console.log(`  -> Retrying after ${delayMs}ms due to transient crash`);
            await sleep(delayMs);
            continue;
          }

          results.push({
            taskId: task.id,
            attempt,
            category: task.category,
            difficulty: task.difficulty,
            url: task.url,
            goal: task.goal,
            completed: false,
            metExpectedLlmCalls: false,
            llmUsage,
            value: '',
            validation,
            failureType,
            failureReason: `crash: ${errStr.slice(0, 300)}`,
            metrics: {
              llmCallCount: 0,
              expectedLlmCalls: llmUsage.expectation,
              inputTokens: 0,
              outputTokens: 0,
              llmDurationMs: 0,
              totalSteps: 0,
              totalTimeMs: 0,
              snapshotNodes: 0,
              totalDOMNodes: 0,
              snapshotTokens: 0,
              attributionRate: 0,
              causeBreakdown: {},
              estimatedCostUsd: 0,
              model,
              progress: {
                assessedActions: 0,
                strongActions: 0,
                weakActions: 0,
                noEffectActions: 0,
                noProgressAborts: 0,
                decisionCounts: { accept: 0, watch: 0, warn: 0, abort: 0 },
                signalCounts: {},
              },
            },
          });
          break;
        }
      }
    }
  }

  await bg.close();
  saveCustomReport(results, runId, runDir, model, options);
}

function saveCustomReport(
  results: CustomTaskResult[],
  runId: string,
  runDir: string,
  model: string,
  options: CustomRunOptions
): void {
  const completed = results.filter((r) => r.completed).length;
  const metExpected = results.filter((r) => r.metExpectedLlmCalls).length;
  const validationFailures = results.filter((r) => !r.validation.passed).length;
  const llmUsageDistribution: Record<LlmUsageStatus, number> = {
    in_range: 0,
    underuse: 0,
    overuse: 0,
  };
  const failureTypes: Record<string, number> = {};
  const byCategory: Record<string, { completed: number; total: number; avgLlmCalls: number }> = {};
  const byDifficulty: Record<string, { completed: number; total: number; avgLlmCalls: number }> = {};

  for (const r of results) {
    llmUsageDistribution[r.llmUsage.status]++;
    if (r.failureType) failureTypes[r.failureType] = (failureTypes[r.failureType] ?? 0) + 1;

    if (!byCategory[r.category]) byCategory[r.category] = { completed: 0, total: 0, avgLlmCalls: 0 };
    byCategory[r.category]!.total++;
    byCategory[r.category]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.completed) byCategory[r.category]!.completed++;

    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { completed: 0, total: 0, avgLlmCalls: 0 };
    byDifficulty[r.difficulty]!.total++;
    byDifficulty[r.difficulty]!.avgLlmCalls += r.metrics.llmCallCount;
    if (r.completed) byDifficulty[r.difficulty]!.completed++;
  }

  for (const c of Object.values(byCategory)) c.avgLlmCalls /= c.total;
  for (const d of Object.values(byDifficulty)) d.avgLlmCalls /= d.total;

  const uniqueTasks = new Set(results.map((r) => r.taskId)).size;
  const report: CustomEvalReport = {
    runId,
    timestamp: new Date().toISOString(),
    model,
    source: options.source,
    sourcePath: options.source === 'bu-bench' ? options.buEncPath : options.sourcePath,
    repeats: options.repeatCount,
    tasks: results,
    summary: {
      totalTasks: results.length,
      uniqueTasks,
      completed,
      failed: results.length - completed,
      completionRate: results.length > 0 ? completed / results.length : 0,
      validationFailures,
      metLlmExpectations: metExpected,
      llmUsageDistribution,
      failureTypes,
      avgLlmCallsPerTask: results.reduce((a, r) => a + r.metrics.llmCallCount, 0) / (results.length || 1),
      avgSnapshotTokensPerTask: results.reduce((a, r) => a + r.metrics.snapshotTokens, 0) / (results.length || 1),
      avgInputTokensPerTask: results.reduce((a, r) => a + r.metrics.inputTokens, 0) / (results.length || 1),
      totalCostUsd: results.reduce((a, r) => a + r.metrics.estimatedCostUsd, 0),
      avgTimeMs: results.reduce((a, r) => a + r.metrics.totalTimeMs, 0) / (results.length || 1),
      byCategory,
      byDifficulty,
    },
  };

  const reportPath = `${runDir}/report.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n================================================');
  console.log('  CUSTOM BENCHMARK SUMMARY');
  console.log('================================================');
  console.log(`  RunID:              ${runId}`);
  console.log(`  Model:              ${model}`);
  console.log(`  Source:             ${options.source}`);
  console.log(`  Repeat:             ${options.repeatCount}`);
  console.log(`  Completion rate:    ${(report.summary.completionRate * 100).toFixed(1)}% (${completed}/${results.length})`);
  console.log(`  Validation failures:${validationFailures}`);
  console.log(`  LLM in-range:       ${metExpected}/${results.length}`);
  console.log(`  Avg LLM calls:      ${report.summary.avgLlmCallsPerTask.toFixed(2)} per task`);
  console.log(`  Avg graph tokens:   ${report.summary.avgSnapshotTokensPerTask.toFixed(0)} (Brain 1 output)`);
  console.log(`  Avg LLM tokens in:  ${report.summary.avgInputTokensPerTask.toFixed(0)}`);
  console.log(`  Total cost:         $${report.summary.totalCostUsd.toFixed(5)}`);
  console.log(`  Avg time:           ${(report.summary.avgTimeMs / 1000).toFixed(1)}s`);
  console.log('\n  Failure types:');
  const entries = Object.entries(failureTypes);
  if (entries.length === 0) {
    console.log('    none');
  } else {
    for (const [failureType, count] of entries) {
      console.log(`    ${failureType}: ${count}`);
    }
  }
  console.log(`\n  Report -> ${reportPath}`);
  console.log('================================================\n');
}

function parseArgs(): CustomRunOptions & { listOnly: boolean } {
  const modelArg = process.argv[2]?.startsWith('--') ? undefined : process.argv[2];
  const sourceIdx = process.argv.indexOf('--source');
  const sourceArg = sourceIdx !== -1 ? process.argv[sourceIdx + 1] ?? 'bu-bench' : 'bu-bench';
  const source = sourceArg === 'file' ? 'file' : 'bu-bench';
  const fileIdx = process.argv.indexOf('--file');
  const sourcePath = fileIdx !== -1 ? process.argv[fileIdx + 1] ?? undefined : undefined;
  const encIdx = process.argv.indexOf('--enc');
  const buEncPath = encIdx !== -1
    ? process.argv[encIdx + 1]!
    : path.resolve('browser-use-inspirationbenchmark/benchmark/BU_Bench_V1.enc');
  const countIdx = process.argv.indexOf('--count');
  const countArg = countIdx !== -1 ? process.argv[countIdx + 1] ?? null : null;
  const seedIdx = process.argv.indexOf('--seed');
  const seedArg = seedIdx !== -1 ? process.argv[seedIdx + 1] ?? null : null;
  const categoriesIdx = process.argv.indexOf('--categories');
  const categoriesArg = categoriesIdx !== -1 ? process.argv[categoriesIdx + 1] ?? null : null;
  const taskFilterIdx = process.argv.indexOf('--task');
  const taskFilter = taskFilterIdx !== -1 ? process.argv[taskFilterIdx + 1] ?? null : null;
  const repeatIdx = process.argv.indexOf('--repeat');
  const repeatArg = repeatIdx !== -1 ? process.argv[repeatIdx + 1] ?? null : null;
  const envRetriesIdx = process.argv.indexOf('--env-retries');
  const envRetriesArg = envRetriesIdx !== -1 ? process.argv[envRetriesIdx + 1] ?? null : null;
  const envRetryDelayIdx = process.argv.indexOf('--env-retry-delay-ms');
  const envRetryDelayArg = envRetryDelayIdx !== -1 ? process.argv[envRetryDelayIdx + 1] ?? null : null;
  const listOnly = process.argv.includes('--list');

  if (source === 'file' && !sourcePath) {
    throw new Error('When --source file is used, --file <path> is required.');
  }

  const categories = categoriesArg
    ? categoriesArg.split(',').map((x) => x.trim()).filter(Boolean)
    : undefined;

  return {
    modelOverride: modelArg,
    source,
    sourcePath,
    buEncPath,
    count: parseIntInRange(countArg, 20, 1, 100, '--count'),
    seed: parseIntInRange(seedArg, 13, 1, 1_000_000, '--seed'),
    categories,
    taskFilter,
    repeatCount: parseIntInRange(repeatArg, 1, 1, 10, '--repeat'),
    envRetryCount: parseIntInRange(envRetriesArg, 2, 0, 5, '--env-retries'),
    envRetryDelayMs: parseIntInRange(envRetryDelayArg, 15000, 1000, 120000, '--env-retry-delay-ms'),
    listOnly,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const tasks = options.source === 'bu-bench'
    ? loadBuBenchSubset(options.buEncPath, options.count, options.seed, options.categories)
    : loadTasksFromFile(options.sourcePath!, options.count, options.seed, options.categories);

  if (options.listOnly) {
    listTasks(tasks);
    return;
  }

  await runCustomBenchmark(options);
}

main().catch((err) => {
  console.error('Custom benchmark crashed:', err);
  process.exit(1);
});
