import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildV2PlannerSystemPrompt } from '../../../src/v2/planner/PlannerPrompt';
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
      refs: {
        ref_submit: {
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
      },
      interactions: [{ refId: 'ref_submit', rank: 1 }],
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

test('V2PlannerClient passes the V2 planner response schema to provider', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const providerCalls: Array<{ options?: { responseSchema?: unknown } }> = [];
  const client = new V2PlannerClient({
    provider: async (_system, _user, _model, options) => {
      providerCalls.push({ options });
      return {
        text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
        inputTokens: 5,
        outputTokens: 3,
      };
    },
  });

  await client.call({ plannerInput: makePlannerInput('episode_v2_schema') });

  assert.ok(providerCalls[0].options?.responseSchema);
  assert.doesNotMatch(JSON.stringify(providerCalls[0].options?.responseSchema), /"sel"|"selector"/);
});

test('V2PlannerClient accepts refs from canonical current refs when views contain no full item facts', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_canonical_refs');

  (plannerInput.current as unknown as {
    refs: Record<string, unknown>;
    interactions: Array<{ refId: string; rank: number }>;
    readables: Array<{ refId: string; rank: number }>;
    navigation: Array<{ refId: string; rank: number }>;
    focus?: undefined;
  }).refs = {
    ref_submit: {
      refId: 'ref_submit',
      kind: 'button',
      role: 'button',
      name: 'Submit',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 10,
    },
  };
  (plannerInput.current as unknown as { interactions: Array<{ refId: string; rank: number }> }).interactions = [
  ];
  (plannerInput.current as unknown as { readables: Array<{ refId: string; rank: number }> }).readables = [];
  (plannerInput.current as unknown as { navigation: Array<{ refId: string; rank: number }> }).navigation = [];
  plannerInput.current.focus = undefined;

  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  const result = await client.call({ plannerInput });

  assert.equal(result.output.plan?.[0].ref, 'ref_submit');
});

test('buildV2PlannerSystemPrompt describes canonical refs and lightweight projection views', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /current\.refs contains selected ref facts only/);
  assert.match(prompt, /workingSet explains why selected refs were included/);
  assert.match(prompt, /bounded views over selected refs/);
});

test('V2PlannerClient validation accepts refs selected through working set current refs only', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_working_set_refs');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.current.refs = {
    ref_visible: {
      refId: 'ref_visible',
      kind: 'button',
      role: 'button',
      name: 'Visible action',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 100,
    },
  };
  plannerInput.current.interactions = [{ refId: 'ref_visible', rank: 1 }];
  plannerInput.current.readables = [];
  plannerInput.current.navigation = [];

  const client = new V2PlannerClient({
    provider: async () => ({
      text: JSON.stringify({ plan: [{ tool: 'click', ref: 'ref_hidden_omitted' }], confidence: 'high' }),
      inputTokens: 1,
      outputTokens: 1,
    }),
  });

  await assert.rejects(
    () => client.call({ plannerInput }),
    /ref_hidden_omitted/,
  );
});

test('V2PlannerClient rejects high-confidence type actions against known non-typeable refs', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_wrong_lane');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_submit'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: [],
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 0,
      topRefs: [],
      omittedCount: 0,
    },
    failedRefs: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 1,
      selectedRefCount: 1,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };
  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"plan":[{"tool":"type","ref":"ref_submit","text":"hello"}],"confidence":"high"}',
      inputTokens: 1,
      outputTokens: 1,
    }),
  });

  await assert.rejects(
    () => client.call({ plannerInput }),
    /not compatible with tool "type"/,
  );
});

test('V2PlannerClient allows ambiguous refs through action compatibility validation', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_ambiguous_lane');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: ['ref_submit'],
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 0,
      topRefs: [],
      omittedCount: 0,
    },
    failedRefs: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 1,
      selectedRefCount: 1,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };
  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"medium"}',
      inputTokens: 1,
      outputTokens: 1,
    }),
  });

  const result = await client.call({ plannerInput });

  assert.equal(result.output.plan?.[0].ref, 'ref_submit');
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
  plannerInput.current.refs = {
    v2ref_1: {
      ...plannerInput.current.refs.ref_submit,
      refId: 'v2ref_1',
      name: 'Open',
      text: undefined,
    },
    v2ref_2: {
      ...plannerInput.current.refs.ref_submit,
      refId: 'v2ref_2',
      name: 'Late action',
      text: undefined,
    },
  };
  plannerInput.current.interactions = [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }];
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

test('V2PlannerClient includes action-compatible ref alternatives in retry feedback for type-on-non-typeable', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_compat_guidance');
  plannerInput.current.refs = {
    ref_button: {
      refId: 'ref_button',
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
    ref_input: {
      refId: 'ref_input',
      kind: 'input',
      role: 'textbox',
      name: 'Search',
      text: '',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 10,
    },
  };
  plannerInput.current.interactions = [
    { refId: 'ref_button', rank: 1 },
    { refId: 'ref_input', rank: 2 },
  ];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_button'],
      typeableRefs: ['ref_input'],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: [],
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 0,
      topRefs: [],
      omittedCount: 0,
    },
    failedRefs: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 2,
      selectedRefCount: 2,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };

  const providerUsers: string[] = [];
  const responses = [
    '{"plan":[{"tool":"type","ref":"ref_button","text":"hello"}],"confidence":"high"}',
    '{"plan":[{"tool":"type","ref":"ref_input","text":"hello"}],"confidence":"high"}',
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

  const result = await client.call({ plannerInput });

  assert.equal(result.output.plan?.[0].ref, 'ref_input');
  assert.equal(providerUsers.length, 2);
  assert.match(providerUsers[1], /not compatible with tool "type"/);
  assert.match(providerUsers[1], /ref_input/);
});
