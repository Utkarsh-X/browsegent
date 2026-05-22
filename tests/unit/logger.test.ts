import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../../src/logger';

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
});

test('logger writes without requiring LLM model environment', async () => {
  const logDir = join(process.cwd(), 'logs', 'logger-unit-no-model-env');
  await rm(logDir, { recursive: true, force: true });

  delete process.env.BROWSEGENT_GEMINI_MODEL;
  delete process.env.BROWSEGENT_CEREBRAS_MODEL;
  delete process.env.BROWSEGENT_OLLAMA_MODEL;
  delete process.env.BROWSEGENT_OPENAI_MODEL;
  process.env.LOG_DIR = logDir;

  logger.info('logger:test', 'model env not required', { marker: 'logger_regression' });

  const contents = await readFile(join(logDir, 'debug.jsonl'), 'utf8');
  assert.match(contents, /logger_regression/);
});
