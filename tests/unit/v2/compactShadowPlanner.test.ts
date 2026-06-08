import assert from 'node:assert/strict';
import test from 'node:test';
import type { V2PlannerProvider, V2PlannerProviderResult } from '../../../src/v2/planner/V2PlannerClient';
import type { CompactShadowPlannerInput } from '../../../src/v2/planner/CompactShadowInput';
import { callCompactShadowPlanner } from '../../../src/v2/planner/CompactShadowPlanner';

const mockInput: CompactShadowPlannerInput = {
  version: 'compact_shadow_input.v1',
  goal: 'Click the submit button',
  actions: [
    { index: 'a1', label: 'Submit Button', tools: ['click'] },
    { index: 'a2', label: 'Input Field', tools: ['type'] }
  ],
  reads: [
    { index: 'r1', text: 'Some text', tools: ['get', 'inspect_region'] }
  ]
};

const mockIndexToRef: Record<string, string> = {
  a1: 'ref_submit',
  a2: 'ref_input',
  r1: 'ref_text'
};

test('callCompactShadowPlanner normalizes provider output using indexToRef', async () => {
  const mockProvider: V2PlannerProvider = async (system, user, model, options) => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a1' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 20
    };
  };

  const result = await callCompactShadowPlanner(
    mockProvider,
    mockInput,
    mockIndexToRef,
    'mock-model'
  );

  assert.equal(result.status, 'valid');
  if (result.status === 'valid') {
    assert.deepEqual(result.output, {
      plan: [{ tool: 'click', ref: 'ref_submit' }],
      confidence: 'high'
    });
    assert.deepEqual(result.rawOutput, {
      plan: [{ tool: 'click', ref: 'a1' }],
      confidence: 'high'
    });
    assert.equal(result.inputTokens, 10);
    assert.equal(result.outputTokens, 20);
    assert.ok(result.durationMs >= 0);
  }
});

test('callCompactShadowPlanner returns invalid_output for unknown compact index', async () => {
  const mockProvider: V2PlannerProvider = async () => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a99' }],
        confidence: 'high'
      }),
      inputTokens: 5,
      outputTokens: 10
    };
  };

  const result = await callCompactShadowPlanner(
    mockProvider,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result.status, 'invalid_output');
  if (result.status === 'invalid_output') {
    assert.ok(result.errors.some(err => err.includes('unknown compact index')));
  }
});

test('callCompactShadowPlanner returns invalid_output for selector-shaped outputs', async () => {
  const mockProvider: V2PlannerProvider = async () => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: '#submit-btn' }],
        confidence: 'high'
      }),
      inputTokens: 5,
      outputTokens: 10
    };
  };

  const result = await callCompactShadowPlanner(
    mockProvider,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result.status, 'invalid_output');
  if (result.status === 'invalid_output') {
    assert.ok(result.errors.some(err => err.includes('unknown compact index')));
  }
});

test('callCompactShadowPlanner returns provider_error when provider throws', async () => {
  const mockProvider: V2PlannerProvider = async () => {
    throw new Error('API call failed');
  };

  const result = await callCompactShadowPlanner(
    mockProvider,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result.status, 'provider_error');
  if (result.status === 'provider_error') {
    assert.equal(result.error, 'API call failed');
  }
});

test('callCompactShadowPlanner calls provider exactly once even if invalid output', async () => {
  let callCount = 0;
  const mockProvider: V2PlannerProvider = async () => {
    callCount++;
    return {
      text: 'invalid json text',
      inputTokens: 10,
      outputTokens: 5
    };
  };

  const result = await callCompactShadowPlanner(
    mockProvider,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result.status, 'invalid_output');
  assert.equal(callCount, 1);
});

test('callCompactShadowPlanner validates output action compatibility and allowed refs', async () => {
  // Case A: Ref not compatible with action tool (e.g. click on a2 which only supports 'type')
  const mockProviderIncompatible: V2PlannerProvider = async () => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a2' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 15
    };
  };

  const result1 = await callCompactShadowPlanner(
    mockProviderIncompatible,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result1.status, 'invalid_output');
  if (result1.status === 'invalid_output') {
    assert.ok(result1.errors.some(err => err.includes('is not compatible with tool')));
  }

  // Case B: Not present in allowedRefs (handled because it's not in indexToRef)
  const mockProviderInvalidRef: V2PlannerProvider = async () => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a3' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 15
    };
  };

  const result2 = await callCompactShadowPlanner(
    mockProviderInvalidRef,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result2.status, 'invalid_output');
});

test('callCompactShadowPlanner rejects plan steps using forbidden alias sel or selector', async () => {
  const mockProviderSel: V2PlannerProvider = async () => {
    return {
      text: JSON.stringify({
        plan: [{ tool: 'click', sel: 'a1' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 15
    };
  };

  const result = await callCompactShadowPlanner(
    mockProviderSel,
    mockInput,
    mockIndexToRef
  );

  assert.equal(result.status, 'invalid_output');
  if (result.status === 'invalid_output') {
    assert.ok(result.errors.some(err => err.includes('uses forbidden alias "sel" or "selector"')));
  }
});
