export interface GroundingConflict {
  /** The claim exactly as it appears in the draft answer, e.g. "$120". */
  claim: string;
  /** A different value of the same kind found in read evidence, e.g. "$100". */
  evidenceValue: string;
  /** The shared dimension that locates both values, e.g. "per_year" or "renewal discount". */
  dimension: string;
}

export interface AnswerGroundingResult {
  conflicts: GroundingConflict[];
}

interface NumericClaim {
  raw: string;
  numericValue: number;
  kind: 'money' | 'percent';
  symbol?: string;
  contextLower: string;
  /** Offset of the occurrence inside the full text. */
  index: number;
  /** Start offset of the captured context window inside the full text. */
  windowStart: number;
}

const MONEY_PATTERN = /[$€£₹]\s?\d[\d,]*(?:\.\d+)?/g;
const PERCENT_PATTERN = /\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b)/gi;

/** Context window inspected around each occurrence when relating claims to evidence. */
const CONTEXT_WINDOW = 48;
/** Minimum token length considered meaningful when matching percent contexts. */
const MIN_CONTEXT_TOKEN_LENGTH = 4;
/** Upper bound on reported conflicts to keep planner feedback bounded. */
const MAX_CONFLICTS = 4;

// Patterns MUST be global: resolveDimension iterates exec() to locate every rate
// keyword; a non-global regex would never advance lastIndex and loop forever.
const MONEY_DIMENSIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'per_year', pattern: /\b(?:per|\/)\s?(?:year|yr)\b|\bannum\b|\bannually\b|\byearly\b/gi },
  { name: 'per_month', pattern: /\b(?:per|\/)\s?month\b|\bmonthly\b/gi },
];

const GENERIC_CONTEXT_TOKENS = new Set([
  'with', 'this', 'that', 'from', 'have', 'will', 'your', 'their', 'them',
  'then', 'than', 'when', 'what', 'which', 'would', 'could', 'should',
  'there', 'these', 'those', 'been', 'also', 'into', 'over',
]);

/**
 * Deterministic answer-vs-read grounding check.
 *
 * Extracts money and percent claims from a drafted answer and reports values that
 * contradict same-dimension values present in captured read evidence. The check is
 * purely textual: it never judges intent and only fires when the claimed value is
 * absent from the evidence while a conflicting value of the same kind shares its
 * dimension. Money claims must share an explicit rate dimension (e.g. both
 * "per year"); percent claims must share surrounding vocabulary. The planner
 * decides how (or whether) to reconcile.
 */
export function detectAnswerEvidenceConflicts(answer: string, evidenceText: string | undefined): AnswerGroundingResult {
  const conflicts: GroundingConflict[] = [];
  if (!answer.trim() || !evidenceText?.trim()) {
    return { conflicts };
  }

  const evidenceClaims = extractClaims(evidenceText);
  const evidenceValues = new Set(evidenceClaims.map(claim => claim.numericValue));

  for (const claim of extractClaims(answer)) {
    if (conflicts.length >= MAX_CONFLICTS) break;
    // A value the reads actually contain can never contradict them.
    if (evidenceValues.has(claim.numericValue)) continue;
    // Money without an explicit rate dimension is too ambiguous to contradict anything.
    if (claim.kind === 'money' && !resolveDimension(claim)) continue;

    const conflict = findConflict(claim, evidenceClaims);
    if (conflict) conflicts.push(conflict);
  }

  return { conflicts };
}

function findConflict(claim: NumericClaim, evidenceClaims: NumericClaim[]): GroundingConflict | undefined {
  let best: { match: NumericClaim; dimension: string } | undefined;
  for (const candidate of evidenceClaims) {
    if (candidate.numericValue === claim.numericValue) continue;
    if (candidate.kind !== claim.kind || candidate.symbol !== claim.symbol) continue;
    const dimension = sharedDimension(claim, candidate);
    if (!dimension) continue;
    if (!best) best = { match: candidate, dimension };
  }
  if (!best) return undefined;
  return { claim: claim.raw, evidenceValue: best.match.raw, dimension: best.dimension };
}

function sharedDimension(claim: NumericClaim, candidate: NumericClaim): string | undefined {
  if (claim.kind === 'money') {
    const claimDimension = resolveDimension(claim);
    return claimDimension && claimDimension === resolveDimension(candidate) ? claimDimension : undefined;
  }
  const shared = sharedContextTokens(claim.contextLower, candidate.contextLower);
  return shared.length > 0 ? shared.slice(0, 3).join(' ') : undefined;
}

/**
 * Resolves the explicit rate dimension nearest to the claimed value inside its
 * captured context window ("$100 USD per year" -> per_year).
 *
 * Positional, not center-distance: windows routinely contain a NEIGHBORING
 * pair's keyword too ("$10 per month or $100 per year"), and rate phrases
 * follow their value far more often than they precede it. Keywords after the
 * value therefore win ties against keywords before it (FOLLOW_BIAS).
 */
const FOLLOW_BIAS = 2;

function resolveDimension(claim: NumericClaim): string | undefined {
  const valueStart = claim.index - claim.windowStart;
  const valueEnd = valueStart + claim.raw.length;
  let best: { name: string; gap: number } | undefined;
  for (const dimension of MONEY_DIMENSIONS) {
    dimension.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dimension.pattern.exec(claim.contextLower)) !== null) {
      const keywordStart = match.index;
      const keywordEnd = match.index + match[0].length;
      let gap: number;
      let before = false;
      if (keywordStart >= valueEnd) {
        gap = keywordStart - valueEnd;
      } else if (keywordEnd <= valueStart) {
        gap = valueStart - keywordEnd;
        before = true;
      } else {
        gap = 0; // keyword directly wraps the value
      }
      const effectiveGap = before ? gap * FOLLOW_BIAS : gap;
      if (!best || effectiveGap < best.gap) best = { name: dimension.name, gap: effectiveGap };
    }
  }
  return best?.name;
}

function extractClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  for (const [pattern, kind] of [[MONEY_PATTERN, 'money'], [PERCENT_PATTERN, 'percent']] as const) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const numericPart = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
      const numericValue = Number.parseFloat(numericPart);
      if (!Number.isFinite(numericValue)) continue;
      claims.push({
        raw,
        numericValue,
        kind,
        symbol: kind === 'money' ? raw[0] : undefined,
        index: match.index,
        ...windowAround(text, match.index, raw.length),
      });
    }
  }
  return claims;
}

function windowAround(text: string, index: number, length: number): { contextLower: string; windowStart: number } {
  const windowStart = Math.max(0, index - CONTEXT_WINDOW);
  return {
    contextLower: text.slice(windowStart, Math.min(text.length, index + length + CONTEXT_WINDOW)).toLowerCase(),
    windowStart,
  };
}

function sharedContextTokens(left: string, right: string): string[] {
  const leftTokens = contextTokens(left);
  const rightTokens = new Set(contextTokens(right));
  return [...leftTokens].filter(token => rightTokens.has(token));
}

function contextTokens(context: string): string[] {
  return context
    .split(/[^a-z]+/)
    .filter(token => token.length >= MIN_CONTEXT_TOKEN_LENGTH && !GENERIC_CONTEXT_TOKENS.has(token));
}
