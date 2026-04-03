import type { CDPSession, Page } from 'playwright';

import { getRuntimeConfig } from '../config/runtime';
import { logger } from '../logger';
import { getBrain1NodePriority } from './scoring';
import type {
  Brain1Confidence,
  Brain1EnrichmentState,
  Brain1Result,
  FilteredNode,
  FilteredNodeMeta,
  InteractionKind,
  SelectorType,
  VisibilityState,
} from './types';

const MAX_ENRICHMENT_CANDIDATES = 8;
const MAX_REGION_RESCANS = 2;
const MAX_FINAL_NODES = 240;

export interface Brain1CandidateEnrichment {
  nodeId: string;
  interactionScoreDelta?: number;
  actionabilityScoreDelta?: number;
  confidence?: Brain1Confidence;
  enrichmentState?: Brain1EnrichmentState;
}

export interface Brain1ServiceOptions {
  enableInteractionPipeline?: boolean;
  maxEnrichmentCandidates?: number;
  maxRegionRescans?: number;
  enricher?: (node: FilteredNode, page: Page) => Promise<Brain1CandidateEnrichment | null>;
  regionScanner?: (regionSelector: string, goal: string, page: Page) => Promise<Brain1Result>;
}

interface RawBrain1Node extends Partial<FilteredNode> {
  selector?: string;
  attributes?: FilteredNode['attrs'];
}

interface RawBrain1Result {
  nodes?: RawBrain1Node[];
  errors?: string[];
  metrics?: Brain1Result['metrics'];
}

export class Brain1Service {
  private readonly page: Page;
  private readonly opts: Required<Brain1ServiceOptions>;

  constructor(page: Page, options: Brain1ServiceOptions = {}) {
    const runtime = getRuntimeConfig();
    this.page = page;
    this.opts = {
      enableInteractionPipeline: options.enableInteractionPipeline ?? runtime.brain1.interactionPipeline,
      maxEnrichmentCandidates: options.maxEnrichmentCandidates ?? MAX_ENRICHMENT_CANDIDATES,
      maxRegionRescans: options.maxRegionRescans ?? MAX_REGION_RESCANS,
      enricher: options.enricher ?? defaultCandidateEnricher,
      regionScanner: options.regionScanner ?? defaultRegionScanner,
    };
  }

  async scan(goal: string): Promise<Brain1Result> {
    const base = normalizeBrain1Result(
      await this.page.evaluate((goalText: string) => (window as any).__browsegent_brain1(document.body, goalText), goal),
    );

    if (!this.opts.enableInteractionPipeline) {
      return finalizeBrain1Result(base);
    }

    let nodes = [...base.nodes];
    const errors = [...base.errors];
    const metrics = { ...base.metrics };

    const enrichmentCandidates = selectEnrichmentCandidates(nodes, this.opts.maxEnrichmentCandidates);
    const enrichments = await Promise.all(enrichmentCandidates.map(candidate => this.opts.enricher(candidate, this.page)));
    nodes = applyEnrichments(nodes, enrichments.filter((value): value is Brain1CandidateEnrichment => !!value));

    const regionCandidates = selectRegionRescans(nodes, this.opts.maxRegionRescans);
    for (const regionSelector of regionCandidates) {
      try {
        const regionResult = await this.opts.regionScanner(regionSelector, goal, this.page);
        nodes = mergeRegionNodes(nodes, regionResult.nodes);
        metrics.totalNodesWalked += regionResult.metrics.totalNodesWalked;
        metrics.shadowDomCount += regionResult.metrics.shadowDomCount;
        mergeCounts(metrics.rulesTriggered, regionResult.metrics.rulesTriggered);
        mergeCounts(metrics.selectorTypes, regionResult.metrics.selectorTypes);
        errors.push(...regionResult.errors);
      } catch (error) {
        errors.push(`region:${regionSelector}:${String(error)}`);
        logger.warn('brain1', 'Region rescan failed', {
          regionSelector,
          message: String(error).slice(0, 140),
        });
      }
    }

    const finalResult = finalizeBrain1Result({
      nodes,
      errors,
      metrics: {
        ...metrics,
        nodesKept: nodes.length,
        nodesDropped: Math.max(0, metrics.totalNodesWalked - nodes.length),
      },
    });

    logger.info('brain1', 'Interaction pipeline completed', {
      baseNodes: base.nodes.length,
      finalNodes: finalResult.nodes.length,
      enrichedCandidates: enrichmentCandidates.length,
      rescannedRegions: regionCandidates.length,
    });

    return finalResult;
  }
}

