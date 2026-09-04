import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertStableSliceContainsNoImpossibleTasks,
  BROWSER_USE_IMPOSSIBLE_TASK_IDS,
  getWebVoyagerTaskStatus,
  WEBVOYAGER_STABLE_SLICES,
} from '../../benchmark/webvoyager/task_registry';
import {
  resolveWebVoyagerTaskIds,
  WEBVOYAGER_FRESH_50_STABLE_TASK_IDS,
  WEBVOYAGER_FRESH_50_TASK_IDS,
} from '../../benchmark/webvoyager/task_selection';
import { normalizeWebVoyagerTaskDate } from '../../benchmark/webvoyager/date_normalizer';

test('fresh50 and fresh50-stable slices have exactly 50 unique tasks and zero overlap with balanced30', () => {
  const fresh50 = WEBVOYAGER_STABLE_SLICES.fresh50;
  const fresh50Stable = WEBVOYAGER_STABLE_SLICES['fresh50-stable'];
  const balanced30 = new Set(WEBVOYAGER_STABLE_SLICES.balanced30);

  assert.equal(fresh50.length, 50, 'fresh50 must contain exactly 50 tasks');
  assert.equal(fresh50Stable.length, 50, 'fresh50-stable must contain exactly 50 tasks');

  const uniqueSet = new Set(fresh50);
  assert.equal(uniqueSet.size, 50, 'fresh50 task IDs must all be unique');

  // Check 0 overlap with balanced30
  const overlap = fresh50.filter(id => balanced30.has(id));
  assert.deepEqual(overlap, [], 'fresh50 must have zero overlap with balanced30');

  // Check exported constants match
  assert.deepEqual(WEBVOYAGER_FRESH_50_TASK_IDS, fresh50);
  assert.deepEqual(WEBVOYAGER_FRESH_50_STABLE_TASK_IDS, fresh50Stable);
});

test('fresh50-stable contains zero impossible or broken tasks', () => {
  assert.doesNotThrow(() => {
    assertStableSliceContainsNoImpossibleTasks('fresh50-stable');
  });

  for (const taskId of WEBVOYAGER_FRESH_50_STABLE_TASK_IDS) {
    assert.equal(
      BROWSER_USE_IMPOSSIBLE_TASK_IDS.has(taskId),
      false,
      `Task ${taskId} is in BROWSER_USE_IMPOSSIBLE_TASK_IDS`,
    );
    assert.equal(
      getWebVoyagerTaskStatus(taskId),
      'valid',
      `Task ${taskId} should have valid status in registry`,
    );
  }
});

test('fresh50 covers all 15 WebVoyager domains with balanced distribution', () => {
  const domains = new Map<string, number>();
  for (const taskId of WEBVOYAGER_FRESH_50_STABLE_TASK_IDS) {
    const domain = taskId.split('--')[0];
    domains.set(domain, (domains.get(domain) || 0) + 1);
  }

  assert.equal(domains.size, 15, 'All 15 domains must be represented in fresh50');

  for (const [domain, count] of domains.entries()) {
    assert.ok(count >= 3, `Domain ${domain} should have at least 3 tasks, got ${count}`);
    assert.ok(count <= 4, `Domain ${domain} should have at most 4 tasks, got ${count}`);
  }
});

test('resolveWebVoyagerTaskIds correctly returns fresh50-stable', () => {
  const ids = resolveWebVoyagerTaskIds('fresh50-stable');
  assert.equal(ids.length, 50);
  assert.equal(ids[0], 'Wolfram Alpha--2');
});

test('normalizeWebVoyagerTaskDate handles time-sensitive tasks in fresh50', () => {
  const runDate = new Date('2026-09-04T00:00:00Z');

  // Booking task in fresh50: Booking--21
  const bookingTask = {
    id: 'Booking--21',
    webName: 'Booking',
    url: 'https://www.booking.com/',
    question: 'Find a hotel in Sydney with a rating of 8 or higher, providing free Wi-Fi and parking, available for a four-night stay starting on March 10, 2024.',
  };

  const normalized = normalizeWebVoyagerTaskDate(bookingTask, runDate);
  assert.equal(normalized.normalized, true);
  assert.match(normalized.question, /2027/);
});
