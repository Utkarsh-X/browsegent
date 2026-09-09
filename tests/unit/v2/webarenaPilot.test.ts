import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { OfficialEvaluatorBridge, parseEvaluatorScore } from '../../../tests/benchmark/v2/webarena/OfficialEvaluatorBridge';
import { applyProfileToEnv, resolveRunProfile } from '../../../tests/benchmark/v2/webarena/runProfiles';
import {
  defaultPilotPredicate,
  resolveWebArenaUrl,
  selectPilotTasks,
  toBenchmarkTask,
} from '../../../tests/benchmark/v2/webarena/WebArenaTaskSource';
import { extractFinalUrl } from '../../../tests/benchmark/v2/webarena/traceFinalUrl';
import type { WebArenaTaskConfig } from '../../../tests/benchmark/v2/webarena/webarenaTypes';

function makeConfig(overrides: Partial<WebArenaTaskConfig> = {}): WebArenaTaskConfig {
  return {
    task_id: 0,
    sites: ['shopping'],
    intent_template: 'What is the top-{{n}} best-selling product in {{year}}',
    intent_template_id: 279,
    intent: 'What is the top-1 best-selling product in 2022',
    start_url: '__SHOPPING__',
    geolocation: null,
    require_login: false,
    storage_state: '',
    require_reset: false,
    eval: {
      eval_types: ['string_match'],
      reference_answers: { exact_match: 'Quest Lumaflex™ Band' },
      reference_url: '',
      program_html: [],
    },
    ...overrides,
  };
}

test('resolves official site placeholders from explicit overrides', () => {
  const url = resolveWebArenaUrl('__SHOPPING__/best-sellers?year=2022', {
    siteBaseUrls: { __SHOPPING__: 'http://localhost:7770/' },
  });
  assert.equal(url, 'http://localhost:7770/best-sellers?year=2022');
});

test('throws a named error when a placeholder has no configured base URL', () => {
  assert.throws(
    () => resolveWebArenaUrl('__GITLAB__/dashboard'),
    /unresolved_webarena_site_placeholder:__GITLAB__/,
  );
});

test('maps an official config to the shared benchmark task shape', () => {
  const task = toBenchmarkTask(makeConfig(), {
    siteBaseUrls: { __SHOPPING__: 'http://localhost:7770' },
  });
  assert.equal(task.taskId, 'webarena_0');
  assert.equal(task.url, 'http://localhost:7770');
  assert.equal(task.goal, 'What is the top-1 best-selling product in 2022');
});

test('pilot selection keeps login-gated and program-html tasks, excludes predicate misses with reasons', () => {
  const configs = [
    makeConfig(),
    makeConfig({ task_id: 1, require_login: true, storage_state: './.auth/state.json' }),
    makeConfig({
      task_id: 2,
      eval: {
        eval_types: ['program_html'],
        reference_url: '__SHOPPING__/checkout/onepage/success/',
        program_html: [{ url: 'last', locator: 'document.querySelector(".price")', required_contents: { exact_match: '$49.00' } }],
      },
    }),
    makeConfig({ task_id: 3, sites: ['reddit'] }),
  ];
  const { selected, excluded } = selectPilotTasks(configs);
  assert.deepEqual(selected.map(config => config.task_id), [0, 1, 2]);
  assert.deepEqual(excluded, [
    { taskId: 3, reasons: ['pilot_predicate'] },
  ]);
});

test('default pilot predicate selects shopping-site tasks only', () => {
  assert.equal(defaultPilotPredicate(makeConfig()), true);
  assert.equal(defaultPilotPredicate(makeConfig({ sites: ['shopping_admin'] })), false);
});

test('parses the bridge result line, ignoring log noise around it', () => {
  const stdout = [
    'some import warning',
    'WEBARENA_EVAL_RESULT:{"score": 1.0}',
    '',
  ].join('\n');
  assert.equal(parseEvaluatorScore(stdout), 1);
});

