import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfiguredModelForProvider, getConfiguredProvider, getRuntimeConfig, resolveLlmSelection } from '../../src/config/runtime';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
});

test('resolveLlmSelection uses explicit provider configuration from env', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';

  const selection = resolveLlmSelection();

  assert.equal(selection.provider, 'gemini');
  assert.equal(selection.model, 'gemini-3.1-flash-lite-preview');
  assert.equal(selection.modelId, 'gemini/gemini-3.1-flash-lite-preview');
});

test('resolveLlmSelection supports explicit prefixed overrides without mutating env state', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';

  const selection = resolveLlmSelection('cerebras/qwen-3-235b-a22b-instruct-2507');

  assert.equal(selection.provider, 'cerebras');
  assert.equal(selection.model, 'qwen-3-235b-a22b-instruct-2507');
  assert.equal(getConfiguredProvider(), 'gemini');
  assert.equal(getConfiguredModelForProvider('gemini'), 'gemini-3.1-flash-lite-preview');
});

test('runtime config exposes progress guard enforcement toggle', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
  process.env.BROWSEGENT_ENFORCE_PROGRESS_GUARDS = 'false';

  const runtime = getRuntimeConfig();

  assert.equal(runtime.agent.enforceProgressGuards, false);
  assert.equal(runtime.agent.enforceTargetUtilityGuards, true);
});

test('runtime config exposes target utility guard enforcement toggle', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
  process.env.BROWSEGENT_ENFORCE_TARGET_UTILITY_GUARDS = 'false';

  const runtime = getRuntimeConfig();

  assert.equal(runtime.agent.enforceTargetUtilityGuards, false);
});

test('runtime config exposes Brain1 interaction pipeline toggle', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
  process.env.BROWSEGENT_BRAIN1_INTERACTION_PIPELINE = 'false';

  const runtime = getRuntimeConfig();

  assert.equal(runtime.brain1.interactionPipeline, false);
});

test('runtime config exposes CDP click toggle', () => {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
  process.env.BROWSEGENT_CDP_CLICK_ENABLED = 'false';

  const runtime = getRuntimeConfig();

  assert.equal(runtime.executor.cdpClickEnabled, false);
});
