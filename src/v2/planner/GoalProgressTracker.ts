import type { CompressedLineage, CompressedLineageStep } from './types';
import {
  buildMonthNameLookup,
  parseAllDatePairs,
  targetDates,
} from './DateLabelMatcher';

export interface GoalRequirements {
  destination?: string;
  destinationTo?: string;
  dateFrom?: string;
  dateTo?: string;
  dateLabel?: string;
  guestsAdults?: number;
  constraints: string[];
}

export interface GoalProgressEntry {
  key: string;
  state: string;
  detail?: string;
}

export interface PlannerGoalProgress {
  entries: GoalProgressEntry[];
  focus?: string;
}

const EXCLUDED_DESTINATIONS = new Set([
  'cart',
  'checkout',
  'account',
  'settings',
  'home',
  'login',
  'search',
  'sign in',
  'sign up',
  'help',
  'profile',
  'support',
  'terms',
  'privacy',
  'details',
  'luxury',
  'boutique',
  'budget',
  'cheap',
  'affordable',
  'the',
  'this',
  'that',
  'any',
  'some',
  'each',
  'best',
  'top',
  'good',
  // Goal verbs: the noun-adjacent place branch must never capture the
  // sentence's leading verb ("Find hotel deals...", "Book flights...").
  'find',
  'book',
  'get',
  'show',
  'list',
  'look',
  'reserve',
  'compare',
  'check',
  'explore',
  'browse',
  'buy',
  'order',
  'purchase',
  'rent',
  'hire',
  'locate',
  'identify',
  'discover',
  'english',
  'french',
  'spanish',
  'german',
  'hindi',
  'chinese',
  'japanese',
  'russian',
  'italian',
  'arabic',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]);

const MONTH_NAMES: Record<string, string> = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

const MONTH_PATTERN_STRING = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

/**
 * Pure function: parses natural language goals into structured requirements.
 * Generic language parsing using regex and keywords only — zero site names, task IDs, or ref IDs.
 * Returns undefined when no requirements match.
 */
