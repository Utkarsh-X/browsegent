import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeWebVoyagerTaskDate } from '../../benchmark/webvoyager/date_normalizer';

test('normalizeWebVoyagerTaskDate moves old travel years into the future and preserves original text', () => {
  const normalized = normalizeWebVoyagerTaskDate({
    id: 'Google Flights--0',
    webName: 'Google Flights',
    question: 'Find flights from SFO to JFK on June 12 2024',
    url: 'https://www.google.com/travel/flights',
  }, new Date('2026-05-25T00:00:00.000Z'));

  assert.equal(normalized.originalQuestion, 'Find flights from SFO to JFK on June 12 2024');
  assert.equal(normalized.question, 'Find flights from SFO to JFK on June 12 2027');
  assert.equal(normalized.normalized, true);
  assert.match(normalized.normalizationReason ?? '', /travel date year/);
});

test('normalizeWebVoyagerTaskDate leaves non-travel years unchanged', () => {
  const normalized = normalizeWebVoyagerTaskDate({
    id: 'BBC News--0',
    webName: 'BBC News',
    question: 'Find news from 2024',
    url: 'https://bbc.com',
  }, new Date('2026-05-25T00:00:00.000Z'));

  assert.equal(normalized.question, 'Find news from 2024');
  assert.equal(normalized.normalized, false);
});
