import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUserMessage } from '../../src/agent/prompt';
import { LoopDetector, fingerprintAction, fingerprintGraph } from '../../src/agent/loopDetector';
import { runAgentLoop } from '../../src/agent/loop';
import type { EscalationContext, LLMCallResult, LLMPlan } from '../../src/agent/llm';
import type { Executor } from '../../src/executor/executor';
import type { Action, ActionResult, LLMPlanStep } from '../../src/executor/types';
import type { SemanticGraph } from '../../src/graph/types';

function makeGraph(label = 'base'): SemanticGraph {
  return {
    snapshot: [
      { type: 'data', tag: 'div', value: `${label} alpha`, sel: '#alpha', selType: 'id', rule: 'test' },
      { type: 'data', tag: 'div', value: `${label} beta`, sel: '#beta', selType: 'id', rule: 'test' },
      { type: 'data', tag: 'div', value: `${label} gamma`, sel: '#gamma', selType: 'id', rule: 'test' },
      { type: 'trigger', tag: 'button', value: 'Search', sel: '[aria-label="Search"]', selType: 'aria', rule: 'test' },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };
}

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    kind: 'click',
    target: '[aria-label="Search"]',
    origin: 'llm',
    original: { tool: 'click', sel: '[aria-label="Search"]' },
    ...overrides,
  };
}

function makeExecutor(): Executor {
  return {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: action.kind !== 'get' && action.kind !== 'wait',
      },
    }),
  } as Executor;
}

function makeNotFoundExecutor(): Executor {
  return {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: false,
      kind: action.kind,
      error: {
        code: 'not_found',
        message: `Element not found: ${action.target ?? '(missing)'}`,
        retryable: true,
        shouldReplan: true,
        runtime: 'dom',
      },
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: action.kind !== 'get' && action.kind !== 'wait',
      },
    }),
  } as Executor;
}

function makeSearchMissExecutor(): Executor {
  return {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      value: 'No matches found for "json\\.dumps".',
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: false,
      },
    }),
  } as Executor;
}

function makePlanResult(plan: LLMPlan): LLMCallResult {
  return {
    plan,
    metrics: {
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 1,
    },
  };
}

test('action fingerprint normalization is kind-specific and stable', () => {
  assert.equal(
    fingerprintAction(makeAction({ target: 'a[href="#section-1"]' })),
    'click|anchor_link',
  );
  assert.equal(
    fingerprintAction(makeAction({ kind: 'type', input: '  Hello   World  ', original: { tool: 'type', sel: '[aria-label="Search"]', text: '  Hello   World  ' } })),
    'type|[aria-label="search"]|hello world',
  );
  assert.equal(
    fingerprintAction(makeAction({ kind: 'scroll', direction: 'down', target: undefined, original: { tool: 'scroll', direction: 'down' } })),
    'scroll|down',
  );
  assert.equal(
    fingerprintAction(makeAction({ kind: 'wait', pattern: undefined, target: undefined, original: { tool: 'wait' } })),
    'wait|sleep',
  );
  assert.equal(
    fingerprintAction(makeAction({ kind: 'select', option: '  IN  ', original: { tool: 'select', sel: '[aria-label="Search"]', value: '  IN  ' } })),
    'select|[aria-label="search"]|in',
  );
});

test('graph fingerprint ignores timestamps but changes on meaningful content changes', () => {
  const first = makeGraph('stable');
  const second = { ...makeGraph('stable'), snapshotTimestamp: 99, lastUpdateTimestamp: 101 };
  const hashA = { ...makeGraph('stable'), pageUrl: 'https://example.com/docs#intro' };
  const hashB = { ...makeGraph('stable'), pageUrl: 'https://example.com/docs#api' };
  const changedUrl = { ...makeGraph('stable'), pageUrl: 'https://example.com/other' };
  const changed = makeGraph('changed');

  assert.equal(fingerprintGraph(first), fingerprintGraph(second));
  assert.equal(fingerprintGraph(hashA), fingerprintGraph(hashB));
  assert.notEqual(fingerprintGraph(first), fingerprintGraph(changedUrl));
  assert.notEqual(fingerprintGraph(first), fingerprintGraph(changed));
});

test('anchor-link clicks are grouped into a single repetition family', () => {
  const detector = new LoopDetector();
  detector.recordAction(makeAction({ target: 'a[href="#section-a"]' }));
  detector.recordAction(makeAction({ target: 'a[href="#section-b"]' }));
  detector.recordAction(makeAction({ target: 'a[href="#section-c"]' }));

  const debug = detector.getDebugState();
  assert.equal(debug.repeatedFingerprint, 'click|anchor_link');
  assert.equal(debug.repetitionCount, 3);
});

