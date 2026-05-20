import test from 'node:test';
import assert from 'node:assert/strict';

import { FailureClassifier } from '../../../src/v2/runtime/FailureClassifier';
import type { OperationalProjection } from '../../../src/v2/brain1/projectionTypes';
import type { V2ToolResult } from '../../../src/v2';

function makeProjection(overrides: Partial<OperationalProjection> = {}): OperationalProjection {
  return {
    projectionId: 'projection_failure',
    observationId: 'obs_failure',
    generationId: 1,
    url: 'https://example.test',
    title: 'Failure Fixture',
    interactions: [],
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: {
      interactionCount: 0,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
    ...overrides,
  };
}

test('FailureClassifier maps blocked target results to persistent mechanical evidence', () => {
  const result: V2ToolResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_blocked',
    error: {
      code: 'target_blocked',
      message: 'Target center point is covered by another element.',
      retryable: false,
    },
    traceStepId: 'step_blocked',
  };

  const evidence = new FailureClassifier().classify(result, {
    observationId: 'obs_blocked',
  });

  assert.equal(evidence.kind, 'target_blocked');
  assert.equal(evidence.category, 'target');
  assert.equal(evidence.persistence, 'persistent');
  assert.equal(evidence.retryable, false);
  assert.equal(evidence.targetRef, 'ref_blocked');
  assert.ok(evidence.signals.includes('error:target_blocked'));
  assert.doesNotMatch(evidence.message, /try another|strategy|not useful|task/i);
});

test('FailureClassifier maps captcha-like projection to environment block evidence only', () => {
  const projection = makeProjection({
    readables: [
      {
        refId: 'ref_captcha_text',
        kind: 'generic',
        role: 'status',
        text: 'CAPTCHA verification required before page content is available.',
        visibility: 'visible',
        actionability: 'unknown',
        state: 'live',
        continuityConfidence: 1,
        score: 20,
      },
    ],
    stats: {
      interactionCount: 0,
      readableCount: 1,
      navigationCount: 0,
      regionCount: 0,
    },
  });

  const evidence = new FailureClassifier().classify(undefined, {
    observationId: 'obs_captcha',
    projection,
  });
  const json = JSON.stringify(evidence);

  assert.equal(evidence.kind, 'environment_block');
  assert.equal(evidence.category, 'environment');
  assert.equal(evidence.observationId, 'obs_captcha');
  assert.ok(evidence.signals.includes('environment_text:captcha'));
  assert.doesNotMatch(json, /impossible|dead_end|try another|not useful/i);
});

test('FailureClassifier preserves retryability for timeout evidence', () => {
  const result: V2ToolResult = {
    success: false,
    kind: 'click',
    targetRef: 'ref_slow',
    error: {
      code: 'timeout',
      message: 'click timed out before the target became stable.',
      retryable: true,
    },
    traceStepId: 'step_timeout',
  };

  const evidence = new FailureClassifier().classify(result, {
    observationId: 'obs_timeout',
  });

  assert.equal(evidence.kind, 'timeout');
  assert.equal(evidence.category, 'timing');
  assert.equal(evidence.persistence, 'transient');
  assert.equal(evidence.retryable, true);
});
