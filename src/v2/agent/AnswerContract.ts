export type AnswerKind = 'number' | 'url' | 'entity' | 'ranked_entity' | 'description' | 'unknown';
export type AnswerRequiredDetail = 'pronunciation' | 'definition' | 'concrete_basic_information';
export type AnswerDetailCategory =
  | 'rating'
  | 'price'
  | 'hours'
  | 'duration'
  | 'date'
  | 'address'
  | 'phone'
  | 'capacity'
  | 'year'
  | 'identity';

export interface AnswerContract {
  kind: AnswerKind;
  requiresNonUrlText: boolean;
  requiresRankingEvidence: boolean;
  requiredDetails: AnswerRequiredDetail[];
  reason: string;
  /** Explicit item-count asks parsed from the goal ('find 5 salons'); undefined when absent. */
  requestedItemCount?: number;
  /** Detail categories the goal asks for; count-completeness gates need >= 2. */
  requestedDetailCategories?: AnswerDetailCategory[];
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
  const base = inferBaseContract(normalized, requiredDetails);
  return {
    ...base,
    requestedItemCount: parseRequestedItemCount(normalized),
    requestedDetailCategories: parseRequestedDetailCategories(normalized),
  };
}

function inferBaseContract(normalized: string, requiredDetails: AnswerRequiredDetail[]): AnswerContract {
  if (/\b(url|link|website)\b/.test(normalized)) {
    return contract('url', false, false, 'goal_requests_url', requiredDetails);
  }
  if (/\b(count|number|how many|calculate|compute|value|answer)\b/.test(normalized)) {
    return contract('number', false, false, 'goal_requests_numeric_or_direct_answer', requiredDetails);
  }
  if (isComparativeRankingGoal(normalized)) {
    return contract('ranked_entity', true, true, 'goal_requests_ranked_entity', requiredDetails);
  }
  if (/\b(repo|repository|paper|preprints?|article|title|name|place|location|company|person|product)\b/.test(normalized)) {
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
  ) {
    if (!hasRankingEvidence(options.evidenceText)) {
      reasons.push('missing_ranking_evidence');
    } else if (contract.kind === 'ranked_entity') {
      const topEntities = extractTopRankedEntitiesFromEvidence(options.evidenceText);
      if (topEntities.length > 0 && !topEntities.some(entity => answerIncludesEntity(compact, entity))) {
        reasons.push('answer_does_not_match_top_ranked_evidence');
      }
    }
  }
  if (contract.requestedItemCount !== undefined && contract.requestedItemCount >= 2) {
    reasons.push(...checkRequestedItemCount(compact, contract.requestedItemCount));
  }
  if ((contract.requestedDetailCategories?.length ?? 0) >= 2) {
    reasons.push(...missingDetailCategoryReasons(compact, contract.requestedDetailCategories!));
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Generic enumerable nouns used by item-count asks. A vocabulary of common
 * result-list nouns keeps the count parser high-precision: '2 miles' or
 * 'between $100 to $200' must never read as item counts.
 */
const ENUMERABLE_NOUNS = new Set([
  'salons', 'hotels', 'motels', 'games', 'matches', 'teams', 'movies', 'songs', 'restaurants',
  'stores', 'options', 'results', 'flights', 'books', 'papers', 'articles', 'courses', 'models',
  'tools', 'apps', 'links', 'places', 'items', 'recipes', 'chapters', 'characters', 'colors',
  'gyms', 'chargers', 'stations', 'reviews', 'repos', 'repositories', 'products', 'titles',
  'videos', 'channels', 'playlists', 'podcasts', 'tracks', 'albums', 'actors', 'players',
  'events', 'attractions', 'museums', 'parks', 'airports', 'airlines', 'names', 'climbs',
]);

const SPELLED_NUMBERS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const REQUEST_ITEM_COUNT_PATTERNS: RegExp[] = [
  /\b(?:find|list|show|give|name|get|identify|check|locate)\b[^.?!]{0,40}?\b(\d{1,2})\s+(?:[a-z]+\s+){0,2}?([a-z]{3,}s)\b/i,
  /\b(?:find|list|show|give|name|get|identify|check|locate)\b[^.?!]{0,40}?\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:[a-z]+\s+){0,2}?([a-z]{3,}s)\b/i,
  /\btop\s+(\d{1,2})\s+(?:[a-z]+\s+){0,2}?([a-z]{3,}s)\b/i,
  /\b(?:first|latest)\s+(\d{1,2})\s+(?:[a-z]+\s+){0,2}?([a-z]{3,}s)\b/i,
];

/** Parses an explicit item-count ask ('find 5 salons', 'top 10 songs') from the goal. */
export function parseRequestedItemCount(goal: string): number | undefined {
  for (const pattern of REQUEST_ITEM_COUNT_PATTERNS) {
    const match = goal.match(pattern);
    if (!match) continue;
    const rawCount = match[1];
    const noun = (match[2] ?? '').toLowerCase();
    if (!ENUMERABLE_NOUNS.has(noun)) continue;
    const count = /^\d+$/.test(rawCount) ? Number(rawCount) : SPELLED_NUMBERS[rawCount];
    if (count !== undefined && count >= 2) return count;
  }
  return undefined;
}

function checkRequestedItemCount(answer: string, requested: number): string[] {
  // Explicit fewer-than admissions are the most reliable incompleteness signal.
  const admissions = [...answer.matchAll(/\b(?:only|just)\s+(\d{1,2})\b|\b(?:fewer|less)\s+than\s+(\d{1,2})\b/gi)];
  for (const admission of admissions) {
    const found = Number(admission[1] ?? admission[2]);
    if (Number.isFinite(found) && found < requested) {
      return [`requested_item_count_missing:requested_${requested}_answered_${found}`];
    }
  }
  // Enumerated entries are counted only when the answer uses explicit list
  // markers; prose answers are not counted (conservative: no false rejections).
  const enumerated = countEnumeratedItems(answer);
  if (enumerated >= 1 && enumerated < requested) {
    return [`requested_item_count_missing:requested_${requested}_answered_${enumerated}`];
  }
  return [];
}

function countEnumeratedItems(answer: string): number {
  const newlineMarkers = [...answer.matchAll(/(?:^|\n)[ \t]*(?:\d{1,2}[.)]|[a-z][.)]|[-•*])\s+/gi)].length;
  const inlineNumbers = new Set(
    [...answer.matchAll(/(?:^|[\s(])(\d{1,2})[.)]\s+/g)].map(match => match[1]),
  ).size;
  return Math.max(newlineMarkers, inlineNumbers);
}

