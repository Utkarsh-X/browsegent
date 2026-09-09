import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowseGent } from '../../../src/BrowseGent';

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

function seedRequiredEnv(): void {
  process.env.BROWSEGENT_LLM_PROVIDER = 'gemini';
  process.env.BROWSEGENT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
  process.env.BROWSEGENT_CEREBRAS_MODEL = 'qwen-3-235b-a22b-instruct-2507';
  process.env.BROWSEGENT_OLLAMA_MODEL = 'qwen3.5:4b';
  process.env.BROWSEGENT_OPENAI_MODEL = 'gpt-4o-mini';
}

test.afterEach(() => {
  restoreEnv();
});

test('BrowseGent public API exposes run, extract, init, and close methods', () => {
  seedRequiredEnv();
  const bg = new BrowseGent({ headless: true, warmup: false, pageWaitMs: 0 });

  assert.equal(typeof bg.run, 'function');
  assert.equal(typeof bg.extract, 'function');
  assert.equal(typeof bg.init, 'function');
  assert.equal(typeof bg.close, 'function');
});

test('BrowseGent init and close manage lifecycle state cleanly', async () => {
  seedRequiredEnv();
  const bg = new BrowseGent({ headless: true, warmup: false, pageWaitMs: 0 });

  await bg.init();
  await bg.close();
});
