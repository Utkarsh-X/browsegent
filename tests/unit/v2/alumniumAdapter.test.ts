import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AlumniumAdapter } from '../../benchmark/v2/adapters/AlumniumAdapter';
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

test('AlumniumAdapter writes sanitized artifacts and maps runner result', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'alumnium-local-adapter-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new AlumniumAdapter({
    pythonCommand: 'python',
    env: { GEMINI_API_KEY: 'secret-key' },
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: true,
        value: 'answer from Alumnium',
        metrics: {
          plannerCalls: 4,
          toolExecutions: 4,
          inputTokens: 25,
          outputTokens: 15,
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

  assert.equal(result.adapterId, 'alumnium-local');
  assert.equal(result.success, true);
  assert.equal(result.value, 'answer from Alumnium');
  assert.equal(result.metrics.plannerCalls, 4);
  assert.equal(result.metrics.toolExecutions, 4);
  assert.equal(result.artifactPath?.includes('alumnium-local'), true);

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

test('AlumniumAdapter maps non-zero exit code to runtime_crash', async () => {
  const outputRoot = join(process.cwd(), 'logs', 'alumnium-local-adapter-failure-unit');
  await rm(outputRoot, { recursive: true, force: true });

  const adapter = new AlumniumAdapter({
    pythonCommand: 'python',
    env: {},
    processRunner: async (_command, args) => {
      const outputFlag = args.indexOf('--output');
      const outputPath = args[outputFlag + 1];
      await writeFile(outputPath, JSON.stringify({
        success: false,
        value: '',
        failureReason: 'TimeoutError: page timed out',
        failureType: 'runtime_crash',
      }));
      return { exitCode: 1, stdout: '', stderr: 'crash' };
    },
  });

  const result = await adapter.run(task, {
    runId: 'bench_fail',
    attempt: 1,
    traceDir: outputRoot,
    headed: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureType, 'runtime_crash');
  assert.ok(result.failureReason?.includes('exited with code 1'));
});
