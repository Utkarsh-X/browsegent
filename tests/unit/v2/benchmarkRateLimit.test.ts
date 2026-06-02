import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBenchmarkRateLimit } from '../../benchmark/v2/benchmark_rate_limit';

test('resolveBenchmarkRateLimit converts request rpm to minimum interval metadata', () => {
  const rateLimit = resolveBenchmarkRateLimit({ requestRpm: 12 });

  assert.deepEqual(rateLimit, {
    mode: 'paced',
    requestRpm: 12,
    minIntervalMs: 5000,
  });
});

test('resolveBenchmarkRateLimit prefers explicit interval over rpm', () => {
  const rateLimit = resolveBenchmarkRateLimit({
    requestRpm: 12,
    requestMinIntervalMs: 7000,
  });

  assert.deepEqual(rateLimit, {
    mode: 'paced',
    requestRpm: 12,
    minIntervalMs: 7000,
  });
});

test('resolveBenchmarkRateLimit can read benchmark env defaults', () => {
  const rateLimit = resolveBenchmarkRateLimit({
    env: { BROWSEGENT_BENCHMARK_REQUEST_RPM: '15' },
  });

  assert.equal(rateLimit.mode, 'paced');
  assert.equal(rateLimit.requestRpm, 15);
  assert.equal(rateLimit.minIntervalMs, 4000);
});