test('loop detector thresholds and critical persistence behave as expected', () => {
  const detector = new LoopDetector();
  const graph = makeGraph('same');
  const repeatedAction = makeAction();

  for (let cycle = 1; cycle <= 6; cycle++) {
    detector.recordGraphState(graph);
    const signal = detector.getSignal();

    if (cycle === 3) {
      assert.equal(signal?.severity, 'info');
      assert.equal(signal?.type, 'action_repetition');
      assert.equal(signal?.shouldAbort, false);
    }

    if (cycle === 4) {
      assert.equal(signal?.severity, 'warning');
      assert.equal(signal?.type, 'combined');
      assert.equal(signal?.shouldAbort, false);
    }

    if (cycle === 5) {
      assert.equal(signal?.severity, 'critical');
      assert.equal(signal?.type, 'combined');
      assert.equal(signal?.shouldAbort, false);
    }

    if (cycle === 6) {
      assert.equal(signal?.severity, 'critical');
      assert.equal(signal?.type, 'no_progress');
      assert.equal(signal?.shouldAbort, true);
    }

    detector.recordActions([repeatedAction, repeatedAction]);
  }
});

test('prompt warnings are included only when provided', () => {
  const withWarnings = buildUserMessage({
    goal: 'Find the answer',
    graphJson: '{"g":"goal"}',
    reason: 'step_2',
    stepCount: 2,
    contextWarnings: ['Repeated pattern detected.'],
  });
  const withoutWarnings = buildUserMessage({
    goal: 'Find the answer',
    graphJson: '{"g":"goal"}',
    reason: 'step_3',
    stepCount: 3,
  });

  assert.match(withWarnings, /Warnings:\n- Repeated pattern detected\./);
  assert.doesNotMatch(withoutWarnings, /Warnings:/);
});

test('runAgentLoop stops on repeated actions plus stagnant graph before max steps', async () => {
  const graph = makeGraph('stagnant');
  const contexts: EscalationContext[] = [];
  const plan: LLMPlanStep[] = [
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'type', sel: '[aria-label="Search"]', text: 'javascript' },
    { tool: 'click', sel: '[aria-label="Search"]' },
  ];

  const result = await runAgentLoop({
    goal: 'How many questions are tagged with javascript on Stack Overflow?',
    graph,
    executor: makeExecutor(),
    maxSteps: 10,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      return makePlanResult({ plan, confidence: 'high' });
    },
  });

  assert.equal(typeof result.success, 'boolean');
  assert.equal(result.failureReason, 'no_progress_detected');
  assert.ok(result.totalSteps < 10);
  assert.ok(contexts.some(ctx => (ctx.contextWarnings?.length ?? 0) > 0));
});

