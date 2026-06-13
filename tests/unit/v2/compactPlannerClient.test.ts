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

test('CompactPlannerClient retries once when first compact output fails action compatibility', async () => {
  const calls: string[] = [];
  const client = new CompactPlannerClient({
    provider: async (_system, user) => {
      calls.push(user);
      if (calls.length === 1) {
        return {
          text: JSON.stringify({
            plan: [{ tool: 'type', ref: 'a1', text: 'sustainability' }],
            confidence: 'high',
          }),
          inputTokens: 10,
          outputTokens: 5,
        };
      }
      return {
        text: JSON.stringify({
          plan: [{ tool: 'type', ref: 'a2', text: 'sustainability' }],
          confidence: 'high',
        }),
        inputTokens: 11,
        outputTokens: 6,
      };
    },
  });

  const plannerInput = {
    ...mockPlannerInput,
    goal: 'Open the form',
    current: {
      ...mockPlannerInput.current,
      refs: {
        ref_button: { refId: 'ref_button', kind: 'button', role: 'button', name: 'Search' },
        ref_search: { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search input' },
      },
    },
    workingSet: {
      ...mockPlannerInput.workingSet!,
      primaryRefs: [
        { refId: 'ref_button', kind: 'button', role: 'button', name: 'Search', score: 100, reasons: ['visible_ready'] },
        { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search input', score: 90, reasons: ['form_candidate'] },
      ],
      secondaryRefs: [],
      readableEvidence: [],
      actionSurface: {
        clickableRefs: ['ref_button'],
        typeableRefs: ['ref_search'],
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: [],
      },
    },
  } as any;

  const result = await client.call({ plannerInput, model: 'mock-model' });

  assert.equal(calls.length, 2);
  assert.match(calls[1], /Choose an index whose tools include the requested tool/);
  assert.match(calls[1], /choose an index with type/i);
  assert.match(calls[1], /previousOutput/);
  assert.match(calls[1], /\\"ref\\":\\"a1\\"/);
  assert.match(calls[1], /Step 1 ref \\"a1\\" is not compatible with tool \\"type\\"/);
  assert.doesNotMatch(calls[1], /ref_button/);
  assert.deepEqual(result.output.plan, [{ tool: 'type', ref: 'ref_search', text: 'sustainability' }]);
  assert.equal(result.inputTokens, 21);
  assert.equal(result.outputTokens, 11);
});

test('CompactPlannerClient does not retry unknown compact index errors', async () => {
  let calls = 0;
  const client = new CompactPlannerClient({
    provider: async () => {
      calls += 1;
      return {
        text: JSON.stringify({
          plan: [{ tool: 'click', ref: 'a99' }],
          confidence: 'high',
        }),
        inputTokens: 10,
        outputTokens: 5,
      };
    },
  });

  await assert.rejects(() => client.call({ plannerInput: mockPlannerInput, model: 'mock-model' }));
  assert.equal(calls, 1);
});

test('CompactPlannerClient proceeds when legacy primary ref is absent from compact surface', async () => {
  const plannerInput: PlannerInput = {
    ...mockPlannerInput,
    current: {
      ...mockPlannerInput.current,
      refs: {
        ref_submit: {
          refId: 'ref_submit',
          kind: 'button',
          name: 'Submit Button',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 1,
        },
        ref_search: {
          refId: 'ref_search',
          kind: 'input',
          role: 'textbox',
          name: 'Search',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 1,
        },
      },
    },
    workingSet: {
      ...mockPlannerInput.workingSet!,
      primaryRefs: [
        { refId: 'ref_submit', kind: 'button', name: 'Submit Button', score: 1, reasons: ['visible_ready'] },
      ],
      secondaryRefs: [
        { refId: 'ref_search', kind: 'input', role: 'textbox', name: 'Search', score: 0.9, reasons: ['form_candidate'] },
      ],
      actionSurface: {
        clickableRefs: [],
        typeableRefs: ['ref_search'],
        selectableRefs: [],
        readableRefs: [],
        ambiguousRefs: []
      }
    }
  };

  let calls = 0;
  const client = new CompactPlannerClient({
    provider: async () => {
      calls += 1;
      return {
      text: JSON.stringify({
        plan: [{ tool: 'type', ref: 'a1', text: 'query' }],
        confidence: 'high'
      }),
      inputTokens: 10,
      outputTokens: 20
      };
    }
  });

  const result = await client.call({
    plannerInput,
    model: 'mock-model'
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.output.plan, [{ tool: 'type', ref: 'ref_search', text: 'query' }]);
});
