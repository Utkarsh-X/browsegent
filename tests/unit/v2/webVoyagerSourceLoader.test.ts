import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWebVoyagerJsonl, parseWebVoyagerReferenceAnswers } from '../../benchmark/webvoyager/source_loader';

test('parseWebVoyagerJsonl reads official WebVoyager jsonl records', () => {
  const tasks = parseWebVoyagerJsonl([
    JSON.stringify({ web_name: 'GitHub', id: 'GitHub--0', ques: 'Find repo stars', web: 'https://github.com' }),
    '',
    JSON.stringify({ web_name: 'Amazon', id: 'Amazon--10', ques: 'Find item', web: 'https://amazon.com' }),
  ].join('\n'));

  assert.deepEqual(tasks.map(task => task.id), ['GitHub--0', 'Amazon--10']);
  assert.equal(tasks[0].webName, 'GitHub');
  assert.equal(tasks[0].question, 'Find repo stars');
  assert.equal(tasks[0].url, 'https://github.com');
});

test('parseWebVoyagerReferenceAnswers maps website answers by task id', () => {
  const references = parseWebVoyagerReferenceAnswers(JSON.stringify({
    GitHub: {
      notice: 'dynamic',
      answers: [
        { id: 0, type: 'string', ans: '42 stars' },
      ],
    },
  }));

  assert.deepEqual(references.get('GitHub--0'), {
    id: 'GitHub--0',
    webName: 'GitHub',
    type: 'string',
    answer: '42 stars',
  });
});