/** Detail categories recognized in goals; each maps to concrete answer-value patterns. */
const DETAIL_CATEGORY_GOAL_PATTERNS: ReadonlyArray<readonly [AnswerDetailCategory, RegExp]> = [
  ['rating', /\bratings?\b|\bstars?\b/i],
  ['price', /\bpric(?:e|es|ing)\b|\bcosts?\b|\bcheap(?:est)?\b|\bbudget\b|\bfees?\b/i],
  ['hours', /\b(?:opening|operating)\s+hours?\b|\bhours\b/i],
  ['duration', /\bhow\s+long\b|\bduration\b|\blength\b/i],
  ['date', /\bdates?\b|\bwhen\b|\bdeadline\b/i],
  ['address', /\baddress\b|\blocation\b|\blocated\b/i],
  ['phone', /\bphone\b|\btelephone\b|\bcontact\b/i],
  ['capacity', /\bstorage\b|\bmemory\b|\bdisk\b|\bram\b|\bcapacity\b|\bseats?\b|\bquarts?\b|\bsizes?\b/i],
  // Only an explicit question about a year counts — adjectival mentions
  // ("2-year protection plan", "yearly subscription") are not year asks.
  ['year', /\b(?:what|which)\s+year\b|\b(?:release|launch|publication|copyright)\s+year\b/i],
  ['identity', /\binstructor\b|\binstitution\b|\buniversity\b|\bschool\b|\bauthors?\b|\bbrands?\b|\bairline\b|\bprovider\b|\bpublisher\b|\bmanufacturer\b|\bcompany\b/i],
];

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

