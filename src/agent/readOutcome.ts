import type { Action } from '../executor/types';
import type { ActionHistoryEntry } from '../graph/serializer';

export type ReadOutcome = 'answer_evidence' | 'context_only' | 'noise_repeat';

export interface ReadOutcomeAssessment {
  outcome: ReadOutcome;
  normalizedValue?: string;
  sameValueCount: number;
}

interface ClassifyReadOutcomeInput {
  action: Action;
  value?: string;
  goal: string;
  history: ActionHistoryEntry[];
  graphFingerprint?: string;
}

const CURRENCY_PATTERN = /(?:[$€£₹]|usd|eur|gbp|inr|aud|cad)\s?\d[\d,]*(?:\.\d+)?/i;
const COUNT_PATTERN = /\b\d[\d,]*(?:\.\d+)?\b/;
const NOT_FOUND_PATTERN = /\b(not found|no matches found|found 0 elements|count for ".+": 0|invalid css selector|scope selector not found)\b/i;
const REGION_SUMMARY_PATTERN = /^Region ".+" contains \d+ notable node/i;
const FIND_ELEMENTS_SUMMARY_PATTERN = /^Found \d+ elements? matching ".+"/i;
const SEARCH_SUMMARY_PATTERN = /^Found \d+ matches? for ".+"/i;
const COUNT_SUMMARY_PATTERN = /^Count for ".+": \d+/i;
const EXISTENCE_GOAL_PATTERN = /\b(exist|exists|is there|whether|present|contains?)\b/i;
const COUNT_GOAL_PATTERN = /\b(how many|count|number of|total)\b/i;
const PRICE_GOAL_PATTERN = /\b(price|cost|salary|amount|rate|fare)\b/i;
const IDENTITY_GOAL_PATTERN = /\b(title|name|headline|company|who|which|what)\b/i;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'what',
  'which',
  'who',
  'how',
  'many',
  'count',
  'number',
  'total',
  'first',
  'top',
  'page',
  'shown',
  'listed',
  'after',
  'next',
  'results',
  'visible',
  'today',
  'main',
  'get',
]);
const OBSERVATION_PREFIX_PATTERN = /^(Found \d+|Region ".+" contains|Region text:|Count for ".+": \d+)/i;
const FIND_TEXT_QUOTED_PATTERN = /text=(?:"([^"]+)"|'([^']+)')/i;

export function classifyReadOutcome(input: ClassifyReadOutcomeInput): ReadOutcomeAssessment {
  const rawValue = input.value?.trim();
  const normalizedValue = normalizeReadValue(rawValue);
  if (!normalizedValue) {
    return {
      outcome: 'noise_repeat',
      normalizedValue: undefined,
      sameValueCount: 1,
    };
  }

  const sameValueCount = countSameObservationValue(input, normalizedValue) + 1;
  const outcome = inferReadOutcome(input.action, normalizedValue, input.goal, sameValueCount);

  return {
    outcome,
    normalizedValue,
    sameValueCount,
  };
}

export function isLowValueReadOutcome(outcome: ReadOutcome | undefined): boolean {
  return outcome === 'context_only' || outcome === 'noise_repeat';
}

export function readOutcomePriority(outcome: ReadOutcome | undefined): number {
  if (outcome === 'answer_evidence') return 3;
  if (outcome === 'context_only') return 2;
  if (outcome === 'noise_repeat') return 1;
  return 0;
}

export function inferReadOutcomeWithoutGoal(
  action: string,
  value: string | undefined,
): ReadOutcome | undefined {
  const normalized = normalizeReadValue(value);
  if (!normalized) {
    return undefined;
  }
  return inferReadOutcomeFromPatterns(action, normalized, 1);
}

export function extractAnswerCandidate(goal: string, value: string | undefined): string | undefined {
  const expanded = normalizeExpandedReadValue(value);
  if (!expanded) {
    return undefined;
  }

  if (PRICE_GOAL_PATTERN.test(goal)) {
    const currencyMatch = expanded.match(CURRENCY_PATTERN)?.[0];
    if (currencyMatch) {
      return cleanCandidate(currencyMatch);
    }
  }

  if (COUNT_GOAL_PATTERN.test(goal) || EXISTENCE_GOAL_PATTERN.test(goal)) {
    const countMatch = expanded.match(/Count for ".+":\s*(\d[\d,]*(?:\.\d+)?)/i)?.[1];
    if (countMatch) {
      return cleanCandidate(countMatch);
    }
    const numberMatch = expanded.match(COUNT_PATTERN)?.[0];
    if (numberMatch) {
      return cleanCandidate(numberMatch);
    }
  }

  if (IDENTITY_GOAL_PATTERN.test(goal)) {
    const foundText = expanded.match(FIND_TEXT_QUOTED_PATTERN);
    const quotedText = foundText?.[1] ?? foundText?.[2];
    if (quotedText) {
      const candidate = cleanCandidate(quotedText);
      if (candidate.length >= 5) {
        return candidate;
      }
    }

    if (!OBSERVATION_PREFIX_PATTERN.test(expanded)) {
      const firstLine = cleanCandidate((expanded.split('\n')[0] ?? expanded).slice(0, 140));
      if (firstLine.length >= 5) {
        return firstLine;
      }
    }
  }

  const compact = normalizeReadValue(expanded);
  if (!compact) {
    return undefined;
  }
  const fallback = cleanCandidate(compact.slice(0, 120));
  if (fallback.length >= 5 && !OBSERVATION_PREFIX_PATTERN.test(fallback)) {
    return fallback;
  }

  return undefined;
}

