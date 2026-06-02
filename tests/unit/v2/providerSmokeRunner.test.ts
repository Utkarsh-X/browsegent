import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { PlannerInput, PlannerOutput } from '../../../src/v2';

async function loadProviderSmokeRunner() {
  try {
    return await import('../../eval/v2/run_provider_smoke');
  } catch (error) {
    assert.fail(`expected provider smoke runner module to exist: ${(error as Error).message}`);
  }
}

test('runProviderSmoke writes a skipped report unless explicitly enabled', async () => {
  const { runProviderSmoke } = await loadProviderSmokeRunner();
  const outputRoot = await freshRoot('provider-smoke-skip');

  const summary = await runProviderSmoke({
    runId: 'provider_skip',
    outputRoot,
    env: { BROWSEGENT_RUN_PROVIDER_SMOKE: 'false' },
    plannerInput: makePlannerInput(),
  });

  assert.equal(summary.status, 'skipped');
  assert.equal(summary.failureReason, 'provider_smoke_not_enabled');

  const report = JSON.parse(await readFile(summary.reportPath, 'utf8'));
  assert.equal(report.status, 'skipped');
  assert.equal(report.fixture, 'static-controls.html');
});

test('runProviderSmoke requires explicit v2 agent runtime mode when enabled', async () => {
  const { runProviderSmoke } = await loadProviderSmokeRunner();
  const outputRoot = await freshRoot('provider-smoke-runtime');

  const summary = await runProviderSmoke({
    runId: 'provider_runtime',
    outputRoot,
    env: {
      BROWSEGENT_RUN_PROVIDER_SMOKE: 'true',
      BROWSEGENT_V2_RUNTIME: 'mvr',
    },
    plannerInput: makePlannerInput(),
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureReason, 'provider_smoke_requires_agent_runtime');
});

test('runProviderSmoke records validated provider planner output', async () => {
  const { runProviderSmoke } = await loadProviderSmokeRunner();
  const outputRoot = await freshRoot('provider-smoke-pass');
  const output: PlannerOutput = { done: true, val: 'visible' };

  const summary = await runProviderSmoke({
    runId: 'provider_pass',
    outputRoot,
    env: {
      BROWSEGENT_RUN_PROVIDER_SMOKE: 'true',
      BROWSEGENT_V2_RUNTIME: 'agent',
    },
    plannerInput: makePlannerInput(),
    plannerClient: {
      call: async () => ({
        output,
        rawText: JSON.stringify(output),
        inputTokens: 10,
        outputTokens: 5,
        durationMs: 7,
      }),
    },
  });

  assert.equal(summary.status, 'passed');
  assert.equal(summary.validationErrors?.length ?? 0, 0);
  assert.equal(summary.metrics?.inputTokens, 10);

  const report = JSON.parse(await readFile(summary.reportPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.output, output);
});

function makePlannerInput(): PlannerInput {
  return {
    version: 'v2.planner_input.v1',
    episodeId: 'episode_provider_unit',
    goal: 'Report visible page state',
    current: {
      projectionId: 'projection_provider_unit',
      observationId: 'obs_provider_unit',
      generationId: 1,
      page: {
        url: 'file:///static-controls.html',
        title: 'Static Controls Fixture',
      },
      stats: {
        interactionCount: 1,
        readableCount: 1,
        navigationCount: 0,
        regionCount: 0,
      },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1',
          kind: 'button',
          role: 'button',
          name: 'Submit form',
          text: 'Submit form',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 10,
        },
      },
      interactions: [{ refId: 'v2ref_1', rank: 1 }],
      readables: [{ refId: 'v2ref_1', rank: 1 }],
      navigation: [],
      regions: [],
      warnings: [],
    },
    uncertainty: {
      level: 'none',
      signals: [],
    },
  };
}

async function freshRoot(name: string): Promise<string> {
  const root = join(process.cwd(), 'logs', 'v2-provider-smoke-unit', name);
  await rm(root, { recursive: true, force: true });
  return root;
}
