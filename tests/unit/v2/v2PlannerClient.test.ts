import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { TraceStore } from '../../../src/v2/trace/TraceStore';
import { buildV2PlannerSystemPrompt } from '../../../src/v2/planner/PlannerPrompt';
import type { PlannerInput, PlannerSerializationConfig } from '../../../src/v2/planner/types';

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
    quarantinedActions: [],
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
    quarantinedActions: [],
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
    quarantinedActions: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 2,
      selectedRefCount: 2,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };
  plannerInput.lastResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_button',
    evidence: {
      transitionClass: 'microstate',
      strength: 'none',
    },
    traceStepId: 'step_no_effect_click',
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
  assert.match(providerUsers[1], /previous click on ref_button produced no observable transition/i);
  assert.match(providerUsers[1], /do not assume the button became a text field/i);
});

test('V2PlannerClient gives labeled recovery guidance for click-on-readable-only evidence', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_click_readable_guidance');
  plannerInput.goal = 'Find the basic information for Castle Mountains National Monument';
  plannerInput.current.refs = {
    ref_result_row: {
      refId: 'ref_result_row',
      kind: 'generic',
      role: 'row',
      name: 'Castle Mountains National Monument, California, USA',
      text: 'Castle Mountains National Monument, California, USA',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 115,
    },
    ref_search_box: {
      refId: 'ref_search_box',
      kind: 'input',
      role: 'combobox',
      name: 'Castle Mountains National Monument',
      text: 'Castle Mountains National Monument',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 109,
    },
    ref_zoom_out: {
      refId: 'ref_zoom_out',
      kind: 'button',
      role: 'button',
      name: 'Zoom out',
      text: 'Zoom out',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 80,
    },
  };
  plannerInput.current.interactions = [
    { refId: 'ref_result_row', rank: 1 },
    { refId: 'ref_search_box', rank: 2 },
    { refId: 'ref_zoom_out', rank: 3 },
  ];
  plannerInput.current.readables = [
    { refId: 'ref_result_row', rank: 1 },
    { refId: 'ref_search_box', rank: 2 },
  ];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [
      {
        refId: 'ref_result_row',
        text: 'Castle Mountains National Monument, California, USA',
        reasons: ['goal_keyword_match'],
      },
    ],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_search_box', 'ref_zoom_out'],
      typeableRefs: ['ref_search_box'],
      selectableRefs: [],
      readableRefs: ['ref_result_row', 'ref_search_box'],
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
    quarantinedActions: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 3,
      selectedRefCount: 3,
      droppedRefCount: 0,
      droppedByReason: {},
    },
  };

  const providerUsers: string[] = [];
  const responses = [
    '{"plan":[{"tool":"click","ref":"ref_result_row"}],"confidence":"medium"}',
    '{"plan":[{"tool":"get","ref":"ref_result_row"}],"confidence":"high"}',
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

  assert.equal(result.output.plan?.[0].tool, 'get');
  assert.equal(result.output.plan?.[0].ref, 'ref_result_row');
  assert.equal(providerUsers.length, 2);
  assert.match(providerUsers[1], /Invalid ref detail: ref_result_row/);
  assert.match(providerUsers[1], /role=row/);
  assert.match(providerUsers[1], /readable-only evidence/i);
  assert.match(providerUsers[1], /use get\("ref_result_row"\)/i);
  assert.match(providerUsers[1], /ref_search_box.*Castle Mountains National Monument/);
  assert.match(providerUsers[1], /ref_zoom_out.*Zoom out/);
});

test('V2PlannerClient rescues repeated click-on-readable-only output as safe get action', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_click_readable_rescue');
  plannerInput.current.refs = {
    ref_result_row: {
      refId: 'ref_result_row',
      kind: 'generic',
      role: 'row',
      name: 'Castle Mountains National Monument, California, USA',
      text: 'Castle Mountains National Monument, California, USA',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 115,
    },
  };
  plannerInput.current.interactions = [{ refId: 'ref_result_row', rank: 1 }];
  plannerInput.current.readables = [{ refId: 'ref_result_row', rank: 1 }];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [
      {
        refId: 'ref_result_row',
        text: 'Castle Mountains National Monument, California, USA',
        reasons: ['goal_keyword_match'],
      },
    ],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: [],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: ['ref_result_row'],
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
    quarantinedActions: [],
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
      text: '{"plan":[{"tool":"click","ref":"ref_result_row"}],"confidence":"medium"}',
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  const result = await client.call({ plannerInput });

  assert.deepEqual(result.output, {
    plan: [{ tool: 'get', ref: 'ref_result_row' }],
    confidence: 'low',
  });
});

