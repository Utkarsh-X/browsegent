import test from 'node:test';
import assert from 'node:assert/strict';

import { detectDateHorizon, findTargetDateCells } from '../../../src/v2/planner/HorizonDetector';
import { parseGoalRequirements } from '../../../src/v2/planner/GoalProgressTracker';
import type { OperationalProjection, ProjectionItem } from '../../../src/v2/brain1/projectionTypes';

const ENGLISH_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HINDI_MONTHS = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];

function makeItem(overrides: Partial<ProjectionItem> & { refId: string }): ProjectionItem {
  return {
    kind: 'button',
    role: 'button',
    visibility: 'visible',
    actionability: 'ready',
    state: 'live',
    continuityConfidence: 1,
    score: 100,
    ...overrides,
  };
}

function calendarCell(
  refId: string,
  label: string,
  position: number,
): ProjectionItem {
  return makeItem({
    refId,
    kind: 'generic',
    role: 'checkbox',
    name: label,
    text: label,
    box: {
      x: 100 + (position % 30) * 40,
      y: 500 + Math.floor(position / 30) * 40,
      width: 40,
      height: 40,
    },
  });
}

function navButton(
  refId: string,
  name: string,
  x: number,
  overrides: Partial<ProjectionItem> = {},
): ProjectionItem {
  return makeItem({
    refId,
    name,
    text: name,
    box: { x, y: 505, width: 30, height: 30 },
    ...overrides,
  });
}

function makeProjection(
  interactions: ProjectionItem[],
  lang?: string,
): OperationalProjection {
  return {
    projectionId: 'projection_test',
    observationId: 'obs_test',
    generationId: 1,
    url: 'https://example.test/',
    title: 'Fixture',
    lang,
    interactions,
    readables: [],
    navigation: [],
    regions: [],
    warnings: [],
    stats: {
      interactionCount: interactions.length,
      readableCount: 0,
      navigationCount: 0,
      regionCount: 0,
    },
  };
}

function englishCalendarCells(): ProjectionItem[] {
  const cells: ProjectionItem[] = [];
  let position = 0;
  for (const [monthIndex, monthCount] of [[8, 30], [9, 31]] as Array<[number, number]>) {
    for (let day = 1; day <= monthCount; day += 1) {
      cells.push(calendarCell(
        `ref_cell_${monthIndex}_${day}`,
        `${day} ${ENGLISH_MONTHS[monthIndex]} 2026`,
        position,
      ));
      position += 1;
    }
  }
  return cells;
}

test('detectDateHorizon finds an uncovered English calendar and widget-local nav controls', () => {
  const requirements = parseGoalRequirements('Find a hotel in Paris for February 14-21, 2027');
  assert.ok(requirements);

  const interactions = [
    ...englishCalendarCells(),
    navButton('ref_prev', 'Previous month', 60),
    navButton('ref_next', 'Next month', 1240),
    // Below the widget top band: not a navigation candidate
    navButton('ref_search', 'Search', 1240, { box: { x: 1240, y: 640, width: 60, height: 40 } }),
  ];
  const horizon = detectDateHorizon(makeProjection(interactions, 'en'), requirements);

  assert.ok(horizon);
  assert.equal(horizon.kind, 'calendar');
  assert.deepEqual(horizon.visibleMonths, ['September 2026', 'October 2026']);
  assert.deepEqual(horizon.targetMonths, ['February 2027']);
  assert.equal(horizon.covered, false);
  assert.deepEqual(horizon.navControls.map(control => control.refId), ['ref_prev', 'ref_next']);
  assert.equal(horizon.navControls[0].directionHint, 'prev');
  assert.equal(horizon.navControls[1].directionHint, 'next');
});

