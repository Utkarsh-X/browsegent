import test from 'node:test';
import assert from 'node:assert/strict';

import { assessTargetUtilityGuard, buildTargetUtilityHistoryValue } from '../../src/agent/targetUtility';
import { normalizeSelectorForComparison, selectorsEquivalent } from '../../src/agent/selectorMatch';
import type { FilteredNode } from '../../src/brain1/types';
import type { Action } from '../../src/executor/types';
import type { SemanticGraph } from '../../src/graph/types';

function makeAction(target: string): Action {
  return {
    kind: 'click',
    target,
    origin: 'llm',
    original: { tool: 'click', sel: target },
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