test('runAgentLoop does not abort repeated actions when graph keeps changing', async () => {
  const graph = makeGraph('changing-0');
  let version = 0;
  let calls = 0;
  const plan: LLMPlanStep[] = [
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'type', sel: '[aria-label="Search"]', text: 'javascript' },
    { tool: 'click', sel: '[aria-label="Search"]' },
  ];

  const result = await runAgentLoop({
    goal: 'Keep exploring until answer is visible',
    graph,
    executor: makeExecutor(),
    maxSteps: 6,
    planMutationWaitMs: 0,
    afterAct: async () => {
      version += 1;
      graph.snapshot[0] = {
        ...graph.snapshot[0]!,
        value: `changing-${version}`,
      };
    },
    llmCaller: async () => {
      calls += 1;
      if (calls === 6) {
        return makePlanResult({ done: true, val: 'resolved' });
      }
      return makePlanResult({ plan, confidence: 'high' });
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'resolved');
});

test('runAgentLoop warns on stagnation alone but allows completion', async () => {
  const graph = makeGraph('unchanged');
  const contexts: EscalationContext[] = [];
  const plans: LLMPlanStep[][] = [
    [{ tool: 'scroll', direction: 'down' }],
    [{ tool: 'scroll', direction: 'up' }],
    [{ tool: 'get', sel: '#alpha' }],
  ];
  let calls = 0;

  const result = await runAgentLoop({
    goal: 'Find the headline',
    graph,
    executor: makeExecutor(),
    maxSteps: 4,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      calls += 1;
      if (calls <= plans.length) {
        return makePlanResult({ plan: plans[calls - 1], confidence: 'medium' });
      }
      return makePlanResult({ done: true, val: 'headline found' });
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'headline found');
  assert.ok((contexts[3]?.contextWarnings?.[0] ?? '').includes('page state has stayed unchanged'));
});

test('runAgentLoop direct success stays unchanged when there is no loop signal', async () => {
  const contexts: EscalationContext[] = [];

  const result = await runAgentLoop({
    goal: 'What is the title?',
    graph: makeGraph('direct'),
    executor: makeExecutor(),
    maxSteps: 2,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      return makePlanResult({ done: true, val: 'direct answer' });
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.value, 'direct answer');
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.contextWarnings, undefined);
});

test('runAgentLoop handles captcha escalation with explicit failure reason', async () => {
  const result = await runAgentLoop({
    goal: 'How many questions are tagged with javascript on Stack Overflow?',
    graph: makeGraph('captcha'),
    executor: makeExecutor(),
    maxSteps: 2,
    llmCaller: async () => makePlanResult({
      escalate: 'captcha',
      reason: 'Cloudflare verification required',
      confidence: 'high',
    }),
  });

  assert.equal(typeof result.success, 'boolean');
  assert.equal(result.failureReason, 'captcha_detected: Cloudflare verification required');
  assert.equal(result.llmCallCount, 1);
});

test('runAgentLoop injects stale-selector warning after repeated not_found failures', async () => {
  const contexts: EscalationContext[] = [];

  await runAgentLoop({
    goal: 'Open the list page',
    graph: makeGraph('stale-selector'),
    executor: makeNotFoundExecutor(),
    maxSteps: 5,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      return makePlanResult({
        plan: [{ tool: 'click', sel: 'a[href="/wiki/List_of_people_who_have_walked_on_the_Moon"]' }],
        confidence: 'high',
      });
    },
    planMutationWaitMs: 0,
  });

  const warningFound = contexts.some(ctx =>
    (ctx.contextWarnings ?? []).some(warning =>
      (warning.includes('failed with not_found') && warning.includes('stale on the current page'))
      || (warning.includes('selector family') && warning.includes('stale positional targeting')),
    ),
  );
  assert.equal(warningFound, true);
});

test('runAgentLoop injects stale-selector-family warning for repeated positional selector misses', async () => {
  const contexts: EscalationContext[] = [];
  let callCount = 0;

  await runAgentLoop({
    goal: 'Get the first laptop price',
    graph: makeGraph('stale-selector-family'),
    executor: makeNotFoundExecutor(),
    maxSteps: 6,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      callCount += 1;
      const variant = callCount + 2;
      return makePlanResult({
        plan: [{ tool: 'get', sel: `div:nth-of-type(${variant}) > div:nth-of-type(1) > span:nth-of-type(2)` }],
        confidence: 'high',
      });
    },
    planMutationWaitMs: 0,
  });

  const warningFound = contexts.some(ctx =>
    (ctx.contextWarnings ?? []).some(warning =>
      warning.includes('selector family') && warning.includes('stale positional targeting'),
    ),
  );
  assert.equal(warningFound, true);
});

test('runAgentLoop injects search_page no-match warning and aborts repeated churn', async () => {
  const contexts: EscalationContext[] = [];

  const result = await runAgentLoop({
    goal: 'What are the default parameters of json.dumps()?',
    graph: makeGraph('search-miss-churn'),
    executor: makeSearchMissExecutor(),
    maxSteps: 10,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      return makePlanResult({
        plan: [{ tool: 'search_page', pattern: 'json\\.dumps' }],
        confidence: 'high',
      });
    },
    planMutationWaitMs: 0,
  });

  const warningFound = contexts.some(ctx =>
    (ctx.contextWarnings ?? []).some(warning =>
      warning.includes('search_page has returned no matches repeatedly'),
    ),
  );

  assert.equal(warningFound, true);
  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'no_progress_detected');
});

test('runAgentLoop injects target-utility warning after guarded low-utility click', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't1',
          selectorScore: 44,
          interactionScore: 55,
          actionabilityScore: 42,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_1',
          regionSelector: '.card',
        },
      },
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't2',
          selectorScore: 43,
          interactionScore: 54,
          actionabilityScore: 41,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_2',
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'h3',
        value: 'First listing',
        sel: '.card h3',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd1',
          selectorScore: 52,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 26,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Remote',
        sel: '.card .location',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd2',
          selectorScore: 50,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 10,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Posted today',
        sel: '.card .posted',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd3',
          selectorScore: 49,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 7,
          regionSelector: '.card',
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/jobs',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  const contexts: EscalationContext[] = [];
  let calls = 0;

  const result = await runAgentLoop({
    goal: 'What company posted the first job listing shown?',
    graph,
    executor: makeExecutor(),
    maxSteps: 3,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      calls += 1;
      if (calls === 1) {
        return makePlanResult({
          plan: [{ tool: 'click', sel: '[data-action="open"]' }],
          confidence: 'medium',
        });
      }
      return makePlanResult({ done: true, val: 'Acme Corp' });
    },
  });

  assert.equal(result.success, true);
  const warningFound = (contexts[1]?.contextWarnings ?? [])
    .some(warning => warning.includes('ambiguous and low-utility'));
  assert.equal(warningFound, true);
});

