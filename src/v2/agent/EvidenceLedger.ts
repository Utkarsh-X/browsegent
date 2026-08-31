import type { BrowserObservation, V2Ref } from '../runtime/types';
import type { OperationalProjection } from '../brain1/projectionTypes';
import type { TaskEvidenceRead } from './TaskEvidenceCoverage';
import type { PlannerEvidenceSnapshot, PlannerEvidenceSnapshotCard } from '../planner/types';

export type SortDimension = 'stars' | 'date' | 'price' | 'rating' | 'relevance';
export type SortDirection = 'asc' | 'desc';

export interface ActiveSortProvenance {
  dimension: SortDimension;
  direction: SortDirection;
  source: 'url_query' | 'active_control' | 'action_lineage';
  rawLabel: string;
}

export interface StructuredResultCard {
  cardId: string;
  observationId: string;
  positionIndex: number;
  entityName?: string;
  metrics: {
    stars?: number;
    rating?: number;
    reviewCount?: number;
    price?: number;
    citations?: number;
    rawMetrics?: string[];
  };
  temporal?: string[];
  rawText: string;
  refIds: string[];
  provenRank?: number; // 1 for 1st card when matching sort is active, or explicit "#1"
}

export interface EvidenceLedgerState {
  activeSort?: ActiveSortProvenance;
  resultCards: StructuredResultCard[];
  toolReads: TaskEvidenceRead[];
  surfaceFacts: TaskEvidenceRead[];
  provenFacts: string[];
}

/**
 * Deterministically extracts the active sort state from URL queries, active DOM controls, or action lineage.
 */
export function extractActiveSort(url: string, refs: V2Ref[] = []): ActiveSortProvenance | undefined {
  if (url) {
    try {
      const parsed = new URL(url);
      const query = parsed.search.toLowerCase();
      const path = parsed.pathname.toLowerCase();

      // 1. URL Pathname conventions (e.g. arXiv recent lists)
      if (/\/list\/[^/]+\/recent\b/i.test(path) || path.endsWith('/recent')) {
        return { dimension: 'date', direction: 'desc', source: 'url_query', rawLabel: 'recent' };
      }

      // 2. URL query parameters
      if (/[?&](?:s|sort|sort_by)=stars\b/i.test(query) || /[?&]order=stars\b/i.test(query)) {
        return { dimension: 'stars', direction: 'desc', source: 'url_query', rawLabel: 'stars' };
      }
      if (/[?&](?:order|sort|sort_by)=(?:-|desc)?(?:announced_date_first|submitted_date_first|date|newest|latest)\b/i.test(query)) {
        return { dimension: 'date', direction: 'desc', source: 'url_query', rawLabel: 'date' };
      }
      if (/[?&](?:s|sort|sort_by|order)=(?:price|price-asc|price_asc|price_a|cheapest)\b/i.test(query)) {
        return { dimension: 'price', direction: 'asc', source: 'url_query', rawLabel: 'price' };
      }
      if (/[?&](?:s|sort|sort_by|order)=(?:rating|rating_desc|highest_rated)\b/i.test(query)) {
        return { dimension: 'rating', direction: 'desc', source: 'url_query', rawLabel: 'rating' };
      }
    } catch {
      // Fall through if URL parsing fails
    }
  }

  // 2. Active DOM controls (comboboxes, select options, active buttons/tabs)
  for (const ref of refs) {
    if (ref.visibility !== 'visible') continue;
    const text = [ref.name, ref.text].filter(Boolean).join(' ').trim();
    if (!text) continue;

    // GitHub / e-commerce sort button or active option
    if (/\b(?:sort\s+by|sorted\s+by):\s*most\s+stars\b/i.test(text) || /\bmost\s+stars\s*\(selected\)/i.test(text)) {
      return { dimension: 'stars', direction: 'desc', source: 'active_control', rawLabel: text };
    }
    if (/\b(?:sort\s+results\s+by|sort\s+by):\s*announcement\s+date\s*\(newest\s+first\)/i.test(text)) {
      return { dimension: 'date', direction: 'desc', source: 'active_control', rawLabel: text };
    }
    if (/\b(?:sort\s+by|sorted\s+by):\s*(?:price\s*\(low\s+to\s+high\)|cheapest|lowest\s+price)\b/i.test(text)) {
      return { dimension: 'price', direction: 'asc', source: 'active_control', rawLabel: text };
    }
    if (/\b(?:sort\s+by|sorted\s+by):\s*(?:highest\s+rated|best\s+rating|top\s+rated)\b/i.test(text)) {
      return { dimension: 'rating', direction: 'desc', source: 'active_control', rawLabel: text };
    }
  }

  return undefined;
}

