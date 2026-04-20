import test from 'node:test';
import assert from 'node:assert/strict';

import { assessTargetUtilityGuard, buildTargetUtilityHistoryValue } from '../../src/agent/targetUtility';
import { normalizeSelectorForComparison, selectorFamilyFingerprint, selectorsEquivalent } from '../../src/agent/selectorMatch';
import type { FilteredNode } from '../../src/brain1/types';
import type { Action } from '../../src/executor/types';
import type { SemanticGraph } from '../../src/graph/types';
import type { ActionHistoryEntry } from '../../src/graph/serializer';

function makeAction(target: string): Action {
  return {
    kind: 'click',
    target,
    origin: 'llm',
    original: { tool: 'click', sel: target },
  };
}

function makeGetAction(target: string): Action {
  return {
    kind: 'get',
    target,
    origin: 'llm',
    original: { tool: 'get', sel: target },
  };
}

function makeNode(overrides: Partial<FilteredNode>): FilteredNode {
  return {
    type: 'trigger',
    tag: 'button',
    value: 'Open',
    sel: '[data-action="open"]',
    selType: 'testid',
    rule: 'test',
    ...overrides,
  };
}

function makeGraph(snapshot: FilteredNode[]): SemanticGraph {
  return {
    snapshot,
    deltas: [],
    status: 'live',
    lastCause: null,
    errors: [],
    pageUrl: 'https://example.com',
    snapshotTimestamp: 1,
    lastUpdateTimestamp: 1,
  };
}

test('assessTargetUtilityGuard blocks ambiguous read-before-click pattern on extraction goal', () => {
  const graph = makeGraph([
    makeNode({
      value: 'Open',
      meta: {
        nodeId: 't1',
        selectorScore: 44,
        interactionScore: 51,
        actionabilityScore: 42,
        interactionKind: 'button',
        confidence: 'low',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 4,
        stableHash: 'sh_1',
        regionSelector: '.card',
      },
    }),
    makeNode({
      value: 'Open',
      meta: {
        nodeId: 't2',
        selectorScore: 42,
        interactionScore: 50,
        actionabilityScore: 41,
        interactionKind: 'button',
        confidence: 'low',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 3,
        stableHash: 'sh_2',
        regionSelector: '.card',
      },
    }),
    {
      type: 'data',
      tag: 'h3',
      value: 'Python Developer',
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
  ]);

  const signal = assessTargetUtilityGuard(
    makeAction('[data-action="open"]'),
    'What company posted the first job listing shown?',
    graph,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'read_before_click');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:read_before_click');
});

test('assessTargetUtilityGuard does not block when high-confidence actionable target exists', () => {
  const graph = makeGraph([
    makeNode({
      meta: {
        nodeId: 't1',
        selectorScore: 86,
        interactionScore: 78,
        actionabilityScore: 82,
        interactionKind: 'button',
        confidence: 'high',
        enrichmentState: 'enriched',
        visibility: 'visible',
        goalScore: 24,
        stableHash: 'sh_high',
      },
    }),
  ]);

  const signal = assessTargetUtilityGuard(
    makeAction('[data-action="open"]'),
    'Open the first listing details',
    graph,
  );

  assert.equal(signal.shouldBlock, false);
});

test('assessTargetUtilityGuard blocks same-page anchors on extraction goals', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="#overview"]',
      selType: 'href',
      meta: {
        nodeId: 'anchor-1',
        selectorScore: 72,
        interactionScore: 66,
        actionabilityScore: 70,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 3,
      },
    }),
  ]);

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="#overview"]'),
    'What is the title of the first weather headline shown?',
    graph,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'same_page_anchor');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:same_page_anchor');
});

test('selector matching treats escaped and unescaped selector variants as equivalent', () => {
  const left = 'a[href="#Human_Moon_landings_\\(1969–1972\\)"]';
  const right = 'a[href="#Human_Moon_landings_(1969–1972)"]';

  assert.equal(selectorsEquivalent(left, right), true);
  assert.equal(
    normalizeSelectorForComparison(left),
    normalizeSelectorForComparison(right),
  );
});

