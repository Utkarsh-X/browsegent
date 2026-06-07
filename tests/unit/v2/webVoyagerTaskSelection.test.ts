import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEBVOYAGER_LITE_TASK_IDS,
  WEBVOYAGER_MVR_5_TASK_IDS,
  WEBVOYAGER_MVR_5_STABLE_TASK_IDS,
  resolveWebVoyagerTaskIds,
  selectWebVoyagerLiteTasks,
  toBenchmarkTasks,
} from '../../benchmark/webvoyager/task_selection';
import type { WebVoyagerReferenceAnswer, WebVoyagerSourceTask } from '../../benchmark/webvoyager/types';

test('WEBVOYAGER_LITE_TASK_IDS contains the planned balanced 30-task set', () => {
  assert.equal(WEBVOYAGER_LITE_TASK_IDS.length, 30);
  assert.equal(new Set(WEBVOYAGER_LITE_TASK_IDS).size, 30);
  assert.equal(WEBVOYAGER_LITE_TASK_IDS.includes('Google Flights--0'), true);
  assert.equal(WEBVOYAGER_LITE_TASK_IDS.includes('Wolfram Alpha--10'), true);
});

test('WEBVOYAGER_MVR_5_TASK_IDS contains the fixed representative next-run slice', () => {
  assert.deepEqual(WEBVOYAGER_MVR_5_TASK_IDS, [
    'Allrecipes--3',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
  assert.deepEqual(resolveWebVoyagerTaskIds('mvr5'), WEBVOYAGER_MVR_5_TASK_IDS);
  assert.deepEqual(resolveWebVoyagerTaskIds('balanced30'), WEBVOYAGER_LITE_TASK_IDS);
});

test('resolveWebVoyagerTaskIds supports mvr5-stable', () => {
  assert.deepEqual(resolveWebVoyagerTaskIds('mvr5-stable'), [
    'Cambridge Dictionary--0',
    'ArXiv--0',
    'GitHub--0',
    'Google Map--10',
    'Wolfram Alpha--0',
  ]);
  assert.deepEqual(WEBVOYAGER_MVR_5_STABLE_TASK_IDS, resolveWebVoyagerTaskIds('mvr5-stable'));
});

test('selectWebVoyagerLiteTasks fails loudly when planned ids are missing', () => {
  assert.throws(
    () => selectWebVoyagerLiteTasks([{ id: 'GitHub--0', webName: 'GitHub', question: 'Q', url: 'https://github.com' }]),
    /Missing WebVoyager-lite task ids/,
  );
});

test('toBenchmarkTasks converts selected WebVoyager records to benchmark tasks with references', () => {
  const references = new Map<string, WebVoyagerReferenceAnswer>([
    ['GitHub--0', { id: 'GitHub--0', webName: 'GitHub', type: 'string', answer: 'repo answer' }],
  ]);

  const tasks = toBenchmarkTasks([
    sourceTask('GitHub--0', 'GitHub', 'Find repo answer', 'https://github.com'),
  ], references, new Date('2026-05-25T00:00:00.000Z'));

  assert.equal(tasks[0].taskId, 'webvoyager_GitHub__0');
  assert.equal(tasks[0].goal, 'Find repo answer');
  assert.equal(tasks[0].url, 'https://github.com');
  assert.equal(tasks[0].validation.minLength, 2);
  assert.equal(tasks[0].webVoyager.referenceAnswer?.answer, 'repo answer');
});

function sourceTask(id: string, webName: string, question: string, url: string): WebVoyagerSourceTask {
  return { id, webName, question, url };
}
