import type { OperationalProjection, ProjectionItem } from '../brain1/projectionTypes';
import type { GoalRequirements } from './GoalProgressTracker';
import {
  buildMonthNameLookup,
  formatMonthEn,
  parseCalendarLabel,
  sameMonth,
  targetDates,
  targetMonthKeys,
} from './DateLabelMatcher';
import type { MonthNameLookup, ParsedDateLabel } from './DateLabelMatcher';

export interface HorizonNavControl {
  refId: string;
  name?: string;
  role?: string;
  /** Structural hint from position inside the widget; the planner decides direction. */
  directionHint: 'next' | 'prev';
  /** True when this control's direction moves the visible window toward the
   *  goal's target months (deterministic month arithmetic, not a guess). */
  recommended?: boolean;
  actionability: 'ready' | 'disabled' | 'hidden' | 'offscreen';
}

export interface SurfaceHorizon {
  kind: 'calendar';
  /** Canonical English labels of months currently rendered in the widget. */
  visibleMonths: string[];
  /** Canonical English labels of months the focused goal requirement needs. */
  targetMonths: string[];
  covered: boolean;
  navControls: HorizonNavControl[];
}

export interface TargetDateCell {
  refId: string;
  label: string;
  day: number;
}

const MIN_CALENDAR_CELLS = 10;
const MAX_NAV_CONTROLS = 6;
const MAX_TARGET_CELLS = 8;

/**
 * Pure function: detects a date-picker-like widget whose visible month window
 * does not cover the months the goal requires, and the widget-local controls
 * that advance that window. Locales are resolved through Intl using the
 * page-declared language — no site names, selectors, or hardcoded month
 * tables. Returns undefined when the page language, widget, or target months
 * cannot be established (honest no-op, never invented facts).
 */
export function detectDateHorizon(
  projection: OperationalProjection,
  requirements: GoalRequirements,
): SurfaceHorizon | undefined {
  const lang = projection.lang?.trim();
  if (!lang || !requirements.dateFrom) return undefined;

  const monthNames = buildMonthNameLookup(lang);
  if (!monthNames) return undefined;

  const targets = targetMonthKeys(requirements);
  if (targets.length === 0) return undefined;

  const cells = selectCalendarCluster(collectCalendarCells(projection.interactions, monthNames));
  if (cells.length < MIN_CALENDAR_CELLS) return undefined;

  const visibleMonths = distinctMonthKeys(cells.map(cell => cell.monthKey));
  if (visibleMonths.length === 0) return undefined;

  const covered = targets.every(target => visibleMonths.some(visible => sameMonth(visible, target)));
  if (covered) return undefined;

  const widgetBounds = widgetBoundsOf(cells);
  if (!widgetBounds) return undefined;

  const navControls = collectNavControls(projection.interactions, cells, widgetBounds, monthNames);
  if (navControls.length === 0) return undefined;

  // Which direction brings the target into view? Deterministic arithmetic over
  // Intl-parsed month numbers — no language assumption. Yearless targets
  // ("December 25-26") only compare against a single-year visible window.
  const targetsHaveYear = targets.every(target => target.year !== undefined);
  const visibleShareOneYear = new Set(visibleMonths.map(key => key.year)).size === 1;
  const recommendedDirection: 'next' | 'prev' | undefined = (() => {
    if (targetsHaveYear) {
      const targetIndex = absoluteMonthOf(targets[0]);
      const indexes = visibleMonths.map(absoluteMonthOf);
      if (targetIndex > Math.max(...indexes)) return 'next';
      if (targetIndex < Math.min(...indexes)) return 'prev';
      return undefined;
    }
    if (!visibleShareOneYear) return undefined;
    const targetMonth = targets[0].month;
    const months = visibleMonths.map(key => key.month);
    if (targetMonth > Math.max(...months)) return 'next';
    if (targetMonth < Math.min(...months)) return 'prev';
    return undefined;
  })();
  if (recommendedDirection) {
    for (const control of navControls) {
      if (control.directionHint === recommendedDirection && control.actionability === 'ready') {
        control.recommended = true;
      }
    }
  }

  return {
    kind: 'calendar',
    visibleMonths: visibleMonths.map(key => formatMonthEn(key, 'long')),
    targetMonths: targets.map(key => formatMonthEn(key, 'long')),
    covered,
    navControls,
  };
}

function absoluteMonthOf(key: MonthKeyLike): number {
  // Yearless targets sort by month only; the horizon already guarantees the
  // target month number is outside the visible window in that case.
  return (key.year ?? 0) * 12 + (key.month - 1);
}

