import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildV2PlannerSystemPrompt,
  buildV2PlannerUserMessage,
} from '../../../src/v2/planner/PlannerPrompt';

test('buildV2PlannerSystemPrompt instructs planner to finish from successful value evidence', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /lastResult\.valuePreview/);
  assert.match(prompt, /return done/i);
  assert.match(prompt, /Do not repeat/i);
  assert.match(prompt, /get, inspect_region, search_page, click, type, press, navigate/);
  assert.match(prompt, /report an operational failure/i);
  assert.match(prompt, /instead of escalating/i);
});

test('buildV2PlannerSystemPrompt describes working set and targeted expansion', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /workingSet/i);
  assert.match(prompt, /selected refs/i);
  assert.match(prompt, /actionSurface/i);
  assert.match(prompt, /compatible/i);
  assert.match(prompt, /Do not assume omitted refs are unavailable/i);
  assert.match(prompt, /inspect_region/i);
  assert.match(prompt, /search_page/i);
});

test('buildV2PlannerSystemPrompt describes recovery state', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /recovery\.state/);
  assert.match(prompt, /nextMechanisms/);
  assert.match(prompt, /blockedAction/);
});

test('buildV2PlannerSystemPrompt exposes bounded press keys', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /press: requires key Enter, Escape, Tab, ArrowDown, or ArrowUp/);
  assert.match(prompt, /click, type, press, navigate/);
});

test('buildV2PlannerUserMessage serializes planner input compactly', () => {
  const message = buildV2PlannerUserMessage({
    version: 'v2.planner_input.v2',
    episodeId: 'episode_prompt_compact',
    goal: 'Open docs',
    current: {
      projectionId: 'projection_1',
      observationId: 'obs_1',
      generationId: 1,
      page: { url: 'https://example.test', title: 'Example' },
      refs: {},
      interactions: [],
      readables: [],
      navigation: [],
      regions: [],
      warnings: [],
      stats: { interactionCount: 0, readableCount: 0, navigationCount: 0, regionCount: 0 },
    },
    uncertainty: { level: 'none', signals: [] },
  });

  assert.match(message, /^Planner input JSON:\n\{/);
  assert.doesNotMatch(message, /\n  "/);
});

test('buildV2PlannerSystemPrompt describes bounded native select use', () => {
  const prompt = buildV2PlannerSystemPrompt();

  assert.match(prompt, /select: requires ref and exact visible option value/i);
  assert.match(prompt, /Use select only for refs listed as selectable/i);
});

test('buildV2PlannerSystemPrompt includes strong failed-ref recovery invariant', () => {
  const prompt = buildV2PlannerSystemPrompt();
  assert.match(prompt, /Failed refs are evidence first/i);
  assert.match(prompt, /same ref\/tool pair/i);
});

test('buildV2PlannerSystemPrompt describes finalization constraints', () => {
  const prompt = buildV2PlannerSystemPrompt();
  assert.match(prompt, /In finalization mode, plans are invalid/i);
});

test('buildV2PlannerSystemPrompt requires complete multi-detail answers before done', () => {
  const prompt = buildV2PlannerSystemPrompt();
  assert.match(prompt, /multiple details/i);
  assert.match(prompt, /pronunciation and definition/i);
  assert.match(prompt, /basic information/i);
});