interface CandidateInspection {
  targetFound: boolean;
  inViewport: boolean;
  occluded: boolean;
  disabled: boolean;
  pointerEventsNone: boolean;
  largeEnough: boolean;
}

async function defaultCandidateEnricher(node: FilteredNode, page: Page): Promise<Brain1CandidateEnrichment | null> {
  if (!node.meta) {
    return null;
  }

  const inspection = await inspectCandidate(page, node.sel);
  const hasJsClickListener = node.type === 'trigger' ? await detectJsClickListener(page, node.sel) : null;

  let interactionScoreDelta = 0;
  let actionabilityScoreDelta = 0;

  if (hasJsClickListener === true) interactionScoreDelta += 14;
  if (!inspection.targetFound) actionabilityScoreDelta -= 24;
  if (inspection.largeEnough) actionabilityScoreDelta += 6;
  if (inspection.inViewport) actionabilityScoreDelta += 10;
  if (inspection.pointerEventsNone) actionabilityScoreDelta -= 18;
  if (inspection.disabled) actionabilityScoreDelta -= 18;
  if (inspection.occluded) actionabilityScoreDelta -= 16;

  return {
    nodeId: node.meta.nodeId,
    interactionScoreDelta,
    actionabilityScoreDelta,
    confidence: deriveConfidence({
      ...node.meta,
      interactionScore: clampScore(node.meta.interactionScore + interactionScoreDelta),
      actionabilityScore: clampScore(node.meta.actionabilityScore + actionabilityScoreDelta),
    }),
    enrichmentState: 'enriched',
  };
}

async function detectJsClickListener(page: Page, selector: string): Promise<boolean | null> {
  let cdpSession: CDPSession | null = null;
  try {
    cdpSession = await page.context().newCDPSession(page);
    const expression = `(() => {
      if (typeof getEventListeners !== 'function') return null;
      try {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const listeners = getEventListeners(el);
        return Boolean(
          (listeners.click && listeners.click.length)
          || (listeners.mousedown && listeners.mousedown.length)
          || (listeners.mouseup && listeners.mouseup.length)
          || (listeners.pointerdown && listeners.pointerdown.length)
          || (listeners.pointerup && listeners.pointerup.length)
        );
      } catch {
        return null;
      }
    })()`;

    const result = await cdpSession.send('Runtime.evaluate', {
      expression,
      includeCommandLineAPI: true,
      returnByValue: true,
    });
    const value = result.result?.value;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  } finally {
    if (cdpSession) {
      await cdpSession.detach().catch(() => {});
    }
  }
}

