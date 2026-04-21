import test from 'node:test';
import assert from 'node:assert/strict';

import { executePlan } from '../../src/agent/planExecutor';
import { fingerprintGraph } from '../../src/agent/loopDetector';
import type { Executor } from '../../src/executor/executor';
import type { Action, ActionResult, LLMPlanStep } from '../../src/executor/types';
import type { SemanticGraph } from '../../src/graph/types';
import type { ActionHistoryEntry } from '../../src/graph/serializer';

function makeGraph(label = 'base'): SemanticGraph {
  return {
    snapshot: [
      { type: 'data', tag: 'div', value: `${label} alpha`, sel: '#alpha', selType: 'id', rule: 'test' },
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

function makeExecutor(handler: (action: Action) => ActionResult | Promise<ActionResult>): Executor {
  return {
    execute: async (action: Action) => handler(action),
  } as Executor;
}

function successResult(action: Action, overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    success: true,
    kind: action.kind,
    value: overrides.value,
    metadata: {
      attempts: 1,
      durationMs: 0,
      runtimePath: ['dom'],
      finalRuntime: 'dom',
      usedFallback: false,
      target: action.target,
      mutating: action.kind !== 'get' && action.kind !== 'wait',
      effect: overrides.metadata?.effect,
    },
    ...overrides,
  };
}

test('executePlan stops repeated no-effect clicks early', async () => {
  const graph = makeGraph('no-effect-click');
  const plan: LLMPlanStep[] = [
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'click', sel: '[aria-label="Search"]' },
  ];

  const result = await executePlan(
    plan,
    'Find the answer',
    graph,
    makeExecutor(action => successResult(action, {
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: true,
        effect: {
          stateChanged: false,
          primarySignal: 'none',
          signals: ['none'],
          strength: 'none',
        },
      },
    })),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.stepsExecuted, 3);
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'no_progress');
});

test('executePlan warns instead of aborting on the third repeated observed value', async () => {
  const graph = makeGraph('same-value-get');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: '[data-testid="company-name"]',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'Acme Corp',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Acme Corp',
      },
    },
    {
      action: 'get',
      selector: '[data-testid="company-name"]',
      result: 'ok',
      timestamp: 2,
      graphFingerprint,
      value: 'Acme Corp',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Acme Corp',
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'get', sel: '[data-testid="company-name"]' }],
    'Find the first company',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'Acme Corp',
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
          targetValue: 'Acme Corp',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'ok');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'warn');
});

test('executePlan stops repeated same-value gets on the fourth observed repetition', async () => {
  const graph = makeGraph('same-value-get-hard-stop');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: '[data-testid="company-name"]',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'Acme Corp',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Acme Corp',
      },
    },
    {
      action: 'get',
      selector: '[data-testid="company-name"]',
      result: 'ok',
      timestamp: 2,
      graphFingerprint,
      value: 'Acme Corp',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Acme Corp',
      },
    },
    {
      action: 'get',
      selector: '[data-testid="company-name"]',
      result: 'ok',
      timestamp: 3,
      graphFingerprint,
      value: 'Acme Corp',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Acme Corp',
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'get', sel: '[data-testid="company-name"]' }],
    'Find the first company',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'Acme Corp',
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
          targetValue: 'Acme Corp',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'no_progress');
});

test('executePlan warns when type repeats the same value on the same selector', async () => {
  const graph = makeGraph('same-value-type-warn');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'type',
      selector: '#search',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'events',
      effect: {
        stateChanged: true,
        primarySignal: 'target_value_changed',
        signals: ['target_value_changed'],
        strength: 'strong',
        targetValue: 'events',
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'type', sel: '#search', text: 'events' }],
    'Find events in San Francisco',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'events',
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
          primarySignal: 'target_value_changed',
          signals: ['target_value_changed'],
          strength: 'strong',
          targetValue: 'events',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'warn');
});

test('executePlan aborts when type repeats same value for the fourth time', async () => {
  const graph = makeGraph('same-value-type-abort');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'type',
      selector: '#search',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'events',
      effect: {
        stateChanged: true,
        primarySignal: 'target_value_changed',
        signals: ['target_value_changed'],
        strength: 'strong',
        targetValue: 'events',
      },
    },
    {
      action: 'type',
      selector: '#search',
      result: 'ok',
      timestamp: 2,
      graphFingerprint,
      value: 'events',
      effect: {
        stateChanged: true,
        primarySignal: 'target_value_changed',
        signals: ['target_value_changed'],
        strength: 'strong',
        targetValue: 'events',
      },
    },
    {
      action: 'type',
      selector: '#search',
      result: 'ok',
      timestamp: 3,
      graphFingerprint,
      value: 'events',
      effect: {
        stateChanged: true,
        primarySignal: 'target_value_changed',
        signals: ['target_value_changed'],
        strength: 'strong',
        targetValue: 'events',
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'type', sel: '#search', text: 'events' }],
    'Find events in San Francisco',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'events',
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
          primarySignal: 'target_value_changed',
          signals: ['target_value_changed'],
          strength: 'strong',
          targetValue: 'events',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'no_progress');
});