export function parseGoalRequirements(goal: string): GoalRequirements | undefined {
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    return undefined;
  }

  // 1. Dates (parse first to avoid collision with "from X to Y" flight routes)
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let dateLabel: string | undefined;

  // ISO pairs: e.g. "2027-02-14 .. 2027-02-21", "2027-02-14 to 2027-02-21", "2027-02-14 - 2027-02-21"
  const isoPairMatch = goal.match(/\b(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|[-–])\s*(\d{4}-\d{2}-\d{2})\b/i);
  if (isoPairMatch) {
    dateFrom = isoPairMatch[1];
    dateTo = isoPairMatch[2];
    dateLabel = isoPairMatch[0];
  } else {
    // Month-name ranges: e.g. "February 14-21, 2024", "February 14 - 21, 2027", "Feb 14 to Feb 21, 2027"
    const monthRangeRegex = new RegExp(
      `\\b(${MONTH_PATTERN_STRING})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|[-–])\\s*(?:(${MONTH_PATTERN_STRING})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:[,]?\\s+(\\d{4}))?\\b`,
      'i',
    );
    const monthRangeMatch = goal.match(monthRangeRegex);
    if (monthRangeMatch) {
      dateLabel = monthRangeMatch[0];
      const startMonth = MONTH_NAMES[monthRangeMatch[1].toLowerCase()] || '01';
      const startDay = monthRangeMatch[2].padStart(2, '0');
      const endMonth = monthRangeMatch[3] ? (MONTH_NAMES[monthRangeMatch[3].toLowerCase()] || startMonth) : startMonth;
      const endDay = monthRangeMatch[4].padStart(2, '0');
      const year = monthRangeMatch[5];
      if (year) {
        dateFrom = `${year}-${startMonth}-${startDay}`;
        dateTo = `${year}-${endMonth}-${endDay}`;
      } else {
        dateFrom = `${startMonth}-${startDay}`;
        dateTo = `${endMonth}-${endDay}`;
      }
    } else {
      // Single "on <date>" or single month date: e.g. "on Dec 28", "on March 5, 2024", "on 2027-02-14"
      const singleOnDateRegex = new RegExp(
        `\\bon\\s+((?:(?:${MONTH_PATTERN_STRING})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:[,]?\\s+\\d{4})?)|\\d{4}-\\d{2}-\\d{2})\\b`,
        'i',
      );
      const singleOnMatch = goal.match(singleOnDateRegex);
      if (singleOnMatch) {
        dateLabel = singleOnMatch[1];
        const isoMatch = dateLabel.match(/\b\d{4}-\d{2}-\d{2}\b/);
        if (isoMatch) {
          dateFrom = isoMatch[0];
        } else {
          const mMatch = dateLabel.match(new RegExp(`(${MONTH_PATTERN_STRING})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,]?\\s+(\\d{4}))?`, 'i'));
          if (mMatch) {
            const m = MONTH_NAMES[mMatch[1].toLowerCase()] || '01';
            const d = mMatch[2].padStart(2, '0');
            const y = mMatch[3];
            dateFrom = y ? `${y}-${m}-${d}` : `${m}-${d}`;
          } else {
            dateFrom = dateLabel;
          }
        }
      }
    }
  }

  // 2. Destination / DestinationTo
  let destination: string | undefined;
  let destinationTo: string | undefined;

  // Check flights route: "from X to Y"
  const fromToMatch = goal.match(/\bfrom\s+([A-Z][a-zA-Z\s.-]+?)\s+to\s+([A-Z][a-zA-Z\s.-]+?)(?=\s+(?:on|for|with|in|around|near|leaving|departing|suitable|under|below|during)|[,.]|$)/i);
  if (fromToMatch) {
    const candidateFrom = fromToMatch[1].trim();
    const candidateTo = fromToMatch[2].trim();
    if (!isExcludedDestination(candidateFrom) && !isExcludedDestination(candidateTo)) {
      destination = candidateFrom;
      destinationTo = candidateTo;
    }
  }

  // If no "from X to Y" matched, check "in|to|near|around"
  if (!destination) {
    const placeMatch = goal.match(/\b(?:in|to|near|around)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/);
    if (placeMatch) {
      const candidate = placeMatch[1].trim();
      if (!isExcludedDestination(candidate)) {
        destination = candidate;
      }
    }
  }

  // If no destination matched yet, check noun-adjacent place: e.g. "Mexico hotel", "Seattle hotel"
  if (!destination) {
    const nounAdjacentMatch = goal.match(/\b([A-Z][a-zA-Z]{2,30})\s+(?:hotels?|flights?|apartments?|resorts?|hostels?|villas?|motels?|b&bs?)\b/);
    if (nounAdjacentMatch) {
      const candidate = nounAdjacentMatch[1].trim();
      if (!isExcludedDestination(candidate)) {
        destination = candidate;
      }
    }
  }

  // 3. Guests
  let guestsAdults: number | undefined;
  const adultsMatch = goal.match(/\b(\d+)\s*(?:adults?|guests?|people|persons?)\b/i);
  if (adultsMatch) {
    guestsAdults = parseInt(adultsMatch[1], 10);
  } else if (/\bcouple\b/i.test(goal)) {
    guestsAdults = 2;
  }

  // 4. Constraints
  const constraints: string[] = [];
  if (/\bfree\s+cancellation\b/i.test(goal)) {
    constraints.push('free cancellation');
  }
  if (/\b(?:well[- ]reviewed|well[- ]rated|highly[- ]rated)\b/i.test(goal)) {
    constraints.push('well-reviewed');
  }
  if (/\b(?:cheapest|lowest[- ]price)\b/i.test(goal)) {
    constraints.push('cheapest');
  }
  if (/\bhighest[- ]rated\b/i.test(goal)) {
    constraints.push('highest rated');
  }
  const priceUnderMatch = goal.match(/\b(?:under|below)\s+(\$\d+)\b/i);
  if (priceUnderMatch) {
    constraints.push(`under ${priceUnderMatch[1]}`);
  }
  if (/\bbeginner[- ]level\b/i.test(goal)) {
    constraints.push('beginner-level');
  } else if (/\badvanced\b/i.test(goal)) {
    constraints.push('advanced');
  }

  // Return undefined if nothing matched
  if (!destination && !destinationTo && !dateFrom && !dateLabel && !guestsAdults && constraints.length === 0) {
    return undefined;
  }

  return {
    destination,
    destinationTo,
    dateFrom,
    dateTo,
    dateLabel,
    guestsAdults,
    constraints,
  };
}

