import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBrowserObservation } from '../../../src/v2/substrate/ObservationService';
import type { BrowserObservation, TransitionEvidence, V2Ref, V2ToolResult } from '../../../src/v2';
import type { FailureEvidence } from '../../../src/v2/runtime/FailureClassifier';
import type { PlannerInput, PlannerOutput, PlannerPressKey } from '../../../src/v2/planner/types';
import type { TraceArtifact, TraceManifest } from '../../../src/v2/trace/types';

async function loadAgentLoopModule() {
  try {
    return await import('../../../src/v2/agent/V2AgentLoop');
  } catch (error) {
    assert.fail(`expected v2 agent loop module to exist: ${(error as Error).message}`);
  }
}

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_submit',
    generationId: 1,
    targetId: 'target_submit',
    selectorCandidates: ['#submit'],
    role: 'button',
    name: 'Submit',
    text: 'Submit',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(id: string, overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return buildBrowserObservation({
    observationId: id,
    sessionId: 'session_agent',
    generationId: overrides.generationId ?? 1,
    url: 'https://example.test/form',
    title: 'Agent Fixture',
    timestamp: Date.now(),
    durationMs: 1,
    refs: [makeRef()],
    warnings: [],
    ...overrides,
  });
}

function makeEvidence(before = 'obs_before', after = 'obs_after'): TransitionEvidence {
  return {
    beforeObservationId: before,
    afterObservationId: after,
    transitionClass: 'structural_local',
    strength: 'moderate',
    generationChanged: false,
    urlChanged: false,
    refChanges: {
      appeared: [],
      disappeared: [],
      weakened: [],
      preserved: ['ref_submit'],
    },
    notes: [],
  };
}

function makeNoProgressEvidence(before = 'obs_before', after = 'obs_after'): TransitionEvidence {
  return {
    beforeObservationId: before,
    afterObservationId: after,
    transitionClass: 'microstate',
    strength: 'none',
    generationChanged: false,
    urlChanged: false,
    refChanges: {
      appeared: [],
      disappeared: [],
      weakened: [],
      preserved: ['ref_submit'],
    },
    notes: [],
  };
}

class FakeHarness {
  openedUrl?: string;
  navigatedUrl?: string;
  closed = false;
  observeCount = 0;
  observations: BrowserObservation[];
  plannerInputs: Array<{ episodeId: string; input: unknown }> = [];
  plannerOutputs: Array<{ episodeId: string; output: unknown }> = [];
  compactPlannerViews: Array<{ episodeId: string; payload: unknown }> = [];
  failures: FailureEvidence[] = [];
  flushCount = 0;

  constructor(observations = [makeObservation('obs_initial'), makeObservation('obs_after_action')]) {
    this.observations = [...observations];
  }

  async open(url: string): Promise<BrowserObservation> {
    this.openedUrl = url;
    return this.observations[0];
  }

  async observe(): Promise<BrowserObservation> {
    this.observeCount += 1;
    return this.observations[Math.min(1, this.observations.length - 1)];
  }

  getCurrentObservation(): BrowserObservation {
    return this.observations[Math.min(1, this.observations.length - 1)];
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async flushTrace(): Promise<TraceManifest> {
    this.flushCount += 1;
    return {
      runId: 'run_agent_loop',
      runtimeMode: 'mvr',
      startTime: 100,
      steps: [],
      artifacts: {
        trace: { kind: 'trace', id: 'trace', path: 'logs/v2-runs/run_agent_loop/trace.json' },
        observations: [],
        transitions: [],
        graph: [],
        planner: [],
        compactPlannerViews: [],
        failures: [],
        screenshots: [],
      },
    };
  }

  recordPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    this.plannerInputs.push({ episodeId, input });
    return { kind: 'planner_input', id: 'planner-input', path: 'planner-input.json' };
  }

  recordCompactPlannerInput(episodeId: string, input: unknown): TraceArtifact {
    this.plannerInputs.push({ episodeId, input });
    return { kind: 'compact_planner_input', id: 'compact-planner-input', path: 'compact-planner-input.json' };
  }

  recordPlannerOutput(episodeId: string, output: unknown): TraceArtifact {
    this.plannerOutputs.push({ episodeId, output });
    return { kind: 'planner_output', id: 'planner-output', path: 'planner-output.json' };
  }

  recordCompactPlannerView(episodeId: string, payload: unknown): TraceArtifact {
    this.compactPlannerViews.push({ episodeId, payload });
    return { kind: 'planner_compact_view', id: `${episodeId}-compact`, path: `${episodeId}-compact.json` };
  }

  recordFailureEvidence(failure: FailureEvidence): TraceArtifact {
    this.failures.push(failure);
    return { kind: 'failure', id: failure.failureId, path: `${failure.failureId}.json` };
  }

  async click(refId: string): Promise<V2ToolResult> {
    return { success: true, kind: 'click', targetRef: refId, traceStepId: 'fake_click' };
  }

  async type(refId: string, text: string): Promise<V2ToolResult<{ inputValue: string }>> {
    return { success: true, kind: 'type', targetRef: refId, value: { inputValue: text }, traceStepId: 'fake_type' };
  }

  async select(refId: string, value: string): Promise<V2ToolResult<{ value: string }>> {
    return { success: true, kind: 'select', targetRef: refId, value: { value }, traceStepId: 'fake_select' };
  }


  async press(key: PlannerPressKey): Promise<V2ToolResult<{ key: PlannerPressKey }>> {
    return { success: true, kind: 'press', value: { key }, traceStepId: 'fake_press' };
  }

  async navigate(url: string): Promise<V2ToolResult<{ url: string }>> {
    this.navigatedUrl = url;
    return {
      success: true,
      kind: 'navigate',
      value: { url },
      evidence: makeEvidence('obs_initial', 'obs_after_action'),
      traceStepId: 'fake_navigate',
    };
  }

  async get(refId: string): Promise<V2ToolResult<{ text: string; value?: string }>> {
    return { success: true, kind: 'get', targetRef: refId, value: { text: 'Submit' }, traceStepId: 'fake_get' };
  }

  async inspectRegion(refId: string): Promise<V2ToolResult<{ refId: string; text: string; nearbyRefs: string[] }>> {
    return { success: true, kind: 'inspect_region', targetRef: refId, value: { refId, text: 'Submit', nearbyRefs: [] }, traceStepId: 'fake_inspect' };
  }

  async searchPage(): Promise<V2ToolResult<{ matches: number; preview: string[] }>> {
    return { success: true, kind: 'search_page', value: { matches: 1, preview: ['Submit'] }, traceStepId: 'fake_search' };
  }

  async scroll(direction: 'down' | 'up' = 'down'): Promise<V2ToolResult<{ direction: 'down' | 'up' }>> {
    return { success: true, kind: 'scroll', value: { direction }, traceStepId: 'fake_scroll' };
  }