test('executePlan allows a single no-effect click without escalating', async () => {
  const graph = makeGraph('single-click');
  const result = await executePlan(
    [{ tool: 'click', sel: '[aria-label="Search"]' }],
    'Try the search box',
    graph,
    makeExecutor(action => successResult(action, {
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: true,
        effect: {
          stateChanged: false,
          primarySignal: 'none',
          signals: ['none'],
          strength: 'none',
        },
      },
    })),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'ok');
});

test('executePlan keeps telemetry but does not abort when progress guards are disabled', async () => {
  const graph = makeGraph('telemetry-only');
  const plan: LLMPlanStep[] = [
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'click', sel: '[aria-label="Search"]' },
    { tool: 'click', sel: '[aria-label="Search"]' },
  ];

  const result = await executePlan(
    plan,
    'Observe without enforcing',
    graph,
    makeExecutor(action => successResult(action, {
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: true,
        effect: {
          stateChanged: false,
          primarySignal: 'none',
          signals: ['none'],
          strength: 'none',
        },
      },
    })),
    [],
    { mutationWaitMs: 0, enforceProgressGuards: false },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'abort');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'ok');
});

test('executePlan stops remaining plan steps after a real page change', async () => {
  const graph = makeGraph('page-change');
  const result = await executePlan(
    [
      { tool: 'click', sel: 'a[href="/next"]' },
      { tool: 'scroll', direction: 'down' },
    ],
    'Navigate to the next page',
    graph,
    makeExecutor(action => successResult(action, {
      metadata: {
        attempts: 1,
        durationMs: 0,
        runtimePath: ['dom'],
        finalRuntime: 'dom',
        usedFallback: false,
        target: action.target,
        mutating: action.kind !== 'get' && action.kind !== 'wait',
        effect: {
          stateChanged: true,
          primarySignal: 'url_changed',
          signals: ['url_changed'],
          strength: 'strong',
        },
      },
    })),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'page_changed');
  assert.equal(result.stepsExecuted, 1);
});

test('executePlan stops repeated same-result search_page actions on the fourth observation', async () => {
  const graph = makeGraph('search-repeat');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'search_page',
      selector: 'pattern:pricing',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'Found 1 match for "pricing".',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Found 1 match for "pricing".',
      },
    },
    {
      action: 'search_page',
      selector: 'pattern:pricing',
      result: 'ok',
      timestamp: 2,
      graphFingerprint,
      value: 'Found 1 match for "pricing".',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Found 1 match for "pricing".',
      },
    },
    {
      action: 'search_page',
      selector: 'pattern:pricing',
      result: 'ok',
      timestamp: 3,
      graphFingerprint,
      value: 'Found 1 match for "pricing".',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Found 1 match for "pricing".',
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'search_page', pattern: 'pricing' }],
    'Check whether pricing exists',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'Found 1 match for "pricing".',
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
          targetValue: 'Found 1 match for "pricing".',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'no_progress');
});

test('executePlan marks direct get results as answer evidence', async () => {
  const graph = makeGraph('get-answer-evidence');

  const result = await executePlan(
    [{ tool: 'get', sel: '#alpha' }],
    'What is the headline?',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'NASA launches new mission',
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
          targetValue: 'NASA launches new mission',
        },
      },
    })),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.readOutcome, 'answer_evidence');
});

test('executePlan escalates repeated low-value inspect_region summaries earlier', async () => {
  const graph = makeGraph('inspect-repeat');
  const graphFingerprint = fingerprintGraph(graph);
  const summary = 'Region ".results" contains 8 notable nodes.';
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'inspect_region',
      selector: '.results',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: summary,
      readOutcome: 'context_only',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: summary,
      },
    },
    {
      action: 'inspect_region',
      selector: '.results',
      result: 'ok',
      timestamp: 2,
      graphFingerprint,
      value: summary,
      readOutcome: 'context_only',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: summary,
      },
    },
  ];

  const result = await executePlan(
    [{ tool: 'inspect_region', sel: '.results' }],
    'Get the first laptop price from this page',
    graph,
    makeExecutor(action => successResult(action, {
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
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.readOutcome, 'noise_repeat');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.result, 'no_progress');
});