test('runAgentLoop aborts repeated utility-guard replan loops before max steps', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't1',
          selectorScore: 44,
          interactionScore: 55,
          actionabilityScore: 42,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_1',
          regionSelector: '.card',
        },
      },
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't2',
          selectorScore: 43,
          interactionScore: 54,
          actionabilityScore: 41,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_2',
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'h3',
        value: 'First listing',
        sel: '.card h3',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd1',
          selectorScore: 52,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 26,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Remote',
        sel: '.card .location',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd2',
          selectorScore: 50,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 10,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Posted today',
        sel: '.card .posted',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd3',
          selectorScore: 49,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 7,
          regionSelector: '.card',
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/jobs',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  const contexts: EscalationContext[] = [];
  const result = await runAgentLoop({
    goal: 'What company posted the first job listing shown?',
    graph,
    executor: makeExecutor(),
    maxSteps: 10,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      return makePlanResult({
        plan: [{ tool: 'click', sel: '[data-action="open"]' }],
        confidence: 'high',
      });
    },
  });

  assert.equal(typeof result.success, 'boolean');
  assert.equal(result.failureReason, 'no_progress_detected');
  assert.ok(result.totalSteps < 10);
  assert.ok(result.llmCallCount < 10);
  assert.ok(result.actionHistory.some(entry => entry.value === 'utility_guard:read_before_click'));
  assert.ok(
    contexts.some(ctx =>
      (ctx.contextWarnings ?? []).some(warning => warning.includes('blocked by utility guard')),
    ),
  );
});

test('runAgentLoop aborts accumulated utility-guard churn under stagnation', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't1',
          selectorScore: 44,
          interactionScore: 55,
          actionabilityScore: 42,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_1',
          regionSelector: '.card',
        },
      },
      {
        type: 'trigger',
        tag: 'button',
        value: 'Open',
        sel: '[data-action="open"]',
        selType: 'testid',
        rule: 'test',
        meta: {
          nodeId: 't2',
          selectorScore: 43,
          interactionScore: 54,
          actionabilityScore: 41,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 4,
          stableHash: 'sh_2',
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'h3',
        value: 'First listing',
        sel: '.card h3',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd1',
          selectorScore: 52,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 24,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Remote',
        sel: '.card .location',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd2',
          selectorScore: 50,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 10,
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'span',
        value: 'Posted today',
        sel: '.card .posted',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd3',
          selectorScore: 49,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 8,
          regionSelector: '.card',
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/jobs',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  let callCount = 0;
  const result = await runAgentLoop({
    goal: 'What company posted the first job listing shown?',
    graph,
    executor: makeExecutor(),
    maxSteps: 10,
    planMutationWaitMs: 0,
    llmCaller: async () => {
      callCount += 1;
      if (callCount % 2 === 1) {
        return makePlanResult({
          plan: [{ tool: 'click', sel: '[data-action="open"]' }],
          confidence: 'high',
        });
      }
      return makePlanResult({
        plan: [{ tool: 'scroll', direction: 'down' }],
        confidence: 'medium',
      });
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'no_progress_detected');
  assert.ok(result.totalSteps < 10);
  assert.ok(result.actionHistory.some(entry => entry.value === 'utility_guard:read_before_click'));
});

test('runAgentLoop surfaces pagination-churn guidance after repeated page navigation clicks', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'a',
        value: '5',
        sel: 'a[href="/search?q=laptop&page=5"]',
        selType: 'href',
        rule: 'test',
        meta: {
          nodeId: 'p5',
          selectorScore: 80,
          interactionScore: 72,
          actionabilityScore: 76,
          interactionKind: 'link',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 8,
        },
      },
      { type: 'data', tag: 'div', value: 'Result card title', sel: '.card h3', selType: 'positional', rule: 'test' },
      { type: 'data', tag: 'div', value: 'Result card price', sel: '.card .price', selType: 'positional', rule: 'test' },
      { type: 'data', tag: 'div', value: 'Result card rating', sel: '.card .rating', selType: 'positional', rule: 'test' },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/search?q=laptop&page=1',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  const contexts: EscalationContext[] = [];
  let calls = 0;

  const executor: Executor = {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: true,
        effect: {
          stateChanged: true,
          primarySignal: 'url_changed',
          signals: ['url_changed'],
          strength: 'strong',
          targetValue: 'next-page',
        },
      },
    }),
  } as Executor;

  const result = await runAgentLoop({
    goal: 'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    executor,
    maxSteps: 5,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      calls += 1;
      if (calls === 5) {
        return makePlanResult({ done: true, val: 'INR 129,999' });
      }
      return makePlanResult({
        plan: [{ tool: 'click', sel: 'a[href="/search?q=laptop&page=5"]' }],
        confidence: 'high',
      });
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'no_progress_detected');
  const warningFound = contexts.some(ctx =>
    (ctx.contextWarnings ?? []).some(warning =>
      warning.includes('pagination') && warning.includes('read-only tools'),
    ),
  );
  const guardRecorded = result.actionHistory.some(entry => entry.value === 'utility_guard:pagination_churn');
  assert.equal(warningFound || guardRecorded, true);
});

