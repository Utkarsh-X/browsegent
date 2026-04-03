import test from 'node:test';
import assert from 'node:assert/strict';

import { executePlan } from '../../src/agent/planExecutor';
import { deriveActionEffect } from '../../src/executor/effects';
import type { Executor } from '../../src/executor/executor';
import type { Action, ActionResult, BrowserRuntimeState, LLMPlanStep } from '../../src/executor/types';
import type { SemanticGraph } from '../../src/graph/types';
import type { ActionHistoryEntry } from '../../src/graph/serializer';
import { fingerprintGraph } from '../../src/agent/loopDetector';

function makeGraph(label = 'scenario'): SemanticGraph {
  return {
    snapshot: [
      { type: 'data', tag: 'div', value: `${label} headline`, sel: '#headline', selType: 'id', rule: 'test' },
      { type: 'trigger', tag: 'a', value: 'Jump', sel: 'a[href="#section"]', selType: 'href', rule: 'test' },
    ],
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com/page',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };
}

function makeRuntimeState(overrides: Partial<BrowserRuntimeState> = {}): BrowserRuntimeState {
  return {
    url: 'https://example.com/page',
    baseUrl: 'https://example.com/page',
    hash: '',
    scrollX: 0,
    scrollY: 0,
    focusKey: undefined,
    targetFound: true,
    targetValue: undefined,
    domSignature: 'stable',
    ...overrides,
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

test('deriveActionEffect grades weak versus strong progress conservatively', () => {
  const weak = deriveActionEffect(
    {
      kind: 'click',
      target: 'a[href="#section"]',
      origin: 'llm',
      original: { tool: 'click', sel: 'a[href="#section"]' },
    },
    makeRuntimeState(),
    makeRuntimeState({ hash: '#section', scrollY: 320 }),
  );
  const strong = deriveActionEffect(
    {
      kind: 'type',
      target: '#search',
      input: 'moon',
      origin: 'llm',
      original: { tool: 'type', sel: '#search', text: 'moon' },
    },
    makeRuntimeState({ targetValue: '' }),
    makeRuntimeState({ targetValue: 'moon', domSignature: 'changed' }),
    'moon',
  );

  assert.equal(weak?.strength, 'weak');
  assert.equal(weak?.primarySignal, 'hash_changed');
  assert.equal(strong?.strength, 'strong');
  assert.ok(strong?.signals.includes('dom_changed'));
});

test('scenario: repeated weak anchor progress escalates to no_progress', async () => {
  const graph = makeGraph('anchor-loop');
  const plan: LLMPlanStep[] = [
    { tool: 'click', sel: 'a[href="#section"]' },
    { tool: 'click', sel: 'a[href="#section"]' },
    { tool: 'click', sel: 'a[href="#section"]' },
  ];

  const result = await executePlan(
    plan,
    'Jump to the relevant section',
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
          stateChanged: true,
          primarySignal: 'hash_changed',
          signals: ['hash_changed', 'scroll_changed'],
          strength: 'weak',
        },
      },
    })),
    [],
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'no_progress');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'abort');
});

test('scenario: strong progress resets a weak anchor streak', async () => {
  const graph = makeGraph('strong-reset');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="#section"]',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      effect: {
        stateChanged: true,
        primarySignal: 'hash_changed',
        signals: ['hash_changed'],
        strength: 'weak',
      },
      progressStrength: 'weak',
      progressDecision: 'warn',
      repeatCount: 2,
    },
  ];

  const result = await executePlan(
    [{ tool: 'click', sel: 'a[href="#section"]' }],
    'Open the real destination',
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
          stateChanged: true,
          primarySignal: 'url_changed',
          signals: ['url_changed', 'dom_changed'],
          strength: 'strong',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'accept');
});

test('scenario: repeated same-value get warns before aborting', async () => {
  const graph = makeGraph('same-value');
  const graphFingerprint = fingerprintGraph(graph);
  const existingHistory: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: '#headline',
      result: 'ok',
      timestamp: 1,
      graphFingerprint,
      value: 'Same headline',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
        targetValue: 'Same headline',
      },
      progressStrength: 'weak',
      progressDecision: 'watch',
      repeatCount: 1,
    },
  ];

  const result = await executePlan(
    [{ tool: 'get', sel: '#headline' }],
    'Read the headline',
    graph,
    makeExecutor(action => successResult(action, {
      value: 'Same headline',
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
          targetValue: 'Same headline',
        },
      },
    })),
    existingHistory,
    { mutationWaitMs: 0 },
  );

  assert.equal(result.abortReason, 'max_steps');
  assert.equal(result.actionHistory[result.actionHistory.length - 1]?.progressDecision, 'warn');
});
