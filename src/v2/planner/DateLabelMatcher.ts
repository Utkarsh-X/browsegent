import type { GoalRequirements } from './GoalProgressTracker';

export type MonthNameLookup = Map<string, number>;

export interface MonthKey {
  year?: number;
  month: number;
}

export interface ParsedDateLabel {
  monthKey: MonthKey;
  day: number;
}

/**
 * Locale-free date-label parsing shared by the horizon detector and the goal
 * progress tracker. Month names are resolved through Intl using the
 * page-declared language — no hardcoded month tables, no site selectors.
 */

export function buildMonthNameLookup(lang: string): MonthNameLookup | undefined {
  try {
    const lookup: MonthNameLookup = new Map();
    for (const style of ['long', 'short', 'narrow'] as const) {
      const formatter = new Intl.DateTimeFormat(lang, { month: style, timeZone: 'UTC' });
      for (let month = 0; month < 12; month += 1) {
        const date = new Date(Date.UTC(2000, month, 15));
        const label = normalizeNameToken(formatter.format(date));
        if (label && !lookup.has(label)) lookup.set(label, month + 1);
      }
    }
    return lookup.size >= 12 ? lookup : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeNameToken(value: string): string {
  // Strip punctuation, symbols, AND combining marks: locales abbreviate month
  // names in two incompatible ways — CLDR uses abbreviation signs ("दिस॰")
  // while sites truncate ("दिसं"). Normalizing both sides to their base
  // letters makes the variants converge without per-language tables.
  return value.replace(/[\p{P}\p{S}\p{M}]+/gu, '').trim().toLowerCase();
}

/**
 * Extracts (month, day, year) from a locale-mixed label such as
 * "Thursday, 10 September 2026" or "गुरुवार, 10 सितंबर 2026". The month is
 * matched by name through the page-locale lookup; digits are read positionally.
 */
export function parseCalendarLabel(
  label: string,
  monthNames: MonthNameLookup,
): ParsedDateLabel | undefined {
  const tokens = label.split(/[\s,.–—-]+/).map(token => normalizeNameToken(token)).filter(Boolean);
  if (tokens.length < 2) return undefined;

  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;

  for (const token of tokens) {
    if (month === undefined) {
      const matched = monthNames.get(token);
      if (matched !== undefined) {
        month = matched;
        continue;
      }
    }
    if (/^\d{4}$/.test(token)) {
      const parsedYear = Number.parseInt(token, 10);
      if (parsedYear >= 1900 && parsedYear <= 2100) year = parsedYear;
      continue;
    }
    if (day === undefined && /^\d{1,2}$/.test(token)) {
      const parsedDay = Number.parseInt(token, 10);
      if (parsedDay >= 1 && parsedDay <= 31) day = parsedDay;
    }
  }

  if (month === undefined || day === undefined) return undefined;
  return { monthKey: { year, month }, day };
}

export interface ParsedDatePair {
  monthKey: MonthKey;
  day: number;
}

/**
 * Extracts ALL (month, day, year) pairs from a label. Confirmation controls
 * such as a check-in/check-out field render the full committed range in one
 * accessible name ("Fri 25 Dec — Sat 26 Dec"), so a single label can evidence
 * more than one target date.
 */
export function parseAllDatePairs(
  label: string,
  monthNames: MonthNameLookup,
): ParsedDatePair[] {
  const tokens = label.split(/[\s,.–—-]+/).map(token => normalizeNameToken(token)).filter(Boolean);
  const pairs: ParsedDatePair[] = [];

  let month: number | undefined;
  let year: number | undefined;
  let day: number | undefined;

  const flush = (): void => {
    if (month !== undefined && day !== undefined) {
      pairs.push({ monthKey: { year, month }, day });
    }
    month = undefined;
    year = undefined;
    day = undefined;
  };

  for (const token of tokens) {
    const matched = monthNames.get(token);
    if (matched !== undefined) {
      // A second month name starts the next date segment (e.g. "25 Dec — 26 Dec").
      if (month !== undefined && day !== undefined) flush();
      month = matched;
      continue;
    }
    if (/^\d{4}$/.test(token)) {
      const parsedYear = Number.parseInt(token, 10);
      if (parsedYear >= 1900 && parsedYear <= 2100) year = parsedYear;
      continue;
    }
    if (/^\d{1,2}$/.test(token)) {
      const parsedDay = Number.parseInt(token, 10);
      if (parsedDay >= 1 && parsedDay <= 31) {
        if (day !== undefined) flush();
        day = parsedDay;
      }
    }
  }
  flush();

  return pairs;
}

export interface TargetDate {
  year?: number;
  month: number;
  day: number;
}

/** Expands the requirement's ISO date endpoints into matchable (month, day, year) triples. */
export function targetDates(requirements: GoalRequirements): TargetDate[] {
  const dates: TargetDate[] = [];
  for (const iso of [requirements.dateFrom, requirements.dateTo]) {
    if (!iso) continue;
    const parts = iso.split('-').map(part => Number.parseInt(part, 10));
    if (parts.length === 3 && parts.every(part => Number.isFinite(part))) {
      dates.push({ year: parts[0], month: parts[1], day: parts[2] });
    } else if (parts.length === 2 && parts.every(part => Number.isFinite(part))) {
      dates.push({ month: parts[0], day: parts[1] });
    }
  }
  return dates;
}

export function sameMonth(left: MonthKey, right: MonthKey): boolean {
  if (left.month !== right.month) return false;
  if (left.year === undefined || right.year === undefined) return true;
  return left.year === right.year;
}

export function targetMonthKeys(requirements: GoalRequirements): MonthKey[] {
  const keys: MonthKey[] = [];
  for (const target of targetDates(requirements)) {
    const key: MonthKey = { year: target.year, month: target.month };
    if (!keys.some(existing => sameMonth(existing, key))) keys.push(key);
  }
  return keys;
}

export function formatMonthEn(key: MonthKey, style: 'long' | 'short'): string {
  const formatter = new Intl.DateTimeFormat('en', { month: style, timeZone: 'UTC' });
  const monthLabel = formatter.format(new Date(Date.UTC(2000, key.month - 1, 15)));
  return key.year !== undefined ? `${monthLabel} ${key.year}` : monthLabel;
}
