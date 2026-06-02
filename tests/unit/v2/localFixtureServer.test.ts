import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { startLocalFixtureServerForTasks } from '../../benchmark/v2/local_fixture_server';
import type { BenchmarkTask } from '../../benchmark/v2/types';

test('startLocalFixtureServerForTasks rewrites v2 fixture file URLs to localhost URLs', async () => {
  const fixturePath = resolve('tests/fixtures/v2/static-controls.html');
  const task = benchmarkTask(pathToFileURL(fixturePath).toString());
  const server = await startLocalFixtureServerForTasks([task]);

  assert.notEqual(server, undefined);
  try {
    const rewritten = server?.rewriteTask(task);
    assert.match(rewritten?.url ?? '', /^http:\/\/127\.0\.0\.1:\d+\/static-controls\.html$/);

    const response = await fetch(rewritten?.url ?? '');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Static Controls/i);
  } finally {
    await server?.close();
  }
});

test('startLocalFixtureServerForTasks leaves non-fixture file URLs unchanged', async () => {
  const task = benchmarkTask('file:///outside.html');
  const server = await startLocalFixtureServerForTasks([task]);

  assert.equal(server, undefined);
});

function benchmarkTask(url: string): BenchmarkTask {
  return {
    taskId: 'fixture_task',
    category: 'local_fixture',
    difficulty: 'extraction',
    partition: 'dev',
    url,
    goal: 'Report visible page',
    validation: { requireAny: ['visible'] },
  };
}