  async waitForState(): Promise<V2ToolResult<{ matched: boolean }>> {
    return { success: true, kind: 'wait', value: { matched: true }, traceStepId: 'fake_wait' };
  }
}

class FakePlanner {
  readonly inputs: PlannerInput[] = [];
  private readonly outputs: PlannerOutput[];

  constructor(outputs: PlannerOutput[]) {
    this.outputs = [...outputs];
  }

  async call(input: { plannerInput: PlannerInput; model?: string }) {
    this.inputs.push(input.plannerInput);
    const output = this.outputs.shift() ?? { escalate: 'dead_end', reason: 'no planner output' };
    return {
      output,
      rawText: JSON.stringify(output),
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 7,
    };
  }
}

class FakeDispatcher {
  readonly steps: PlannerOutput['plan'] = [];
  readonly results: V2ToolResult[] = [];
  nextResult?: V2ToolResult;

  async dispatch(step: NonNullable<PlannerOutput['plan']>[number]): Promise<V2ToolResult> {
    this.steps?.push(step);
    const queuedResult = this.results.shift();
    if (queuedResult) {
      return queuedResult;
    }
    if (this.nextResult) {
      return this.nextResult;
    }

    return {
      success: true,
      kind: step.tool,
      targetRef: step.ref,
      traceStepId: `tool_${this.steps?.length ?? 0}`,
      evidence: makeEvidence(),
    };
  }
}

test('V2AgentLoop returns done output without executing tools', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([{ done: true, val: 'Visible answer' }]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible text',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Visible answer');
  assert.equal(result.metrics.plannerCalls, 1);
  assert.equal(result.metrics.toolExecutions, 0);
  assert.equal(harness.openedUrl, 'https://example.test/form');
  assert.equal(harness.closed, true);
});

test('V2AgentLoop reuses the harness post-action observation instead of recapturing it', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'navigate', url: 'https://example.test/results' }], confidence: 'high' },
    { done: true, val: 'The result is visible.' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push({
    success: true,
    kind: 'navigate',
    value: { url: 'https://example.test/results' },
    evidence: makeEvidence('obs_initial', 'obs_after_action'),
    traceStepId: 'fake_navigate',
  });
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible result',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(harness.observeCount, 0);
  assert.equal(result.metrics.postActionObservationReuseCount, 1);
  assert.equal(result.metrics.postActionObservationRecaptureCount, 0);
});

test('V2AgentLoop replans once when done output misses required answer details', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    {
      done: true,
      val: 'Sustainability means the quality of being able to continue over time. Pronunciation is available via audio buttons.',
    },
    {
      done: true,
      val: 'UK: /səˌsteɪ.nəˈbɪl.ə.ti/, US: /səˌsteɪ.nəˈbɪl.ə.t̬i/; definition: the quality of being able to continue over a period of time.',
    },
  ]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/dictionary',
    goal: 'Look up the pronunciation and definition of the word "sustainability"',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.match(result.value, /UK:/);
  assert.equal(result.metrics.plannerCalls, 2);
  assert.equal(result.metrics.toolExecutions, 0);
  assert.match(planner.inputs[1].answerFeedback?.previousAnswer ?? '', /Pronunciation is available/);
  assert.deepEqual(planner.inputs[1].answerFeedback?.missingDetails, ['missing_pronunciation_detail']);
});

test('V2AgentLoop replans when done output explicitly reports an unfinished result', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      done: true,
      val: 'The search has not been executed yet, so the lowest price option is not currently available.',
    },
    { done: true, val: 'The lowest round-trip price is 412 USD.' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/flights',
    goal: 'Find the lowest round-trip flight price',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'The lowest round-trip price is 412 USD.');
  assert.equal(result.metrics.plannerCalls, 2);
  assert.deepEqual(planner.inputs[1].answerFeedback?.missingDetails, ['incomplete_answer']);
});

test('V2AgentLoop replans when done output omits a pronunciation variant present in evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    {
      done: true,
      val: 'The pronunciation is /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.ti/ (UK). The definition is the quality of being able to continue over a period of time.',
    },
    {
      done: true,
      val: 'UK: /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.ti/, US: /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.tÌ¬i/; definition: the quality of being able to continue over a period of time.',
    },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push({
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    traceStepId: 'fake_get',
    value: {
      text: 'sustainability noun [ U ] uk Your browser does not support HTML5 audio /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.ti/ us Your browser does not support HTML5 audio /sÉ™ËŒsteÉª.nÉ™ËˆbÉªl.É™.tÌ¬i/ the quality of being able to continue over a period of time',
    },
  });
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/dictionary',
    goal: 'Look up the pronunciation and definition of the word "sustainability"',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.match(result.value, /US:/);
  assert.equal(result.metrics.plannerCalls, 3);
  assert.deepEqual(planner.inputs[2].answerFeedback?.missingDetails, ['missing_pronunciation_variant_us']);
});

test('V2AgentLoop validates done output against accumulated read history, not only the latest read', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    {
      done: true,
      val: 'UK: /səˌsteɪ.nəˈbɪl.ə.ti/; definition: the quality of being able to continue over a period of time.',
    },
    {
      done: true,
      val: 'UK: /səˌsteɪ.nəˈbɪl.ə.ti/, US: /səˌsteɪ.nəˈbɪl.ə.t̬i/; definition: the quality of being able to continue over a period of time.',
    },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push(
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      traceStepId: 'fake_get_rich_pronunciation',
      value: {
        text: 'sustainability noun uk /səˌsteɪ.nəˈbɪl.ə.ti/ us /səˌsteɪ.nəˈbɪl.ə.t̬i/ definition: the quality of being able to continue over a period of time',
      },
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      traceStepId: 'fake_get_short_pronunciation',
      value: {
        text: 'sustainability noun uk /səˌsteɪ.nəˈbɪl.ə.ti/ definition: the quality of being able to continue over a period of time',
      },
    },
  );
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/dictionary',
    goal: 'Look up the pronunciation and definition of the word "sustainability"',
    maxSteps: 4,
  });

  assert.equal(result.success, true);
  assert.match(result.value, /US:/);
  assert.equal(planner.inputs.length, 4);
  assert.deepEqual(planner.inputs[3].answerFeedback?.missingDetails, ['missing_pronunciation_variant_us']);
});

test('V2AgentLoop records planner artifacts for injected planner clients', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([{ done: true, val: 'Visible answer' }]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible text',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(harness.plannerInputs.length, 1);
  assert.equal(harness.plannerOutputs.length, 1);
  assert.equal(harness.plannerOutputs[0].episodeId, harness.plannerInputs[0].episodeId);
  assert.deepEqual((harness.plannerOutputs[0].output as { validation?: unknown }).validation, {
    ok: true,
    errors: [],
  });
});

