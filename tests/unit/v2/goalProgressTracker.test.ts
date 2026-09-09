import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoalRequirements,
  evaluateGoalProgress,
} from '../../../src/v2/planner/GoalProgressTracker';
import type { CompressedLineage } from '../../../src/v2/planner/types';

test('parseGoalRequirements parses a Booking-like hotel travel goal', () => {
  const goal = "Find a well-reviewed hotel in Paris with available bookings suitable for a couple (2 adults) on Valentine's Day week, February 14-21, 2027, that offers free cancellation options.";
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, 'Paris');
  assert.equal(reqs.dateFrom, '2027-02-14');
  assert.equal(reqs.dateTo, '2027-02-21');
  assert.equal(reqs.dateLabel, 'February 14-21, 2027');
  assert.equal(reqs.guestsAdults, 2);
  assert.ok(reqs.constraints.includes('free cancellation'));
  assert.ok(reqs.constraints.includes('well-reviewed'));
});

test('parseGoalRequirements parses a flights from/to travel goal', () => {
  const goal = 'Book a one-way flight from Boston to Seattle on Dec 28 for 1 adult, cheapest';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, 'Boston');
  assert.equal(reqs.destinationTo, 'Seattle');
  assert.equal(reqs.dateLabel, 'Dec 28');
  assert.equal(reqs.guestsAdults, 1);
  assert.ok(reqs.constraints.includes('cheapest'));
});

test('parseGoalRequirements parses Booking__0-style noun-adjacent goal', () => {
  const goal = 'Find a Mexico hotel with deals for December 25-26';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, 'Mexico');
  assert.equal(reqs.dateFrom, '12-25');
  assert.equal(reqs.dateTo, '12-26');
  assert.equal(reqs.dateLabel, 'December 25-26');
});

test('parseGoalRequirements parses noun-adjacent place: Book a Seattle hotel', () => {
  const goal = 'Book a Seattle hotel';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, 'Seattle');
});

test('parseGoalRequirements rejects non-place adjective modifying hotel (Find a luxury hotel)', () => {
  assert.equal(parseGoalRequirements('Find a luxury hotel'), undefined);
  assert.equal(parseGoalRequirements('Find a Luxury hotel'), undefined);
});

test('parseGoalRequirements parses Non-Travel Goal 1: Shopping under $N', () => {
  const goal = 'Find wireless noise-cancelling headphones under $50 with lowest price';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, undefined);
  assert.equal(reqs.dateFrom, undefined);
  assert.equal(reqs.guestsAdults, undefined);
  assert.ok(reqs.constraints.includes('under $50'));
  assert.ok(reqs.constraints.includes('cheapest'));
});

test('parseGoalRequirements parses Non-Travel Goal 2: Course-level goal', () => {
  const goal = 'Find a beginner-level python programming course with highest rated reviews';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, undefined);
  assert.equal(reqs.dateFrom, undefined);
  assert.equal(reqs.guestsAdults, undefined);
  assert.ok(reqs.constraints.includes('beginner-level'));
  assert.ok(reqs.constraints.includes('highest rated'));
});

test('parseGoalRequirements parses Non-Travel Goal 3: Recipe/Cooking goal', () => {
  const goal = 'Find a chocolate chip cookie recipe that is well-reviewed';
  const reqs = parseGoalRequirements(goal);
  assert.ok(reqs);
  assert.equal(reqs.destination, undefined);
  assert.equal(reqs.dateFrom, undefined);
  assert.equal(reqs.guestsAdults, undefined);
  assert.ok(reqs.constraints.includes('well-reviewed'));
});

test('parseGoalRequirements returns undefined for no-match operational goals', () => {
  assert.equal(parseGoalRequirements('Click the submit button and verify the message'), undefined);
  assert.equal(parseGoalRequirements('Check if the logo is visible on the page'), undefined);
  assert.equal(parseGoalRequirements('Log in to account and go to Settings'), undefined);
});

test('evaluateGoalProgress tracks typed destination via lineage value', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 1,
    truncated: false,
    steps: [
      {
        stepId: 'step_1',
        index: 0,
        kind: 'type',
        status: 'completed',
        value: 'Paris',
      },
    ],
  };

  const progress = evaluateGoalProgress(goal, {
    url: 'https://example.test/search',
    lineage,
  });

  assert.ok(progress);
  const destEntry = progress.entries.find(e => e.key === 'destination');
  assert.equal(destEntry?.state, 'typed:"Paris"');
  // First unsatisfied is dates because destination is typed
  assert.equal(progress.focus, 'dates');
});

