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