test('V2AgentLoop closes harness when opening the target fails', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  harness.open = async () => {
    throw new Error('open failed');
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: new FakePlanner([]),
    dispatcherFactory: () => new FakeDispatcher(),
  });

  await assert.rejects(
    () => loop.run({
      url: 'https://example.test/broken',
      goal: 'Open broken target',
      maxSteps: 1,
    }),
    /open failed/,
  );
  assert.equal(harness.closed, true);
});

test('V2AgentLoop returns non-validation planner client failures with flushed trace evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: {
      call: async () => {
        throw Object.assign(
          new Error('API_QUOTA_EXCEEDED: Gemini key hit rate limit.'),
          { inputTokens: 8, outputTokens: 12, durationMs: 20 },
        );
      },
    },
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.match(result.failureReason ?? '', /planner_client_error/);
  assert.match(result.failureReason ?? '', /API_QUOTA_EXCEEDED/);
  assert.equal(result.metrics.plannerCalls, 1);
  assert.equal(result.metrics.inputTokens, 8);
  assert.equal(result.metrics.outputTokens, 12);
  assert.equal(result.metrics.plannerDurationMs, 20);
  assert.equal(result.tracePath, 'logs/v2-runs/run_agent_loop/trace.json');
  assert.equal(harness.flushCount, 1);
  assert.equal(harness.closed, true);
});

test('V2AgentLoop does not classify provider errors with errors arrays as invalid planner output', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: {
      call: async () => {
        throw Object.assign(new Error('fetch failed'), {
          errors: ['network socket closed'],
          inputTokens: 11,
          outputTokens: 0,
          durationMs: 19,
        });
      },
    },
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_client_error:fetch failed');
  assert.equal(result.metrics.inputTokens, 11);
  assert.equal(result.metrics.outputTokens, 0);
  assert.equal(result.metrics.plannerDurationMs, 19);
});

test('V2AgentLoop stops invalid planner output as controlled dead end', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: {
      call: async () => {
        throw Object.assign(
          new Error('Planner output invalid after retry: Step 1 click requires "ref"'),
          {
            errors: ['Step 1 click requires "ref"'],
            inputTokens: 8,
            outputTokens: 12,
            durationMs: 20,
          },
        );
      },
    },
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_invalid_output_dead_end');
  assert.equal(result.metrics.plannerCalls, 1);
  assert.equal(result.metrics.inputTokens, 8);
  assert.equal(result.metrics.outputTokens, 12);
  assert.equal(result.metrics.plannerDurationMs, 20);
  assert.equal(harness.flushCount, 1);
  assert.equal(harness.closed, true);
});

test('V2AgentLoop executes planner plan and feeds runtime evidence into next planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Clicked' },
  ]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Clicked');
  assert.equal(result.metrics.plannerCalls, 2);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.equal(dispatcher.steps?.[0].ref, 'ref_submit');
  assert.equal(planner.inputs[1].lastResult?.kind, 'click');
  assert.equal(planner.inputs[1].transition?.transitionClass, 'structural_local');
});

test('V2AgentLoop interrupts a mini-plan after a mutating transition before executing stale follow-up refs', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'click', ref: 'ref_submit' },
        { tool: 'get', ref: 'ref_after_click' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Replanned from fresh observation' },
  ]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read after click',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Replanned from fresh observation');
  assert.deepEqual(dispatcher.steps, [{ tool: 'click', ref: 'ref_submit' }]);
  assert.equal(planner.inputs.length, 2);
  assert.equal(result.metrics.toolExecutions, 1);
});

test('V2AgentLoop continues safe mini-plan after type when the next ref is live in the fresh observation', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_submit', text: 'Ada' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Submitted' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push(
    {
      success: true,
      kind: 'type',
      targetRef: 'ref_submit',
      value: { inputValue: 'Ada' },
      evidence: makeNoProgressEvidence(),
      traceStepId: 'tool_type',
    },
    {
      success: true,
      kind: 'click',
      targetRef: 'ref_submit',
      traceStepId: 'tool_click',
    },
  );
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Fill in the field and submit',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type', 'click']);
  assert.equal(result.metrics.toolExecutions, 2);
});

test('V2AgentLoop stops queued mini-plan step when the next ref is stale after re-observe', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const staleObservation = makeObservation('obs_after_stale', { refs: [] });
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_submit', text: 'Ada' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    { escalate: 'dead_end', reason: 'next ref stale' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push({
    success: true,
    kind: 'type',
    targetRef: 'ref_submit',
    value: { inputValue: 'Ada' },
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_type',
  });
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness([makeObservation('obs_initial'), staleObservation]),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Enter name and submit',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_escalated:dead_end:next ref stale');
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type']);
});

test('V2AgentLoop feeds failed runtime evidence into the next planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { escalate: 'dead_end', reason: 'bounded evidence received' },
  ]);
  const dispatcher = new FakeDispatcher();
  const harness = new FakeHarness();
  dispatcher.nextResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_submit',
    traceStepId: 'tool_blocked',
    error: {
      code: 'target_blocked',
      message: 'Target center point is blocked by another element.',
      retryable: false,
      diagnostics: {
        reason: 'target_blocked_by_overlay',
        candidateCount: 1,
      },
    },
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'planner_escalated:dead_end:bounded evidence received');
  assert.equal(planner.inputs[1].lastResult?.error?.code, 'target_blocked');
  assert.deepEqual(planner.inputs[1].lastResult?.error?.diagnostics, {
    reason: 'target_blocked_by_overlay',
    candidateCount: 1,
  });
  assert.deepEqual(harness.failures[0].diagnostics, {
    reason: 'target_blocked_by_overlay',
    candidateCount: 1,
  });
  assert.equal(planner.inputs[1].failures?.[0].kind, 'target_blocked');
  assert.equal(planner.inputs[1].failures?.[0].category, 'target');
  assert.equal(planner.inputs[1].failures?.[0].targetRef, 'ref_submit');
  assert.equal(harness.failures[0].kind, 'target_blocked');
  assert.equal(harness.failures[0].targetRef, 'ref_submit');
  assert.equal(planner.inputs[1].uncertainty.level, 'high');
  assert.ok(planner.inputs[1].uncertainty.signals.includes('failure:target_blocked'));
  assert.equal(planner.inputs[1].deadState?.deadState, true);
  assert.ok(planner.inputs[1].deadState?.reasons.includes('high_uncertainty'));
});