test('selector family fingerprint groups positional sibling variants', () => {
  const first = 'div:nth-of-type(3) > div:nth-of-type(1) > span:nth-of-type(2)';
  const second = 'div:nth-of-type(4) > div:nth-of-type(1) > span:nth-of-type(5)';

  assert.equal(selectorFamilyFingerprint(first), selectorFamilyFingerprint(second));
});

test('assessTargetUtilityGuard blocks outbound navigation when strong goal data is already present', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/wiki/List_of_people_who_have_walked_on_the_Moon"]',
      selType: 'href',
      value: 'List of people who have walked on the Moon',
      meta: {
        nodeId: 'nav-link',
        selectorScore: 76,
        interactionScore: 70,
        actionabilityScore: 72,
        interactionKind: 'link',
        confidence: 'high',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 14,
      },
    }),
    {
      type: 'data',
      tag: 'p',
      value: 'Twelve people have walked on the Moon.',
      sel: '.mw-parser-output p:nth-of-type(1)',
      selType: 'positional',
      rule: 'test',
      meta: {
        nodeId: 'd1',
        selectorScore: 48,
        interactionScore: 0,
        actionabilityScore: 0,
        interactionKind: 'generic',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 32,
      },
    },
  ]);

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/wiki/List_of_people_who_have_walked_on_the_Moon"]'),
    'How many people have walked on the Moon in total?',
    graph,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'read_before_navigation');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:read_before_navigation');
});

test('assessTargetUtilityGuard blocks repeated pagination churn on extraction goals', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=5"]',
      selType: 'href',
      value: '5',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

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

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=5"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_churn');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:pagination_churn');
});

test('assessTargetUtilityGuard treats inspect_region as exploratory and does not reset pagination churn', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=6"]',
      selType: 'href',
      value: '6',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

  const history: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=3"]',
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
      selector: 'a[href="/search?q=laptop&page=4"]',
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
      action: 'inspect_region',
      selector: '.result-list',
      result: 'ok',
      timestamp: 3,
      value: 'Region ".result-list" contains 8 notable nodes.',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
      },
    },
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=5"]',
      result: 'ok',
      timestamp: 4,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=6"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_churn');
});

test('assessTargetUtilityGuard keeps pagination churn when low-value read tools repeat', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=7"]',
      selType: 'href',
      value: '7',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

  const history: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=4"]',
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
      selector: 'a[href="/search?q=laptop&page=5"]',
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
      action: 'find_elements',
      selector: 'div.product-card',
      result: 'ok',
      timestamp: 3,
      value: 'Found 12 elements matching "div.product-card". Showing 8.',
      readOutcome: 'context_only',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
      },
    },
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=6"]',
      result: 'ok',
      timestamp: 4,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=7"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_churn');
});

test('assessTargetUtilityGuard blocks immediate pagination continuation without read evidence', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=7"]',
      selType: 'href',
      value: '7',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

  const history: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: '.results .product:nth-child(1) .price',
      result: 'ok',
      timestamp: 1,
      value: 'INR 129,999',
      readOutcome: 'answer_evidence',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
      },
    },
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=6"]',
      result: 'ok',
      timestamp: 2,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=7"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_churn');
});

test('assessTargetUtilityGuard blocks immediate pagination continuation even when selector is unmatched', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=2"]',
      selType: 'href',
      value: '2',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

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
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search\\\\?q\\\\=laptop\\\\&page\\\\=3"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_churn');
});

test('assessTargetUtilityGuard blocks extra pagination after answer evidence on single-page extraction goals', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=7"]',
      selType: 'href',
      value: '7',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

  const history: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=6"]',
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
      action: 'get',
      selector: '.results .product:nth-child(1) .price',
      result: 'ok',
      timestamp: 2,
      value: 'INR 129,999',
      readOutcome: 'answer_evidence',
      effect: {
        stateChanged: false,
        primarySignal: 'target_value_observed',
        signals: ['target_value_observed'],
        strength: 'weak',
      },
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=7"]'),
    'Get the price of the first laptop listed after moving to the next page of results',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'pagination_answer_observed');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:pagination_answer_observed');
});

