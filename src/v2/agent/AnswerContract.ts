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
  // TODO: Validate requiresRankingEvidence when ranking evidence is available in finalization context.
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

function hasConcretePronunciation(value: string): boolean {
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

function hasDefinitionDetail(value: string): boolean {
  return /\b(definition|defined as|meaning|means|is a noun|is an adjective|is a verb)\b/i.test(value);
}

function hasConcreteBasicInformation(value: string): boolean {
  const signals = [
    /\b(open|closed|hours?|24 hours?)\b/i,
    /\b(phone|contact|call)\b|\+?\d[\d\s().-]{6,}\d/,
    /\b(address|located|location|in [A-Z][a-z]+|,\s*[A-Z]{2}\b|\b\d{5}(?:-\d{4})?\b)/,
    /\b(rating|stars?|reviews?)\b/i,
    /\b(price|cost|fee|ticket)\b/i,
  ];
  return signals.filter(signal => signal.test(value)).length >= 2;
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
