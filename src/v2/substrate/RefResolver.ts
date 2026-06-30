import type { Locator, Page } from 'playwright';

import { V2OperationalError } from '../runtime/errors';
import type { V2Ref } from '../runtime/types';

const MAX_CANDIDATES_PER_SELECTOR = 5;
const MIN_SINGLE_OVERFLOW_CANDIDATE_SCORE = 120;

export interface ResolvedRefTarget {
  locator: Locator;
  resolution: 'unique_selector' | 'semantic_selector';
  diagnostics?: Record<string, unknown>;
}

interface ScoredCandidate {
  locator: Locator;
  score: number;
  identityKey: string;
  diagnostics?: CandidateDiagnostics;
}

interface CandidateDiagnostics {
  tagName: string;
  role: string;
  accessibleName: string;
  nameMatched: boolean;
  textMatched: boolean;
  semanticOrdinal?: number;
  semanticGroupSize: number;
  semanticScope: 'owner_document' | 'unknown';
}

type OrdinalRefusalReason =
  | 'ordinal_metadata_incomplete'
  | 'exact_semantic_group_missing'
  | 'ordinal_out_of_range'
  | 'ordinal_candidate_not_unique'
  | 'semantic_scope_unstable';

type OrdinalSelection =
  | { candidate: ScoredCandidate; semanticGroupSize: number }
  | { ordinalReason: OrdinalRefusalReason; semanticGroupSize?: number };

export class RefResolver {
  async resolve(ref: V2Ref, page: Page): Promise<ResolvedRefTarget> {
    const candidates = new Map<string, ScoredCandidate>();
    let overflowed = false;

    for (const selector of ref.selectorCandidates) {
      let locator: Locator;
      try {
        locator = page.locator(selector);
      } catch {
        continue;
      }

      const count = await locator.count().catch(() => 0);
      if (count > MAX_CANDIDATES_PER_SELECTOR) {
        overflowed = true;
      }

      for (let index = 0; index < Math.min(count, MAX_CANDIDATES_PER_SELECTOR); index += 1) {
        const candidate = locator.nth(index);
        const scored = await scoreCandidate(candidate, ref).catch(() => undefined);
        if (!scored || scored.score < 100) {
          continue;
        }

        const existing = candidates.get(scored.identityKey);
        if (!existing || scored.score > existing.score) {
          candidates.set(scored.identityKey, { locator: candidate, ...scored });
        }
      }
    }

    const sorted = [...candidates.values()].sort((left, right) => right.score - left.score);
    if (sorted.length === 0) {
      throw new V2OperationalError('stale_ref', `Ref "${ref.refId}" no longer resolves to a verified target.`, {
        retryable: false,
        diagnostics: {
          candidateCount: 0,
          reason: 'no_verified_candidates',
          selectorCount: ref.selectorCandidates.length,
          topCandidates: sorted.slice(0, 5).map(candidate => ({
            score: candidate.score,
            identityKey: candidate.identityKey,
            diagnostics: candidate.diagnostics,
          })),
        },
      });
    }

    if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
      const topScore = sorted[0].score;
      const tiedCandidates = sorted.filter(candidate => candidate.score === topScore);
      const ordinalSelection = selectExactSemanticOrdinalCandidate(tiedCandidates, ref);
      if ('candidate' in ordinalSelection) {
        const selected = ordinalSelection.candidate;
        if (
          overflowed
          && selected.score < 140
          && (sorted.length > 1 || selected.score < MIN_SINGLE_OVERFLOW_CANDIDATE_SCORE)
        ) {
          throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" matched too many weak selector candidates.`, {
            retryable: false,
            diagnostics: {
              candidateCount: sorted.length,
              reason: 'overflow_weak_selectors',
              topScore: selected.score,
              topCandidates: sorted.slice(0, 5).map(candidate => ({
                score: candidate.score,
                identityKey: candidate.identityKey,
                diagnostics: candidate.diagnostics,
              })),
            },
          });
        }

        return {
          locator: selected.locator,
          resolution: selected.score >= 140 ? 'semantic_selector' : 'unique_selector',
          diagnostics: {
            reason: 'resolved_exact_semantic_ordinal',
            candidateCount: sorted.length,
            topScore: selected.score,
            topIdentityKey: selected.identityKey,
            expectedOrdinal: ref.nthRoleName,
            semanticGroupSize: ordinalSelection.semanticGroupSize,
          },
        };
      }

      throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" resolved to multiple equivalent candidates.`, {
        retryable: false,
        diagnostics: {
          candidateCount: sorted.length,
          reason: 'tied_candidates',
          ordinalReason: ordinalSelection.ordinalReason,
          expectedOrdinal: ref.nthRoleName,
          semanticGroupSize: ordinalSelection.semanticGroupSize,
          topScore,
          topCandidates: sorted.slice(0, 5).map(candidate => ({
            score: candidate.score,
            identityKey: candidate.identityKey,
            diagnostics: candidate.diagnostics,
          })),
        },
      });
    }

    const selected = sorted[0];
    if (
      overflowed
      && selected.score < 140
      && (sorted.length > 1 || selected.score < MIN_SINGLE_OVERFLOW_CANDIDATE_SCORE)
    ) {
      throw new V2OperationalError('ambiguous_ref_resolution', `Ref "${ref.refId}" matched too many weak selector candidates.`, {
        retryable: false,
        diagnostics: {
          candidateCount: sorted.length,
          reason: 'overflow_weak_selectors',
          topScore: selected.score,
          topCandidates: sorted.slice(0, 5).map(candidate => ({
            score: candidate.score,
            identityKey: candidate.identityKey,
            diagnostics: candidate.diagnostics,
          })),
        },
      });
    }

    return {
      locator: selected.locator,
      resolution: selected.score >= 140 ? 'semantic_selector' : 'unique_selector',
      diagnostics: {
        reason: 'resolved_unique_top_candidate',
        candidateCount: sorted.length,
        topScore: selected.score,
        topIdentityKey: selected.identityKey,
      },
    };
  }
}

