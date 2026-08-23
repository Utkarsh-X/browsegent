import test from 'node:test';
import assert from 'node:assert/strict';

import { RequestPacer, readRequestMinIntervalMs } from '../../../src/providers/requestPacer';

test('readRequestMinIntervalMs accepts positive integer env values only', () => {
  assert.equal(readRequestMinIntervalMs({ BROWSEGENT_GEMINI_MIN_INTERVAL_MS: '5000' }), 5000);
  assert.equal(readRequestMinIntervalMs({ BROWSEGENT_GEMINI_MIN_INTERVAL_MS: '0' }), 0);
  assert.equal(readRequestMinIntervalMs({ BROWSEGENT_GEMINI_MIN_INTERVAL_MS: 'bad' }), 0);
});

test('RequestPacer spaces consecutive request starts', async () => {
  let now = 1000;
  const waits: number[] = [];
  const pacer = new RequestPacer({
    now: () => now,
    sleep: async ms => {
      waits.push(ms);
      now += ms;
    },
  });

  assert.equal(await pacer.wait(5000), 0);
  now += 1000;
  assert.equal(await pacer.wait(5000), 4000);

  assert.deepEqual(waits, [4000]);
});

test('RequestPacer reports no pacing wait when disabled', async () => {
  const pacer = new RequestPacer({
    now: () => 1000,
    sleep: async () => undefined,
  });

  assert.equal(await pacer.wait(0), 0);
});

test('RequestPacer does not wait when pacing is disabled', async () => {
  const waits: number[] = [];
  const pacer = new RequestPacer({
    now: () => 1000,
    sleep: async ms => {
      waits.push(ms);
    },
  });

  await pacer.wait(0);
  await pacer.wait(0);

  assert.deepEqual(waits, []);
});
