import test from 'node:test';
import assert from 'node:assert/strict';

import { buildV2PlannerSystemPrompt } from '../../../src/v2/planner/PlannerPrompt';
import type { PlannerInput } from '../../../src/v2/planner/types';

const config = { mode: 'prc' as const, conditionalSystemPrompt: true };

function inputWith(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_test',
    goal: 'test goal',
    current: { projectionId: 'p', observationId: 'o', generationId: 1, page: { url: 'https://x', title: 'x' }, refs: {}, interactions: [] },
    uncertainty: { level: 'low', signals: [] },
    ...overrides,
  } as PlannerInput;
}

test('conditional prompt keeps every subject-present block and removes only inactive recovery states', () => {
  const full = inputWith({
    goal: 'find the repository with the most stars',
    uncertainty: { level: 'medium', signals: ['repeated_value_preview:search_page:global:3', 'budget_low:2'] },
    evidenceSnapshot: { cards: [] } as PlannerInput['evidenceSnapshot'],
    recovery: { state: 'surface_wide_blocker', severity: 'critical', nextMechanisms: [], signals: [] },
    answerFeedback: { previousAnswer: 'x', missingDetails: [], instruction: 'y' },
    taskProgress: { state: 'incomplete', items: [] } as unknown as PlannerInput['taskProgress'],
    horizon: { visibleMonths: [], targetMonths: [], navControls: [], recommended: undefined } as unknown as PlannerInput['horizon'],
    current: {
      projectionId: 'p', observationId: 'o', generationId: 1, page: { url: 'https://x', title: 'x' },
      refs: { r1: { refId: 'r1', role: 'combobox' } },
      interactions: [],
    },
  } as unknown as PlannerInput);
  const legacy = buildV2PlannerSystemPrompt({ } as Parameters<typeof buildV2PlannerSystemPrompt>[0]);
  const conditionalFull = buildV2PlannerSystemPrompt(config, full);
  // Recovery states are mutually exclusive: with surface_wide_blocker active,
  // exactly the four inactive state sentences may differ from the legacy text.
  const inactiveStates = [
    'If recovery.state is empty_navigation_surface',
    'If recovery.state is repeated_timeout_target',
    'If recovery.state is repeated_type_same_value',
    'If recovery.state is navigation_oscillation',
    'If recovery.state is click_no_navigation',
    'If recovery.state is navigate_loop',
    'If recovery.state is max_step_risk',
  ];
  let expected = legacy;
  for (const sentence of inactiveStates) {
    const start = expected.indexOf(sentence);
    assert.ok(start !== -1, `legacy should contain ${sentence}`);
    const end = expected.indexOf(String.fromCharCode(10), start);
    expected = expected.slice(0, start) + expected.slice(end + 1);
  }
  assert.equal(conditionalFull, expected);
  assert.ok(conditionalFull.includes('If recovery.state is surface_wide_blocker'));
});

test('conditional prompt drops blocks whose subject is absent', () => {
  const plain = buildV2PlannerSystemPrompt(config, inputWith({}));
  assert.ok(!plain.includes('HORIZON appears when'), 'horizon guidance dropped');
  assert.ok(!plain.includes('For a combobox or searchbox'), 'combobox guidance dropped');
  assert.ok(!plain.includes('If taskProgress is present'), 'taskProgress guidance dropped');
  assert.ok(!plain.includes('If answerFeedback is present'), 'answerFeedback guidance dropped');
  assert.ok(!plain.includes('If evidenceSnapshot is present'), 'evidenceSnapshot guidance dropped');
  assert.ok(!plain.includes('If recovery.state is surface_wide_blocker'), 'inactive recovery states dropped');
  assert.ok(!plain.includes('If the goal asks for a superlative'), 'superlative guidance dropped for non-ranking goal');
  assert.ok(!plain.includes("switch to the site's own search"), 'site-search guidance dropped without zero-match loop');
  assert.ok(!plain.includes('If PROBLEMS shows a budget_low signal'), 'budget guidance dropped without budget signal');
  assert.ok(plain.includes('If recovery.state is present'), 'general recovery guidance kept');
  assert.ok(plain.includes('GOAL PROGRESS lists goal requirements'), 'goal progress guidance kept');
  assert.ok(plain.includes('Click only elements whose tools attribute contains c'), 'click compatibility kept');
});

test('conditional prompt keeps superlative guidance only for ranking goals', () => {
  const ranking = buildV2PlannerSystemPrompt(config, inputWith({ goal: 'find the repository with the most stars' }));
  assert.ok(ranking.includes('If the goal asks for a superlative'), 'superlative guidance kept for ranking goal');
});

test('conditional prompt engages site-search and budget guidance only on their signals', () => {
  const zeroMatchLoop = buildV2PlannerSystemPrompt(config, inputWith({
    recovery: { state: 'zero_result_read_loop', severity: 'warning', nextMechanisms: [], signals: [] },
  }));
  assert.ok(zeroMatchLoop.includes("switch to the site's own search"), 'site-search guidance kept on zero_result_read_loop');
  assert.ok(!zeroMatchLoop.includes('If PROBLEMS shows a budget_low signal'), 'budget guidance still dropped');

  const budget = buildV2PlannerSystemPrompt(config, inputWith({
    uncertainty: { level: 'medium', signals: ['budget_low:2'] },
  }));
  assert.ok(budget.includes('If PROBLEMS shows a budget_low signal'), 'budget guidance kept on budget_low signal');
  assert.ok(!budget.includes("switch to the site's own search"), 'site-search guidance still dropped');

  const searchPageLoop = buildV2PlannerSystemPrompt(config, inputWith({
    uncertainty: { level: 'medium', signals: ['repeated_value_preview:search_page:global:3'] },
  }));
  assert.ok(searchPageLoop.includes("switch to the site's own search"), 'site-search guidance kept on repeated zero-match search_page');
});

test('conditional prompt keeps the guidance for the active recovery state only', () => {
  const withRecovery = inputWith({
    recovery: { state: 'repeated_type_same_value', severity: 'warning', nextMechanisms: [], signals: [] },
  });
  const text = buildV2PlannerSystemPrompt(config, withRecovery);
  assert.ok(text.includes('If recovery.state is repeated_type_same_value'));
  assert.ok(!text.includes('If recovery.state is surface_wide_blocker'));
});

test('legacy path is unchanged when the flag is off or no planner input is given', () => {
  const legacy = buildV2PlannerSystemPrompt({ } as Parameters<typeof buildV2PlannerSystemPrompt>[0]);
  assert.equal(buildV2PlannerSystemPrompt({ } as Parameters<typeof buildV2PlannerSystemPrompt>[0], inputWith({})), legacy);
  assert.equal(buildV2PlannerSystemPrompt({ conditionalSystemPrompt: true }), legacy);
});
