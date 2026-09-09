import test from 'node:test';
import assert from 'node:assert/strict';

import { findUnaddressedDateRequirements } from '../../../src/v2/agent/RequirementCompletionGate';
import type { PlannerGoalProgress } from '../../../src/v2/planner/GoalProgressTracker';

const GOAL = 'Find hotels in Mexico for December 25-26 with rating greater than 8.5';

function progressWithDates(state: string): PlannerGoalProgress {
  return { entries: [{ key: 'dates', state }] };
}

test('gate flags a results-shaped answer when dates were never entered', () => {
  const reasons = findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('NOT_SET'),
    answer: 'Hotel More By Kavia (9.3/10), Hotel Catedral (Historic Centre), and Hotel Metropol (8.7/10) are available.',
  });
  assert.deepEqual(reasons, ['requirements_unaddressed:dates_not_entered']);
});

test('gate flags answers after widget selection when the search was never executed', () => {
  const reasons = findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('selected:"Dec 25 - Dec 26"'),
    answer: 'The cheapest option is $3,450 (click on a date to see details).',
  });
  assert.deepEqual(reasons, ['requirements_unaddressed:search_not_executed']);
});

test('gate flags stale and partial date states distinctly', () => {
  const stale = findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('stale:"Dec 25"'),
    answer: 'Hotels from 9.0/10 are listed below.',
  });
  assert.deepEqual(stale, ['requirements_unaddressed:dates_stale_reset']);

  const partial = findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('partial:"Dec 25 - Dec 26" (1/2 selected)'),
    answer: 'Available hotels: 1. Kavia 2. Metropol',
  });
  assert.deepEqual(partial, ['requirements_unaddressed:dates_partially_selected']);
});

test('gate passes when the search completed (dates in URL)', () => {
  const reasons = findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('in_url'),
    answer: 'Hotel More By Kavia (9.3/10) is available for those dates.',
  });
  assert.deepEqual(reasons, []);
});

test('gate ignores non-results answers and goals without date requirements', () => {
  assert.deepEqual(findUnaddressedDateRequirements({
    goal: GOAL,
    goalProgress: progressWithDates('NOT_SET'),
    answer: 'I was unable to find that information.',
  }), []);

  assert.deepEqual(findUnaddressedDateRequirements({
    goal: 'Find the Introduction to Psychology course instructor, institution, hours',
    goalProgress: { entries: [{ key: 'destination', state: 'in_url' }] },
    answer: 'Paul Bloom teaches it at Yale University.',
  }), []);
});

test('gate never fires for informational date lookups without a destination', () => {
  const reasons = findUnaddressedDateRequirements({
    goal: 'What was the geomagnetic field strength in Oslo on June 20, 2023?',
    goalProgress: progressWithDates('NOT_SET'),
    answer: 'The total field strength was 51.5 microteslas.',
  });
  assert.deepEqual(reasons, []);
});

test('gate fires only for transactional destination+dates flows', () => {
  const datesOnly = findUnaddressedDateRequirements({
    goal: 'Find the cheapest flight on January 25, 2024',
    goalProgress: progressWithDates('NOT_SET'),
    answer: 'The cheapest fare was 3,450 (click a date for details).',
  });
  assert.deepEqual(datesOnly, []);
});
