import test from 'node:test';
import assert from 'node:assert/strict';

import { buildV2PlannerSystemPrompt } from '../../../src/v2/planner/PlannerPrompt';

test('buildV2PlannerSystemPrompt instructs planner to finish from successful value evidence', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /lastResult\.valuePreview/);
  assert.match(prompt, /return done/i);
  assert.match(prompt, /Do not repeat/i);
  assert.match(prompt, /get, inspect_region, search_page, click, type, navigate/);
  assert.match(prompt, /report an operational failure/i);
  assert.match(prompt, /instead of escalating/i);
});
