import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEvaluatorScore } from '../../../tests/benchmark/v2/webarena/OfficialEvaluatorBridge';
import { applyProfileToEnv, resolveRunProfile } from '../../../tests/benchmark/v2/webarena/runProfiles';
import {
  defaultPilotPredicate,
  resolveWebArenaUrl,
  selectPilotTasks,
  toBenchmarkTask,
} from '../../../tests/benchmark/v2/webarena/WebArenaTaskSource';
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
    eval_types: ['string_match'],
    reference_answers: { exact_match: 'Quest Lumaflex™ Band' },
    reference_url: '',
    program_html: [],
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

test('pilot selection excludes login-gated and program-html tasks with explicit reasons', () => {
  const configs = [
    makeConfig(),
    makeConfig({ task_id: 1, require_login: true, storage_state: './.auth/state.json' }),
    makeConfig({ task_id: 2, program_html: [{ selector: '.price', text_or_attr: 'text' }] }),
    makeConfig({ task_id: 3, sites: ['reddit'] }),
  ];
  const { selected, excluded } = selectPilotTasks(configs);
  assert.deepEqual(selected.map(config => config.task_id), [0]);
  assert.deepEqual(excluded, [
    { taskId: 1, reasons: ['require_login_unsupported'] },
    { taskId: 2, reasons: ['program_html_evaluation_unsupported'] },
    { taskId: 3, reasons: ['pilot_predicate'] },
  ]);
});

test('default pilot predicate selects shopping-site tasks only', () => {
  assert.equal(defaultPilotPredicate(makeConfig()), true);
  assert.equal(defaultPilotPredicate(makeConfig({ sites: ['shopping_admin'] })), false);
});

test('parses bare-number and labeled official evaluator output', () => {
  assert.equal(parseEvaluatorScore('1\n'), 1);
  assert.equal(parseEvaluatorScore('score: 0'), 0);
});

test('rejects unparsable evaluator output instead of coercing to zero', () => {
  assert.throws(() => parseEvaluatorScore('Traceback (most recent call last):'), /unparsable_evaluator_output/);
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