/**
 * Pure function: finds observed day cells that match the focused requirement's
 * concrete target dates (e.g. December 25 and 26). Used when the target month
 * IS visible so the matched cells are guaranteed to reach the planner's
 * working set. Locale handling identical to detectDateHorizon.
 */
export function findTargetDateCells(
  projection: OperationalProjection,
  requirements: GoalRequirements,
): TargetDateCell[] {
  const lang = projection.lang?.trim();
  if (!lang || !requirements.dateFrom) return [];

  const monthNames = buildMonthNameLookup(lang);
  if (!monthNames) return [];

  const targets = targetDates(requirements);
  if (targets.length === 0) return [];

  const cells = selectCalendarCluster(collectCalendarCells(projection.interactions, monthNames));
  const matched: TargetDateCell[] = [];
  for (const cell of cells) {
    const hit = targets.find(target =>
      target.day === cell.day
      && target.month === cell.monthKey.month
      && (target.year === undefined || cell.monthKey.year === undefined || target.year === cell.monthKey.year),
    );
    if (hit) {
      matched.push({
        refId: cell.item.refId,
        label: `${cell.item.name ?? cell.item.text ?? ''}`.trim().slice(0, 80),
        day: cell.day,
      });
      if (matched.length >= MAX_TARGET_CELLS) break;
    }
  }
  return matched.sort((left, right) => left.day - right.day);
}

interface CalendarCell {
  item: ProjectionItem;
  monthKey: ParsedDateLabel['monthKey'];
  day: number;
}

function collectCalendarCells(
  interactions: ProjectionItem[],
  monthNames: MonthNameLookup,
): CalendarCell[] {
  const cells: CalendarCell[] = [];
  for (const item of interactions) {
    if (item.visibility === 'hidden') continue;
    const label = `${item.name ?? ''} ${item.text ?? ''}`.trim();
    if (!label) continue;
    const parsed = parseCalendarLabel(label, monthNames);
    // Calendar date buttons announce the full date including the year;
    // requiring it excludes stray page elements whose text happens to
    // contain a month word and a day number (news dates, offer badges).
    if (parsed && parsed.monthKey.year !== undefined) {
      cells.push({ item, monthKey: parsed.monthKey, day: parsed.day });
    }
  }
  return cells;
}

/**
 * Reduces parsed cells to the single densest spatial cluster: stray page
 * elements whose labels happen to contain a month word and a day number
 * (news dates, offer badges) do not form grid-like clusters, while a real
 * calendar renders its cells on a tight regular grid. Falls back to all
 * year-bearing cells when clustering is inconclusive.
 */
function selectCalendarCluster(cells: CalendarCell[]): CalendarCell[] {
  const boxed = cells.filter(cell => cell.item.box !== undefined);
  if (boxed.length < MIN_CALENDAR_CELLS) return [];

  // Grid cells share one box size; content cards carrying date-like text do
  // not. Keep only the cells whose dimensions match the modal size.
  const sizeCounts = new Map<string, number>();
  for (const cell of boxed) {
    const box = cell.item.box!;
    const key = `${Math.round(box.width / 8)}:${Math.round(box.height / 8)}`;
    sizeCounts.set(key, (sizeCounts.get(key) ?? 0) + 1);
  }
  let modalKey = '';
  let modalCount = 0;
  for (const [key, count] of sizeCounts) {
    if (count > modalCount) {
      modalCount = count;
      modalKey = key;
    }
  }
  const uniform = boxed.filter(cell => {
    const box = cell.item.box!;
    return `${Math.round(box.width / 8)}:${Math.round(box.height / 8)}` === modalKey;
  });
  if (uniform.length < MIN_CALENDAR_CELLS) return [];

  const parent = boxed.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const clusterGap = 80;
  for (let i = 0; i < uniform.length; i += 1) {
    for (let j = i + 1; j < uniform.length; j += 1) {
      if (boxesNear(uniform[i].item.box!, uniform[j].item.box!, clusterGap)) union(i, j);
    }
  }

  const clusterSizes = new Map<number, number>();
  for (let i = 0; i < boxed.length; i += 1) {
    const root = find(i);
    clusterSizes.set(root, (clusterSizes.get(root) ?? 0) + 1);
  }
  let bestRoot = -1;
  let bestSize = 0;
  for (const [root, size] of clusterSizes) {
    if (size > bestSize) {
      bestSize = size;
      bestRoot = root;
    }
  }
  if (bestSize < MIN_CALENDAR_CELLS) return [];
  return uniform.filter((_, index) => find(index) === bestRoot);
}

function boxesNear(
  left: NonNullable<ProjectionItem['box']>,
  right: NonNullable<ProjectionItem['box']>,
  gap: number,
): boolean {
  const gapX = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
  const gapY = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
  return gapX <= gap && gapY <= gap;
}

