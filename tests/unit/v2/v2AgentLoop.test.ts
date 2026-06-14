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
