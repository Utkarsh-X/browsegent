import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlannerInput } from '../../../src/v2/planner/types';
import { CompactPlannerClient } from '../../../src/v2/planner/CompactPlannerClient';

const mockPlannerInput = {
  version: 'v2.planner_input.v2',
  episodeId: 'episode_test_1',
  goal: 'Click the submit button',
  current: {
    projectionId: 'proj_test',
    observationId: 'obs_test',
    generationId: 1,
    page: {
      url: 'https://example.test',
      title: 'Example',
    },
    refs: {
      ref_submit: {
        refId: 'ref_submit',
        kind: 'button',
        name: 'Submit Button',
        visibility: 'visible',
        actionability: 'ready',
        state: 'stable',
        confidence: 1,
        score: 1,
      }
    },
    interactions: [
      { refId: 'ref_submit', rank: 1 }
    ],
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: {
      interactionCount: 1,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    }
  },
  workingSet: {
    mode: 'act',
    modeReason: 'test',
    primaryRefs: [{ refId: 'ref_submit', kind: 'button', name: 'Submit Button', score: 1, reasons: ['visible_ready'] }],
    secondaryRefs: [],
    readableEvidence: [],
    navigationRefs: [],
    actionSurface: {
      clickableRefs: ['ref_submit'],
      typeableRefs: [],
      selectableRefs: [],
      readableRefs: [],
      ambiguousRefs: []
    },
    changedRefs: {
      appearedCount: 0,
      weakenedCount: 0,
      preservedCount: 1,
      topRefs: [],
      omittedCount: 0
    },
    failedRefs: [],
    quarantinedActions: [],
    regionSummaries: [],
    omitted: {
      observedRefCount: 1,
      selectedRefCount: 1,
      droppedRefCount: 0,
      droppedByReason: {}
    }
  },
  uncertainty: {
    level: 'none',
    signals: []
  }
} as unknown as PlannerInput;

test('CompactPlannerClient returns valid PlannerOutput with runtime refs', async () => {
  const client = new CompactPlannerClient({
    provider: async () => ({
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a1' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 20
    })
  });

  const result = await client.call({
    plannerInput: mockPlannerInput,
    model: 'mock-model'
  });

  assert.deepEqual(result.output, {
    plan: [{ tool: 'click', ref: 'ref_submit' }],
    confidence: 'high'
  });
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 20);
});

test('CompactPlannerClient throws invalid output error for unknown index', async () => {
  const client = new CompactPlannerClient({
    provider: async () => ({
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a99' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 20
    })
  });

  await assert.rejects(
    () => client.call({
      plannerInput: mockPlannerInput,
      model: 'mock-model'
    }),
    (err: any) => {
      assert.equal(err.code, 'PLANNER_INVALID_OUTPUT');
      assert.match(err.message, /unknown compact index/);
      return true;
    }
  );
});

test('CompactPlannerClient throws ineligible error when first ref cannot be represented', async () => {
  const ineligiblePlannerInput: PlannerInput = {
    ...mockPlannerInput,
    workingSet: {
      ...mockPlannerInput.workingSet!,
      actionSurface: {
        clickableRefs: [], // Empty means ref_submit will be filtered out and not represented
        typeableRefs: [],
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: []
      }
    }
  };

  const client = new CompactPlannerClient({
    provider: async () => ({
      text: JSON.stringify({
        plan: [{ tool: 'click', ref: 'a1' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 20
    })
  });

  await assert.rejects(
    () => client.call({
      plannerInput: ineligiblePlannerInput,
      model: 'mock-model'
    }),
    (err: any) => {
      assert.equal(err.code, 'COMPACT_PLANNER_INPUT_INELIGIBLE');
      assert.equal(err.message, 'compact_planner_input_ineligible');
      return true;
    }
  );
});
