import type { FilteredNode } from '../brain1/types';
import type { Action } from '../executor/types';
import type { SemanticGraph } from '../graph/types';
import type { ActionHistoryEntry } from '../graph/serializer';
import { selectorsEquivalent } from './selectorMatch';

export type TargetUtilityGuardReason =
  | 'read_before_click'
  | 'low_actionability'
  | 'same_page_anchor'
  | 'read_before_navigation'
  | 'pagination_churn';

export interface TargetUtilityGuardSignal {
  shouldBlock: boolean;
  reason?: TargetUtilityGuardReason;
  message?: string;
  matchedNodes: number;
  actionableNodes: number;
  highConfidenceNodes: number;
  maxGoalScore: number;
}

const EXTRACTION_GOAL_PATTERN = /\b(what|which|who|whom|where|when|how many|count|title|name|company|price|headline|first|top|tagged|posted|list)\b/i;
const NAVIGATION_GOAL_PATTERN = /\b(open|navigate|go to|visit|click|submit|sign in|login|log in|checkout|continue|next page|download|apply)\b/i;
const SAME_PAGE_ANCHOR_SELECTOR_PATTERN = /href\s*=\s*["']?#/i;
const PAGINATION_PARAM_SELECTOR_PATTERN = /[?&](page|pg|start|offset)=\d+/i;
const PAGINATION_ATTR_SELECTOR_PATTERN = /(rel\s*=\s*["']next["']|aria-label\s*=\s*["'][^"']*next[^"']*["']|title\s*=\s*["'][^"']*next[^"']*["'])/i;
const PAGINATION_CHAIN_THRESHOLD = 3;
const PAGINATION_RECENT_READ_LOOKBACK = 5;

export function assessTargetUtilityGuard(
  action: Action,
  goal: string,
  graph: SemanticGraph,
  actionHistory: ActionHistoryEntry[] = [],
): TargetUtilityGuardSignal {
  if (!shouldEvaluateAction(action)) {
    return noBlock();
  }

  const matches = graph.snapshot.filter(node =>
    (node.type === 'trigger' || node.type === 'input')
    && selectorsEquivalent(node.sel, action.target),
  );

  if (matches.length === 0) {
    return noBlock();
  }

  const actionableNodes = matches.filter(isActionableNode).length;
  const nodesWithMeta = matches.filter(node => !!node.meta).length;
  const highConfidenceNodes = matches.filter(node => node.meta?.confidence === 'high').length;
  const maxGoalScore = Math.max(
    0,
    ...matches.map(node => node.meta?.goalScore ?? 0),
  );
  const maxSelectorScore = Math.max(
    0,
    ...matches.map(node => node.meta?.selectorScore ?? 0),
  );
  const strongGoalDataCount = countStrongGoalDataNodes(graph);
  const extractionGoal = EXTRACTION_GOAL_PATTERN.test(goal);
  const navigationGoal = NAVIGATION_GOAL_PATTERN.test(goal);
  const howManyGoal = /\b(how many|number of|count|total)\b/i.test(goal);
  const paginationSelector = isLikelyPaginationSelector(action.target, matches);

  if (nodesWithMeta === 0) {
    return {
      shouldBlock: false,
      matchedNodes: matches.length,
      actionableNodes,
      highConfidenceNodes,
      maxGoalScore,
    };
  }

  if (
    extractionGoal
    && !navigationGoal
    && action.target
    && SAME_PAGE_ANCHOR_SELECTOR_PATTERN.test(action.target)
  ) {
    return blocked(
      'same_page_anchor',
      matches.length,
      actionableNodes,
      highConfidenceNodes,
      maxGoalScore,
      'Planned click is a same-page anchor on an extraction-style goal; this usually does not reveal new answer data.',
    );
  }

  if (
    extractionGoal
    && !navigationGoal
    && isOutboundNavigationSelector(action.target)
    && strongGoalDataCount >= (howManyGoal ? 1 : 2)
    && maxGoalScore >= 12
  ) {
    return blocked(
      'read_before_navigation',
      matches.length,
      actionableNodes,
      highConfidenceNodes,
      maxGoalScore,
      'Current page already contains strong goal-relevant data; read/extract before outbound navigation clicks.',
    );
  }

  if (extractionGoal && !navigationGoal && paginationSelector) {
    const paginationChainCount = countConsecutivePaginationNavigations(actionHistory);
    const hasRecentRead = hasRecentReadObservation(actionHistory, PAGINATION_RECENT_READ_LOOKBACK);
    if (paginationChainCount >= PAGINATION_CHAIN_THRESHOLD && !hasRecentRead) {
      return blocked(
        'pagination_churn',
        matches.length,
        actionableNodes,
        highConfidenceNodes,
        maxGoalScore,
        'Repeated pagination navigation is not yielding an extracted answer. Inspect visible result data before moving to more pages.',
      );
    }
  }

  if (actionableNodes === 0 && highConfidenceNodes === 0) {
    return blocked(
      'low_actionability',
      matches.length,
      actionableNodes,
      highConfidenceNodes,
      maxGoalScore,
      'Planned click target has no visible actionable candidates; selector is likely stale, hidden, or low-confidence.',
    );
  }

  const ambiguous = isAmbiguousTarget(action, matches);
  const regionDataCount = countRegionDataNodes(graph, matches);
  if (
    extractionGoal
    && !navigationGoal
    && ambiguous
    && highConfidenceNodes === 0
    && maxGoalScore < 16
    && maxSelectorScore < 65
    && regionDataCount >= 2
  ) {
    return blocked(
      'read_before_click',
      matches.length,
      actionableNodes,
      highConfidenceNodes,
      maxGoalScore,
      'Planned click target is ambiguous and weakly relevant for an extraction goal with available region data.',
    );
  }

  return {
    shouldBlock: false,
    matchedNodes: matches.length,
    actionableNodes,
    highConfidenceNodes,
    maxGoalScore,
  };
}

export function buildTargetUtilityHistoryValue(signal: TargetUtilityGuardSignal): string | undefined {
  if (!signal.shouldBlock || !signal.reason) {
    return undefined;
  }
  return `utility_guard:${signal.reason}`;
}

function shouldEvaluateAction(action: Action): action is Action & { target: string } {
  return (action.kind === 'click' || action.kind === 'close')
    && typeof action.target === 'string'
    && action.target.length > 0;
}

function isActionableNode(node: FilteredNode): boolean {
  const visibility = node.meta?.visibility;
  const score = node.meta?.actionabilityScore ?? 0;
  const disabled = node.meta?.disabled === true;
  return visibility === 'visible' && !disabled && score >= 38;
}

function isAmbiguousTarget(action: Action, matches: FilteredNode[]): boolean {
  if (action.targetHint?.ambiguousSelector) {
    return true;
  }

  if (matches.length >= 3) {
    return true;
  }

  const uniqueStableHashes = new Set(
    matches
      .map(node => node.meta?.stableHash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  return uniqueStableHashes.size > 1;
}

function countRegionDataNodes(graph: SemanticGraph, matches: FilteredNode[]): number {
  const regions = new Set(
    matches
      .map(node => node.meta?.regionSelector)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  if (regions.size === 0) {
    return 0;
  }

  return graph.snapshot.filter(node =>
    (node.type === 'data' || node.type === 'table_cell')
    && !!node.meta?.regionSelector
    && regions.has(node.meta.regionSelector),
  ).length;
}

function countStrongGoalDataNodes(graph: SemanticGraph): number {
  return graph.snapshot.filter(node =>
    (node.type === 'data' || node.type === 'table_cell')
    && (node.meta?.visibility ?? 'visible') !== 'hidden'
    && (node.meta?.goalScore ?? 0) >= 20,
  ).length;
}

function isOutboundNavigationSelector(selector: string): boolean {
  if (SAME_PAGE_ANCHOR_SELECTOR_PATTERN.test(selector)) {
    return false;
  }

  return /href\s*=\s*["'](?:https?:\/\/|\/|\?)/i.test(selector);
}

function isLikelyPaginationSelector(selector: string, matches: FilteredNode[]): boolean {
  if (PAGINATION_PARAM_SELECTOR_PATTERN.test(selector) || PAGINATION_ATTR_SELECTOR_PATTERN.test(selector)) {
    return true;
  }

  const selectorHasNextWord = /\bnext\b/i.test(selector);
  if (selectorHasNextWord) {
    return true;
  }

  return matches.some(node => {
    const value = node.value.toLowerCase();
    return value === 'next' || value === '>' || value === '>>' || /^\d+$/.test(value);
  });
}

function countConsecutivePaginationNavigations(actionHistory: ActionHistoryEntry[]): number {
  let count = 0;

  for (let index = actionHistory.length - 1; index >= 0; index -= 1) {
    const entry = actionHistory[index]!;

    if (entry.result === 'plan_stale' && entry.value?.startsWith('utility_guard:')) {
      continue;
    }

    if (entry.result !== 'ok') {
      break;
    }

    if (isReadObservation(entry.action)) {
      break;
    }

    if (
      (entry.action === 'click' || entry.action === 'close')
      && entry.effect?.primarySignal === 'url_changed'
      && !!entry.selector
      && isLikelyPaginationSelector(entry.selector, [])
    ) {
      count += 1;
      continue;
    }

    break;
  }

  return count;
}

function hasRecentReadObservation(actionHistory: ActionHistoryEntry[], lookback: number): boolean {
  return actionHistory.slice(-lookback).some(entry => entry.result === 'ok' && isReadObservation(entry.action));
}

function isReadObservation(action: string): boolean {
  return action === 'get'
    || action === 'search_page'
    || action === 'find_elements'
    || action === 'count_elements'
    || action === 'inspect_region';
}

function noBlock(): TargetUtilityGuardSignal {
  return {
    shouldBlock: false,
    matchedNodes: 0,
    actionableNodes: 0,
    highConfidenceNodes: 0,
    maxGoalScore: 0,
  };
}

function blocked(
  reason: TargetUtilityGuardReason,
  matchedNodes: number,
  actionableNodes: number,
  highConfidenceNodes: number,
  maxGoalScore: number,
  message: string,
): TargetUtilityGuardSignal {
  return {
    shouldBlock: true,
    reason,
    message,
    matchedNodes,
    actionableNodes,
    highConfidenceNodes,
    maxGoalScore,
  };
}