function selectExactSemanticOrdinalCandidate(candidates: ScoredCandidate[], ref: V2Ref): OrdinalSelection {
  const expectedRole = normalizeSemanticIdentity(ref.role || '');
  const expectedName = normalizeSemanticIdentity(ref.name || '');
  const expectedOrdinal = ref.nthRoleName;

  if (
    ref.state !== 'live'
    || !expectedRole
    || !expectedName
    || !Number.isInteger(expectedOrdinal)
    || Number(expectedOrdinal) < 1
  ) {
    return { ordinalReason: 'ordinal_metadata_incomplete' };
  }

  const exactCandidates = candidates.filter(candidate => {
    const diagnostics = candidate.diagnostics;
    return diagnostics
      && normalizeSemanticIdentity(diagnostics.role) === expectedRole
      && normalizeSemanticIdentity(diagnostics.accessibleName) === expectedName
      && diagnostics.nameMatched;
  });

  if (exactCandidates.length === 0) {
    return { ordinalReason: 'exact_semantic_group_missing' };
  }

  if (exactCandidates.some(candidate => candidate.diagnostics?.semanticScope !== 'owner_document')) {
    return { ordinalReason: 'semantic_scope_unstable' };
  }

  const groupSizes = new Set(exactCandidates.map(candidate => candidate.diagnostics?.semanticGroupSize));
  const semanticGroupSize = exactCandidates[0]?.diagnostics?.semanticGroupSize;
  if (
    groupSizes.size !== 1
    || !Number.isInteger(semanticGroupSize)
    || Number(semanticGroupSize) < exactCandidates.length
  ) {
    return { ordinalReason: 'ordinal_metadata_incomplete' };
  }
  const expectedSemanticGroupSize = Number(semanticGroupSize);

  if (Number(expectedOrdinal) > expectedSemanticGroupSize) {
    return { ordinalReason: 'ordinal_out_of_range', semanticGroupSize: expectedSemanticGroupSize };
  }

  const ordinalCandidates = exactCandidates.filter(candidate => candidate.diagnostics?.semanticOrdinal === expectedOrdinal);
  if (ordinalCandidates.length !== 1) {
    return { ordinalReason: 'ordinal_candidate_not_unique', semanticGroupSize: expectedSemanticGroupSize };
  }

  return { candidate: ordinalCandidates[0], semanticGroupSize: expectedSemanticGroupSize };
}