function distinctMonthKeys(keys: MonthKeyLike[]): MonthKeyLike[] {
  const distinct: MonthKeyLike[] = [];
  for (const key of keys) {
    if (!distinct.some(existing => sameMonth(existing, key))) distinct.push(key);
  }
  return distinct.sort((left, right) =>
    (left.year ?? 0) - (right.year ?? 0) || left.month - right.month,
  );
}

interface MonthKeyLike {
  year?: number;
  month: number;
}

interface WidgetBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function widgetBoundsOf(cells: CalendarCell[]): WidgetBounds | undefined {
  const boxes = cells.map(cell => cell.item.box).filter((box): box is NonNullable<ProjectionItem['box']> => Boolean(box));
  if (boxes.length < MIN_CALENDAR_CELLS) return undefined;

  return boxes.reduce((bounds, box) => ({
    minX: Math.min(bounds.minX, box.x),
    minY: Math.min(bounds.minY, box.y),
    maxX: Math.max(bounds.maxX, box.x + box.width),
    maxY: Math.max(bounds.maxY, box.y + box.height),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function collectNavControls(
  interactions: ProjectionItem[],
  cells: CalendarCell[],
  bounds: WidgetBounds,
  monthNames: MonthNameLookup,
): HorizonNavControl[] {
  const cellRefIds = new Set(cells.map(cell => cell.item.refId));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const topBandMaxY = bounds.minY + (bounds.maxY - bounds.minY) * 0.45;
  const candidates: Array<{ item: ProjectionItem; control: HorizonNavControl; distanceToTop: number }> = [];

  for (const item of interactions) {
    if (cellRefIds.has(item.refId)) continue;
    if (item.kind !== 'button' && item.role !== 'button') continue;
    if (item.actionability !== 'ready' && item.actionability !== 'disabled') continue;
    const box = item.box;
    if (!box || !boxOverlapsBand(box, bounds, topBandMaxY)) continue;

    const label = `${item.name ?? ''} ${item.text ?? ''}`.trim();
    if (!label || /^\d{1,2}$/.test(label)) continue;
    if (parseCalendarLabel(label, monthNames)) continue;

    candidates.push({
      item,
      control: {
        refId: item.refId,
        name: item.name ?? item.text,
        role: item.role ?? item.kind,
        directionHint: box.x + box.width / 2 >= centerX ? 'next' : 'prev',
        actionability: item.actionability,
      },
      distanceToTop: Math.abs(box.y - bounds.minY),
    });
  }

  return candidates
    .sort((left, right) => left.distanceToTop - right.distanceToTop)
    .slice(0, MAX_NAV_CONTROLS)
    .map(candidate => candidate.control);
}

function boxOverlapsBand(box: NonNullable<ProjectionItem['box']>, bounds: WidgetBounds, bandMaxY: number): boolean {
  // Nav controls frequently sit at (or slightly outside) the widget's horizontal
  // edges, above a month-label and weekday header strip that separates them
  // from the first cell row — so both tolerances are generous while the band
  // stays anchored to the top of the grid.
  const horizontalMargin = 80;
  const aboveWidgetMargin = 64;
  const withinX = box.x + box.width >= bounds.minX - horizontalMargin && box.x <= bounds.maxX + horizontalMargin;
  const withinTopBand = box.y + box.height >= bounds.minY - aboveWidgetMargin && box.y <= bandMaxY;
  return withinX && withinTopBand;
}

/**
 * Commit-phase helper: finds the form submit controls on the surface
 * (explicit type=submit, or a typeless <button> inside a <form> — the HTML
 * spec default). Used once every parsed requirement is satisfied so the
 * search/submit button cannot be squeezed out of the working set by render
 * floods. Language-free structural semantics; cap keeps it bounded.
 */
export function findSubmitControls(projection: OperationalProjection): Array<{ refId: string; name?: string }> {
  const found: Array<{ refId: string; name?: string }> = [];
  for (const item of projection.interactions) {
    if (found.length >= MAX_SUBMIT_CONTROLS) break;
    if (item.visibility !== 'visible' && item.visibility !== 'offscreen') continue;
    if (item.actionability !== 'ready') continue;
    if (item.kind !== 'button' && item.role !== 'button') continue;
    const isSubmit = item.inputType === 'submit' || (item.inForm === true && item.inputType === undefined);
    if (!isSubmit) continue;
    found.push({ refId: item.refId, name: item.name ?? item.text });
  }
  return found;
}

const MAX_SUBMIT_CONTROLS = 3;
