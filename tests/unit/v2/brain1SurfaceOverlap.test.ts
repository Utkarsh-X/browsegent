import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBrain1NodesToV2Refs, type SurfaceOverlapReport } from '../../../src/v2/trace/Brain1SurfaceOverlap';

test('mapBrain1NodesToV2Refs matches nodes by selector overlap', () => {
  const brain1Nodes = [
    { sel: '#search-input', value: 'Search', tag: 'input', rule: 'input', selType: 'id' as const },
    { sel: '.nav-link:nth-child(2)', value: 'About', tag: 'a', rule: 'link', selType: 'positional' as const },
  ];
  const v2Refs = [
    { refId: 'v2ref_1', selectorCandidates: ['#search-input', 'input[name=q]'], role: 'textbox', name: 'Search' },
    { refId: 'v2ref_2', selectorCandidates: ['.nav-link:nth-child(2)'], role: 'link', name: 'About' },
    { refId: 'v2ref_3', selectorCandidates: ['#footer-link'], role: 'link', name: 'Contact' },
  ];

  const report = mapBrain1NodesToV2Refs(brain1Nodes, v2Refs);
  assert.equal(report.brain1NodeCount, 2);
  assert.equal(report.v2RefCount, 3);
  assert.equal(report.matchedCount, 2);
  assert.equal(report.brain1OnlyCount, 0);
  assert.equal(report.v2OnlyCount, 1);
});

test('mapBrain1NodesToV2Refs identifies Brain1-only elements', () => {
  const brain1Nodes = [
    { sel: '#hidden-widget', value: 'Widget', tag: 'div', rule: 'widget', selType: 'id' as const },
  ];
  const v2Refs: any[] = [];
  const report = mapBrain1NodesToV2Refs(brain1Nodes, v2Refs);
  assert.equal(report.brain1OnlyCount, 1);
  assert.equal(report.brain1Only[0].sel, '#hidden-widget');
});

test('mapBrain1NodesToV2Refs identifies V2-only elements', () => {
  const brain1Nodes: any[] = [];
  const v2Refs = [
    { refId: 'v2ref_1', selectorCandidates: ['#btn'], role: 'button', name: 'Go' },
  ];
  const report = mapBrain1NodesToV2Refs(brain1Nodes, v2Refs);
  assert.equal(report.v2OnlyCount, 1);
  assert.equal(report.v2Only[0].refId, 'v2ref_1');
});

test('mapBrain1NodesToV2Refs handles empty inputs', () => {
  const report = mapBrain1NodesToV2Refs([], []);
  assert.equal(report.brain1NodeCount, 0);
  assert.equal(report.v2RefCount, 0);
  assert.equal(report.matchedCount, 0);
  assert.equal(report.brain1OnlyCount, 0);
  assert.equal(report.v2OnlyCount, 0);
});

test('mapBrain1NodesToV2Refs deduplicates when multiple Brain1 nodes match same V2 ref', () => {
  const brain1Nodes = [
    { sel: '#search-input', value: 'Search', tag: 'input', rule: 'input', selType: 'id' as const },
    { sel: 'input[name=q]', value: 'Search', tag: 'input', rule: 'input', selType: 'positional' as const },
  ];
  const v2Refs = [
    { refId: 'v2ref_1', selectorCandidates: ['#search-input', 'input[name=q]'], role: 'textbox', name: 'Search' },
  ];
  const report = mapBrain1NodesToV2Refs(brain1Nodes, v2Refs);
  assert.equal(report.matchedCount, 1); // Same V2 ref matched by two Brain1 nodes
  assert.equal(report.brain1OnlyCount, 0);
  assert.equal(report.v2OnlyCount, 0);
});
