import test from 'node:test';
import assert from 'node:assert/strict';

import { createBenchmarkAdapter, readBenchmarkAdapterId } from '../../benchmark/v2/adapter_factory';
import { BrowseGentBenchmarkAdapter } from '../../benchmark/v2/adapters/BrowseGentAdapter';
import { BrowserUseLocalAdapter } from '../../benchmark/v2/adapters/BrowserUseLocalAdapter';

test('createBenchmarkAdapter defaults to BrowseGent adapter', () => {
  const adapter = createBenchmarkAdapter();

  assert.equal(adapter.adapterId, 'browsegent');
  assert.equal(adapter instanceof BrowseGentBenchmarkAdapter, true);
});

test('createBenchmarkAdapter creates Browser Use local adapter', () => {
  const adapter = createBenchmarkAdapter('browser-use-local');

  assert.equal(adapter.adapterId, 'browser-use-local');
  assert.equal(adapter instanceof BrowserUseLocalAdapter, true);
});

test('readBenchmarkAdapterId rejects unsupported adapter names', () => {
  assert.throws(
    () => readBenchmarkAdapterId('stagehand'),
    /Unsupported benchmark adapter "stagehand"/,
  );
});