test('executePlan forwards Brain1 target identity hints for click actions', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'button',
        value: 'Search',
        sel: '[aria-label="Search"]',
        selType: 'aria',
        rule: 'test',
        meta: {
          nodeId: 'n_low',
          refId: 'bg1_2',
          backendNodeId: 1002,
          frameId: 'frame-low',
          sessionId: 'brain1_sess',
          nth: 2,
          stableHash: 'sh_low',
          selectorScore: 40,
          interactionScore: 42,
          actionabilityScore: 44,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 1,
        },
      },
      {
        type: 'trigger',
        tag: 'button',
        value: 'Search',
        sel: '[aria-label="Search"]',
        selType: 'aria',
        rule: 'test',
        meta: {
          nodeId: 'n_high',
          refId: 'bg1_1',
          backendNodeId: 2001,
          frameId: 'frame-main',
          sessionId: 'brain1_sess',
          nth: 1,
          stableHash: 'sh_high',
          selectorScore: 88,
          interactionScore: 92,
          actionabilityScore: 90,
          interactionKind: 'button',
          confidence: 'high',
          enrichmentState: 'enriched',
          visibility: 'visible',
          goalScore: 8,
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  let capturedAction: Action | undefined;
  const result = await executePlan(
    [{ tool: 'click', sel: '[aria-label="Search"]' }],
    'Use search',
    graph,
    makeExecutor(action => {
      capturedAction = action;
      return successResult(action);
    }),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(capturedAction?.targetHint?.backendNodeId, 2001);
  assert.equal(capturedAction?.targetHint?.refId, 'bg1_1');
  assert.equal(capturedAction?.targetHint?.nth, 1);
  assert.equal(capturedAction?.targetHint?.ambiguousSelector, true);
});

test('executePlan forwards target hints when selector differs only by escaping', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'trigger',
        tag: 'a',
        value: 'Human Moon landings',
        sel: 'a[href="#Human_Moon_landings_(1969–1972)"]',
        selType: 'href',
        rule: 'test',
        meta: {
          nodeId: 'n1',
          refId: 'bg1_7',
          backendNodeId: 7007,
          frameId: 'frame-main',
          sessionId: 'brain1_sess',
          nth: 1,
          stableHash: 'sh_anchor',
          selectorScore: 82,
          interactionScore: 78,
          actionabilityScore: 70,
          interactionKind: 'link',
          confidence: 'high',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 10,
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  let capturedAction: Action | undefined;
  await executePlan(
    [{ tool: 'click', sel: 'a[href="#Human_Moon_landings_\\(1969–1972\\)"]' }],
    'How many people have walked on the Moon in total?',
    graph,
    makeExecutor(action => {
      capturedAction = action;
      return successResult(action);
    }),
    [],
    { mutationWaitMs: 0, enforceTargetUtilityGuards: false },
  );

  assert.equal(capturedAction?.target, 'a[href="#Human_Moon_landings_(1969–1972)"]');
  assert.equal(capturedAction?.targetHint?.backendNodeId, 7007);
  assert.equal(capturedAction?.targetHint?.refId, 'bg1_7');
});

test('executePlan canonicalizes equivalent escaped selectors for inspect_region', async () => {
  const graph: SemanticGraph = {
    snapshot: [
      {
        type: 'data',
        tag: 'h2',
        value: 'Featured laptop',
        sel: 'h2[aria-label="Featured \\"Laptop\\""]',
        selType: 'aria',
        rule: 'test',
        meta: {
          nodeId: 'd1',
          selectorScore: 70,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 22,
          stableHash: 'sh_data',
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  let capturedAction: Action | undefined;
  await executePlan(
    [{ tool: 'inspect_region', sel: 'h2[aria-label="Featured \\\"Laptop\\\""]' }],
    'Get the first laptop title',
    graph,
    makeExecutor(action => {
      capturedAction = action;
      return successResult(action, {
        value: 'Region contains 3 notable nodes.',
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
            targetValue: 'Region contains 3 notable nodes.',
          },
        },
      });
    }),
    [],
    { mutationWaitMs: 0, enforceTargetUtilityGuards: false },
  );

  assert.equal(capturedAction?.target, 'h2[aria-label="Featured \\"Laptop\\""]');
});

test('executePlan blocks ambiguous low-utility click plans and returns to LLM', async () => {
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
          selectorScore: 42,
          interactionScore: 55,
          actionabilityScore: 43,
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
          selectorScore: 41,
          interactionScore: 52,
          actionabilityScore: 40,
          interactionKind: 'button',
          confidence: 'low',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 5,
          stableHash: 'sh_2',
          regionSelector: '.card',
        },
      },
      {
        type: 'data',
        tag: 'h3',
        value: 'First Listing',
        sel: '.card h3',
        selType: 'positional',
        rule: 'test',
        meta: {
          nodeId: 'd1',
          selectorScore: 55,
          interactionScore: 0,
          actionabilityScore: 0,
          interactionKind: 'generic',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 28,
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
          selectorScore: 52,
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

  let executeCount = 0;
  const result = await executePlan(
    [{ tool: 'click', sel: '[data-action="open"]' }],
    'What company posted the first job listing shown?',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    [],
    { mutationWaitMs: 0, enforceTargetUtilityGuards: true },
  );

  assert.equal(executeCount, 0);
  assert.equal(result.abortReason, 'plan_stale');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.value, 'utility_guard:read_before_click');
});

test('executePlan can bypass target utility guard when disabled', async () => {
  const graph = makeGraph('guard-disabled');
  let executeCount = 0;

  const result = await executePlan(
    [{ tool: 'click', sel: '[aria-label="Search"]' }],
    'What is visible here?',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    [],
    { mutationWaitMs: 0, enforceTargetUtilityGuards: false },
  );

  assert.equal(executeCount, 1);
  assert.equal(result.abortReason, 'max_steps');
});

test('executePlan blocks repeated pagination churn and requests replan', async () => {
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
          selectorScore: 78,
          interactionScore: 72,
          actionabilityScore: 74,
          interactionKind: 'link',
          confidence: 'medium',
          enrichmentState: 'base',
          visibility: 'visible',
          goalScore: 8,
        },
      },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/search?q=laptop&page=4',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };

  const history: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=2"]',
      result: 'ok',
      timestamp: 1,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=3"]',
      result: 'ok',
      timestamp: 2,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=4"]',
      result: 'ok',
      timestamp: 3,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
  ];

  let executeCount = 0;
  const result = await executePlan(
    [{ tool: 'click', sel: 'a[href="/search?q=laptop&page=5"]' }],
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    history,
    { mutationWaitMs: 0, enforceTargetUtilityGuards: true },
  );

  assert.equal(executeCount, 0);
  assert.equal(result.abortReason, 'plan_stale');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.value, 'utility_guard:pagination_churn');
});