async function inspectCandidate(page: Page, selector: string): Promise<CandidateInspection> {
  return page.evaluate((targetSelector: string) => {
    try {
      const element = document.querySelector(targetSelector) as HTMLElement | null;
      if (!element) {
        return {
          targetFound: false,
          inViewport: false,
          occluded: false,
          disabled: false,
          pointerEventsNone: false,
          largeEnough: false,
        };
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const inViewport = rect.width >= 2
        && rect.height >= 2
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
      const hit = inViewport ? document.elementFromPoint(centerX, centerY) : null;
      const occluded = !!hit && hit !== element && !element.contains(hit);
      const disabled = (element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement).disabled === true
        || element.getAttribute('disabled') !== null
        || element.getAttribute('aria-disabled') === 'true';

      return {
        targetFound: true,
        inViewport,
        occluded,
        disabled,
        pointerEventsNone: style.pointerEvents === 'none',
        largeEnough: rect.width >= 8 && rect.height >= 8,
      };
    } catch {
      return {
        targetFound: false,
        inViewport: false,
        occluded: false,
        disabled: false,
        pointerEventsNone: false,
        largeEnough: false,
      };
    }
  }, selector);
}

async function defaultRegionScanner(regionSelector: string, goal: string, page: Page): Promise<Brain1Result> {
  const raw = await page.evaluate(
    ({ selector, goalText }) => (window as any).__browsegent_brain1_region(selector, goalText),
    { selector: regionSelector, goalText: goal },
  );
  return normalizeBrain1Result(raw);
}

function normalizeBrain1Result(raw: unknown): Brain1Result {
  const result = (raw ?? {}) as RawBrain1Result;
  const nodes: FilteredNode[] = (result.nodes ?? []).map(node => {
    const selector = node.sel ?? node.selector ?? '';
    const meta = normalizeMeta(node.meta, selector, node.tag ?? 'div', node.type ?? 'data', node.value ?? '');

    return {
      type: (node.type as FilteredNode['type']) ?? 'data',
      tag: node.tag ?? 'div',
      value: node.value ?? '',
      sel: selector,
      selType: (node.selType as SelectorType) ?? inferSelectorType(selector),
      rule: node.rule ?? 'extension_content',
      attrs: node.attrs ?? node.attributes,
      meta,
    };
  });

  const metrics = result.metrics ?? {
    totalNodesWalked: nodes.length,
    nodesKept: nodes.length,
    nodesDropped: 0,
    walkTimeMs: 0,
    shadowDomCount: 0,
    rulesTriggered: {},
    selectorTypes: {},
  };

  return {
    nodes,
    metrics: {
      totalNodesWalked: metrics.totalNodesWalked ?? nodes.length,
      nodesKept: metrics.nodesKept ?? nodes.length,
      nodesDropped: metrics.nodesDropped ?? 0,
      walkTimeMs: metrics.walkTimeMs ?? 0,
      shadowDomCount: metrics.shadowDomCount ?? 0,
      rulesTriggered: metrics.rulesTriggered ?? {},
      selectorTypes: metrics.selectorTypes ?? {},
    },
    errors: result.errors ?? [],
  };
}

function normalizeMeta(
  rawMeta: Partial<FilteredNodeMeta> | undefined,
  selector: string,
  tag: string,
  type: FilteredNode['type'],
  value: string,
): FilteredNodeMeta {
  const selectorScore = clampScore(rawMeta?.selectorScore ?? 20);
  const interactionScore = clampScore(rawMeta?.interactionScore ?? 0);
  const actionabilityScore = clampScore(rawMeta?.actionabilityScore ?? 0);
  const interactionKind = rawMeta?.interactionKind ?? inferInteractionKind(tag, type);
  const visibility = rawMeta?.visibility ?? 'visible';
  const goalScore = rawMeta?.goalScore ?? 0;

  return {
    nodeId: rawMeta?.nodeId ?? buildNodeId(selector, tag, interactionKind, value),
    selectorScore,
    interactionScore,
    actionabilityScore,
    interactionKind,
    confidence: rawMeta?.confidence ?? deriveConfidence({
      selectorScore,
      interactionScore,
      actionabilityScore,
      visibility,
    }),
    enrichmentState: rawMeta?.enrichmentState ?? 'base',
    visibility,
    goalScore,
    regionSelector: rawMeta?.regionSelector,
    disabled: rawMeta?.disabled,
    shadow: rawMeta?.shadow,
    role: rawMeta?.role,
    selectorSource: rawMeta?.selectorSource,
  };
}

function selectEnrichmentCandidates(nodes: FilteredNode[], limit: number): FilteredNode[] {
  return [...nodes]
    .filter(node =>
      node.meta
      && node.meta.confidence !== 'high'
      && node.meta.visibility !== 'hidden'
      && (node.type === 'trigger' || node.type === 'input'),
    )
    .sort((left, right) => getEnrichmentPriority(right) - getEnrichmentPriority(left))
    .slice(0, limit);
}

function getEnrichmentPriority(node: FilteredNode): number {
  const typeBonus = node.type === 'input' ? 14 : node.type === 'trigger' ? 10 : 0;
  const confidencePenalty = node.meta?.confidence === 'low' ? 18 : node.meta?.confidence === 'medium' ? 8 : 0;
  return (node.meta?.goalScore ?? 0) * 4
    + (node.meta?.interactionScore ?? 0)
    + typeBonus
    + confidencePenalty;
}

function applyEnrichments(nodes: FilteredNode[], enrichments: Brain1CandidateEnrichment[]): FilteredNode[] {
  const enrichmentsById = new Map(enrichments.map(enrichment => [enrichment.nodeId, enrichment]));
  return nodes.map(node => {
    const enrichment = node.meta ? enrichmentsById.get(node.meta.nodeId) : undefined;
    if (!enrichment || !node.meta) {
      return node;
    }

    const interactionScore = clampScore(node.meta.interactionScore + (enrichment.interactionScoreDelta ?? 0));
    const actionabilityScore = clampScore(node.meta.actionabilityScore + (enrichment.actionabilityScoreDelta ?? 0));
    const confidence = enrichment.confidence ?? deriveConfidence({
      ...node.meta,
      interactionScore,
      actionabilityScore,
    });

    return {
      ...node,
      meta: {
        ...node.meta,
        interactionScore,
        actionabilityScore,
        confidence,
        enrichmentState: enrichment.enrichmentState ?? 'enriched',
      },
    };
  });
}

function selectRegionRescans(nodes: FilteredNode[], limit: number): string[] {
  const regionSelectors = new Set<string>();
  for (const node of [...nodes].sort((left, right) => getBrain1NodePriority(right) - getBrain1NodePriority(left))) {
    if (
      node.meta?.confidence === 'low'
      && node.meta.regionSelector
      && (node.type === 'trigger' || node.type === 'input')
    ) {
      regionSelectors.add(node.meta.regionSelector);
      if (regionSelectors.size >= limit) {
        break;
      }
    }
  }
  return Array.from(regionSelectors);
}

function mergeRegionNodes(existingNodes: FilteredNode[], regionNodes: FilteredNode[]): FilteredNode[] {
  const merged = new Map(existingNodes.map(node => [getMergeKey(node), node]));
  for (const node of regionNodes) {
    const key = getMergeKey(node);
    const current = merged.get(key);
    if (!current || getBrain1NodePriority(node) > getBrain1NodePriority(current)) {
      merged.set(key, node);
    }
  }
  return Array.from(merged.values());
}

function finalizeBrain1Result(result: Brain1Result): Brain1Result {
  const nodes = [...result.nodes]
    .sort((left, right) => getBrain1NodePriority(right) - getBrain1NodePriority(left))
    .slice(0, MAX_FINAL_NODES);

  return {
    nodes,
    metrics: {
      ...result.metrics,
      nodesKept: nodes.length,
      nodesDropped: Math.max(0, result.metrics.totalNodesWalked - nodes.length),
    },
    errors: result.errors,
  };
}

function mergeCounts(target: Record<string, number>, incoming: Record<string, number>): void {
  for (const [key, value] of Object.entries(incoming)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function getMergeKey(node: FilteredNode): string {
  return node.meta?.nodeId ?? `${node.type}|${node.sel}|${node.value}`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function deriveConfidence(input: {
  selectorScore: number;
  interactionScore: number;
  actionabilityScore: number;
  visibility: VisibilityState;
}): Brain1Confidence {
  if (
    input.visibility === 'visible'
    && input.selectorScore >= 78
    && input.interactionScore >= 55
    && input.actionabilityScore >= 55
  ) {
    return 'high';
  }

  if (
    input.visibility !== 'hidden'
    && input.selectorScore >= 48
    && input.actionabilityScore >= 34
  ) {
    return 'medium';
  }

  return 'low';
}

function inferSelectorType(selector: string): SelectorType {
  if (selector.startsWith('#')) return 'id';
  if (selector.includes('[data-testid=') || selector.includes('[data-test=')) return 'testid';
  if (selector.includes('[aria-label=')) return 'aria';
  if (selector.includes('[name=')) return 'name';
  if (selector.startsWith('a[href=') || selector.includes('[href=')) return 'href';
  if (selector.includes('[placeholder=')) return 'placeholder';
  if (selector.includes('[role=')) return 'role';
  if (selector.includes('[type=')) return 'type';
  return 'positional';
}

function inferInteractionKind(tag: string, type: FilteredNode['type']): InteractionKind {
  const normalizedTag = tag.toLowerCase();
  if (normalizedTag === 'a') return 'link';
  if (normalizedTag === 'button' || type === 'trigger') return 'button';
  if (normalizedTag === 'select') return 'select';
  if (normalizedTag === 'input' || normalizedTag === 'textarea' || type === 'input') return 'input';
  return 'generic';
}

function buildNodeId(selector: string, tag: string, interactionKind: InteractionKind, value: string): string {
  return `n_${hashString(`${selector}|${tag}|${interactionKind}|${value.slice(0, 80)}`)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
