import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collectGeminiFailoverKeyPool,
  createGeminiQuotaKeyRotator,
  numberedKeyIndex,
} from '../../../src/providers/geminiKeyFailover.js';

describe('collectGeminiFailoverKeyPool', () => {
  it('returns numbered keys excluding the active key, deduplicated', () => {
    const pool = collectGeminiFailoverKeyPool({
      GEMINI_API_KEY: 'key-a',
      GEMINI_API_KEY_1: 'key-a',
      GEMINI_API_KEY_2: 'key-b',
      GOOGLE_API_KEY_3: 'key-c',
      GEMINI_API_KEY_4: 'key-b',
      UNRELATED_KEY_5: 'key-d',
    });
    assert.deepEqual(pool, [
      { value: 'key-b', envName: 'GEMINI_API_KEY_2' },
      { value: 'key-c', envName: 'GOOGLE_API_KEY_3' },
    ]);
  });

  it('is inert with only the single configured key', () => {
    assert.deepEqual(collectGeminiFailoverKeyPool({ GEMINI_API_KEY: 'key-a' }), []);
    assert.deepEqual(collectGeminiFailoverKeyPool({}), []);
  });
});

describe('createGeminiQuotaKeyRotator', () => {
  const pool = [
    { value: 'key-b', envName: 'GEMINI_API_KEY_2' },
    { value: 'key-c', envName: 'GEMINI_API_KEY_3' },
  ];

  it('rotates to the next usable key and skips exhausted keys', () => {
    let clock = 0;
    const rotator = createGeminiQuotaKeyRotator(pool, () => clock);

    rotator.markBlocked('key-b', 'quota exceeded for PerDay limit');
    const next = rotator.nextKey('key-a');
    assert.equal(next?.value, 'key-c');

    rotator.markBlocked('key-c', 'quota exceeded for PerDay limit');
    assert.equal(rotator.nextKey('key-a'), undefined);
    assert.equal(rotator.blockedCount(), 2);
  });

  it('recovers per-minute blocks after the cooldown and never recovers daily blocks', () => {
    let clock = 0;
    const rotator = createGeminiQuotaKeyRotator(pool, () => clock);

    rotator.markBlocked('key-b', 'Rate limit: per minute');
    assert.equal(rotator.isBlocked('key-b'), true);

    clock += 60_000;
    assert.equal(rotator.isBlocked('key-b'), false);
    assert.equal(rotator.nextKey('key-a')?.value, 'key-b');

    clock += 1;
    rotator.markBlocked('key-b', 'Requests per day exhausted');
    clock += 3_600_000;
    assert.equal(rotator.isBlocked('key-b'), true);
  });

  it('keeps the failing key excluded from its own rotation', () => {
    const rotator = createGeminiQuotaKeyRotator(pool, () => 0);
    rotator.markBlocked('key-b', 'per minute');
    assert.equal(rotator.nextKey('key-b')?.value, 'key-c');
  });
});

describe('numberedKeyIndex', () => {
  it('extracts the one-based suffix for telemetry', () => {
    assert.equal(numberedKeyIndex('GEMINI_API_KEY_2'), 2);
    assert.equal(numberedKeyIndex('GOOGLE_API_KEY_11'), 11);
    assert.equal(numberedKeyIndex('GEMINI_API_KEY'), undefined);
  });
});