const DETAIL_CATEGORY_ANSWER_PATTERNS: Record<AnswerDetailCategory, RegExp[]> = {
  rating: [/\b[1-5](?:\.\d)?[-\s]*(?:\/\s*5|[-\s]*stars?|out of 5)\b/i, /\brating\s*:\s*[1-5](?:\.\d)?/i, /[★☆]/, /\b[1-9](?:\.\d)?\s*\/\s*10\b/],
  price: [/[$€£¥₹]\s*\d/i, /\b\d+(?:\.\d{2})?\s*(?:usd|eur|gbp|inr|dollars?|rupees?|pounds?)\b/i, /\bfree\b/i],
  hours: [/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\b/i, /\bhours?\s*:\s*\d/i, /\b\d+(?:\.\d+)?\s*hours?\b/i, /\b\d{1,2}:\d{2}\b/],
  duration: [/\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?)\b/i],
  date: [/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i, /\b\d{4}-\d{2}-\d{2}\b/i],
  address: [BASIC_INFO_SIGNALS[2]],
  phone: [BASIC_INFO_SIGNALS[1]],
  capacity: [/\b\d+\s*(?:gb|tb|mb|kg|lb|oz|quarts?|qt|inches?|inch|cm|mm|miles?|mi|cups?)\b/i, /\b\d+\s*(?:seats?|people|persons?)\b/i],
  year: [/\b(?:19|20)\d{2}\b/],
  identity: [/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/, /\b(?:by|from|at|instructor)\s+[A-Z][a-z]{2,}/i, /\b(?:instructor|institution|university|author|brand|airline|provider|publisher|manufacturer)\s*:\s*\S+/i],
};

/** Parses which detail categories the goal asks for; count-completeness gates at >= 2. */
export function parseRequestedDetailCategories(goal: string): AnswerDetailCategory[] {
  const categories: AnswerDetailCategory[] = [];
  for (const [category, pattern] of DETAIL_CATEGORY_GOAL_PATTERNS) {
    if (pattern.test(goal) && !categories.includes(category)) {
      categories.push(category);
    }
  }
  return categories;
}


function missingDetailCategoryReasons(answer: string, categories: AnswerDetailCategory[]): string[] {
  const missing: string[] = [];
  for (const category of categories) {
    const patterns = DETAIL_CATEGORY_ANSWER_PATTERNS[category];
    if (!patterns.some(pattern => pattern.test(answer))) {
      missing.push(`missing_requested_detail_${category}`);
    }
  }
  return missing;
}

/**
 * True when the answer looks like it delivers concrete results (enumerated
 * items, ratings, prices, times, dates, named entities). Used by the
 * requirement-completion gate: a results-shaped answer from a flow whose
 * parsed requirements never completed is suspect.
 */
export function hasResultClaimSignal(answer: string): boolean {
  if (countEnumeratedItems(answer) >= 1) return true;
  return Object.values(DETAIL_CATEGORY_ANSWER_PATTERNS)
    .some(patterns => patterns.some(pattern => pattern.test(answer)));
}

const ADVISORY_REASON_PREFIXES = [
  'requested_item_count_missing:',
  'missing_requested_detail_',
  'requirements_unaddressed:',
];

/**
 * Splits contract reasons into hard (long-standing answer-shape failures that
 * must reject a done) and advisory (completeness/completion heuristics that
 * steer once but must never destroy an otherwise-delivered answer — the model
 * may simply be unable to satisfy them, and a recorded imperfect answer
 * outperforms a catastrophic run failure).
 */
export function partitionAnswerContractReasons(reasons: string[]): {
  hardReasons: string[];
  advisoryReasons: string[];
} {
  const hardReasons: string[] = [];
  const advisoryReasons: string[] = [];
  for (const reason of reasons) {
    if (ADVISORY_REASON_PREFIXES.some(prefix => reason.startsWith(prefix))) {
      advisoryReasons.push(reason);
    } else {
      hardReasons.push(reason);
    }
  }
  return { hardReasons, advisoryReasons };
}