/**
 * Parses numeric metric values from text.
 */
function parseMetricNumber(raw: string): number | undefined {
  const clean = raw.trim().replace(/,/g, '');
  if (/k$/i.test(clean)) {
    return Math.round(parseFloat(clean) * 1000);
  }
  if (/m$/i.test(clean)) {
    return Math.round(parseFloat(clean) * 1000000);
  }
  const val = parseFloat(clean);
  return Number.isFinite(val) ? val : undefined;
}

function getRefText(ref: V2Ref): string {
  const name = ref.name?.trim() ?? '';
  const text = ref.text?.trim() ?? '';
  if (name && text) {
    if (name === text) return name;
    if (name.includes(text)) return name;
    if (text.includes(name)) return text;
    return `${name} ${text}`;
  }
  return name || text;
}

const COMMON_FACET_KEYWORDS = new Set([
  'jupyter notebook', 'python', 'javascript', 'html', 'r', 'typescript', 'css', 'c', 'rust', 'tex',
  'code', 'repositories', 'issues', 'pull requests', 'discussions', 'users', 'packages', 'wikis',
  'all', 'any', 'filter by', 'filter', 'more', 'advanced', 'public', 'private', 'archived',
  'sign in', 'sign up', 'pricing', 'skip to content', 'homepage', 'star', 'sponsor',
  'archive home', 'submit', 'donate', 'page 1', 'page 2', 'goto page 1', 'learn more',
]);

function isSidebarOrNavigation(ref: V2Ref, visibleRefs: V2Ref[] = []): boolean {
  // Check selector matches for sidebar/nav
  const selectors = ref.selectorCandidates?.join(' ') ?? '';
  if (/\b(?:sidebar|nav|ActionList|filter|pagination|breadcrumb)\b/i.test(selectors)) {
    return true;
  }

  // Check role matches
  if (ref.role === 'navigation' || (ref.role === 'region' && /filter/i.test(ref.name ?? ''))) {
    return true;
  }

  return false;
}

function isSearchOrListingPage(url: string): boolean {
  if (/[/?&](?:search|find|list|results|browse|category|explore)\b/i.test(url)) return true;
  if (/[?&](?:q|query|s|k|keywords|searchtype)=/i.test(url)) return true;
  return false;
}

/**
 * Deterministically checks if a ref represents a primary result entity anchor.
 */
