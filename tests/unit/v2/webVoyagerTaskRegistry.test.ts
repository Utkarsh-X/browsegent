import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertStableSliceContainsNoImpossibleTasks,
  BROWSER_USE_IMPOSSIBLE_TASK_IDS,
  getWebVoyagerTaskStatus,
  WEBVOYAGER_STABLE_SLICES,
} from '../../benchmark/webvoyager/task_registry';

test('Browser Use impossible task list marks Allrecipes--3 impossible', () => {
  assert.equal(BROWSER_USE_IMPOSSIBLE_TASK_IDS.has('Allrecipes--3'), true);
  assert.equal(getWebVoyagerTaskStatus('Allrecipes--3'), 'impossible');
});

test('mvr5-stable replaces impossible Allrecipes task', () => {
  assert.deepEqual(WEBVOYAGER_STABLE_SLICES['mvr5-stable'], [
    'Cambridge Dictionary--0',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
  assert.doesNotThrow(() => assertStableSliceContainsNoImpossibleTasks('mvr5-stable'));
});
