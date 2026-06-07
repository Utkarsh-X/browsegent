import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebVoyagerTaskArtifactSummary } from '../../benchmark/webvoyager/artifacts';

test('buildWebVoyagerTaskArtifactSummary captures review-critical fields', () => {
  const summary = buildWebVoyagerTaskArtifactSummary(
    {
      taskId: 'webvoyager_GitHub__0',
      category: 'webvoyager',
      difficulty: 'navigation',
      partition: 'holdout',
      url: 'https://github.com/',
      goal: 'Find a climate data visualization repository with most stars.',
      validation: { minLength: 2 },
      webVoyager: {
        id: 'GitHub--0',
        webName: 'GitHub',
        originalQuestion: 'Find a climate data visualization repository with most stars.',
        normalizedQuestion: 'Find a climate data visualization repository with most stars.',
        normalized: false,
        referenceAnswer: { id: 'GitHub--0', webName: 'GitHub', type: 'golden', answer: 'resource-watch/resource-watch' },
      },
    },
    {
      adapterId: 'browsegent',
      taskId: 'webvoyager_GitHub__0',
      attempt: 1,
      success: true,
      value: 'bcgov/cccharts',
      tracePath: 'logs/run/trace.json',
      metrics: { plannerCalls: 3, toolExecutions: 4, durationMs: 1000 },
      partition: 'holdout',
      passed: true,
      validation: { passed: true, reasons: [], preview: 'bcgov/cccharts' },
      trace: { ok: true, errors: [] },
    },
  );

  assert.equal(summary.webVoyagerId, 'GitHub--0');
  assert.equal(summary.referenceAnswer, 'resource-watch/resource-watch');
  assert.equal(summary.finalAnswer, 'bcgov/cccharts');
  assert.equal(summary.tracePath, 'logs/run/trace.json');
});