function isExcludedDestination(place: string): boolean {
  const lower = place.toLowerCase().trim();
  if (EXCLUDED_DESTINATIONS.has(lower)) return true;
  // If phrase starts with month name or is too generic
  const firstWord = lower.split(/\s+/)[0];
  if (EXCLUDED_DESTINATIONS.has(firstWord)) return true;
  return false;
}

/**
 * Returns the freshest evidence for a typed value from the lineage horizon:
 * `typed:"X"` when the most recent completed type covering the value is the
 * latest relevant event, `stale:"X"` when a completed navigation happened
 * after it (the surface may have been reset), or undefined when no completed
 * type matches. Failed steps never count as evidence.
 */
function latestCompletedTypeState(
  lineageSteps: CompressedLineageStep[],
  valueNeedle: string,
  displayValue: string,
): string | undefined {
  let lastTypeIndex = -1;
  let lastNavigateIndex = -1;
  for (let index = 0; index < lineageSteps.length; index += 1) {
    const step = lineageSteps[index];
    if (step.status !== 'completed') continue;
    if (step.kind === 'navigate') {
      lastNavigateIndex = index;
    } else if (
      step.kind === 'type'
      && typeof step.value === 'string'
      && step.value.toLowerCase().includes(valueNeedle)
    ) {
      lastTypeIndex = index;
    }
  }

  if (lastTypeIndex < 0) {
    return undefined;
  }
  return lastNavigateIndex > lastTypeIndex
    ? `stale:"${displayValue}"`
    : `typed:"${displayValue}"`;
}

/**
 * Detects committed in-widget date selection from the click lineage: every
 * target date of the requirement must appear as a completed click on an
 * element whose accessible name parses to that date in the page locale.
 * Returns the goal's own date label for rendering, or undefined when the
 * selection is incomplete or the surface language cannot resolve month names.
 * Also reports how many endpoints are committed so partially selected ranges
 * steer the model at the missing endpoint instead of re-clicking the chosen
 * one.
 */
function matchSelectedDatesInLineage(
  lineageSteps: CompressedLineageStep[],
  reqs: GoalRequirements,
  lang: string,
): { label: string; matched: number; total: number } | undefined {
  const targets = targetDates(reqs);
  if (targets.length === 0) return undefined;

  const monthNames = buildMonthNameLookup(lang);
  if (!monthNames) return undefined;

  const matched = new Set<number>();
  for (const step of lineageSteps) {
    if (step.status !== 'completed') continue;
    if (step.kind !== 'click' && step.kind !== 'select') continue;
    if (typeof step.targetName !== 'string') continue;
    // Confirmation controls render the whole committed range in one name
    // ("Fri 25 Dec — Sat 26 Dec"), so match every date pair in the label.
    for (const parsed of parseAllDatePairs(step.targetName, monthNames)) {
      targets.forEach((target, index) => {
        if (
          target.day === parsed.day
          && target.month === parsed.monthKey.month
          && (target.year === undefined || parsed.monthKey.year === undefined || target.year === parsed.monthKey.year)
        ) {
          matched.add(index);
        }
      });
    }
    if (matched.size === targets.length) break;
  }

  if (matched.size === 0) return undefined;
  const label = reqs.dateLabel ?? [reqs.dateFrom, reqs.dateTo].filter(Boolean).join('..');
  return { label, matched: matched.size, total: targets.length };
}

/**
 * Pure function: evaluates per-attribute progress state using ONLY:
 * - current page URL
 * - action lineage history (tools + text values + urls)
 * Returns undefined when goal parses to no requirements.
 */
