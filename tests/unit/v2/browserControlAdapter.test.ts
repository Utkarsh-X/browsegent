import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BrowserControlAdapter } from '../../benchmark/v2/adapters/BrowserControlAdapter';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'browser_control_test_task',
  category: 'local_fixture',
  difficulty: 'extraction',
  partition: 'dev',
  url: 'https://example.com',
  goal: 'Extract test info',
  validation: { minLength: 2 },
  maxSteps: 12,
};

test('BrowserControlAdapter returns success true when runner completes with done action', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-control-adapter-unit-done');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserControlAdapter({
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: true,
        value: 'Valid goal answer from page',
        failureReason: null,
        failureType: null,
        metrics: {
          plannerCalls: 4,
          toolExecutions: 3,
          inputTokens: 1200,
          outputTokens: 150,
          durationMs: 45000,
        },
      }));
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bc_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'browser-control');
  assert.equal(result.success, true);
  assert.equal(result.value, 'Valid goal answer from page');
  assert.equal(result.failureType, undefined);
  assert.equal(result.metrics.plannerCalls, 4);
});

test('BrowserControlAdapter marks success false when step budget is exhausted', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-control-adapter-unit-exhausted');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserControlAdapter({
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: false,
        value: 'The provided text does not contain the answer',
        failureReason: 'v2_max_steps_exhausted',
        failureType: 'budget_exceeded',
        metrics: {
          plannerCalls: 12,
          toolExecutions: 11,
          inputTokens: 15000,
          outputTokens: 600,
          durationMs: 140000,
        },
      }));
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bc_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'browser-control');
  assert.equal(result.success, false);
  assert.equal(result.failureType, 'budget_exceeded');
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(result.metrics.plannerCalls, 12);
});

test('BrowserControlAdapter marks success false when bot wall / CAPTCHA is detected', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-control-adapter-unit-captcha');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserControlAdapter({
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: false,
        value: 'The page is blocked by Cloudflare verification',
        failureReason: 'Bot verification / access block: The page is blocked by Cloudflare verification',
        failureType: 'captcha_wall',
        metrics: {
          plannerCalls: 5,
          toolExecutions: 4,
          durationMs: 30000,
        },
      }));
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bc_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'browser-control');
  assert.equal(result.success, false);
  assert.equal(result.failureType, 'captcha_wall');
  assert.match(result.failureReason ?? '', /Cloudflare/);
});

test('BrowserControlAdapter classifies crash when runner process fails before writing result', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-control-adapter-unit-crash');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserControlAdapter({
    processRunner: async () => {
      return { exitCode: 1, stdout: '', stderr: 'Python fatal syntax error' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bc_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'browser-control');
  assert.equal(result.success, false);
  assert.equal(result.failureType, 'runtime_crash');
  assert.match(result.failureReason ?? '', /Python fatal syntax error/);
});