test('detectDateHorizon resolves non-Latin month labels through the page language', () => {
  const requirements = parseGoalRequirements('Find a Mexico hotel with deals for December 25-26');
  assert.ok(requirements);

  const cells: ProjectionItem[] = [];
  let position = 0;
  for (const [monthIndex, monthCount] of [[8, 30], [9, 31]] as Array<[number, number]>) {
    for (let day = 1; day <= monthCount; day += 1) {
      cells.push(calendarCell(
        `ref_hi_${monthIndex}_${day}`,
        `गुरुवार, ${day} ${HINDI_MONTHS[monthIndex]} 2026`,
        position,
      ));
      position += 1;
    }
  }
  const interactions = [
    ...cells,
    navButton('ref_hi_next', 'अगले महीने', 1240),
  ];
  const horizon = detectDateHorizon(makeProjection(interactions, 'hi'), requirements);

  assert.ok(horizon);
  assert.deepEqual(horizon.visibleMonths, ['September 2026', 'October 2026']);
  assert.deepEqual(horizon.targetMonths, ['December']);
  assert.equal(horizon.covered, false);
  assert.deepEqual(horizon.navControls.map(control => control.refId), ['ref_hi_next']);
});

test('detectDateHorizon returns undefined when the target month is already visible', () => {
  const requirements = parseGoalRequirements('Find a hotel in Paris for February 14-21, 2027');
  assert.ok(requirements);

  const cells: ProjectionItem[] = [];
  let position = 0;
  for (const [monthIndex, monthCount] of [[1, 28], [2, 31]] as Array<[number, number]>) {
    for (let day = 1; day <= monthCount; day += 1) {
      cells.push(calendarCell(
        `ref_feb_${day}`,
        `${day} ${ENGLISH_MONTHS[monthIndex]} 2027`,
        position,
      ));
      position += 1;
    }
  }
  const horizon = detectDateHorizon(makeProjection([
    ...cells,
    navButton('ref_next', 'Next month', 1240),
  ], 'en'), requirements);

  assert.equal(horizon, undefined);
});

test('detectDateHorizon returns undefined without a page language, without a date target, or without a widget', () => {
  const requirements = parseGoalRequirements('Find a hotel in Paris for February 14-21, 2027');
  assert.ok(requirements);
  const interactions = [
    ...englishCalendarCells(),
    navButton('ref_next', 'Next month', 1240),
  ];

  // No lang declared: honest no-op rather than an English assumption.
  assert.equal(detectDateHorizon(makeProjection(interactions), requirements), undefined);

  // A requirements object without a date target.
  const guestsOnly = parseGoalRequirements('Book a table for 2 adults');
  assert.ok(guestsOnly);
  assert.equal(detectDateHorizon(makeProjection(interactions, 'en'), guestsOnly), undefined);

  // Too few day cells to be a calendar widget.
  const sparse = interactions.slice(0, 4);
  assert.equal(detectDateHorizon(makeProjection(sparse, 'en'), requirements), undefined);
});

test('detectDateHorizon includes disabled nav controls so the planner can see a hard boundary', () => {
  const requirements = parseGoalRequirements('Find a hotel in Paris for February 14-21, 2027');
  assert.ok(requirements);

  const horizon = detectDateHorizon(makeProjection([
    ...englishCalendarCells(),
    navButton('ref_prev_disabled', 'Previous month', 60, { actionability: 'disabled' }),
    navButton('ref_next', 'Next month', 1240),
  ], 'en'), requirements);

  assert.ok(horizon);
  const prev = horizon.navControls.find(control => control.refId === 'ref_prev_disabled');
  assert.ok(prev);
  assert.equal(prev.actionability, 'disabled');
});