test('evaluateGoalProgress marks destination in_url when present in decoded URL without type', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const progress = evaluateGoalProgress(goal, {
    url: 'https://example.test/city/fr/paris.html',
    lineage: { totalSteps: 0, truncated: false, steps: [] },
  });

  assert.ok(progress);
  const destEntry = progress.entries.find(e => e.key === 'destination');
  assert.equal(destEntry?.state, 'in_url');
  assert.equal(progress.focus, 'dates');
});

test('evaluateGoalProgress marks dates in_url via checkin/checkout params and NOT_SET otherwise', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';

  // 1. Without date params in URL, dates is NOT_SET even if calendar was clicked
  const progressBefore = evaluateGoalProgress(goal, {
    url: 'https://example.test/search?destination=paris',
    lineage: {
      totalSteps: 1,
      truncated: false,
      steps: [
        {
          stepId: 'step_1',
          index: 0,
          kind: 'click',
          status: 'completed',
          value: 'Calendar tab',
        },
      ],
    },
  });
  assert.ok(progressBefore);
  assert.equal(progressBefore.entries.find(e => e.key === 'dates')?.state, 'NOT_SET');

  // 2. With checkin/checkout date params in URL, dates is in_url
  const progressAfter = evaluateGoalProgress(goal, {
    url: 'https://example.test/search?checkin=2027-02-14&checkout=2027-02-21',
    lineage: { totalSteps: 0, truncated: false, steps: [] },
  });
  assert.ok(progressAfter);
  assert.equal(progressAfter.entries.find(e => e.key === 'dates')?.state, 'in_url');
});

test('evaluateGoalProgress evaluates focus ordering [destination, destinationTo, dates, guests]', () => {
  const goal = 'Find flights from Boston to Seattle on 2027-03-01 for 2 adults';

  // State 1: Nothing set -> focus: destination
  const p1 = evaluateGoalProgress(goal, {
    url: 'https://flights.test/',
    lineage: { totalSteps: 0, truncated: false, steps: [] },
  });
  assert.ok(p1);
  assert.equal(p1.focus, 'destination');

  // State 2: Destination set -> focus: destinationTo
  const p2 = evaluateGoalProgress(goal, {
    url: 'https://flights.test/',
    lineage: {
      totalSteps: 1,
      truncated: false,
      steps: [{ stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Boston' }],
    },
  });
  assert.ok(p2);
  assert.equal(p2.focus, 'destinationTo');

  // State 3: Both destinations set -> focus: dates
  const p3 = evaluateGoalProgress(goal, {
    url: 'https://flights.test/',
    lineage: {
      totalSteps: 2,
      truncated: false,
      steps: [
        { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Boston' },
        { stepId: 's2', index: 1, kind: 'type', status: 'completed', value: 'Seattle' },
      ],
    },
  });
  assert.ok(p3);
  assert.equal(p3.focus, 'dates');

  // State 4: Destinations and dates set in URL -> focus: guests
  const p4 = evaluateGoalProgress(goal, {
    url: 'https://flights.test/search?from=boston&to=seattle&date=2027-03-01',
    lineage: { totalSteps: 0, truncated: false, steps: [] },
  });
  assert.ok(p4);
  assert.equal(p4.focus, 'guests');

  // State 5: All satisfied in URL -> focus undefined
  const p5 = evaluateGoalProgress(goal, {
    url: 'https://flights.test/search?from=boston&to=seattle&date=2027-03-01&adults=2',
    lineage: { totalSteps: 0, truncated: false, steps: [] },
  });
  assert.ok(p5);
  assert.equal(p5.focus, undefined);
});

test('evaluateGoalProgress returns undefined for goals with no requirements', () => {
  const result = evaluateGoalProgress('Click submit button', {
    url: 'https://example.test',
  });
  assert.equal(result, undefined);
});

test('evaluateGoalProgress marks destination stale when navigation followed the type', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 3,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Paris' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', value: 'Calendar' },
      { stepId: 's3', index: 2, kind: 'navigate', status: 'completed', value: 'https://example.test/index.html' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/index.html', lineage });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'destination')?.state, 'stale:"Paris"');
});

test('evaluateGoalProgress keeps destination fresh when clicks follow the type without navigation', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 4,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Paris' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', value: 'Calendar' },
      { stepId: 's3', index: 2, kind: 'click', status: 'completed', value: 'Next month' },
      { stepId: 's4', index: 3, kind: 'click', status: 'completed', value: '14 February 2027' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'destination')?.state, 'typed:"Paris"');
});