test('executePlan replans when a selector has repeated not_found failures', async () => {
  const graph = makeGraph('stale-selector-guard');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: '[aria-label="Search"]',
      result: 'not_found',
      timestamp: 1,
      graphFingerprint,
    },
    {
      action: 'click',
      selector: '[aria-label="Search"]',
      result: 'not_found',
      timestamp: 2,
      graphFingerprint,
    },
    {
      action: 'click',
      selector: '[aria-label="Search"]',
      result: 'not_found',
      timestamp: 3,
      graphFingerprint,
    },
  ];

  let executeCount = 0;
  const result = await executePlan(
    [{ tool: 'click', sel: '[aria-label="Search"]' }],
    'Open search',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(executeCount, 0);
  assert.equal(result.abortReason, 'plan_stale');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.value, 'utility_guard:stale_selector');
});

test('executePlan replans when selector family has repeated not_found failures', async () => {
  const graph = makeGraph('stale-family-guard');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: 'div:nth-of-type(3) > div:nth-of-type(1) > span:nth-of-type(2)',
      result: 'not_found',
      timestamp: 1,
      graphFingerprint,
    },
    {
      action: 'get',
      selector: 'div:nth-of-type(4) > div:nth-of-type(1) > span:nth-of-type(2)',
      result: 'not_found',
      timestamp: 2,
      graphFingerprint,
    },
    {
      action: 'get',
      selector: 'div:nth-of-type(5) > div:nth-of-type(1) > span:nth-of-type(2)',
      result: 'not_found',
      timestamp: 3,
      graphFingerprint,
    },
  ];

  let executeCount = 0;
  const result = await executePlan(
    [{ tool: 'get', sel: 'div:nth-of-type(6) > div:nth-of-type(1) > span:nth-of-type(2)' }],
    'Get the first laptop price',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(executeCount, 0);
  assert.equal(result.abortReason, 'plan_stale');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.value, 'utility_guard:stale_selector');
});

test('executePlan replans when type selector repeats non-fillable execution errors', async () => {
  const graph = makeGraph('type-host-guard');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'type',
      selector: '#search-input',
      result: 'execution_error',
      timestamp: 1,
      graphFingerprint,
      value: 'locator.fill: Error: Element is not an <input>, <textarea>, <select> or [contenteditable] and does not have a role allowing [aria-readonly]',
    },
    {
      action: 'type',
      selector: '#search-input',
      result: 'execution_error',
      timestamp: 2,
      graphFingerprint,
      value: 'locator.fill: Error: Element is not an <input>, <textarea>, <select> or [contenteditable] and does not have a role allowing [aria-readonly]',
    },
  ];

  let executeCount = 0;
  const result = await executePlan(
    [{ tool: 'type', sel: '#search-input', text: 'space images' }],
    'Search archive for space images',
    graph,
    makeExecutor(action => {
      executeCount += 1;
      return successResult(action);
    }),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(executeCount, 0);
  assert.equal(result.abortReason, 'plan_stale');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.value, 'utility_guard:stale_selector');
});