export function evaluateGoalProgress(
  goal: string,
  context: { url?: string; lineage?: CompressedLineage; lang?: string },
): PlannerGoalProgress | undefined {
  const reqs = parseGoalRequirements(goal);
  if (!reqs) {
    return undefined;
  }

  const entries: GoalProgressEntry[] = [];
  const decodedUrl = context.url ? decodeUrl(context.url) : '';
  const lineageSteps = context.lineage?.steps ?? [];

  // 1. Destination
  if (reqs.destination) {
    const destLower = reqs.destination.toLowerCase();
    const typedState = latestCompletedTypeState(lineageSteps, destLower, reqs.destination);

    let state = typedState ?? 'NOT_SET';
    if (state === 'NOT_SET' && decodedUrl.toLowerCase().includes(destLower)) {
      state = 'in_url';
    }
    entries.push({ key: 'destination', state });
  }

  // 2. DestinationTo (if parsed, e.g. for flights)
  if (reqs.destinationTo) {
    const destToLower = reqs.destinationTo.toLowerCase();
    const typedState = latestCompletedTypeState(lineageSteps, destToLower, reqs.destinationTo);

    let state = typedState ?? 'NOT_SET';
    if (state === 'NOT_SET' && decodedUrl.toLowerCase().includes(destToLower)) {
      state = 'in_url';
    }
    entries.push({ key: 'destinationTo', state });
  }

  // 3. Dates
  if (reqs.dateFrom || reqs.dateLabel) {
    let state = 'NOT_SET';
    const lowerUrl = decodedUrl.toLowerCase();

    if (reqs.dateFrom && reqs.dateTo) {
      // Range: require both dates in URL (either exact ISO, dateLabel tokens, or checkin/checkout params)
      const hasFrom = lowerUrl.includes(reqs.dateFrom.toLowerCase()) ||
        hasDateTokenInUrl(lowerUrl, reqs.dateFrom, 'checkin');
      const hasTo = lowerUrl.includes(reqs.dateTo.toLowerCase()) ||
        hasDateTokenInUrl(lowerUrl, reqs.dateTo, 'checkout');

      if (hasFrom && hasTo) {
        state = 'in_url';
      }
    } else if (reqs.dateFrom) {
      // Single date: require date in URL
      if (lowerUrl.includes(reqs.dateFrom.toLowerCase())) {
        state = 'in_url';
      }
    }
    if (state === 'NOT_SET' && context.lang) {
      const selection = matchSelectedDatesInLineage(lineageSteps, reqs, context.lang);
      if (selection) {
        state = selection.matched === selection.total
          ? `selected:"${selection.label}"`
          : `partial:"${selection.label}" (${selection.matched}/${selection.total} selected)`;
      }
    }
    entries.push({ key: 'dates', state });
  }

  // 4. Guests
  if (reqs.guestsAdults !== undefined) {
    let state = 'unverified';
    const lowerUrl = decodedUrl.toLowerCase();
    const guestParamRegex = new RegExp(
      `(?:group_adults|adults?|guests?|num_adults|travelers?|pax)=${reqs.guestsAdults}\\b`,
      'i',
    );
    if (guestParamRegex.test(lowerUrl)) {
      state = 'in_url';
    }
    entries.push({ key: 'guests', state });
  }

  // 5. Constraints
  for (const constraint of reqs.constraints) {
    entries.push({ key: constraint, state: 'unverified' });
  }

  // Focus: the first requirement in order [destination, destinationTo, dates, guests] whose state is NOT_SET or unverified
  const focusOrder = ['destination', 'destinationTo', 'dates', 'guests'];
  let focus: string | undefined;
  for (const candidateKey of focusOrder) {
    const entry = entries.find(e => e.key === candidateKey);
    if (entry && (entry.state === 'NOT_SET' || entry.state === 'unverified')) {
      focus = candidateKey;
      break;
    }
  }

  return {
    entries,
    focus,
  };
}

function decodeUrl(rawUrl: string): string {
  try {
    return decodeURIComponent(rawUrl);
  } catch {
    return rawUrl;
  }
}

function hasDateTokenInUrl(url: string, isoDate: string, paramPrefix: string): boolean {
  // Check if param prefix exists and contains date parts
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    const dayNum = parseInt(day, 10).toString();
    const monthNum = parseInt(month, 10).toString();
    const hasParams = url.includes(`${paramPrefix}_year=${year}`) || url.includes(`${paramPrefix}=${year}-${month}-${day}`);
    const hasParts = url.includes(year) && (url.includes(month) || url.includes(monthNum)) && (url.includes(day) || url.includes(dayNum));
    return hasParams || (url.includes(paramPrefix) && hasParts);
  }
  return false;
}