test('V2AgentLoop replans after a timeout when post-action transition proves progress', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'The page changed and the task is complete.' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_submit',
    traceStepId: 'tool_timeout_after_transition',
    error: {
      code: 'timeout',
      message: 'Click exceeded its bounded wait.',
      retryable: true,
    },
    evidence: makeEvidence(),
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit and report the result',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.equal(harness.failures.length, 1);
  assert.equal(harness.failures[0].kind, 'timeout');
  assert.equal(planner.inputs[1].failures, undefined);
  assert.equal(planner.inputs[1].deadState, undefined);
  assert.ok(planner.inputs[1].uncertainty.signals.includes('progress_after_error:timeout'));
  assert.equal(planner.inputs[1].lastResult?.error?.code, 'timeout');
  assert.equal(planner.inputs[1].transition?.strength, 'moderate');
});

test('V2AgentLoop keeps a timeout without transition on the failure path', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { escalate: 'dead_end', reason: 'timeout requires recovery' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_submit',
    traceStepId: 'tool_timeout_without_transition',
    error: {
      code: 'timeout',
      message: 'Click exceeded its bounded wait.',
      retryable: true,
    },
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(planner.inputs[1].failures?.[0].kind, 'timeout');
  assert.equal(planner.inputs[1].uncertainty.signals.includes('progress_after_error:timeout'), false);
});

test('V2AgentLoop does not reconcile target blockers with transition evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { escalate: 'dead_end', reason: 'blocked target requires recovery' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_submit',
    traceStepId: 'tool_blocked_with_transition',
    error: {
      code: 'target_blocked',
      message: 'Target is covered by another element.',
      retryable: false,
    },
    evidence: makeEvidence(),
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, false);
  assert.equal(planner.inputs[1].failures?.[0].kind, 'target_blocked');
  assert.equal(planner.inputs[1].uncertainty.signals.includes('progress_after_error:target_blocked'), false);
});

test('V2AgentLoop feeds repeated no-progress mutation evidence into the next planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Changed strategy' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_submit',
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_no_progress_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(planner.inputs[2].uncertainty.level, 'medium');
  assert.ok(planner.inputs[2].uncertainty.signals.includes('repeated_no_progress_transition:click:ref_submit:2'));
});

test('V2AgentLoop feeds repeated identical read evidence into the next planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Same visible answer' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Same visible answer' },
    traceStepId: 'tool_repeated_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible text',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(planner.inputs[2].uncertainty.level, 'medium');
  assert.ok(planner.inputs[2].uncertainty.signals.includes('repeated_value_preview:get:ref_submit:2'));
});

test('V2AgentLoop feeds repeated empty read evidence into the next planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Empty answer' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: '' },
    traceStepId: 'tool_repeated_empty_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible text',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(planner.inputs[2].uncertainty.level, 'medium');
  assert.ok(planner.inputs[2].uncertainty.signals.includes('repeated_value_preview:get:ref_submit:2'));
});

test('V2AgentLoop does not emit no-progress signals for repeated mutations with real transition evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Progressed' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_submit',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'strong',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_new_1', 'ref_new_2', 'ref_new_3'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_submit'],
      },
      notes: ['meaningful content change'],
    },
    traceStepId: 'tool_progress_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(
    planner.inputs[2].uncertainty.signals.some(signal => signal.startsWith('repeated_')),
    false,
  );
});

test('V2AgentLoop routes planner navigate steps through the default tool dispatcher', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'navigate', url: 'https://example.test/next' }], confidence: 'high' },
    { done: true, val: 'Navigated' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Open the next page',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Navigated');
  assert.equal(harness.navigatedUrl, 'https://example.test/next');
  assert.equal(result.metrics.toolExecutions, 1);
  assert.equal(planner.inputs[1].lastResult?.kind, 'navigate');
});

test('V2AgentLoop stops deterministically at maxSteps without semantic judgment', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'wait', timeout: 1 }], confidence: 'low' },
    { plan: [{ tool: 'wait', timeout: 1 }], confidence: 'low' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Wait for change',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(result.metrics.plannerCalls, 2);
  assert.equal(result.metrics.toolExecutions, 2);
});

test('V2AgentLoop fails max-step exhaustion while preserving last read evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Observed answer' },
    traceStepId: 'tool_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read answer',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.value, 'Observed answer');
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(result.metrics.plannerCalls, 3);
  assert.equal(result.metrics.toolExecutions, 2);
});

test('V2AgentLoop fails max-step exhaustion while preserving last mutation evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_submit',
    target: {
      refId: 'ref_submit',
      role: 'button',
      name: 'Open modal',
      text: 'Open modal',
    },
    evidence: makeEvidence(),
    traceStepId: 'tool_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Open the modal and report it opened',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.value, 'Open modal button');
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(result.metrics.plannerCalls, 3);
  assert.equal(result.metrics.toolExecutions, 2);
});

test('V2AgentLoop attempts finalization when useful evidence exists at max steps', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { done: true, val: 'Observed answer' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Observed answer' },
    traceStepId: 'tool_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read the visible text',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Observed answer');
  assert.equal(planner.inputs.length, 3);
  assert.match(planner.inputs[2].goal, /Finalization evidence:/);
  assert.match(planner.inputs[2].goal, /Readable evidence:/);
});

test('V2AgentLoop finalization preserves earlier rich read evidence beyond compact previews', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { escalate: 'dead_end', reason: 'not enough evidence' },
  ]);
  const dispatcher = new FakeDispatcher();
  const lateMarker = 'EARLIER-RICH-READ-DETAIL-7741';
  dispatcher.results.push(
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: `${'first read detail '.repeat(70)}${lateMarker}` },
      traceStepId: 'tool_get_rich',
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: 'Second shorter read without the late detail.' },
      traceStepId: 'tool_get_short',
    },
  );
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  await loop.run({
    url: 'https://example.test/form',
    goal: 'Report the earlier rich read detail',
    maxSteps: 2,
  });

  assert.equal(planner.inputs.length, 3);
  assert.match(planner.inputs[2].goal, new RegExp(lateMarker));
});

test('V2AgentLoop finalization preserves earliest read evidence across broader extraction history', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { escalate: 'dead_end', reason: 'not enough evidence' },
  ]);
  const dispatcher = new FakeDispatcher();
  const earliestMarker = 'EARLIEST-READ-DETAIL-5291';
  dispatcher.results.push(
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: `first extracted fact ${earliestMarker}` },
      traceStepId: 'tool_get_1',
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: 'second extracted fact' },
      traceStepId: 'tool_get_2',
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: 'third extracted fact' },
      traceStepId: 'tool_get_3',
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: 'fourth extracted fact' },
      traceStepId: 'tool_get_4',
    },
    {
      success: true,
      kind: 'get',
      targetRef: 'ref_submit',
      value: { text: 'fifth extracted fact' },
      traceStepId: 'tool_get_5',
    },
  );
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  await loop.run({
    url: 'https://example.test/form',
    goal: 'Report all extracted facts',
    maxSteps: 5,
  });

  assert.equal(planner.inputs.length, 6);
  assert.match(planner.inputs[5].goal, new RegExp(earliestMarker));
});