function countSameObservationValue(input: ClassifyReadOutcomeInput, normalizedValue: string): number {
  const selector = getActionHistoryKey(input.action);
  if (!selector) {
    return 0;
  }
  return input.history.filter(entry =>
    entry.result === 'ok'
    && entry.action === input.action.kind
    && entry.selector === selector
    && (
      !input.graphFingerprint
      || !entry.graphFingerprint
      || entry.graphFingerprint === input.graphFingerprint
    )
    && normalizeReadValue(entry.value ?? entry.effect?.targetValue) === normalizedValue,
  ).length;
}

function inferReadOutcome(
  action: Action,
  normalizedValue: string,
  goal: string,
  sameValueCount: number,
): ReadOutcome {
  const patternOnly = inferReadOutcomeFromPatterns(action.kind, normalizedValue, sameValueCount);
  if (patternOnly === 'noise_repeat') {
    return patternOnly;
  }

  if (action.kind === 'count_elements') {
    if (COUNT_GOAL_PATTERN.test(goal) || EXISTENCE_GOAL_PATTERN.test(goal)) {
      return 'answer_evidence';
    }
    return sameValueCount >= 3 ? 'noise_repeat' : 'context_only';
  }

  if (action.kind === 'get') {
    return 'answer_evidence';
  }

  if (isLikelyAnswerEvidenceForGoal(goal, normalizedValue)) {
    return 'answer_evidence';
  }

  if (patternOnly === 'context_only') {
    return sameValueCount >= 3 ? 'noise_repeat' : 'context_only';
  }

  if (action.kind === 'inspect_region') {
    return sameValueCount >= 2 ? 'noise_repeat' : 'context_only';
  }

  if (sameValueCount >= 3) {
    return 'noise_repeat';
  }

  return 'context_only';
}

function inferReadOutcomeFromPatterns(
  action: string,
  normalizedValue: string,
  sameValueCount: number,
): ReadOutcome | undefined {
  if (NOT_FOUND_PATTERN.test(normalizedValue)) {
    return 'noise_repeat';
  }

  if (action === 'inspect_region') {
    if (REGION_SUMMARY_PATTERN.test(normalizedValue)) {
      return sameValueCount >= 2 ? 'noise_repeat' : 'context_only';
    }
    if (normalizedValue.startsWith('Region text:')) {
      return sameValueCount >= 2 ? 'noise_repeat' : 'context_only';
    }
  }

  if (action === 'find_elements' && FIND_ELEMENTS_SUMMARY_PATTERN.test(normalizedValue)) {
    return sameValueCount >= 3 ? 'noise_repeat' : 'context_only';
  }

  if (action === 'search_page' && SEARCH_SUMMARY_PATTERN.test(normalizedValue)) {
    return sameValueCount >= 3 ? 'noise_repeat' : 'context_only';
  }

  if (action === 'count_elements' && COUNT_SUMMARY_PATTERN.test(normalizedValue)) {
    return sameValueCount >= 3 ? 'noise_repeat' : 'context_only';
  }

  return undefined;
}

function isLikelyAnswerEvidenceForGoal(goal: string, normalizedValue: string): boolean {
  if (PRICE_GOAL_PATTERN.test(goal) && CURRENCY_PATTERN.test(normalizedValue)) {
    return true;
  }

  if (COUNT_GOAL_PATTERN.test(goal) && COUNT_PATTERN.test(normalizedValue)) {
    return true;
  }

  if (EXISTENCE_GOAL_PATTERN.test(goal) && /\b(found \d+ matches?|yes|no)\b/i.test(normalizedValue)) {
    return true;
  }

  if (IDENTITY_GOAL_PATTERN.test(goal)) {
    const overlap = countGoalTokenOverlap(goal, normalizedValue);
    if (overlap >= 2) {
      return true;
    }
  }

  return false;
}

function countGoalTokenOverlap(goal: string, value: string): number {
  const tokens = tokenize(goal);
  if (tokens.length === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of tokens) {
    if (value.includes(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4 && !STOP_WORDS.has(token));
}

export function normalizeReadValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
  return normalized.length > 0 ? normalized : undefined;
}

function getActionHistoryKey(action: Action): string | undefined {
  if (action.kind === 'search_page') {
    if (!action.pattern) {
      return undefined;
    }
    return action.target
      ? `pattern:${action.pattern} @ ${action.target}`
      : `pattern:${action.pattern}`;
  }

  if (action.target) {
    return action.target;
  }

  if (action.kind === 'wait' && action.pattern) {
    return `pattern:${action.pattern}`;
  }

  return undefined;
}

function cleanCandidate(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeExpandedReadValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 4000);
}
