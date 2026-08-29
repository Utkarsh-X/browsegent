export type AnswerKind = 'number' | 'url' | 'entity' | 'ranked_entity' | 'description' | 'unknown';
export type AnswerRequiredDetail = 'pronunciation' | 'definition' | 'concrete_basic_information';

export interface AnswerContract {
  kind: AnswerKind;
  requiresNonUrlText: boolean;
  requiresRankingEvidence: boolean;
  requiredDetails: AnswerRequiredDetail[];
  reason: string;
}

export interface AnswerValidation {
  ok: boolean;
  reasons: string[];
}

export interface AnswerValidationOptions {
  evidenceText?: string;
}

export function inferAnswerContract(goal: string): AnswerContract {
  const normalized = goal.toLowerCase();
  const requiredDetails = inferRequiredDetails(normalized);

  if (/\b(url|link|website)\b/.test(normalized)) {
    return contract('url', false, false, 'goal_requests_url', requiredDetails);
  }
  if (/\b(count|number|how many|calculate|compute|value|answer)\b/.test(normalized)) {
    return contract('number', false, false, 'goal_requests_numeric_or_direct_answer', requiredDetails);
  }
  if (/\b(most|highest|lowest|largest|smallest|top|latest|newest|oldest|best)\b/.test(normalized)) {
    return contract('ranked_entity', true, true, 'goal_requests_ranked_entity', requiredDetails);
  }
  if (/\b(repo|repository|paper|article|title|name|place|location|company|person|product)\b/.test(normalized)) {
    return contract('entity', true, false, 'goal_requests_named_entity', requiredDetails);
  }
  if (/\b(describe|summary|explain|tell me about)\b/.test(normalized)) {
    return contract('description', true, false, 'goal_requests_description', requiredDetails);
  }
  if (requiredDetails.length > 0) {
    return contract('description', true, false, 'goal_requests_required_details', requiredDetails);
  }
  return contract('unknown', false, false, 'goal_shape_unknown', requiredDetails);
}

export function validateAnswerAgainstContract(
  answer: string,
  contract: AnswerContract,
  options: AnswerValidationOptions = {},
): AnswerValidation {
  const compact = answer.replace(/\s+/g, ' ').trim();
  const reasons: string[] = [];
  if (compact.length === 0) reasons.push('empty_answer');
  if (hasExplicitIncompleteResult(compact)) reasons.push('incomplete_answer');
  if (contract.requiresNonUrlText && isUrlOnly(compact)) reasons.push('url_only_answer_for_named_entity_goal');
  if (contract.kind === 'number' && !/[0-9]/.test(compact)) reasons.push('numeric_goal_without_number');
  if (contract.requiredDetails.includes('pronunciation')) {
    if (!hasConcretePronunciation(compact)) {
      reasons.push('missing_pronunciation_detail');
    } else {
      reasons.push(...missingRegionalPronunciationReasons(compact, options.evidenceText));
    }
  }
  if (contract.requiredDetails.includes('definition') && !hasDefinitionDetail(compact)) {
    reasons.push('missing_definition_detail');
  }
  if (contract.requiredDetails.includes('concrete_basic_information') && !hasConcreteBasicInformation(compact)) {
    reasons.push('missing_concrete_basic_information');
  }
  if (
    contract.requiredDetails.includes('concrete_basic_information')
    && evidenceContainsSpecificLocation(options.evidenceText)
    && !answerIncludesEvidenceLocation(compact, options.evidenceText)
  ) {
    reasons.push('missing_basic_information_location');
  }
  if (
    contract.requiresRankingEvidence
    && options.evidenceText?.trim()
    && !hasRankingEvidence(options.evidenceText)
  ) {
    reasons.push('missing_ranking_evidence');
  }
  return { ok: reasons.length === 0, reasons };
}