function normalizeSemanticIdentity(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const SCORE_CANDIDATE_SOURCE = String.raw`
const ownerDocument = element.ownerDocument;
const ownerWindow = ownerDocument.defaultView || window;
const rect = element.getBoundingClientRect();

const normalizedText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizedSemanticIdentity = (value) => normalizedText(value).toLowerCase();
const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

const identityKey = [
  element.tagName.toLowerCase(),
  Math.round(rect.left),
  Math.round(rect.top),
  Math.round(rect.width),
  Math.round(rect.height),
  normalize(element.textContent || ''),
].join('|');

const isVisible = (target) => {
  const targetStyle = ownerWindow.getComputedStyle(target);
  const targetRect = target.getBoundingClientRect();
  return !target.hasAttribute('hidden')
    && targetStyle.display !== 'none'
    && targetStyle.visibility !== 'hidden'
    && targetStyle.opacity !== '0'
    && targetRect.width > 0
    && targetRect.height > 0;
};

if (!isVisible(element)) {
  return { score: -1, identityKey };
}

const explicitOrNativeRole = (target) => {
  const explicit = target.getAttribute('role');
  if (explicit) return explicit.toLowerCase();

  switch (target.tagName.toLowerCase()) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input':
      switch (String(target.getAttribute('type') || 'text').toLowerCase()) {
        case 'button':
        case 'submit':
        case 'reset':
        case 'image':
          return 'button';
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'search':
          return 'searchbox';
        default:
          return 'textbox';
      }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    default:
      return undefined;
  }
};

const ariaLabelledByText = (target) => {
  const labelledBy = target.getAttribute('aria-labelledby');
  if (!labelledBy) {
    return undefined;
  }

  const text = labelledBy
    .split(/\s+/)
    .map(id => target.ownerDocument.getElementById(id)?.textContent || '')
    .map(normalizedText)
    .filter(Boolean)
    .join(' ');
  return text || undefined;
};

const accessibleName = (target) => {
  const direct =
    ariaLabelledByText(target)
    || target.getAttribute('aria-label')
    || target.getAttribute('placeholder')
    || target.getAttribute('title');

  if (direct) {
    return normalizedText(direct);
  }

  if (target instanceof ownerWindow.HTMLInputElement && target.value) {
    return normalizedText(target.value);
  }

  if (
    (target instanceof ownerWindow.HTMLInputElement
      || target instanceof ownerWindow.HTMLSelectElement
      || target instanceof ownerWindow.HTMLTextAreaElement)
    && target.labels
    && target.labels.length > 0
  ) {
    const labelText = Array.from(target.labels)
      .map(label => normalizedText(label.textContent || ''))
      .filter(Boolean)
      .join(' ');
    if (labelText) {
      return labelText;
    }
  }

  const formName = target.getAttribute('name');
  if (formName) {
    return normalizedText(formName);
  }

  return normalizedText(target.textContent || '') || undefined;
};

const isInteractiveElement = (target) => {
  const targetTagName = target.tagName.toLowerCase();
  if (['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option'].includes(targetTagName)) {
    return true;
  }

  const targetRole = target.getAttribute('role') && target.getAttribute('role')?.toLowerCase();
  if (
    targetRole
    && ['button', 'link', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'searchbox'].includes(targetRole)
  ) {
    return true;
  }

  if (target.getAttribute('contenteditable') === 'true') {
    return true;
  }

  const tabindex = target.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0) {
    return true;
  }

  if (Array.from(target.getAttributeNames()).some(name => name.startsWith('on'))) {
    return true;
  }

  return ownerWindow.getComputedStyle(target).cursor === 'pointer';
};

const walkOwnerDocument = (target) => {
  const walked = [];
  const pending = Array.from(target.ownerDocument.children || []);

  while (pending.length > 0) {
    const child = pending.shift();
    walked.push(child);

    if (child.shadowRoot) {
      pending.unshift(...Array.from(child.shadowRoot.children || []));
    }
    pending.unshift(...Array.from(child.children || []));
  }

  return walked;
};

let score = 100;
const tagName = element.tagName.toLowerCase();
const role = normalizedSemanticIdentity(explicitOrNativeRole(element) || '');
const liveAccessibleName = accessibleName(element) || '';
const accessibleNameIdentity = normalizedSemanticIdentity(liveAccessibleName);
const text = normalizedSemanticIdentity(element.textContent || '');
const name = normalizedSemanticIdentity(expected.name || '');
const expectedText = normalizedSemanticIdentity(expected.text || '');

if (expected.tagName && tagName === normalizedSemanticIdentity(expected.tagName)) score += 15;
if (expected.role && role === normalizedSemanticIdentity(expected.role)) score += 15;
if (name && accessibleNameIdentity === name) score += 30;
if (expectedText && text === expectedText) score += 20;

const semanticGroup = walkOwnerDocument(element)
  .filter(candidate => isInteractiveElement(candidate) && isVisible(candidate))
  .filter(candidate => normalizedSemanticIdentity(explicitOrNativeRole(candidate) || '') === role)
  .filter(candidate => normalizedSemanticIdentity(accessibleName(candidate) || '') === accessibleNameIdentity);
const semanticIndex = semanticGroup.indexOf(element);

return {
  score,
  identityKey,
  diagnostics: {
    tagName,
    role,
    accessibleName: accessibleNameIdentity,
    nameMatched: Boolean(name && accessibleNameIdentity === name),
    textMatched: Boolean(expectedText && text === expectedText),
    semanticOrdinal: semanticIndex >= 0 ? semanticIndex + 1 : undefined,
    semanticGroupSize: semanticGroup.length,
    semanticScope: ownerDocument === document ? 'owner_document' : 'unknown',
  },
};
`;

interface ScoreCandidateExpected {
  tagName?: string;
  role?: string;
  name?: string;
  text?: string;
  nthRoleName?: number;
}

const SCORE_CANDIDATE_PAGE_FUNCTION = Function(
  'element',
  'expected',
  SCORE_CANDIDATE_SOURCE,
) as unknown as (
  element: Element,
  expected: ScoreCandidateExpected,
) => { score: number; identityKey: string; diagnostics?: CandidateDiagnostics };

async function scoreCandidate(locator: Locator, ref: V2Ref): Promise<{ score: number; identityKey: string; diagnostics?: CandidateDiagnostics }> {
  return locator.evaluate(SCORE_CANDIDATE_PAGE_FUNCTION, {
    tagName: ref.tagName,
    role: ref.role,
    name: ref.name,
    text: ref.text,
    nthRoleName: ref.nthRoleName,
  });
}