test('evaluateGoalProgress fresh re-type after navigation clears staleness', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 4,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Paris' },
      { stepId: 's2', index: 1, kind: 'navigate', status: 'completed', value: 'https://example.test/index.html' },
      { stepId: 's3', index: 2, kind: 'click', status: 'completed', value: 'Dismiss' },
      { stepId: 's4', index: 3, kind: 'type', status: 'completed', value: 'Paris' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/index.html', lineage });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'destination')?.state, 'typed:"Paris"');
});

test('evaluateGoalProgress never counts failed steps as typed evidence', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 2,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'failed', value: 'Paris', errorCode: 'target_blocked' },
      { stepId: 's2', index: 1, kind: 'navigate', status: 'completed', value: 'https://example.test/index.html' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/index.html', lineage });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'destination')?.state, 'NOT_SET');
});

test('evaluateGoalProgress detects committed date selection from click lineage in the page locale', () => {
  const goal = 'Find a Mexico hotel with deals for December 25-26';
  const lineage: CompressedLineage = {
    totalSteps: 4,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Mexico' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', targetName: 'अगले महीने' },
      { stepId: 's3', index: 2, kind: 'click', status: 'completed', targetName: 'शुक्रवार, 25 दिसंबर 2026' },
      { stepId: 's4', index: 3, kind: 'click', status: 'completed', targetName: 'शनिवार, 26 दिसंबर 2026' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage, lang: 'hi' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'destination')?.state, 'typed:"Mexico"');
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'selected:"December 25-26"');
  assert.equal(progress.focus, undefined);
});

test('evaluateGoalProgress marks partial selection when only one endpoint of the range was clicked', () => {
  const goal = 'Find a Mexico hotel with deals for December 25-26';
  const lineage: CompressedLineage = {
    totalSteps: 1,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'click', status: 'completed', targetName: 'शुक्रवार, 25 दिसंबर 2026' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage, lang: 'hi' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'partial:"December 25-26" (1/2 selected)');
});

test('evaluateGoalProgress does not mark selection from unrelated month clicks', () => {
  const goal = 'Find a Mexico hotel with deals for December 25-26';
  const lineage: CompressedLineage = {
    totalSteps: 2,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'click', status: 'completed', targetName: 'मंगलवार, 25 सितंबर 2026' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', targetName: '19' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage, lang: 'hi' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'NOT_SET');
});

test('evaluateGoalProgress detects English date selection with an English page locale', () => {
  const goal = 'Find a hotel in Paris for February 14-21, 2027';
  const lineage: CompressedLineage = {
    totalSteps: 2,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'click', status: 'completed', targetName: 'Sunday, 14 February 2027' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', targetName: 'Sunday, 21 February 2027' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage, lang: 'en' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'selected:"February 14-21, 2027"');
});

test('evaluateGoalProgress accepts a confirmation-field click whose name carries the whole committed range', () => {
  // Reproduces run webvoyager_lite_1788395034547: the range completed via the
  // check-in/check-out field click, never via a Dec-26 day-cell click.
  const goal = 'Find a Mexico hotel with deals for December 25-26';
  const lineage: CompressedLineage = {
    totalSteps: 5,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Mexico' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', targetName: 'शुक्रवार, 25 दिसंबर 2026' },
      { stepId: 's3', index: 2, kind: 'click', status: 'completed', targetName: 'तारीखें चुनेंशुक्र. 25 दिसं. — शनि. 26 दिसं.' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://www.booking.com/index.hi.html', lineage, lang: 'hi' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'selected:"December 25-26"');
  assert.equal(progress.focus, undefined);
});

test('evaluateGoalProgress marks a partially selected range so the missing endpoint is steered', () => {
  const goal = "Find a hotel in Paris for February 14-21, 2027";
  const lineage: CompressedLineage = {
    totalSteps: 2,
    truncated: false,
    steps: [
      { stepId: 's1', index: 0, kind: 'type', status: 'completed', value: 'Paris' },
      { stepId: 's2', index: 1, kind: 'click', status: 'completed', targetName: 'Sunday, 14 February 2027' },
    ],
  };

  const progress = evaluateGoalProgress(goal, { url: 'https://example.test/', lineage, lang: 'en' });
  assert.ok(progress);
  assert.equal(progress.entries.find(e => e.key === 'dates')?.state, 'partial:"February 14-21, 2027" (1/2 selected)');
});