function isUrlOnly(value: string): boolean {
  const withoutUrls = value.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim();
  return withoutUrls.length === 0 || /^[/:?=&._#%a-z0-9-]+$/i.test(withoutUrls);
}

function hasExplicitIncompleteResult(value: string): boolean {
  return [
    /\b(?:has|have) not been (?:executed|completed|found|loaded)\b/i,
    /\b(?:unable to|cannot|can't) (?:find|provide|extract|determine|complete|answer)\b/i,
    /\b(?:lowest|cheapest|requested|search|result|answer|option|price|information|details?)\b[^.]{0,60}\bnot currently available\b/i,
  ].some(pattern => pattern.test(value));
}

export function hasConcretePronunciation(value: string): boolean {
  return /\/[^/\s][^/]{2,}\//.test(value)
    || /\bpronounced\s+["']?[^"',.;]{3,}/i.test(value)
    || /\b(uk|us|british|american)\s*:\s*\/[^/]{2,}\//i.test(value);
}

function missingRegionalPronunciationReasons(answer: string, evidenceText: string | undefined): string[] {
  const evidenceRegions = detectRegionalPronunciations(evidenceText ?? '');
  if (evidenceRegions.length === 0) {
    return [];
  }

  return evidenceRegions
    .filter(region => !hasRegionalPronunciation(answer, region))
    .map(region => `missing_pronunciation_variant_${region}`);
}

function detectRegionalPronunciations(value: string): Array<'uk' | 'us'> {
  const regions: Array<'uk' | 'us'> = [];
  if (/\b(uk|british)\b[^/]{0,140}\/[^/]{2,}\//i.test(value)) {
    regions.push('uk');
  }
  if (/\b(us|american)\b[^/]{0,140}\/[^/]{2,}\//i.test(value)) {
    regions.push('us');
  }
  return regions;
}

function hasRegionalPronunciation(value: string, region: 'uk' | 'us'): boolean {
  const label = region === 'uk' ? '(?:uk|british)' : '(?:us|american)';
  return new RegExp(`\\b${label}\\b[^/]{0,80}/[^/]{2,}/`, 'i').test(value)
    || new RegExp(`/[^/]{2,}/[^a-z]{0,40}\\b${label}\\b`, 'i').test(value);
}

export function hasDefinitionDetail(value: string): boolean {
  return [
    /\b(definition|defined as|meaning|means|is a noun|is an adjective|is a verb)\b/i,
    /\bthe (?:quality|ability|act|state|capacity|process|practice|condition|property|concept|measure) of\b/i,
    /\bis (?:the|a|an) (?:quality|ability|act|state|capacity|process|practice|condition|property|concept|measure|noun|adjective|verb|term|word)\b/i,
  ].some(pattern => pattern.test(value));
}

export function hasRankingEvidence(value: string): boolean {
  const lines = value.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.some(line => hasRankingEvidence(line));
  }

  const normalized = lines[0] ?? '';
  if (!normalized) return false;

  // Exclude pure sort/filter control dropdowns or headers with no entity/value attached
  const isPureControl = /^(?:sort|order|filter|group|arrange)\s+(?:by|results\s+by)\s*:[^0-9]*$/i.test(normalized)
    || /^(?:sort\s+results\s+by|sort\s+by|order\s+by|filter\s+by)\b[^0-9]{0,60}$/i.test(normalized);
  if (isPureControl) {
    return false;
  }

  // 1. Ordinal rank (e.g. "#1", "top 10", "rank 1", "1st result")
  const hasOrdinalRank = /(?:^|\s)#\d+\b|\b(?:top\s+\d+|rank(?:ed)?\s*#?\d+|1st|2nd|3rd|[4-9]th)\b/i.test(normalized);

  // 2. Order signal + Dimension signal attached to concrete values (e.g. "Highest rated: 4.9", "Cheapest flight: $120", "Most stars: 98.4k")
  const hasOrderSignal = /\b(?:sorted|rank(?:ed|ing)?|ordered|top|highest|lowest|most|least|cheapest|latest|newest|oldest|best)\b/i.test(normalized);
  const hasDimensionSignal = /\b(?:stars?|rating|reviews?|price|cost|fee|score|position|rank)\b|[$€£¥₹]\s*\d/i.test(normalized);
  const hasConcreteValue = /[:\d$€£]|\b(?:preprint|paper|repository|repo|hotel|place|item|product|author|title)\b/i.test(normalized);

  return hasOrdinalRank || (hasOrderSignal && hasDimensionSignal && hasConcreteValue && !isPureControl);
}

export const BASIC_INFO_SIGNALS = [
  // 0. Hours / Schedule: requires actual temporal schedule values
  /\b(?:open\s+24\s*hours?|open\s+now|closed\s+now|open\s+daily|closed\s+on\s+[a-z]+|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|hours?\s*:\s*(?:[^\n,;]{2,30}\d|open|closed))\b/i,

  // 1. Phone / Contact: requires actual phone digits
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\b(?:phone|tel(?:ephone)?)\s*:\s*\+?\d[\d\s().-]{5,}\d/i,

  // 2. Address / Location: requires street address, City/State/Zip, or explicit address value
  /\b\d{1,5}\s+[A-Z][a-z0-9\s.,'-]+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|lane|way|pkwy|parkway|hwy|highway)\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?\b|\baddress\s*:\s*[A-Z0-9][^\n,;]{4,}|\bin\s+[A-Z][a-z]+,\s*[A-Z]{2}\b/i,

  // 3. Rating / Reviews: requires concrete score or count
  /\b[1-5](?:\.\d)?\s*(?:\/\s*5|\s*stars?|\s*out of 5)\b|\b(?:\d{1,3}(?:,\d{3})+|\d+)\s+(?:reviews?|ratings?)\b|[★☆]{3,5}|\brating\s*:\s*[1-5](?:\.\d)?/i,

  // 4. Price / Fee: requires currency amount or explicit free entry statement
  /[$€£¥₹]\s*\d+(?:\.\d{2})?(?:\s*(?:k|m|million|billion|per\s+[a-z]+|\/|\+))?|\b\d+(?:\.\d{2})?\s*(?:usd|eur|gbp|dollars?|cents?)\b|\b(?:free\s+admission|free\s+entry|no\s+(?:fee|admission|cost)|admission\s+is\s+free)\b|\b(?:entry|admission|ticket|fee|price|cost)\s*:\s*(?:[$€£¥₹]\s*\d+|free|none)/i,
];

export function hasConcreteBasicInformation(value: string): boolean {
  return BASIC_INFO_SIGNALS.filter(signal => signal.test(value)).length >= 2;
}

function evidenceContainsSpecificLocation(evidenceText: string | undefined): boolean {
  return extractSpecificLocations(evidenceText ?? '').length > 0;
}

function answerIncludesEvidenceLocation(answer: string, evidenceText: string | undefined): boolean {
  const answerTokens = new Set(tokenizePlace(answer));
  return extractSpecificLocations(evidenceText ?? '').some(location => {
    const tokens = tokenizePlace(location);
    if (tokens.length === 0) return false;
    return tokens.every(token => answerTokens.has(token));
  });
}

function extractSpecificLocations(value: string): string[] {
  // Remove Plus code lines which contain supplementary geocoding sub-locations
  const cleaned = value.replace(/Plus\s+code:\s*\S+\s+/gi, '');
  return [...cleaned.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:[A-Z][a-z]+|[A-Z]{2})(?:,\s*(?:USA|United States|United States of America))?/g)]
    .map(match => match[0])
    .filter(location => tokenizePlace(location).length >= 2);
}

function tokenizePlace(value: string): string[] {
  return expandStateAbbreviations(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !['usa', 'united', 'states', 'america'].includes(token));
}

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

function expandStateAbbreviations(value: string): string {
  return value.replace(/\b([A-Z]{2})\b/g, (match) =>
    US_STATE_ABBREVIATIONS[match] ?? match,
  );
}

function inferRequiredDetails(normalizedGoal: string): AnswerRequiredDetail[] {
  const details: AnswerRequiredDetail[] = [];
  if (/\b(pronunciation|pronounce|pronounced)\b/.test(normalizedGoal)) {
    details.push('pronunciation');
  }
  if (/\b(definition|meaning|means)\b/.test(normalizedGoal)) {
    details.push('definition');
  }
  if (/\bbasic\s+(information|info)\b/.test(normalizedGoal)) {
    details.push('concrete_basic_information');
  }
  return details;
}

function contract(
  kind: AnswerKind,
  requiresNonUrlText: boolean,
  requiresRankingEvidence: boolean,
  reason: string,
  requiredDetails: AnswerRequiredDetail[],
): AnswerContract {
  return {
    kind,
    requiresNonUrlText,
    requiresRankingEvidence,
    requiredDetails,
    reason,
  };
}
