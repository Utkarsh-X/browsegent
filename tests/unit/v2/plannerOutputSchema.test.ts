import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerOutputSchema } from '../../../src/v2/planner/PlannerOutputSchema';

test('PlannerOutputSchema accepts done output with a value', () => {
  const result = new PlannerOutputSchema().validate({
    done: true,
    val: 'Visible answer',
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.done : undefined, true);
});

test('PlannerOutputSchema accepts ref-first v2 action plans', () => {
  const result = new PlannerOutputSchema().validate({
    plan: [
      { tool: 'click', ref: 'ref_primary' },
      { tool: 'type', ref: 'ref_search', text: 'query' },
      { tool: 'press', key: 'Enter' },
      { tool: 'navigate', url: 'https://example.test/results' },
      { tool: 'search_page', pattern: 'query' },
    ],
    confidence: 'high',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.plan?.map(step => step.tool) : [], ['click', 'type', 'press', 'navigate', 'search_page']);
});

test('PlannerOutputSchema rejects selector-based browser mechanics in v2 mode', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'click', sel: '#submit' },
    ],
    confidence: 'high',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /selector fields are not valid in v2 planner output/);
});

test('PlannerOutputSchema normalizes legacy sel field only when it contains a known ref', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'click', sel: 'ref_primary' },
    ],
    confidence: 'high',
  }, { allowedRefs: ['ref_primary'] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.plan : [], [
    { tool: 'click', ref: 'ref_primary' },
  ]);
});

test('PlannerOutputSchema normalizes ref-token selector aliases without accepting CSS selectors', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'get', selector: 'v2ref_2' },
    ],
    confidence: 'high',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.plan : [], [
    { tool: 'get', ref: 'v2ref_2' },
  ]);
});

test('PlannerOutputSchema maps projected region ids to representative refs for inspect_region', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'inspect_region', sel: 'region_repeated_1' },
    ],
    confidence: 'high',
  }, { regionRefs: { region_repeated_1: 'v2ref_4' } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.plan : [], [
    { tool: 'inspect_region', ref: 'v2ref_4' },
  ]);
});

test('PlannerOutputSchema rejects low-level browser commands and script payloads', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'evaluate_js', script: 'document.body.click()' },
    ],
    confidence: 'low',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /unknown tool/);
  assert.match(result.ok ? '' : result.errors.join('\n'), /script fields are not valid in v2 planner output/);
});

test('PlannerOutputSchema rejects unsafe navigate URLs', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'navigate', url: 'javascript:document.body.click()' },
    ],
    confidence: 'low',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /navigate URL must use http, https, or file/);
});

test('PlannerOutputSchema enforces required ref and text fields', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'click' },
      { tool: 'type', ref: 'ref_search' },
      { tool: 'navigate' },
    ],
    confidence: 'medium',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /click requires "ref"/);
  assert.match(result.ok ? '' : result.errors.join('\n'), /type requires "text"/);
  assert.match(result.ok ? '' : result.errors.join('\n'), /navigate requires "url"/);
});

test('PlannerOutputSchema accepts bounded press tool keys', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [{ tool: 'press', key: 'Enter' }],
    confidence: 'high',
  });

  assert.equal(result.ok, true);
});

test('PlannerOutputSchema rejects unsupported press keys', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [{ tool: 'press', key: 'Control+L' }],
    confidence: 'high',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /press key/);
});