test('V2AgentLoop falls through to max_steps_exhausted when finalization planner refuses to finish', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'get', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'scroll' }], confidence: 'low' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'get',
    targetRef: 'ref_submit',
    value: { text: 'Observed answer' },
    traceStepId: 'tool_get',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Read answer',
    maxSteps: 2,
  });

  assert.equal(result.success, false);
  assert.equal(result.value, 'Observed answer');
  assert.equal(result.failureReason, 'v2_max_steps_exhausted');
  assert.equal(planner.inputs.length, 3);
});

test('V2AgentLoop emits repeated no-progress signal for same-ref structural_local moderate mutations', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_compute' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_compute' }], confidence: 'high' },
    { done: true, val: 'Changed strategy' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_compute',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_spinner_a', 'ref_spinner_b'],
        disappeared: ['ref_spinner_c'],
        weakened: [],
        preserved: ['ref_compute'],
      },
      notes: ['local churn only'],
    },
    traceStepId: 'tool_compute_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/calculator',
    goal: 'Trigger the calculation',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.ok(planner.inputs[2].uncertainty.signals.includes('repeated_no_progress_transition:click:ref_compute:2'));
});

test('V2AgentLoop does not emit no-progress signal for repeated strong local mutations', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_load_more' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_load_more' }], confidence: 'high' },
    { done: true, val: 'More content loaded' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_load_more',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'strong',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_new_1', 'ref_new_2', 'ref_new_3', 'ref_new_4'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_load_more'],
      },
      notes: ['new content loaded'],
    },
    traceStepId: 'tool_load_more_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/list',
    goal: 'Load more items',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs.length, 3);
  assert.equal(planner.inputs[2].uncertainty.signals.some(signal => signal.startsWith('repeated_no_progress_transition:')), false);
});

test('V2AgentLoop replans after page-changing first step instead of executing stale queued steps', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'click', ref: 'ref_search_button' },
        { tool: 'type', ref: 'ref_search_button', text: 'climate change data visualization' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Replanned after launcher click' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_search_button',
    evidence: {
      beforeObservationId: 'obs_before',
      afterObservationId: 'obs_after',
      transitionClass: 'structural_local',
      strength: 'moderate',
      generationChanged: false,
      urlChanged: false,
      refChanges: {
        appeared: ['ref_search_input'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_search_button'],
      },
      notes: ['launcher opened input'],
    },
    traceStepId: 'tool_click_launcher',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test',
    goal: 'Search repository',
    maxSteps: 2,
  });

  assert.equal(result.success, true);
  assert.equal(result.metrics.toolExecutions, 1);
  assert.equal(dispatcher.steps!.length, 1);
  assert.equal(dispatcher.steps![0].tool, 'click');
});

test('V2AgentLoop preserves planner escalation reason in failureReason', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { escalate: 'dead_end', reason: 'page shows security check and no useful controls' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/security',
    goal: 'Find recipe',
    maxSteps: 1,
  });

  assert.equal(result.success, false);
  assert.equal(
    result.failureReason,
    'planner_escalated:dead_end:page shows security check and no useful controls',
  );
});

test('V2AgentLoop records compact planner telemetry without changing planner input', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([{ plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' }, { done: true, val: 'Clicked' }]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(harness.plannerInputs.length, 2);
  assert.equal(harness.compactPlannerViews.length, 2);
  assert.equal(harness.compactPlannerViews[0].episodeId, harness.plannerInputs[0].episodeId);

  const firstPayload = harness.compactPlannerViews[0].payload as {
    version?: string;
    stats?: { originalBytes?: number; compactBytes?: number; reductionRatio?: number };
    coverage?: { plannedRefs?: string[]; actionRefCoverage?: number };
    view?: { version?: string; actions?: Array<{ refId: string }> };
  };

  assert.equal(firstPayload.version, 'compact_planner_telemetry.v1');
  assert.equal(firstPayload.view?.version, 'compact_planner_view.v1');
  assert.ok((firstPayload.stats?.originalBytes ?? 0) > 0);
  assert.ok((firstPayload.stats?.compactBytes ?? 0) > 0);
  assert.ok((firstPayload.stats?.reductionRatio ?? 1) < 1);
  assert.deepEqual(firstPayload.coverage?.plannedRefs, ['ref_submit']);
  assert.equal(firstPayload.coverage?.actionRefCoverage, 1);
  assert.deepEqual(planner.inputs[0], harness.plannerInputs[0].input);
});

test('V2AgentLoop routes through default planner when plannerMode is undefined or current', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([{ done: true, val: 'Default mode works' }]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 1,
    plannerMode: 'current',
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Default mode works');
  assert.equal(planner.inputs.length, 1);
});

test('V2AgentLoop routes through compact client and returns ineligible when first ref is not represented', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();

  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: {
      call: async () => {
        throw Object.assign(new Error('compact_planner_input_ineligible'), {
          code: 'COMPACT_PLANNER_INPUT_INELIGIBLE',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 5
        });
      }
    },
    dispatcherFactory: () => new FakeDispatcher(),
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit',
    maxSteps: 1,
    plannerMode: 'compact_enforced',
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'compact_planner_input_ineligible');
});