test('detectDateHorizon keeps nav controls above the month-header strip within the top band', () => {
  // Real-calendar geometry: nav buttons sit ~36px above the first cell row
  // with the month label and weekday strip between them.
  const requirements = parseGoalRequirements('Find a Mexico hotel with deals for December 25-26');
  assert.ok(requirements);

  const cells: ProjectionItem[] = [];
  let position = 0;
  for (const [monthIndex, monthCount] of [[8, 30], [9, 31]] as Array<[number, number]>) {
    for (let day = 1; day <= monthCount; day += 1) {
      cells.push(calendarCell(
        `ref_gap_${monthIndex}_${day}`,
        `गुरुवार, ${day} ${HINDI_MONTHS[monthIndex]} 2026`,
        position,
      ));
      position += 1;
    }
  }
  const horizon = detectDateHorizon(makeProjection([
    ...cells,
    makeItem({
      refId: 'ref_nav_above',
      name: 'अगले महीने',
      text: 'अगले महीने',
      box: { x: 1072, y: 495, width: 48, height: 48 },
    }),
    // Day-number sub-buttons inside the grid must not become nav candidates.
    makeItem({
      refId: 'ref_day_button',
      name: '2',
      text: '2',
      box: { x: 560, y: 620, width: 24, height: 24 },
    }),
  ], 'hi'), requirements);

  assert.ok(horizon);
  assert.deepEqual(horizon.navControls.map(control => control.refId), ['ref_nav_above']);
});

test('findTargetDateCells matches the goal-exact day cells once the target month is visible', () => {
  const requirements = parseGoalRequirements('Find a Mexico hotel with deals for December 25-26');
  assert.ok(requirements);

  const cells: ProjectionItem[] = [];
  let position = 0;
  for (let day = 1; day <= 31; day += 1) {
    cells.push(calendarCell(
      `ref_dec_${day}`,
      `गुरुवार, ${day} दिसंबर 2026`,
      position,
    ));
    position += 1;
  }
  const matched = findTargetDateCells(makeProjection(cells, 'hi'), requirements);
  assert.deepEqual(matched.map(cell => cell.refId), ['ref_dec_25', 'ref_dec_26']);
  assert.deepEqual(matched.map(cell => cell.day), [25, 26]);
});

test('detectDateHorizon recommends the control that moves the window toward the target', () => {
  const requirements = parseGoalRequirements('Find a Mexico hotel with deals for December 25-26');
  assert.ok(requirements);

  const horizon = detectDateHorizon(makeProjection([
    ...englishCalendarCells(),
    navButton('ref_prev', 'Previous month', 60),
    navButton('ref_next', 'Next month', 1240),
  ], 'en'), requirements);

  assert.ok(horizon);
  const next = horizon.navControls.find(control => control.refId === 'ref_next');
  const prev = horizon.navControls.find(control => control.refId === 'ref_prev');
  assert.equal(next?.recommended, true);
  assert.equal(prev?.recommended, undefined);
});

test('detectDateHorizon ignores stray date-like page elements and grid-uniform cards', () => {
  // Reproduces webvoyager_lite_1788460634215 EP5: hotel-card review dates
  // ("12 March", yearless) and other page text polluted the visible window
  // and broke direction hints on the real Booking surface.
  const requirements = parseGoalRequirements("Find a hotel in Paris for February 14-21, 2027");
  assert.ok(requirements);

  const pollution: ProjectionItem[] = Array.from({ length: 14 }, (_, index) => makeItem({
    refId: `ref_card_${index}`,
    kind: 'generic',
    role: 'link',
    name: `Marari Beach Resort ${index} review 1${index % 10} March`,
    text: `Marari Beach Resort ${index} review 1${index % 10} March`,
    box: { x: 200 + (index % 4) * 220, y: 700 + Math.floor(index / 4) * 160, width: 210, height: 150 },
  }));
  const yearless = Array.from({ length: 6 }, (_, index) => makeItem({
    refId: `ref_yearless_${index}`,
    kind: 'generic',
    name: `${index + 3} March`,
    text: `${index + 3} March`,
    box: { x: 300 + index * 30, y: 1100, width: 24, height: 24 },
  }));

  const horizon = detectDateHorizon(makeProjection([
    ...englishCalendarCells(),
    ...pollution,
    ...yearless,
    navButton('ref_prev', 'Previous month', 60),
    navButton('ref_next', 'Next month', 1240),
  ], 'en'), requirements);

  assert.ok(horizon);
  assert.deepEqual(horizon.visibleMonths, ['September 2026', 'October 2026']);
  const next = horizon.navControls.find(control => control.refId === 'ref_next');
  assert.equal(next?.recommended, true);
  assert.equal(horizon.navControls.some(control => control.refId.startsWith('ref_card')), false);
});