test('V2PlannerClient accepts queued launcher plan when first step is compatible', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const plannerInput = makePlannerInput('episode_launcher_plan');
  plannerInput.version = 'v2.planner_input.v2';
  plannerInput.current.refs = {
    ref_search_button: {
      refId: 'ref_search_button',
      kind: 'button',
      role: 'button',
      name: 'Search or jump to...',
      text: 'Search or jump to...',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      confidence: 1,
      score: 10,
    },
  };
  plannerInput.current.interactions = [{ refId: 'ref_search_button', rank: 1 }];
  plannerInput.current.readables = [];
  plannerInput.current.navigation = [];
  plannerInput.workingSet = {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_search_button'],
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
    quarantinedActions: [],
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
      text: JSON.stringify({
        plan: [
          { tool: 'click', ref: 'ref_search_button' },
          { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
          { tool: 'press', ref: 'ref_search_button', key: 'Enter' },
        ],
        confidence: 'high',
      }),
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  const result = await client.call({ plannerInput });

  assert.equal(result.output.plan?.[0].tool, 'click');
  assert.equal(result.output.plan?.[1].tool, 'type');
  assert.equal(result.output.plan?.[2].tool, 'press');
});

test('V2PlannerClient uses JSON serialization by default and switches to PRC when configured', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();

  const capturedUserMessages: string[] = [];
  function makeProvider() {
    return async (_system: string, user: string) => {
      capturedUserMessages.push(user);
      return {
        text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
        inputTokens: 1,
        outputTokens: 1,
      };
    };
  }

  // Default client — no plannerSerialization option — must use JSON
  const defaultClient = new V2PlannerClient({ provider: makeProvider() });
  await defaultClient.call({ plannerInput: makePlannerInput('episode_prc_default') });
  assert.match(
    capturedUserMessages[0],
    /^Planner input JSON:\n\{/,
    'default client must send raw JSON to provider',
  );

  // PRC-configured client — must send structured PRC output
  const prcConfig: PlannerSerializationConfig = { mode: 'prc' };
  const prcClient = new V2PlannerClient({
    provider: makeProvider(),
    plannerSerialization: prcConfig,
  });
  await prcClient.call({ plannerInput: makePlannerInput('episode_prc_opt_in') });
  assert.match(
    capturedUserMessages[1],
    /^Planner input:\nMISSION/,
    'PRC-configured client must send structured PRC output to provider',
  );
  assert.doesNotMatch(
    capturedUserMessages[1],
    /"visibility":"visible"/,
    'PRC output must not contain raw JSON attribute noise',
  );
});

test('V2PlannerClient records provider payload byte summaries without raw prompts', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const { traceDir, store } = await freshTraceStore('planner_client_provider_payload');
  const client = new V2PlannerClient({
    traceStore: store,
    plannerSerialization: { mode: 'prc' },
    provider: async (_system, _user) => ({
      text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  await client.call({ plannerInput: makePlannerInput('episode_provider_payload') });
  await store.flush();

  const outputJson = JSON.parse(await readFile(
    join(traceDir, 'run_planner_client_provider_payload', 'planner', 'episode_provider_payload-output.json'),
    'utf8',
  ));

  assert.equal(outputJson.providerPayload.serializationMode, 'prc');
  assert.equal(outputJson.providerPayload.attempts.length, 1);
  assert.equal(outputJson.providerPayload.attempts[0].attempt, 1);
  assert.equal(typeof outputJson.providerPayload.attempts[0].systemBytes, 'number');
  assert.equal(typeof outputJson.providerPayload.attempts[0].userBytes, 'number');
  assert.equal(
    outputJson.providerPayload.attempts[0].totalBytes,
    outputJson.providerPayload.attempts[0].systemBytes + outputJson.providerPayload.attempts[0].userBytes,
  );
  assert.equal(outputJson.providerPayload.rawSystemPrompt, undefined);
  assert.equal(outputJson.providerPayload.rawUserMessage, undefined);
});

test('V2PlannerClient rejects plan output in finalization mode with finalization_attempted_plan error', async () => {
  const { V2PlannerClient, V2PlannerClientError } = await loadPlannerClientModule();
  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}',
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  await assert.rejects(
    () => client.call({ plannerInput: makePlannerInput('episode_finalization_plan'), mode: 'finalization' }),
    (error: unknown) => {
      assert.ok(error instanceof V2PlannerClientError);
      assert.ok(error.errors.some(e => e.includes('finalization_attempted_plan')));
      return true;
    },
  );
});

test('V2PlannerClient accepts done output in finalization mode', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const client = new V2PlannerClient({
    provider: async () => ({
      text: '{"done":true,"val":"Task completed successfully","confidence":"high"}',
      inputTokens: 5,
      outputTokens: 3,
    }),
  });

  const result = await client.call({ plannerInput: makePlannerInput('episode_finalization_done'), mode: 'finalization' });

  assert.equal(result.output.done, true);
  assert.equal(result.output.plan, undefined);
});

// --- Truncated navigate URL detection tests ---

test('isTruncatedNavigateOutput detects truncated navigate URL', async () => {
  const { isTruncatedNavigateOutput } = await loadPlannerClientModule();

  // Truncated: navigate + url + long unfinished string, no closing braces
  const truncated = '{"plan":[{"tool":"navigate","url":"https://www.amazon.com/s?k=foo' + '%2B'.repeat(500);
  assert.equal(isTruncatedNavigateOutput(truncated), true);
});

test('isTruncatedNavigateOutput rejects non-truncated valid JSON', async () => {
  const { isTruncatedNavigateOutput } = await loadPlannerClientModule();

  // Valid JSON — ends with structural close
  const valid = '{"plan":[{"tool":"navigate","url":"https://example.com"}]}';
  assert.equal(isTruncatedNavigateOutput(valid), false);
});

test('isTruncatedNavigateOutput rejects non-navigate truncated JSON', async () => {
  const { isTruncatedNavigateOutput } = await loadPlannerClientModule();

  // Truncated, but no navigate/url — should not trigger
  const noNavigate = '{"plan":[{"tool":"click","ref":"v2ref_' + 'a'.repeat(600);
  assert.equal(isTruncatedNavigateOutput(noNavigate), false);
});

test('isTruncatedNavigateOutput rejects short truncated navigate', async () => {
  const { isTruncatedNavigateOutput } = await loadPlannerClientModule();

  // Has navigate + url but URL is short (< 500 chars) — not truncation, just malformed
  const shortTrunc = '{"plan":[{"tool":"navigate","url":"https://example.com/short';
  assert.equal(isTruncatedNavigateOutput(shortTrunc), false);
});

test('isTruncatedNavigateOutput rejects non-JSON garbage', async () => {
  const { isTruncatedNavigateOutput } = await loadPlannerClientModule();
  assert.equal(isTruncatedNavigateOutput('not json at all'), false);
});

test('V2PlannerClient returns url_truncated error for truncated navigate and retries with feedback', async () => {
  const { V2PlannerClient } = await loadPlannerClientModule();
  const truncatedText = '{"plan":[{"tool":"navigate","url":"https://www.amazon.com/s?k=' + 'x'.repeat(600);
  const validText = '{"plan":[{"tool":"click","ref":"ref_submit"}],"confidence":"high"}';

  let callCount = 0;
  const client = new V2PlannerClient({
    provider: async (_system, user) => {
      callCount += 1;
      if (callCount === 1) {
        return { text: truncatedText, inputTokens: 5, outputTokens: 3 };
      }
      // Verify retry feedback contains url_truncated guidance
      assert.match(user, /url_truncated/);
      return { text: validText, inputTokens: 5, outputTokens: 3 };
    },
  });

  const result = await client.call({ plannerInput: makePlannerInput('episode_truncated') });
  assert.equal(callCount, 2);
  assert.equal(result.output.plan?.[0].tool, 'click');
});