test('V2AgentLoop routes through compact client and succeeds when mock provider resolves successfully', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();

  // Create a custom observation with a clickable ref
  const customRef = makeRef({ refId: 'ref_submit', name: 'Submit Button' });
  const harness = new FakeHarness([
    makeObservation('obs_initial', {
      refs: [customRef]
    })
  ]);

  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    dispatcherFactory: () => new FakeDispatcher(),
  });

  // Mock global fetch to return a valid compact plan
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GEMINI_API_KEY = 'mock-key';
  process.env.BROWSEGENT_GEMINI_RETRIES = '1';

  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: JSON.stringify({ done: true, val: 'Compact Mode Succeeds' }) }
              ]
            }
          }
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20
        }
      })
    } as any;
  };

  try {
    const result = await loop.run({
      url: 'https://example.test/form',
      goal: 'Click submit',
      maxSteps: 1,
      plannerMode: 'compact_enforced',
    });

    assert.equal(result.success, true);
    assert.equal(result.value, 'Compact Mode Succeeds');
    assert.equal(result.metrics.inputTokens, 10);
    assert.equal(result.metrics.outputTokens, 20);
    assert.equal(harness.plannerInputs.length, 2);
    assert.equal((harness.plannerInputs[0].input as any).version, 'v2.planner_input.v2');
    assert.equal((harness.plannerInputs[1].input as any).version, 'compact_shadow_input.v1');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('V2AgentLoop hard-blocks after 3 identical search_page actions', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    // 4th attempt should be blocked before execution
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { done: true, val: 'Gave up' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'search_page',
    value: { matches: 1, preview: ['Submit'] },
    traceStepId: 'tool_search',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Find submit button',
    maxSteps: 5,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Gave up');
  // After 3 successful identical executions, hard-block is registered in record().
  // The 4th planner call dispatches search_page but it's blocked before dispatch.
  // The 5th planner call (inputs[4]) receives the blocked error as lastResult.
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');
  assert.equal(planner.inputs[4].lastResult?.error?.retryable, true);
  // The dispatcher should only have been called 3 times (4th was blocked before dispatch)
  assert.equal(dispatcher.steps?.length, 3);
});

test('V2AgentLoop hard-blocks repeated press when the runtime result omits targetRef and transition evidence', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { plan: [{ tool: 'press', ref: 'ref_submit', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_submit', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_submit', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_submit', key: 'Enter' }], confidence: 'high' },
    { done: true, val: 'Gave up' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'press',
    value: { key: 'Enter' },
    traceStepId: 'tool_press',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Submit the form',
    maxSteps: 5,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Gave up');
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');
  assert.equal(dispatcher.steps?.length, 3);
});

test('V2AgentLoop hard-blocks no-progress actions when refs churn around one stable target identity', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const targetId = 'target_shared';
  const observations = [
    makeObservation('obs_initial', { refs: [makeRef({ refId: 'ref_a', targetId })] }),
    makeObservation('obs_after_a', { refs: [makeRef({ refId: 'ref_b', targetId })] }),
    makeObservation('obs_after_b', { refs: [makeRef({ refId: 'ref_c', targetId })] }),
    makeObservation('obs_after_c', { refs: [makeRef({ refId: 'ref_d', targetId })] }),
  ];
  class RotatingHarness extends FakeHarness {
    private cursor = 0;

    override async observe(): Promise<BrowserObservation> {
      return this.observations[Math.min(++this.cursor, this.observations.length - 1)];
    }
  }
  const planner = new FakePlanner([
    { plan: [{ tool: 'click', ref: 'ref_a' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_b' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_c' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_d' }], confidence: 'high' },
    { done: true, val: 'Gave up' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    traceStepId: 'tool_click',
  };
  const harness = new RotatingHarness(observations);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Submit the form',
    maxSteps: 5,
  });

  assert.equal(result.success, true);
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');
  assert.equal(dispatcher.steps?.length, 3);
});

test('V2AgentLoop pivots after 3 no-progress actions using the same tool across ref churn', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const observations = [
    makeObservation('obs_initial', {
      refs: [
        makeRef({ refId: 'ref_a', targetId: 'target_a' }),
        makeRef({ refId: 'ref_b', targetId: 'target_b' }),
        makeRef({ refId: 'ref_c', targetId: 'target_c' }),
        makeRef({ refId: 'ref_d', targetId: 'target_d' }),
      ],
    }),
  ];
  const planner = new FakePlanner([
    { plan: [{ tool: 'press', ref: 'ref_a', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_b', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_c', key: 'Enter' }], confidence: 'high' },
    { plan: [{ tool: 'press', ref: 'ref_d', key: 'Enter' }], confidence: 'high' },
    { done: true, val: 'Changed strategy' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'press',
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_press',
  };
  const harness = new FakeHarness(observations);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Submit the form',
    maxSteps: 5,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Changed strategy');
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');
  assert.equal(dispatcher.steps?.length, 3);
});

test('V2AgentLoop hard-block resets after URL change', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const urlChangedEvidence = {
    ...makeEvidence(),
    urlChanged: true,
  };
  const planner = new FakePlanner([
    // Steps 1-3: search_page with same pattern (3 successful records → hard-block registered)
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    // Step 4: search_page blocked (4th identical attempt)
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    // Step 5: navigate, which produces urlChanged evidence and resets the block
    { plan: [{ tool: 'navigate', url: 'https://example.test/next' }], confidence: 'high' },
    // Step 6: search_page again — should be allowed (block was reset)
    { plan: [{ tool: 'search_page', pattern: 'Submit' }], confidence: 'high' },
    { done: true, val: 'Found after reset' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push(
    // search_page #1
    {
      success: true,
      kind: 'search_page',
      value: { matches: 1, preview: ['Submit'] },
      traceStepId: 'tool_search_1',
    },
    // search_page #2
    {
      success: true,
      kind: 'search_page',
      value: { matches: 1, preview: ['Submit'] },
      traceStepId: 'tool_search_2',
    },
    // search_page #3
    {
      success: true,
      kind: 'search_page',
      value: { matches: 1, preview: ['Submit'] },
      traceStepId: 'tool_search_3',
    },
    // search_page #4 is blocked, so no dispatch result needed
    // navigate
    {
      success: true,
      kind: 'navigate',
      value: { url: 'https://example.test/next' },
      evidence: urlChangedEvidence,
      traceStepId: 'tool_navigate',
    },
    // search_page #5 (after reset)
    {
      success: true,
      kind: 'search_page',
      value: { matches: 2, preview: ['Submit', 'Other'] },
      traceStepId: 'tool_search_5',
    },
  );
  const loop = new V2AgentLoop({
    harnessFactory: () => new FakeHarness(),
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Find submit button across pages',
    maxSteps: 7,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'Found after reset');
  // The 5th planner input (inputs[4]) should contain the blocked error
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');
  // After navigate with urlChanged, the 7th planner input (inputs[6]) should have a successful lastResult
  // (search_page was allowed again after reset)
  assert.equal(planner.inputs[6].lastResult?.kind, 'search_page');
  assert.equal(planner.inputs[6].lastResult?.success, true);
});

test('V2AgentLoop interrupts mini-plan after typing into a combobox', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_origin', text: 'New York' },
        { tool: 'type', ref: 'ref_dest', text: 'London' },
      ],
      confidence: 'high',
    },
    // Re-invoked after interruption — planner sees fresh observation
    { done: true, val: 'Autocomplete selected' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push({
    success: true,
    kind: 'type',
    targetRef: 'ref_origin',
    value: { inputValue: 'New York' },
    target: { refId: 'ref_origin', role: 'combobox', name: 'Origin', text: 'New York' },
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_type_combobox',
  });
  const harness = new FakeHarness([
    makeObservation('obs_initial', {
      refs: [
        makeRef({ refId: 'ref_origin', role: 'combobox', name: 'Origin' }),
        makeRef({ refId: 'ref_dest', role: 'textbox', name: 'Destination' }),
      ],
    }),
    makeObservation('obs_after_type', {
      refs: [
        makeRef({ refId: 'ref_origin', role: 'combobox', name: 'Origin' }),
        makeRef({ refId: 'ref_dest', role: 'textbox', name: 'Destination' }),
      ],
    }),
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/flights',
    goal: 'Search flights from New York to London',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  // Mini-plan was interrupted: planner called at least twice (plan was interrupted, planner re-invoked)
  assert.ok(planner.inputs.length >= 2, `Expected planner to be called at least 2 times, got ${planner.inputs.length}`);
  // Only the first type step should have been dispatched (second was not executed due to interruption)
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type']);
});

test('V2AgentLoop interrupts mini-plan after type when new refs appeared (dropdown opened)', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_input', text: 'search query' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    // Re-invoked after interruption due to appeared refs
    { done: true, val: 'Dropdown option selected' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push({
    success: true,
    kind: 'type',
    targetRef: 'ref_input',
    value: { inputValue: 'search query' },
    target: { refId: 'ref_input', role: 'textbox', name: 'Search', text: 'search query' },
    evidence: {
      ...makeNoProgressEvidence(),
      refChanges: {
        appeared: ['ref_dropdown_1', 'ref_dropdown_2'],
        disappeared: [],
        weakened: [],
        preserved: ['ref_input', 'ref_submit'],
      },
    },
    traceStepId: 'tool_type_with_dropdown',
  });
  const harness = new FakeHarness([
    makeObservation('obs_initial', {
      refs: [
        makeRef({ refId: 'ref_input', role: 'textbox', name: 'Search' }),
        makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit' }),
      ],
    }),
    makeObservation('obs_after_type', {
      refs: [
        makeRef({ refId: 'ref_input', role: 'textbox', name: 'Search' }),
        makeRef({ refId: 'ref_submit', role: 'button', name: 'Submit' }),
        makeRef({ refId: 'ref_dropdown_1', role: 'option', name: 'Option 1' }),
        makeRef({ refId: 'ref_dropdown_2', role: 'option', name: 'Option 2' }),
      ],
    }),
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/search',
    goal: 'Search for results',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  // Mini-plan was interrupted: planner called at least twice
  assert.ok(planner.inputs.length >= 2, `Expected planner to be called at least 2 times, got ${planner.inputs.length}`);
  // Only the type step was dispatched; the click was not executed
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type']);
});

test('V2AgentLoop continues mini-plan after type into regular textbox without new refs', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    {
      plan: [
        { tool: 'type', ref: 'ref_first', text: 'Alice' },
        { tool: 'type', ref: 'ref_second', text: 'Bob' },
      ],
      confidence: 'high',
    },
    { done: true, val: 'Form filled' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.results.push(
    {
      success: true,
      kind: 'type',
      targetRef: 'ref_first',
      value: { inputValue: 'Alice' },
      target: { refId: 'ref_first', role: 'textbox', name: 'First Name', text: 'Alice' },
      evidence: makeNoProgressEvidence(),
      traceStepId: 'tool_type_first',
    },
    {
      success: true,
      kind: 'type',
      targetRef: 'ref_second',
      value: { inputValue: 'Bob' },
      target: { refId: 'ref_second', role: 'textbox', name: 'Last Name', text: 'Bob' },
      evidence: makeNoProgressEvidence(),
      traceStepId: 'tool_type_second',
    },
  );
  const harness = new FakeHarness([
    makeObservation('obs_initial', {
      refs: [
        makeRef({ refId: 'ref_first', role: 'textbox', name: 'First Name' }),
        makeRef({ refId: 'ref_second', role: 'textbox', name: 'Last Name' }),
      ],
    }),
    makeObservation('obs_after_type', {
      refs: [
        makeRef({ refId: 'ref_first', role: 'textbox', name: 'First Name' }),
        makeRef({ refId: 'ref_second', role: 'textbox', name: 'Last Name' }),
      ],
    }),
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Fill in the name fields',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  // Mini-plan was NOT interrupted: both type steps dispatched, planner called only once for the plan
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), ['type', 'type']);
  // Planner should have been called exactly once for the plan (+ once for done)
  assert.equal(planner.inputs.length, 2);
  assert.equal(result.metrics.toolExecutions, 2);
});

test('V2AgentLoop validates and rejects navigate step with oversized URL', async () => {
  const { V2AgentLoop, validatePlannerStep } = await loadAgentLoopModule();
  
  // Test the validation function directly
  const oversizedUrl = 'https://example.test/search?' + 'a'.repeat(2048);
  const error = validatePlannerStep({ tool: 'navigate', url: oversizedUrl });
  assert.ok(error);
  assert.equal(error.code, 'invalid_action_payload');
  assert.match(error.message, /URL too long/);
  assert.equal(error.retryable, true);

  // Test that the loop processes this validation failure correctly
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'navigate', url: oversizedUrl }], confidence: 'high' },
    { done: true, val: 'Fellback' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Navigate to oversized URL',
    maxSteps: 3,
  });

  assert.equal(planner.inputs.length, 2);
  const lastResultFeed = planner.inputs[1].lastResult;
  assert.equal(lastResultFeed?.success, false);
  assert.equal(lastResultFeed?.error?.code, 'invalid_action_payload');
  assert.equal(lastResultFeed?.error?.retryable, true);
  assert.equal(result.success, true);
  assert.equal(result.value, 'Fellback');
});

test('V2AgentLoop validates and rejects navigate step with malformed URL', async () => {
  const { V2AgentLoop, validatePlannerStep } = await loadAgentLoopModule();
  
  // Test the validation function directly
  const malformedUrl = 'not-a-valid-url';
  const error = validatePlannerStep({ tool: 'navigate', url: malformedUrl });
  assert.ok(error);
  assert.equal(error.code, 'invalid_action_payload');
  assert.match(error.message, /Malformed URL/);
  assert.equal(error.retryable, true);

  // Test that the loop processes this validation failure correctly
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    { plan: [{ tool: 'navigate', url: malformedUrl }], confidence: 'high' },
    { done: true, val: 'Fellback' },
  ]);
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Navigate to malformed URL',
    maxSteps: 3,
  });

  assert.equal(planner.inputs.length, 2);
  const lastResultFeed = planner.inputs[1].lastResult;
  assert.equal(lastResultFeed?.success, false);
  assert.equal(lastResultFeed?.error?.code, 'invalid_action_payload');
  assert.equal(lastResultFeed?.error?.retryable, true);
  assert.equal(result.success, true);
  assert.equal(result.value, 'Fellback');
});

test('normalizeAnswerValue helper function tests', async () => {
  const { normalizeAnswerValue } = await loadAgentLoopModule();

  // 1. Pronunciation goal, value '/kæt/, /kæt/' -> returns 'UK: /kæt/ US: /kæt/'
  assert.equal(
    normalizeAnswerValue('/kæt/, /kæt/', 'What is the pronunciation of cat?'),
    'UK: /kæt/ US: /kæt/'
  );
  
  // Variations with different separators (comma, semicolon, newline) and spacing
  assert.equal(
    normalizeAnswerValue('/kæt/;\n/kæt/', 'Find pronunciation of cat'),
    'UK: /kæt/ US: /kæt/'
  );

  // 2. Pronunciation goal, value already labeled 'UK: /kæt/ US: /kæt/' -> unchanged
  assert.equal(
    normalizeAnswerValue('UK: /kæt/ US: /kæt/', 'What is the pronunciation of cat?'),
    'UK: /kæt/ US: /kæt/'
  );
  assert.equal(
    normalizeAnswerValue('British: /kæt/ American: /kæt/', 'pronunc'),
    'British: /kæt/ American: /kæt/'
  );

  // 3. Non-pronunciation goal -> value unchanged
  assert.equal(
    normalizeAnswerValue('/kæt/, /kæt/', 'What is the meaning of cat?'),
    '/kæt/, /kæt/'
  );

  // 4. Pronunciation goal, single IPA '/kæt/' -> unchanged (not a pair)
  assert.equal(
    normalizeAnswerValue('/kæt/', 'Find the pronunciation of cat'),
    '/kæt/'
  );
  assert.equal(
    normalizeAnswerValue('/kæt/ /kæt/ /kæt/', 'pronunciation'),
    '/kæt/ /kæt/ /kæt/'
  );
});

test('V2AgentLoop integration - returns normalized answer in successful completion result', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const planner = new FakePlanner([
    { done: true, val: '/kæt/, /kæt/' },
  ]);
  const harness = new FakeHarness();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Find the pronunciation of cat',
    maxSteps: 3,
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'UK: /kæt/ US: /kæt/');
});

test('URL guard rejection routes through failure classifier and replans', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const oversizedUrl = 'https://example.test/search?' + 'a'.repeat(3000);
  const planner = new FakePlanner([
    // Step 1: navigate with oversized URL (should be rejected by validatePlannerStep),
    //         followed by a click that should NOT be dispatched (mini-plan breaks)
    {
      plan: [
        { tool: 'navigate', url: oversizedUrl },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    // Step 2: planner receives the error and gives up
    { done: true, val: 'Recovered' },
  ]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Navigate to oversized URL',
    maxSteps: 3,
  });

  // Step 2 (click) was NOT dispatched — mini-plan broke after pre-execution rejection
  assert.deepEqual(dispatcher.steps?.map(step => step.tool), []);

  // failureClassifier.classify() was called — harness.failures should have the evidence
  assert.ok(harness.failures.length >= 1, 'harness.recordFailureEvidence should have been called');
  assert.equal(harness.failures[0].kind, 'invalid_action_payload');

  // Planner was called again with the error in lastResult (replan happened)
  assert.equal(planner.inputs.length, 2);
  assert.equal(planner.inputs[1].lastResult?.success, false);
  assert.equal(planner.inputs[1].lastResult?.error?.code, 'invalid_action_payload');

  // Failures array is fed into the next planner input
  assert.ok(planner.inputs[1].failures && planner.inputs[1].failures.length >= 1);
  assert.equal(planner.inputs[1].failures![0].kind, 'invalid_action_payload');

  assert.equal(result.success, true);
  assert.equal(result.value, 'Recovered');
});

test('hard-block rejection routes through failure classifier and replans', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const planner = new FakePlanner([
    // Steps 1-3: identical click on ref_submit with no-progress evidence (builds up to hard-block)
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    { plan: [{ tool: 'click', ref: 'ref_submit' }], confidence: 'high' },
    // Step 4: same click again — this should trigger hard-block (3 identical repeats registered)
    //         followed by a second click that should NOT be dispatched
    {
      plan: [
        { tool: 'click', ref: 'ref_submit' },
        { tool: 'click', ref: 'ref_submit' },
      ],
      confidence: 'high',
    },
    // Step 5: planner receives the blocked error and escalates
    { done: true, val: 'Changed strategy' },
  ]);
  const dispatcher = new FakeDispatcher();
  dispatcher.nextResult = {
    success: true,
    kind: 'click',
    targetRef: 'ref_submit',
    evidence: makeNoProgressEvidence(),
    traceStepId: 'tool_click',
  };
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Click submit button',
    maxSteps: 5,
  });

  // The 4th planner step's second click was NOT dispatched — mini-plan broke
  // Dispatcher received 3 clicks (steps 1-3), NOT 4
  assert.equal(dispatcher.steps?.length, 3);

  // failureClassifier.classify() was called with the blocked error
  assert.ok(harness.failures.length >= 1, 'harness.recordFailureEvidence should have been called');

  // Planner received the blocked error with failure evidence
  assert.equal(planner.inputs[4].lastResult?.error?.code, 'action_blocked_by_loop_detector');

  // Failure evidence was recorded and passed to planner
  assert.ok(planner.inputs[4].failures && planner.inputs[4].failures.length >= 1);
  assert.equal(planner.inputs[4].failures![planner.inputs[4].failures!.length - 1].kind, 'action_blocked_by_loop_detector');

  assert.equal(result.success, true);
  assert.equal(result.value, 'Changed strategy');
});