test('rejects unparsable evaluator output instead of coercing to zero', () => {
  assert.throws(() => parseEvaluatorScore('Traceback (most recent call last):'), /unparsable_evaluator_output/);
  assert.throws(() => parseEvaluatorScore('score: 0\n'), /unparsable_evaluator_output/);
});

test('extracts the final page URL from the latest trace observation', async () => {
  const traceDir = await mkdtemp(join(tmpdir(), 'webarena-trace-'));
  const runDir = join(traceDir, 'run_a', 'observations');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'obs_early.json'), JSON.stringify({ url: 'http://localhost:7770/', timestamp: 100 }));
  await writeFile(join(runDir, 'obs_late.json'), JSON.stringify({ url: 'http://localhost:7770/checkout/cart/', timestamp: 200 }));

  assert.equal(await extractFinalUrl(traceDir, 'run_a'), 'http://localhost:7770/checkout/cart/');
});

test('extractFinalUrl returns undefined when no observations exist', async () => {
  const traceDir = await mkdtemp(join(tmpdir(), 'webarena-trace-'));
  assert.equal(await extractFinalUrl(traceDir, 'missing_run'), undefined);
});

test('bridge spawns the official python script with mapped site env', async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const spawnImpl = ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    void command;
    calls.push({ args, env: options?.env });
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
    const stdout = new EventEmitter();
    (child as unknown as { stdout: EventEmitter }).stdout = stdout;
    child.kill = () => true;
    queueMicrotask(() => {
      stdout.emit('data', Buffer.from('WEBARENA_EVAL_RESULT:{"score":1}\n'));
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof spawn;

  const bridge = new OfficialEvaluatorBridge({
    bridgeScriptPath: 'webarena_official_eval.py',
    webarenaRepoPath: 'E:\\webarena',
    siteBaseUrls: { __SHOPPING__: 'http://localhost:7770' },
    timeoutMs: 5000,
    spawnImpl,
  });
  const artifactDir = await mkdtemp(join(tmpdir(), 'wa-artifact-'));
  const artifactPath = join(artifactDir, 'artifact.json');
  await writeFile(artifactPath, JSON.stringify({ taskId: 0, answer: 'Quest Lumaflex™ Band', success: true }));

  const score = await bridge.evaluate(makeConfig(), artifactPath);

  assert.equal(score.score, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'webarena_official_eval.py');
  assert.ok(calls[0].args.includes('--repo-path'));
  assert.ok(calls[0].args.includes('E:\\webarena'));
  assert.equal(calls[0].env?.SHOPPING, 'http://localhost:7770');
});

test('run profile presets resolve with CLI overrides on top', () => {
  const base = resolveRunProfile({ preset: 'openrouter-default' });
  assert.equal(base.model, 'openrouter/anthropic/claude-sonnet-4.5');
  const customized = resolveRunProfile({
    preset: 'flash-lite-fast',
    overrides: { model: 'openrouter/meta-llama/llama-3.3-70b-instruct', attemptsPerTask: 2 },
  });
  assert.equal(customized.model, 'openrouter/meta-llama/llama-3.3-70b-instruct');
  assert.equal(customized.attemptsPerTask, 2);
  // Untouched fields keep the preset values.
  assert.equal(customized.requestMinIntervalMs, 4000);
});

test('unknown run profile presets throw for typo safety', () => {
  assert.throws(() => resolveRunProfile({ preset: 'flashlite' }), /unknown_run_profile_preset:flashlite/);
});

test('profiles apply through the env vars the provider layer reads per request', () => {
  const env: Record<string, string | undefined> = {};
  applyProfileToEnv(resolveRunProfile({ preset: 'openrouter-default' }), env);
  assert.equal(env.BROWSEGENT_GEMINI_MIN_INTERVAL_MS, '1500');
  assert.equal(env.BROWSEGENT_OPENROUTER_RETRIES, '8');
  assert.equal(env.BROWSEGENT_OPENROUTER_RETRY_BASE_MS, '5000');
  assert.equal(env.BROWSEGENT_OPENROUTER_RETRY_MAX_MS, '60000');
});
