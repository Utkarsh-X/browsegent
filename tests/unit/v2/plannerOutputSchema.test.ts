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
      { tool: 'search_page', pattern: 'query' },
    ],
    confidence: 'high',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.plan?.map(step => step.tool) : [], ['click', 'type', 'search_page']);
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

test('PlannerOutputSchema enforces required ref and text fields', () => {
  const schema = new PlannerOutputSchema();
  const result = schema.validate({
    plan: [
      { tool: 'click' },
      { tool: 'type', ref: 'ref_search' },
    ],
    confidence: 'medium',
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.errors.join('\n'), /click requires "ref"/);
  assert.match(result.ok ? '' : result.errors.join('\n'), /type requires "text"/);
});