test('assessTargetUtilityGuard allows multi-page extraction goals to continue pagination without forced reads', () => {
  const graph = makeGraph([
    makeNode({
      tag: 'a',
      sel: 'a[href="/search?q=laptop&page=7"]',
      selType: 'href',
      value: '7',
      meta: {
        nodeId: 'page-link',
        selectorScore: 78,
        interactionScore: 72,
        actionabilityScore: 75,
        interactionKind: 'link',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 9,
      },
    }),
  ]);

  const history: ActionHistoryEntry[] = [
    {
      action: 'click',
      selector: 'a[href="/search?q=laptop&page=6"]',
      result: 'ok',
      timestamp: 1,
      effect: {
        stateChanged: true,
        primarySignal: 'url_changed',
        signals: ['url_changed'],
        strength: 'strong',
      },
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeAction('a[href="/search?q=laptop&page=7"]'),
    'Collect prices across the next 3 pages and return the average laptop price',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, false);
});

test('assessTargetUtilityGuard blocks brittle unmatched get selectors to avoid stale read churn', () => {
  const graph = makeGraph([
    {
      type: 'data',
      tag: 'span',
      value: 'INR 129,999',
      sel: '.result .price',
      selType: 'positional',
      rule: 'test',
      meta: {
        nodeId: 'd1',
        selectorScore: 58,
        interactionScore: 0,
        actionabilityScore: 0,
        interactionKind: 'generic',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 24,
      },
    },
  ]);

  const signal = assessTargetUtilityGuard(
    makeGetAction('div:nth-of-type(3) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(2) > div > div > div:nth-of-type(3) > div > div > div'),
    'Get the price of the first laptop product in the search results',
    graph,
    [],
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'stale_read_selector');
  assert.equal(buildTargetUtilityHistoryValue(signal), 'utility_guard:stale_read_selector');
});

test('assessTargetUtilityGuard blocks repeated not_found get selectors even when selector is short', () => {
  const graph = makeGraph([]);
  const history: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: '.price',
      result: 'not_found',
      timestamp: 1,
    },
    {
      action: 'get',
      selector: '.price',
      result: 'not_found',
      timestamp: 2,
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeGetAction('.price'),
    'Get the first laptop price',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'stale_read_selector');
});

test('assessTargetUtilityGuard blocks repeated not_found get selector families', () => {
  const graph = makeGraph([]);
  const history: ActionHistoryEntry[] = [
    {
      action: 'get',
      selector: 'div:nth-of-type(3) > span:nth-of-type(1) > span.price',
      result: 'not_found',
      timestamp: 1,
    },
    {
      action: 'get',
      selector: 'div:nth-of-type(4) > span:nth-of-type(1) > span.price',
      result: 'not_found',
      timestamp: 2,
    },
  ];

  const signal = assessTargetUtilityGuard(
    makeGetAction('div:nth-of-type(5) > span:nth-of-type(1) > span.price'),
    'Get the first laptop price',
    graph,
    history,
  );

  assert.equal(signal.shouldBlock, true);
  assert.equal(signal.reason, 'stale_read_selector');
});

test('assessTargetUtilityGuard allows get selectors that are present in current snapshot', () => {
  const graph = makeGraph([
    {
      type: 'data',
      tag: 'span',
      value: '$129',
      sel: '.price',
      selType: 'positional',
      rule: 'test',
      meta: {
        nodeId: 'p1',
        selectorScore: 64,
        interactionScore: 0,
        actionabilityScore: 0,
        interactionKind: 'generic',
        confidence: 'medium',
        enrichmentState: 'base',
        visibility: 'visible',
        goalScore: 22,
      },
    },
  ]);

  const signal = assessTargetUtilityGuard(
    makeGetAction('.price'),
    'Get the first laptop price',
    graph,
    [],
  );

  assert.equal(signal.shouldBlock, false);
});
