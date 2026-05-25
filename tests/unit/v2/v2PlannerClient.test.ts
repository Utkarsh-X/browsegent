import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { TraceStore } from '../../../src/v2/trace/TraceStore';
import type { PlannerInput } from '../../../src/v2/planner/types';

async function loadPlannerClientModule() {
  try {
    return await import('../../../src/v2/planner/V2PlannerClient');
  } catch (error) {
    assert.fail(`expected v2 planner client module to exist: ${(error as Error).message}`);
  }
}

function makePlannerInput(episodeId = 'episode_client'): PlannerInput {
  return {
    version: 'v2.planner_input.v1',
    episodeId,
    goal: 'Click submit',
    current: {
      projectionId: 'projection_1',
      observationId: 'obs_1',
      generationId: 1,
      page: {
        url: 'https://example.test/form',
        title: 'Form',
      },
      interactions: [
        {
          refId: 'ref_submit',
          kind: 'button',
          role: 'button',
          name: 'Submit',
          text: 'Submit',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 10,
        },
      ],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: {
        interactionCount: 1,
        readableCount: 0,
        navigationCount: 0,
        regionCount: 0,
      },
    },
    uncertainty: {
      level: 'none',
      signals: [],
    },
  };
}

async function freshTraceStore(name: string): Promise<{ traceDir: string; store: TraceStore }> {
  const traceDir = join(process.cwd(), 'logs', 'v2-unit-traces', name);
  await rm(traceDir, { recursive: true, force: true });
  await mkdir(traceDir, { recursive: true });
  return {
    traceDir,
    store: new TraceStore({
      runId: `run_${name}`,
      runtimeMode: 'mvr',
      traceDir,
      startTime: 7777,
    }),
  };
}

test('V2PlannerClient accepts validated ref-first planner output and records replay artifacts', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const { traceDir, store } = await freshTraceStore('planner_client_valid');
  const providerCalls: Array<{ system: string; user: string; model?: string }> = [];
  const client = new V2PlannerClient({
    traceStore: store,
    provider: async (system, user, model) => {
      providerCalls.push({ system, user, model });
      return {
        text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
        inputTokens: 11,
        outputTokens: 7,
      };
    },
  });

  const result = await client.call({
    plannerInput: makePlannerInput('episode_valid'),
    model: 'test-model',
  });
  const manifest = await store.flush();

  assert.equal(result.output.plan?.[0].ref, 'ref_submit');
  assert.equal(result.inputTokens, 11);
  assert.equal(result.outputTokens, 7);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].model, 'test-model');
  assert.match(providerCalls[0].system, /BrowseGent v2 planner/);
  assert.match(providerCalls[0].user, /episode_valid/);
  assert.equal(manifest.artifacts.planner.length, 2);

  const outputJson = JSON.parse(await readFile(
    join(traceDir, 'run_planner_client_valid', 'planner', 'episode_valid-output.json'),
    'utf8',
  ));
  assert.equal(outputJson.validation.ok, true);
  assert.equal(outputJson.output.plan[0].ref, 'ref_submit');
});

test('V2PlannerClient retries once with validation feedback after invalid selector output', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const providerUsers: string[] = [];
  const responses = [
    '{"plan":[{"tool":"click","selector":"#submit"}],"confidence":"high"}',
    '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
  ];
  const client = new V2PlannerClient({
    provider: async (_system, user) => {
      providerUsers.push(user);
      return {
        text: responses.shift() ?? '{}',
        inputTokens: 5,
        outputTokens: 3,
      };
    },
  });

  const result = await client.call({ plannerInput: makePlannerInput('episode_retry') });

  assert.equal(result.output.plan?.[0].ref, 'ref_submit');
  assert.equal(providerUsers.length, 2);
  assert.match(providerUsers[1], /selector fields are not valid in v2 planner output/);
});

test('V2PlannerClient accepts legacy sel field only when it contains a known ref', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const providerUsers: string[] = [];
  const client = new V2PlannerClient({
    provider: async (_system, user) => {
      providerUsers.push(user);
      return {
        text: '{"plan":[{"tool":"click","sel":"ref_submit"}],"confidence":"high"}',
        inputTokens: 5,
        outputTokens: 3,
      };
    },
  });

  const result = await client.call({ plannerInput: makePlannerInput('episode_sel_ref') });

  assert.equal(result.output.plan?.[0].ref, 'ref_submit');
  assert.equal('sel' in (result.output.plan?.[0] ?? {}), false);
  assert.equal(providerUsers.length, 1);
});

