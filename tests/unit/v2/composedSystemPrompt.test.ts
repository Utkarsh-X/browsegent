import test from 'node:test';
import assert from 'node:assert/strict';

import { buildV2PlannerSystemPrompt } from '../../../src/v2/planner/PlannerPrompt';
import type { PlannerInput } from '../../../src/v2/planner/types';

const conditionalConfig = { mode: 'prc' as const, conditionalSystemPrompt: true };
const composedConfig = { mode: 'prc' as const, composedPrompt: true };

function inputWith(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    version: 'v2.planner_input.v2',
    episodeId: 'episode_test',
    goal: 'test goal',
    current: { projectionId: 'p', observationId: 'o', generationId: 1, page: { url: 'https://x', title: 'x' }, refs: {}, interactions: [] },
    uncertainty: { level: 'low', signals: [] },
    ...overrides,
  } as unknown as PlannerInput;
}

test('composed prompt lists seek as a valid tool (satisfiability fix for HORIZON steering)', () => {
  const prompt = buildV2PlannerSystemPrompt(composedConfig, inputWith({}));
  assert.ok(prompt.includes('- seek: ref'), 'seek must appear in the Valid tools list');
  assert.ok(!prompt.includes('- inspect_region: requires ref'), 'composed tools must be one-line format');
});

test('composed prompt keeps subject-present blocks and drops absent subjects', () => {
  const full = inputWith({
    goal: 'find the repository with the most stars',
    uncertainty: { level: 'medium', signals: ['budget_low:2'] },
    evidenceSnapshot: { cards: [] } as PlannerInput['evidenceSnapshot'],
    recovery: { state: 'navigation_oscillation', severity: 'high', nextMechanisms: [], signals: [] },
    answerFeedback: { previousAnswer: 'x', missingDetails: [], instruction: 'y' },
    horizon: { visibleMonths: [], targetMonths: [], navControls: [], recommended: undefined } as unknown as PlannerInput['horizon'],
    current: {
      projectionId: 'p', observationId: 'o', generationId: 1, page: { url: 'https://x', title: 'x' },
      refs: { r1: { refId: 'r1', role: 'combobox' } },
      interactions: [],
    },
  } as unknown as PlannerInput);
  const prompt = buildV2PlannerSystemPrompt(composedConfig, full);
  assert.ok(prompt.includes('If recovery.state is navigation_oscillation'), 'active recovery state renders');
  assert.ok(!prompt.includes('If recovery.state is surface_wide_blocker'), 'inactive recovery states are absent');
  assert.ok(prompt.includes('If PROBLEMS shows a budget_low signal, only 1-2 planner steps remain: return done'), 'budget one-liner renders on budget_low');
  assert.ok(!prompt.includes('over opening new pages; a grounded partial answer is worth more than exhausting the budget'), 'old long budget guidance is replaced');
  assert.ok(prompt.includes('If answerFeedback is present'), 'answer feedback renders');
  assert.ok(prompt.includes('HORIZON appears when'), 'horizon renders (full text + seek fix)');
  assert.ok(prompt.includes('If evidenceSnapshot is present'), 'snapshot guidance renders');
  assert.ok(prompt.includes('superlative'), 'superlative guidance renders for ranking goals');
  assert.ok(prompt.includes('For a combobox or searchbox'), 'combobox choreography renders on suggestion surfaces');
  assert.ok(prompt.includes('PICK_OPTION:'), 'pick_option guidance renders');

  const bare = buildV2PlannerSystemPrompt(composedConfig, inputWith({}));
  assert.ok(!bare.includes('If PROBLEMS shows a budget_low signal'), 'budget block absent without the signal');
  assert.ok(!bare.includes('HORIZON appears when'), 'horizon absent without subject');
  assert.ok(!bare.includes('If evidenceSnapshot is present'), 'snapshot absent without subject');
  assert.ok(!bare.includes('PICK_OPTION:'), 'suggestion blocks absent without subject');
});

test('composed prompt skips budget steering when the episode is already finalizing', () => {
  const input = inputWith({
    uncertainty: { level: 'medium', signals: ['budget_low:2'] },
    workingSet: { mode: 'done_candidate', modeReason: 'test' },
  } as unknown as Partial<PlannerInput>);
  const prompt = buildV2PlannerSystemPrompt(composedConfig, input);
  assert.ok(!prompt.includes('budget_low signal'), 'done_candidate episodes must not receive budget steering');
  assert.ok(prompt.includes('When the input workingSet.mode is extract, verify, or done_candidate'), 'finalization rule stays in the head');
});

test('off-path byte identity: composedPrompt unset leaves the conditional output untouched', () => {
  const input = inputWith({
    goal: 'find the repository with the most stars',
    evidenceSnapshot: { cards: [] } as PlannerInput['evidenceSnapshot'],
  } as unknown as Partial<PlannerInput>);
  const conditional = buildV2PlannerSystemPrompt(conditionalConfig, input);
  const withFlagOff = buildV2PlannerSystemPrompt({ ...conditionalConfig, composedPrompt: false } as typeof conditionalConfig, input);
  assert.equal(withFlagOff, conditional);
  assert.notEqual(buildV2PlannerSystemPrompt(composedConfig, input), conditional);
});

test('composed prompt is smaller than the conditional prompt on a subject-light episode', () => {
  const input = inputWith({});
  const cond = Buffer.byteLength(buildV2PlannerSystemPrompt(conditionalConfig, input));
  const comp = Buffer.byteLength(buildV2PlannerSystemPrompt(composedConfig, input));
  assert.ok(comp < cond, `composed (${comp} B) must be smaller than conditional (${cond} B)`);
  assert.ok(comp < 7139, `subject-light composed head (${comp} B) must sit under the fixed-core budget`);
});

import { buildDoneCandidateChecklist } from '../../../src/v2/agent/V2AgentLoop';

test('done-candidate checklist embeds the evidence and the four verification items', () => {
  const checklist = buildDoneCandidateChecklist('EVIDENCE_TEXT_MARKER');
  assert.ok(checklist.includes('EVIDENCE_TEXT_MARKER'), 'validation evidence must ride the re-ask');
  assert.ok(checklist.includes('Item count'), 'item-count check present');
  assert.ok(checklist.includes('Claim source'), 'claim-source check present');
  assert.ok(checklist.includes('Value, not narration'), 'value-vs-narration check present');
  assert.ok(checklist.includes('Language'), 'language check present');
  assert.ok(checklist.includes('escalate honestly'), 'honest escalation stays a compliant exit');
});
