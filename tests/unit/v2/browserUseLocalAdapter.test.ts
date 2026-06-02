import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BrowserUseLocalAdapter } from '../../benchmark/v2/adapters/BrowserUseLocalAdapter';
import type { BenchmarkTask } from '../../benchmark/v2/types';

const task: BenchmarkTask = {
  taskId: 'static_read',
  category: 'local_fixture',
  difficulty: 'extraction',
  partition: 'dev',
  url: 'file:///fixture.html',
  goal: 'Read answer',
  validation: { minLength: 2 },
  maxSteps: 4,
};

test('BrowserUseLocalAdapter writes sanitized artifacts and maps runner result', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-use-local-adapter-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserUseLocalAdapter({
    pythonCommand: 'python',
    env: { GEMINI_API_KEY: 'secret-key' },
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: true,
        value: 'answer from Browser Use',
        metrics: {
          plannerCalls: 3,
          toolExecutions: 2,
          inputTokens: 11,
          outputTokens: 7,
        },
      }));
      return {
        exitCode: 0,
        stdout: 'stdout secret-key',
        stderr: 'stderr secret-key',
      };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    model: 'gemini/gemini-3.1-flash-lite',
    traceDir: outputRoot,
    headed: false,
    requestMinIntervalMs: 5000,
  });

  assert.equal(result.adapterId, 'browser-use-local');
  assert.equal(result.success, true);
  assert.equal(result.value, 'answer from Browser Use');
  assert.equal(result.metrics.plannerCalls, 3);
  assert.equal(result.metrics.toolExecutions, 2);
  assert.equal(result.artifactPath?.includes('browser-use-local'), true);

  const stdout = await readFile(join(result.artifactPath ?? '', 'stdout.txt'), 'utf8');
  const stderr = await readFile(join(result.artifactPath ?? '', 'stderr.txt'), 'utf8');
  assert.equal(stdout, 'stdout [REDACTED_SECRET]');
  assert.equal(stderr, 'stderr [REDACTED_SECRET]');

  const input = JSON.parse(await readFile(join(result.artifactPath ?? '', 'input.json'), 'utf8'));
  assert.equal(input.goal, 'Read answer');
  assert.equal(input.url, 'file:///fixture.html');
  assert.equal(input.model, 'gemini-3.1-flash-lite');
  assert.equal(input.headed, false);
  assert.equal(input.requestMinIntervalMs, 5000);
});

test('BrowserUseLocalAdapter maps non-zero runner exits to runtime failures', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-use-local-adapter-failure-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserUseLocalAdapter({
    pythonCommand: 'python',
    env: { GOOGLE_API_KEY: 'secret-key' },
    processRunner: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'package missing secret-key',
    }),
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    traceDir: outputRoot,
    headed: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureType, 'runtime_crash');
  assert.match(result.failureReason ?? '', /Browser Use local runner exited with code 1/);
  assert.doesNotMatch(result.failureReason ?? '', /secret-key/);
});

test('BrowserUseLocalAdapter uses corrected Gemini Lite model when no explicit model is passed', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'browser-use-local-adapter-default-model-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new BrowserUseLocalAdapter({
    pythonCommand: 'python',
    env: { GEMINI_API_KEY: 'secret-key' },
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: true,
        value: 'answer from Browser Use',
        metrics: { plannerCalls: 1, toolExecutions: 1 },
      }));
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bench_unit',
    attempt: 1,
    traceDir: outputRoot,
    headed: false,
  });

  const input = JSON.parse(await readFile(join(result.artifactPath ?? '', 'input.json'), 'utf8'));
  assert.equal(input.model, 'gemini-3.1-flash-lite');
});
