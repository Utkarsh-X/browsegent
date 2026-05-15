import test from 'node:test';
import assert from 'node:assert/strict';

import { detectProvider, normalizeProviderModel } from '../../src/providers';

test('normalizeProviderModel preserves native Gemini names and strips provider namespaces', () => {
  assert.equal(normalizeProviderModel('gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeProviderModel('google/gemini/gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(normalizeProviderModel('cerebras/qwen-3-235b-a22b-instruct-2507'), 'qwen-3-235b-a22b-instruct-2507');
  assert.equal(normalizeProviderModel('ollama/qwen3.5:4b'), 'qwen3.5:4b');
  assert.equal(normalizeProviderModel('openai/gpt-4o'), 'gpt-4o');
});

test('detectProvider keeps Gemini models on the Gemini transport', () => {
  assert.equal(detectProvider('gemini-2.5-flash'), 'gemini');
  assert.equal(detectProvider('google/gemini/gemini-2.5-flash'), 'gemini');
  assert.equal(detectProvider('cerebras/qwen-3-235b-a22b-instruct-2507'), 'cerebras');
  assert.equal(detectProvider('ollama/qwen3.5:4b'), 'ollama');
});