test('V2PlannerClient accepts safe ref-token and region aliases from planner output', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const client = new V2PlannerClient({
    provider: async () => ({
      text: JSON.stringify({
        plan: [
          { tool: 'inspect_region', sel: 'region_repeated_1' },
          { tool: 'get', selector: 'v2ref_2' },
        ],
        confidence: 'high',
      }),
      inputTokens: 8,
      outputTokens: 4,
    }),
  });
  const plannerInput = makePlannerInput('episode_safe_aliases');
  plannerInput.current.interactions = [
    { ...plannerInput.current.interactions[0], refId: 'v2ref_1', name: 'Open', text: 'Open' },
    { ...plannerInput.current.interactions[0], refId: 'v2ref_2', name: 'Late action', text: 'Late action' },
  ];
  plannerInput.current.regions = [{
    regionId: 'region_repeated_1',
    kind: 'repeated_list',
    label: 'Repeated button controls',
    refIds: ['v2ref_1', 'v2ref_2'],
    score: 100,
  }];

  const result = await client.call({ plannerInput });

  assert.deepEqual(result.output.plan, [
    { tool: 'inspect_region', ref: 'v2ref_1' },
    { tool: 'get', ref: 'v2ref_2' },
  ]);
});

test('V2PlannerClient fails deterministically after bounded validation retry is exhausted', async () => {
  const { V2PlannerClient, V2PlannerClientError } = await loadPlannerClientModule();
  const { traceDir, store } = await freshTraceStore('planner_client_invalid');
  const client = new V2PlannerClient({
    traceStore: store,
    provider: async () => ({
      text: '{"plan":[{"tool":"evaluate_js","script":"document.body.click()"}],"confidence":"low"}',
      inputTokens: 4,
      outputTokens: 6,
    }),
  });

  await assert.rejects(
    () => client.call({ plannerInput: makePlannerInput('episode_invalid') }),
    (error: unknown) => {
      assert.ok(error instanceof V2PlannerClientError);
      assert.match(error.message, /Planner output invalid after retry/);
      assert.equal(error.attempts, 2);
      assert.equal(error.inputTokens, 8);
      assert.equal(error.outputTokens, 12);
      assert.ok(error.durationMs >= 0);
      assert.ok(error.errors.some(message => message.includes('unknown tool')));
      return true;
    },
  );

  await store.flush();
  const outputJson = JSON.parse(await readFile(
    join(traceDir, 'run_planner_client_invalid', 'planner', 'episode_invalid-output.json'),
    'utf8',
  ));

  assert.equal(outputJson.validation.ok, false);
  assert.equal(outputJson.attempts, 2);
  assert.match(outputJson.rawText, /evaluate_js/);
});

test('V2PlannerClient records provider failures as planner replay artifacts', async () => {
  const { V2PlannerClient, V2PlannerClientError } = await loadPlannerClientModule();
  const { traceDir, store } = await freshTraceStore('planner_client_provider_error');
  const client = new V2PlannerClient({
    traceStore: store,
    provider: async () => {
      throw new Error('API_QUOTA_EXCEEDED: Gemini key hit rate limit.');
    },
  });

  await assert.rejects(
    () => client.call({ plannerInput: makePlannerInput('episode_provider_error') }),
    (error: unknown) => {
      assert.ok(error instanceof V2PlannerClientError);
      assert.match(error.message, /API_QUOTA_EXCEEDED/);
      assert.equal(error.attempts, 1);
      return true;
    },
  );

  await store.flush();
  const outputJson = JSON.parse(await readFile(
    join(traceDir, 'run_planner_client_provider_error', 'planner', 'episode_provider_error-output.json'),
    'utf8',
  ));

  assert.equal(outputJson.validation.ok, false);
  assert.deepEqual(outputJson.validation.errors, ['provider_error:API_QUOTA_EXCEEDED: Gemini key hit rate limit.']);
});