export function isPrimaryEntityAnchor(ref: V2Ref, visibleRefs: V2Ref[] = []): boolean {
  const text = getRefText(ref).trim();
  if (!text) return false;
  const lower = text.toLowerCase();

  // Exclude common facet keywords and navigation
  if (COMMON_FACET_KEYWORDS.has(lower)) return false;
  if (/^(?:\(\d+[^)]*\)|\d+\s*(?:results?|stars?|reviews?|k|m))\b/i.test(text)) return false;
  if (isSidebarOrNavigation(ref, visibleRefs)) return false;

  // 1. GitHub repo: owner/repo
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(text)) {
    const [owner, repo] = text.split('/');
    if (owner && repo && !['search', 'site', 'features', 'orgs', 'settings', 'topics'].includes(owner.toLowerCase())) {
      return true;
    }
  }

  // 2. arXiv preprint
  if (/\barXiv:\d+\.\d+/i.test(text)) return true;

  // 3. Main content headings (h1, h2, h3) in result region
  if (ref.role === 'heading' || ref.tagName === 'h1' || ref.tagName === 'h2' || ref.tagName === 'h3') {
    if (text.length >= 5 && text.length <= 120 && !/^(?:sort|filter|view|see|click|read|learn|sign|log|search|menu|nav)\b/i.test(text)) {
      if (!/^(?:star|sponsor|follow|watch|fork|subscribe)\b/i.test(text)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Clusters visible refs into Structured Result Cards using relative 2D column layout bands with DOM sibling fallback.
 */
export function extractResultCards(
  observation: BrowserObservation,
  activeSort?: ActiveSortProvenance,
): StructuredResultCard[] {
  const visibleRefs = (observation.refs ?? []).filter(ref => ref.visibility === 'visible');
  if (visibleRefs.length === 0) return [];

  // Identify raw anchor elements
  const rawAnchors = visibleRefs.filter(ref => isPrimaryEntityAnchor(ref, visibleRefs));
  if (rawAnchors.length === 0) return [];

  // Check if we have spatial geometry (box.y and box.x)
  const hasGeometry = visibleRefs.filter(r => r.box && typeof r.box.y === 'number' && typeof r.box.x === 'number').length >= 2;

  if (hasGeometry) {
    // Spatial Deduplication: Deduplicate multiple tags referring to the same entity within Delta y <= 20px
    const distinctAnchors: V2Ref[] = [];
    for (const anchor of rawAnchors) {
      const text = getRefText(anchor);
      const y = anchor.box?.y ?? 0;
      const existing = distinctAnchors.find(a => getRefText(a) === text && Math.abs((a.box?.y ?? 0) - y) <= 20);
      if (!existing) {
        distinctAnchors.push(anchor);
      }
    }

    distinctAnchors.sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0));

    const cards: StructuredResultCard[] = [];
    distinctAnchors.forEach((anchor, index) => {
      const anchorX = anchor.box?.x ?? 0;
      const anchorY = anchor.box?.y ?? 0;
      const nextAnchorY = distinctAnchors[index + 1]?.box?.y ?? (anchorY + 250);

      // Relative 2D Column Band:
      // Vertical band: [anchorY - 10, nextAnchorY - 5)
      // Relative horizontal column: [anchorX - 50, anchorX + 450]
      const cardRefs = visibleRefs.filter(ref => {
        if (!ref.box || typeof ref.box.y !== 'number' || typeof ref.box.x !== 'number') return false;
        if (ref.box.y < anchorY - 10 || ref.box.y >= nextAnchorY - 5) return false;
        if (ref.box.x < anchorX - 50 || ref.box.x > anchorX + 450) return false;
        return true;
      });

      const card = buildCardFromRefs(
        `card_${observation.observationId}_${index}`,
        observation.observationId,
        index,
        cardRefs.length > 0 ? cardRefs : [anchor],
        activeSort,
        getRefText(anchor),
      );
      if (card) {
        cards.push(card);
      }
    });

    return cards;
  }

  // Sibling / Sequential Proximity Fallback (when geometry is unavailable)
  const cards: StructuredResultCard[] = [];
  let currentAnchor: V2Ref | undefined;
  let currentGroup: V2Ref[] = [];
  let cardIndex = 0;

  for (const ref of visibleRefs) {
    if (isPrimaryEntityAnchor(ref, visibleRefs)) {
      if (currentGroup.length > 0 && currentAnchor) {
        const card = buildCardFromRefs(
          `card_${observation.observationId}_${cardIndex++}`,
          observation.observationId,
          cardIndex - 1,
          currentGroup,
          activeSort,
          getRefText(currentAnchor),
        );
        if (card) cards.push(card);
      }
      currentAnchor = ref;
      currentGroup = [ref];
    } else if (currentAnchor) {
      currentGroup.push(ref);
    }
  }

  if (currentGroup.length > 0 && currentAnchor) {
    const card = buildCardFromRefs(
      `card_${observation.observationId}_${cardIndex}`,
      observation.observationId,
      cardIndex,
      currentGroup,
      activeSort,
      getRefText(currentAnchor),
    );
    if (card) cards.push(card);
  }

  return cards;
}

function normalizeEntityName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const arxivMatch = raw.match(/\barXiv:(\d+\.\d+)/i);
  if (arxivMatch) return `arXiv:${arxivMatch[1]}`;
  return raw.trim();
}

