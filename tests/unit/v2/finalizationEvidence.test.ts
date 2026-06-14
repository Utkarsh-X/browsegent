import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalizationEvidence } from '../../../src/v2/agent/FinalizationEvidence';
import type { OperationalProjection, ProjectionItem } from '../../../src/v2/brain1/projectionTypes';

function makeProjection(): OperationalProjection {
  return {
    projectionId: 'projection_finalization',
    observationId: 'obs_finalization',
    generationId: 1,
    url: 'https://example.test',
    title: 'Calculator',
    interactions: [],
    readables: [
      {
        refId: 'ref_result',
        kind: 'generic',
        role: 'text',
        name: 'Result',
        text: 'Derivative is 11.2',
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        score: 100,
        continuityConfidence: 1,
      },
      {
        refId: 'ref_noise',
        kind: 'button',
        role: 'button',
        name: 'Step-by-step solution',
        text: 'Step-by-step solution',
        visibility: 'visible',
        actionability: 'ready',
        state: 'live',
        score: 20,
        continuityConfidence: 1,
      },
    ],
    navigation: [],
    regions: [],
    warnings: [],
    stats: {
      interactionCount: 0,
      readableCount: 2,
      navigationCount: 0,
      regionCount: 0,
    },
  };
}

test('buildFinalizationEvidence includes last value and compact readable evidence', () => {
  const evidence = buildFinalizationEvidence({
    goal: 'Calculate derivative of x^2 when x=5.6',
    projection: makeProjection(),
    lastSuccessfulEvidenceValue: 'Compute input button',
  });

  assert.match(evidence, /Last successful evidence:/);
  assert.match(evidence, /Compute input button/);
  assert.match(evidence, /Readable evidence:/);
  assert.match(evidence, /Derivative is 11\.2/);
});

test('buildFinalizationEvidence includes answer contract and bounded candidates', () => {
  const projection = makeProjection();
  // Override readables to test candidate extraction
  projection.readables = [
    {
      refId: 'r1',
      kind: 'generic',
      role: 'text',
      name: 'resource-watch/resource-watch',
      text: '1.2k stars climate data platform',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      score: 100,
      continuityConfidence: 1,
    },
    {
      refId: 'r2',
      kind: 'generic',
      role: 'text',
      name: 'akshaysonvane/Climate-Change-Data-Analytics',
      text: '20 stars visualization',
      visibility: 'visible',
      actionability: 'ready',
      state: 'live',
      score: 50,
      continuityConfidence: 1,
    },
  ];

  const evidence = buildFinalizationEvidence({
    goal: 'Find the repository with the most stars for climate change data visualization',
    projection,
    lastSuccessfulEvidenceValue: 'GitHub search results',
  });

  assert.match(evidence, /Answer contract: ranked_entity/);
  assert.match(evidence, /candidate_1/);
  assert.match(evidence, /resource-watch\/resource-watch/);
});

test('buildFinalizationEvidence includes required answer details from the goal', () => {
  const evidence = buildFinalizationEvidence({
    goal: 'Look up the pronunciation and definition of the word "sustainability"',
    projection: makeProjection(),
  });

  assert.match(evidence, /Required answer details:/);
  assert.match(evidence, /pronunciation/);
  assert.match(evidence, /definition/);
});