test('pre-execution rejection records progress memory', async () => {
  const { V2AgentLoop } = await loadAgentLoopModule();
  const harness = new FakeHarness();
  const oversizedUrl = 'https://example.test/search?' + 'a'.repeat(3000);
  const planner = new FakePlanner([
    // Step 1: navigate with oversized URL — pre-execution rejection
    { plan: [{ tool: 'navigate', url: oversizedUrl }], confidence: 'high' },
    // Step 2: planner should receive error and recover
    { done: true, val: 'Recovered' },
  ]);
  const dispatcher = new FakeDispatcher();
  const loop = new V2AgentLoop({
    harnessFactory: () => harness,
    plannerClient: planner,
    dispatcherFactory: () => dispatcher,
  });

  const result = await loop.run({
    url: 'https://example.test/form',
    goal: 'Navigate to oversized URL',
    maxSteps: 3,
  });

  // The synthetic lastResult should have been fed to the planner
  assert.equal(planner.inputs[1].lastResult?.success, false);
  assert.equal(planner.inputs[1].lastResult?.error?.code, 'invalid_action_payload');

  // Failure evidence should be recorded
  assert.ok(harness.failures.length >= 1);

  // Uncertainty signals should be present (from failure pipeline)
  assert.ok(planner.inputs[1].uncertainty !== undefined);

  assert.equal(result.success, true);
  assert.equal(result.value, 'Recovered');
});