/**
 * Builds a single StructuredResultCard from a cluster of co-located refs.
 */
function buildCardFromRefs(
  cardId: string,
  observationId: string,
  positionIndex: number,
  refs: V2Ref[],
  activeSort?: ActiveSortProvenance,
  explicitEntityName?: string,
): StructuredResultCard | undefined {
  const refIds = refs.map(r => r.refId);
  const rawTexts = refs.map(r => getRefText(r)).filter(Boolean);
  const combinedText = rawTexts.join(' | ');
  if (!combinedText) return undefined;

  let entityName = normalizeEntityName(explicitEntityName);
  const metrics: StructuredResultCard['metrics'] = {};
  const temporal: string[] = [];

  for (const text of rawTexts) {
    // Entity detection fallback if not explicitly provided
    if (!entityName) {
      if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(text)) {
        entityName = text;
      } else if (/\barXiv:\d+\.\d+/i.test(text)) {
        entityName = normalizeEntityName(text);
      } else if (!/^(?:stars?|ratings?|reviews?|price|sort|filter|view|more)\b/i.test(text) && text.length > 3) {
        entityName = text;
      }
    }

    // Stars
    const starMatch = text.match(/\b(\d+(?:[.,]\d+)?\s*[kKmM]?)\s+stars?\b/i)
      || text.match(/\bstars?:\s*(\d+(?:[.,]\d+)?\s*[kKmM]?)\b/i)
      || (metrics.stars === undefined && /^\d+(?:[.,]\d+)?\s*[kKmM]?$/.test(text) ? [null, text] : null);
    if (starMatch?.[1]) {
      metrics.stars = parseMetricNumber(starMatch[1]);
    }

    // Price
    const priceMatch = text.match(/[$€£¥₹]\s*(\d+(?:[.,]\d+)?)/i)
      || text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:USD|EUR|GBP|JPY|dollars?)\b/i);
    if (priceMatch) {
      metrics.price = parseMetricNumber(priceMatch[1] ?? priceMatch[2]);
    }

    // Rating
    const ratingMatch = text.match(/\b([1-5](?:\.\d)?)\s*(?:stars?|rating|\/\s*5)\b/i);
    if (ratingMatch?.[1]) {
      metrics.rating = parseFloat(ratingMatch[1]);
    }

    // Citations
    const citationMatch = text.match(/\b(\d+)\s+citations?\b/i);
    if (citationMatch?.[1]) {
      metrics.citations = parseInt(citationMatch[1], 10);
    }

    // Temporal
    const dateMatch = text.match(/\b(?:submitted|announced|released|published|updated)?\s*(\d{1,2}\s+[a-z]{3,9}\s*,?\s*\d{4}|\d{4}-\d{2}-\d{2})\b/i);
    if (dateMatch?.[1]) {
      temporal.push(dateMatch[1]);
    }
  }

  // Determine provenRank
  let provenRank: number | undefined;
  // If active sort is present and matching, assign rank based on position
  if (activeSort) {
    if (activeSort.dimension === 'stars' && metrics.stars !== undefined) {
      provenRank = positionIndex + 1;
    } else if (activeSort.dimension === 'date' && (temporal.length > 0 || entityName?.startsWith('arXiv:'))) {
      provenRank = positionIndex + 1;
    } else if (activeSort.dimension === 'price' && metrics.price !== undefined) {
      provenRank = positionIndex + 1;
    } else if (activeSort.dimension === 'rating' && metrics.rating !== undefined) {
      provenRank = positionIndex + 1;
    }
  }

  // Also check if text has an explicit ordinal badge (e.g. "#1", "Rank 1")
  const ordinalMatch = combinedText.match(/(?:^|\s)#(\d+)\b|\b(?:rank\s*#?(\d+)|1st|2nd|3rd)\b/i);
  if (ordinalMatch) {
    const explicitRank = ordinalMatch[1] ? parseInt(ordinalMatch[1], 10) : ordinalMatch[2] ? parseInt(ordinalMatch[2], 10) : 1;
    provenRank = explicitRank;
  }

  return {
    cardId,
    observationId,
    positionIndex,
    entityName,
    metrics,
    temporal: temporal.length > 0 ? temporal : undefined,
    rawText: combinedText,
    refIds,
    provenRank,
  };
}