function isComparativeRankingGoal(normalizedGoal: string): boolean {
  // Temporal recency is a lookup constraint, not proof that the task asks for
  // a comparison. Keep explicit comparative terms and top-N/result language.
  const withoutTemporalTerms = normalizedGoal
    .replace(/\bmost\s+recent(?:ly)?\b/g, ' ')
    .replace(/\b(?:latest|newest|oldest)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasComparativeTerm = /\b(?:most|highest|lowest|largest|smallest|top|best|cheapest|least)\b/.test(withoutTemporalTerms);
  if (!hasComparativeTerm) return false;

  // Guidance questions use "best" without selecting a result from a set.
  if (/\bbest\s+(?:way|practice|practices|approach|method|methods)\b/.test(withoutTemporalTerms)) {
    return false;
  }

  const hasExplicitTopResults = /\btop\s+(?:\d+|results?|items?|options?|entries?)\b/.test(withoutTemporalTerms);
  const hasComparisonDimension = /\b(?:starred?|stars?|rating|reviews?|price|cost|fee|score|rank(?:ed|ing)?|results?|options?)\b|[$€£¥₹]\s*\d/.test(withoutTemporalTerms);
  const hasSelectionIntent = /\b(?:which|what|find|identify|select|choose|name|list)\b/.test(withoutTemporalTerms);

  return hasExplicitTopResults || hasComparisonDimension || hasSelectionIntent;
}

export function extractTopRankedEntitiesFromEvidence(evidenceText: string): string[] {
  const entities: string[] = [];
  const lines = evidenceText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/\[Card\s+\d+:\s+Rank\s+#1\s+\|\s+([^|]+?)(?:\s+\||\])/i);
    if (match && match[1]) {
      const entity = match[1].trim();
      if (entity && !entities.includes(entity)) {
        entities.push(entity);
      }
    }
  }
  return entities;
}

export function answerIncludesEntity(answer: string, entity: string): boolean {
  const normAnswer = answer.toLowerCase().replace(/[-_/]/g, ' ');
  const normEntity = entity.toLowerCase().replace(/[-_/]/g, ' ');
  if (normAnswer.includes(normEntity) || normAnswer.includes(entity.toLowerCase())) {
    return true;
  }
  if (entity.includes('/')) {
    const [, repo] = entity.split('/');
    if (repo && repo.length >= 3 && normAnswer.includes(repo.toLowerCase().replace(/[-_]/g, ' '))) {
      return true;
    }
  }
  return false;
}

function isUrlOnly(value: string): boolean {
  const withoutUrls = value.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim();
  return withoutUrls.length === 0 || /^[/:?=&._#%a-z0-9-]+$/i.test(withoutUrls);
}

function hasExplicitIncompleteResult(value: string): boolean {
  return [
    /\b(?:has|have) not been (?:executed|completed|found|loaded)\b/i,
    /\b(?:have|has) not yet (?:performed|booked|executed|completed|entered|selected|searched)\b/i,
    /\b(?:is|are) not yet complete\b/i,
    /\b(?:need|needs) to (?:input|enter|select|execute|perform|book)\b/i,
    /\b(?:unable to|cannot|can't) (?:find|provide|extract|determine|complete|answer)\b/i,
    /\b(?:lowest|cheapest|requested|search|result|answer|option|price|information|details?)\b[^.]{0,60}\bnot currently available\b/i,
    /\bplease (?:provide|enter|select|input|interact|proceed)\b/i,
    /\b(?:you can|please)\s+(?:now\s+)?proceed with (?:your\s+)?(?:search|booking|request|selection)\b/i,
    /\bif you would like me to\b/i,
    /\b(?:i can|allow me to)\s+(?:escalate|attempt|proceed)\b/i,
    // Honest unavailability reports (404s, gone pages) are valid terminal
    // answers when the target itself does not exist; the strict matcher and
    // judge still assess the content.
    /\bsecurity verification page\b/i,
    /\b(?:captcha|cloudflare)\b/i,
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