test('runAgentLoop aborts when no_progress keeps recurring on a stagnant graph', async () => {
  const graph = makeGraph('stagnant-inspect');
  const executor: Executor = {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      value: 'Region ".results" contains 8 notable nodes.',
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: false,
        effect: {
          stateChanged: false,
          primarySignal: 'target_value_observed',
          signals: ['target_value_observed'],
          strength: 'weak',
          targetValue: 'Region ".results" contains 8 notable nodes.',
        },
      },
    }),
  } as Executor;

  const result = await runAgentLoop({
    goal: 'Get the first laptop price from the current page',
    graph,
    executor,
    maxSteps: 12,
    planMutationWaitMs: 0,
    llmCaller: async () => makePlanResult({
      plan: [{ tool: 'inspect_region', sel: '.results' }],
      confidence: 'high',
    }),
  });

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'no_progress_detected');
  assert.ok(result.totalSteps < 12);
  assert.ok(result.actionHistory.some(entry => entry.result === 'no_progress'));
});

test('runAgentLoop injects warning for repeated low-value read-only observations', async () => {
  const graph = makeGraph('low-value-read-warning');
  const contexts: EscalationContext[] = [];
  const summary = 'Region ".results" contains 8 notable nodes.';
  let calls = 0;

  const executor: Executor = {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      value: summary,
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: false,
        effect: {
          stateChanged: false,
          primarySignal: 'target_value_observed',
          signals: ['target_value_observed'],
          strength: 'weak',
          targetValue: summary,
        },
      },
    }),
  } as Executor;

  const result = await runAgentLoop({
    goal: 'Get the first laptop price from this page',
    graph,
    executor,
    maxSteps: 6,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      calls += 1;
      if (calls === 6) {
        return makePlanResult({ done: true, val: 'INR 129,999' });
      }
      return makePlanResult({
        plan: [{ tool: 'inspect_region', sel: '.results' }],
        confidence: 'high',
      });
    },
  });

  assert.equal(typeof result.success, 'boolean');
  const warningFound = contexts.some(ctx =>
    (ctx.contextWarnings ?? []).some(warning =>
      warning.includes('low-value observations') && warning.includes('not making progress'),
    ),
  );
  assert.equal(warningFound, true);
});

test('runAgentLoop injects answer-finalization warning when answer evidence is observed', async () => {
  const graph = makeGraph('answer-evidence');
  const contexts: EscalationContext[] = [];
  let calls = 0;

  const executor: Executor = {
    execute: async (action: Action): Promise<ActionResult> => ({
      success: true,
      kind: action.kind,
      value: action.kind === 'get'
        ? 'Found 5 elements matching "span.price". 1. <span> text="INR 129,999" children=0'
        : undefined,
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: false,
        effect: {
          stateChanged: false,
          primarySignal: 'target_value_observed',
          signals: ['target_value_observed'],
          strength: 'weak',
          targetValue: 'INR 129,999',
        },
      },
    }),
  } as Executor;

  const result = await runAgentLoop({
    goal: 'Get the price of the first laptop product in the search results',
    graph,
    executor,
    maxSteps: 3,
    planMutationWaitMs: 0,
    llmCaller: async (ctx) => {
      contexts.push(ctx);
      calls += 1;
      if (calls === 1) {
        return makePlanResult({
          plan: [{ tool: 'get', sel: '#alpha' }],
          confidence: 'high',
        });
      }
      return makePlanResult({ done: true, val: 'INR 129,999' });
    },
  });

  assert.equal(result.success, true);
  const warningFound = (contexts[1]?.contextWarnings ?? []).some(warning =>
    warning.includes('already contains the answer') && warning.includes('INR 129,999'),
  );
  assert.equal(warningFound, true);
});