/**
 * Generic Relation-Aware Evidence Ledger managing durable state across observations.
 */
export class EvidenceLedger {
  private activeSort?: ActiveSortProvenance;
  private lastSearchCards: StructuredResultCard[] = [];
  private cardsByEntity: Map<string, StructuredResultCard> = new Map();
  private toolReads: TaskEvidenceRead[] = [];
  private surfaceFacts: TaskEvidenceRead[] = [];
  private lastOrigin?: string;

  recordObservation(observation: BrowserObservation, projection?: OperationalProjection): void {
    // Detect domain / origin changes
    try {
      const origin = new URL(observation.url).origin;
      if (this.lastOrigin && origin !== this.lastOrigin) {
        // Clear search cards on cross-domain navigation
        this.lastSearchCards = [];
        this.cardsByEntity.clear();
        this.activeSort = undefined;
      }
      this.lastOrigin = origin;
    } catch {
      // Ignore invalid URL parse
    }

    // Detect active sort state
    const sort = extractActiveSort(observation.url, observation.refs);
    if (sort) {
      this.activeSort = sort;
    }

    // Extract structured result cards from current observation
    const currentCards = extractResultCards(observation, this.activeSort);
    if (currentCards.length > 0 && isSearchOrListingPage(observation.url)) {
      this.lastSearchCards = currentCards;
      for (const card of currentCards) {
        if (card.entityName) {
          this.cardsByEntity.set(card.entityName, card);
        }
      }
    }

    // Update surface facts from projection
    if (projection) {
      const seenRefs = new Set<string>();
      const reads: TaskEvidenceRead[] = [];
      for (const item of [
        ...(projection.readables ?? []),
        ...(projection.interactions ?? []),
        ...(projection.navigation ?? []),
      ]) {
        if (seenRefs.has(item.refId)) continue;
        seenRefs.add(item.refId);
        if (item.visibility !== 'visible') continue;
        const text = [item.name, item.text].filter(Boolean).join(' ').trim();
        if (!text) continue;

        reads.push({
          kind: 'surface_observation',
          sourceKind: 'surface_observation',
          observationId: observation.observationId,
          targetRef: item.refId,
          refIds: [item.refId],
          text,
        });
      }
      this.surfaceFacts = reads;
    }
  }

  recordToolRead(read: TaskEvidenceRead): void {
    this.toolReads.push(read);
  }

  getActiveSort(): ActiveSortProvenance | undefined {
    return this.activeSort;
  }

  getResultCards(): StructuredResultCard[] {
    return this.lastSearchCards.length > 0
      ? this.lastSearchCards
      : Array.from(this.cardsByEntity.values());
  }

  getToolReads(): TaskEvidenceRead[] {
    return this.toolReads;
  }

  getSurfaceFacts(): TaskEvidenceRead[] {
    return this.surfaceFacts;
  }

  /**
   * Returns only compact, relation-bound facts that are useful for the next
   * planning decision. Raw observation text stays out of this snapshot.
   */
  getPlannerEvidenceSnapshot(maxCards = 8): PlannerEvidenceSnapshot | undefined {
    const cards = this.getResultCards()
      .filter(card => Boolean(card.entityName))
      .slice(0, maxCards)
      .map((card): PlannerEvidenceSnapshotCard => {
        const snapshotCard: PlannerEvidenceSnapshotCard = {
          position: card.positionIndex,
          entity: card.entityName,
          metrics: card.metrics,
          refIds: card.refIds.slice(0, 8),
        };
        if (card.provenRank !== undefined) snapshotCard.provenRank = card.provenRank;
        if (card.temporal?.length) snapshotCard.temporal = card.temporal;
        return snapshotCard;
      });

    if (cards.length === 0) return undefined;

    return {
      activeSort: this.activeSort
        ? {
            dimension: this.activeSort.dimension,
            direction: this.activeSort.direction,
            source: this.activeSort.source,
          }
        : undefined,
      cards,
    };
  }

  /**
   * Builds relation-bound evidence text formatted specifically for final answer validation.
   */
  buildValidationEvidenceText(): string {
    const lines: string[] = [];

    // 1. Tool Reads
    for (const read of this.toolReads) {
      if (read.text.trim()) {
        lines.push(read.text.trim());
      }
    }

    // 2. Active Sort Provenance
    if (this.activeSort) {
      lines.push(`[Active Sort: ${this.activeSort.dimension} (${this.activeSort.direction}) via ${this.activeSort.source}]`);
    }

    // 3. Structured Result Cards (from persistent search lineage or current observation)
    const cards = this.getResultCards();
    for (const card of cards) {
      const parts: string[] = [];
      if (card.provenRank !== undefined) {
        parts.push(`Rank #${card.provenRank}`);
      }
      if (card.entityName) {
        parts.push(card.entityName);
      }
      if (card.metrics.stars !== undefined) {
        parts.push(`${card.metrics.stars} stars`);
      }
      if (card.metrics.price !== undefined) {
        parts.push(`$${card.metrics.price}`);
      }
      if (card.metrics.rating !== undefined) {
        parts.push(`Rating: ${card.metrics.rating}`);
      }
      if (card.temporal && card.temporal.length > 0) {
        parts.push(card.temporal.join(', '));
      }

      if (parts.length > 0) {
        lines.push(`[Card ${card.positionIndex + 1}: ${parts.join(' | ')}]`);
      }
    }

    // 4. Visible Surface Facts (Fallback / Context)
    for (const fact of this.surfaceFacts) {
      if (fact.text.trim()) {
        lines.push(fact.text.trim());
      }
    }

    return lines.join('\n');
  }

  /**
   * Returns all evidence reads aggregated for coverage evaluation.
   */
  getAllEvidenceReads(): TaskEvidenceRead[] {
    const reads: TaskEvidenceRead[] = [...this.toolReads];

    // Add structured result cards as relation-bound reads
    const cards = this.getResultCards();
    for (const card of cards) {
      const parts: string[] = [];
      if (card.provenRank !== undefined) {
        parts.push(`Rank #${card.provenRank}`);
      }
      if (card.entityName) {
        parts.push(card.entityName);
      }
      if (card.metrics.stars !== undefined) {
        parts.push(`${card.metrics.stars} stars`);
      }
      if (card.metrics.price !== undefined) {
        parts.push(`Price: $${card.metrics.price}`);
      }
      if (card.metrics.rating !== undefined) {
        parts.push(`Rating: ${card.metrics.rating}`);
      }
      if (card.temporal && card.temporal.length > 0) {
        parts.push(card.temporal.join(', '));
      }

      if (parts.length > 0) {
        reads.push({
          kind: 'structured_card',
          sourceKind: 'surface_observation',
          observationId: card.observationId,
          refIds: card.refIds,
          text: parts.join(' | '),
        });
      }
    }

    // Add direct surface reads
    reads.push(...this.surfaceFacts);

    return reads;
  }
}
