import type { FilteredNode } from '../brain1/types';
import type { Action } from '../executor/types';
import type { ActionHistoryEntry } from '../graph/serializer';
import type { SemanticGraph } from '../graph/types';
import { normalizeSelectorForComparison, selectorFamilyFingerprint, selectorsEquivalent } from './selectorMatch';

export type TargetUtilityGuardReason =
  | 'read_before_click'
  | 'low_actionability'
  | 'same_page_anchor'
  | 'read_before_navigation'
  | 'pagination_churn'
  | 'pagination_answer_observed'
  | 'read_after_interaction_churn'
  | 'read_after_submit_transition'
  | 'submit_control_recovery'
  | 'weak_interaction_repeat'
  | 'stale_read_selector';

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
const READ_SELECTOR_NOT_FOUND_THRESHOLD = 2;
const READ_SELECTOR_NOT_FOUND_FAMILY_THRESHOLD = 2;
const READ_SELECTOR_NOT_FOUND_LOOKBACK = 12;
const INTERACTION_READ_CHURN_WINDOW = 10;
const INTERACTION_READ_CHURN_THRESHOLD = 6;
const FORM_SUBMIT_TRANSITION_WINDOW = 12;
const FORM_SUBMIT_FAILURE_THRESHOLD = 1;
const WEAK_INTERACTION_REPEAT_THRESHOLD = 2;
const READ_EMPTY_PATTERN = /\b(not found|no matches found|found 0 elements|count for ".+": 0)\b/i;
const MULTI_PAGE_GOAL_PATTERN = /\b(page\s*(?:[3-9]|\d{2,})|third page|fourth page|fifth page|multiple pages|next \d+ pages)\b/i;
const SUBMIT_SELECTOR_PATTERN = /\b(type\s*=\s*["']submit["']|submit|search|find|apply|go|query|lookup)\b/i;
const SUBMIT_TEXT_PATTERN = /\b(search|submit|find|apply|go|lookup|show results?|view results?)\b/i;

export function assessTargetUtilityGuard(
  action: Action,
  goal: string,
  graph: SemanticGraph,
  actionHistory: ActionHistoryEntry[] = [],
): TargetUtilityGuardSignal {
  if (isGuardedReadAction(action)) {
    return assessReadTargetUtility(action, graph, actionHistory);
  }

  if (!shouldEvaluateAction(action)) {
    return noBlock();
  }

  const matches = graph.snapshot.filter(node =>
    (node.type === 'trigger' || node.type === 'input')
    && selectorsEquivalent(node.sel, action.target),
  );
  const extractionGoal = EXTRACTION_GOAL_PATTERN.test(goal);
  const navigationGoal = NAVIGATION_GOAL_PATTERN.test(goal);
  const howManyGoal = /\b(how many|number of|count|total)\b/i.test(goal);
  const paginationSelector = isLikelyPaginationSelector(action.target, matches);
  const interactionReadChurn = extractionGoal && !navigationGoal
    ? getInteractionWithoutReadPattern(actionHistory)
    : undefined;
  const readRequired = extractionGoal && paginationSelector
    ? isPaginationReadRequired(actionHistory, goal)
    : false;
  const formSubmitTransition = extractionGoal
    ? getFormSubmitTransitionPattern(actionHistory)
    : undefined;
  const submitRecoveryPattern = extractionGoal
    ? getSubmitControlRecoveryPattern(actionHistory)
    : undefined;
  const weakInteractionRepeatPattern = extractionGoal
    ? getWeakInteractionRepeatPattern(actionHistory)
    : undefined;
  const likelySubmitTarget = action.target
    ? isLikelySubmitTarget(action.target, matches)
    : false;
  const hasRecentFormInput = extractionGoal
    ? countRecentFormInputActions(actionHistory) > 0
    : false;
  const shouldEnforceReadAfterSubmitTransition = !!(
    extractionGoal
    && formSubmitTransition
    && formSubmitTransition.hasPendingSubmitRead
    && formSubmitTransition.recentFormInputCount > 0
    && isFormInteractionAction(action.kind)
  );
  const shouldEnforceSubmitControlRecovery = !!(
    extractionGoal
    && submitRecoveryPattern
    && submitRecoveryPattern.failedSubmitLikeCount >= FORM_SUBMIT_FAILURE_THRESHOLD
    && submitRecoveryPattern.hasPendingFailureRead
    && submitRecoveryPattern.recentFormInputCount > 0
    && (action.kind === 'type' || action.kind === 'select')
  );
  const shouldEnforceWeakInteractionRepeat = !!(
    extractionGoal
    && weakInteractionRepeatPattern
    && weakInteractionRepeatPattern.repeatCount >= WEAK_INTERACTION_REPEAT_THRESHOLD
    && weakInteractionRepeatPattern.hasPendingRecovery
    && weakInteractionRepeatPattern.recentFormInputCount > 0
    && (
      ((action.kind === 'click' || action.kind === 'close')
        && selectorsEquivalent(action.target, weakInteractionRepeatPattern.selector))
      || action.kind === 'type'
      || action.kind === 'select'
    )
  );
  const answerAlreadyObserved = extractionGoal
    && paginationSelector
    && !MULTI_PAGE_GOAL_PATTERN.test(goal)
    && hasAnswerEvidenceSinceLastPagination(actionHistory);

  if (answerAlreadyObserved) {
    return blocked(
      'pagination_answer_observed',
      matches.length,
      0,
      0,
      0,
      'Answer evidence was already observed after the last pagination step. Do not continue paginating; extract/finalize from the current page.',
    );
  }

  if (readRequired) {
    return blocked(
      'pagination_churn',
      matches.length,
      0,
      0,
      0,
      'A recent pagination click changed the page, but no answer-evidence read followed. Use get/find_elements/count_elements/search_page now before any further pagination.',
    );
  }

  if (
    interactionReadChurn
    && interactionReadChurn.interactionCount >= INTERACTION_READ_CHURN_THRESHOLD
    && interactionReadChurn.readObservationCount === 0
  ) {
    return blocked(
      'read_after_interaction_churn',
      matches.length,
      0,
      0,
      0,
      'Recent steps performed many interactions without any read observation. Pause clicking and use read-only tools (get/find_elements/count_elements/search_page/inspect_region) to verify answer evidence from the current page.',
    );
  }

  if (shouldEnforceReadAfterSubmitTransition) {
    return blocked(
      'read_after_submit_transition',
      matches.length,
      0,
      0,
      0,
      'A recent submit-like interaction likely completed form entry, but no read evidence has been collected since then. Switch to read-only tools now (get/find_elements/count_elements/search_page) before further typing/clicking.',
    );
  }

  if (shouldEnforceSubmitControlRecovery) {
    return blocked(
      'submit_control_recovery',
      matches.length,
      0,
      0,
      0,
      'A submit-like control failed after recent form entry, and no read/discovery step followed. Do not keep retyping fields. Use read-only discovery (find_elements/get/search_page) to locate the actionable submit or result region first.',
    );
  }

  if (shouldEnforceWeakInteractionRepeat) {
    return blocked(
      'weak_interaction_repeat',
      matches.length,
      0,
      0,
      0,
      'The same weak interaction target has been clicked repeatedly after form entry without producing answer evidence or a result-page transition. Stop repeating this control. Use read-only discovery to locate a true submit/result target first.',
    );
  }

  if (matches.length === 0) {
    if (extractionGoal && paginationSelector) {
      const paginationChainCount = countConsecutivePaginationNavigations(actionHistory);
      const hasRecentRead = hasRecentAnswerEvidenceObservation(actionHistory, PAGINATION_RECENT_READ_LOOKBACK);
      if (paginationChainCount >= PAGINATION_CHAIN_THRESHOLD && !hasRecentRead) {
        return blocked(
          'pagination_churn',
          0,
          0,
          0,
          0,
          'Repeated pagination navigation is not yielding an extracted answer. Inspect visible result data before moving to more pages.',
        );
      }
    }
    return noBlock();
  }

  const actionableNodes = matches.filter(isActionableNode).length;
  const nodesWithMeta = matches.filter(node => !!node.meta).length;
  const highConfidenceNodes = matches.filter(node => node.meta?.confidence === 'high').length;
  const maxGoalScore = Math.max(0, ...matches.map(node => node.meta?.goalScore ?? 0));
  const maxSelectorScore = Math.max(0, ...matches.map(node => node.meta?.selectorScore ?? 0));
  const strongGoalDataCount = countStrongGoalDataNodes(graph);
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

  if (extractionGoal && paginationSelector) {
    const paginationChainCount = countConsecutivePaginationNavigations(actionHistory);
    const hasRecentRead = hasRecentAnswerEvidenceObservation(actionHistory, PAGINATION_RECENT_READ_LOOKBACK);
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
    && !(likelySubmitTarget && hasRecentFormInput)
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
  return (action.kind === 'click' || action.kind === 'close' || action.kind === 'type' || action.kind === 'select')
    && typeof action.target === 'string'
    && action.target.length > 0;
}

function isGuardedReadAction(action: Action): action is Action & { kind: 'get' | 'find_elements' | 'count_elements'; target: string } {
  return (action.kind === 'get' || action.kind === 'find_elements' || action.kind === 'count_elements')
    && typeof action.target === 'string'
    && action.target.length > 0;
}

function assessReadTargetUtility(
  action: Action & { kind: 'get' | 'find_elements' | 'count_elements'; target: string },
  graph: SemanticGraph,
  actionHistory: ActionHistoryEntry[],
): TargetUtilityGuardSignal {
  const matches = graph.snapshot.filter(node => selectorsEquivalent(node.sel, action.target));
  if (action.kind === 'get' && matches.length > 0) {
    return {
      shouldBlock: false,
      matchedNodes: matches.length,
      actionableNodes: 0,
      highConfidenceNodes: matches.filter(node => node.meta?.confidence === 'high').length,
      maxGoalScore: Math.max(0, ...matches.map(node => node.meta?.goalScore ?? 0)),
    };
  }

  const brittleSelector = isLikelyBrittleReadSelector(action.target);
  const repeatedNotFoundCount = countRepeatedNotFoundReads(action.target, actionHistory);
  const repeatedFamilyNotFoundCount = countRepeatedNotFoundReadFamily(action.target, actionHistory);
  const repeatedZeroMatchCount = countRepeatedZeroMatchReads(action.kind, action.target, actionHistory);
  if (
    brittleSelector
    || repeatedNotFoundCount >= READ_SELECTOR_NOT_FOUND_THRESHOLD
    || repeatedFamilyNotFoundCount >= READ_SELECTOR_NOT_FOUND_FAMILY_THRESHOLD
    || repeatedZeroMatchCount >= READ_SELECTOR_NOT_FOUND_THRESHOLD
  ) {
    return blocked(
      'stale_read_selector',
      0,
      0,
      0,
      0,
      'Planned get selector is not present in the current snapshot and appears stale or overly positional. Replan using a visible selector or read-only discovery tools first; avoid trying sibling positional variants of the same selector family.',
    );
  }

  return noBlock();
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
  const normalizedSelector = normalizePaginationSelector(selector);

  if (
    PAGINATION_PARAM_SELECTOR_PATTERN.test(selector)
    || PAGINATION_ATTR_SELECTOR_PATTERN.test(selector)
    || PAGINATION_PARAM_SELECTOR_PATTERN.test(normalizedSelector)
    || PAGINATION_ATTR_SELECTOR_PATTERN.test(normalizedSelector)
  ) {
    return true;
  }

  const selectorHasNextWord = /\bnext\b/i.test(selector) || /\bnext\b/i.test(normalizedSelector);
  if (selectorHasNextWord) {
    return true;
  }

  return matches.some(node => {
    const value = node.value.toLowerCase();
    return value === 'next' || value === '>' || value === '>>' || /^\d+$/.test(value);
  });
}

function normalizePaginationSelector(selector: string): string {
  return normalizeSelectorForComparison(selector)
    .replace(/\\+([?&=\/])/g, '$1');
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

    if (entry.action === 'inspect_region') {
      continue;
    }

    if (isReadObservation(entry.action)) {
      if (isAnswerEvidenceReadEntry(entry)) {
        break;
      }
      continue;
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

function isPaginationReadRequired(actionHistory: ActionHistoryEntry[], goal: string): boolean {
  if (MULTI_PAGE_GOAL_PATTERN.test(goal)) {
    return false;
  }

  let lastPaginationClickIndex = -1;
  for (let index = actionHistory.length - 1; index >= 0; index -= 1) {
    const entry = actionHistory[index]!;
    if (
      entry.result === 'ok'
      && (entry.action === 'click' || entry.action === 'close')
      && entry.effect?.primarySignal === 'url_changed'
      && !!entry.selector
      && isLikelyPaginationSelector(entry.selector, [])
    ) {
      lastPaginationClickIndex = index;
      break;
    }
  }

  if (lastPaginationClickIndex === -1) {
    return false;
  }

  for (let index = lastPaginationClickIndex + 1; index < actionHistory.length; index += 1) {
    const entry = actionHistory[index]!;
    if (entry.result !== 'ok') {
      continue;
    }
    if (!isExtractionEvidenceObservation(entry.action)) {
      continue;
    }
    if (isAnswerEvidenceReadEntry(entry)) {
      return false;
    }
  }

  return true;
}

function hasRecentAnswerEvidenceObservation(actionHistory: ActionHistoryEntry[], lookback: number): boolean {
  return actionHistory.slice(-lookback).some(entry =>
    entry.result === 'ok'
    && isExtractionEvidenceObservation(entry.action)
    && isAnswerEvidenceReadEntry(entry),
  );
}

function hasAnswerEvidenceSinceLastPagination(actionHistory: ActionHistoryEntry[]): boolean {
  let lastPaginationClickIndex = -1;
  for (let index = actionHistory.length - 1; index >= 0; index -= 1) {
    const entry = actionHistory[index]!;
    if (
      entry.result === 'ok'
      && (entry.action === 'click' || entry.action === 'close')
      && entry.effect?.primarySignal === 'url_changed'
      && !!entry.selector
      && isLikelyPaginationSelector(entry.selector, [])
    ) {
      lastPaginationClickIndex = index;
      break;
    }
  }

  if (lastPaginationClickIndex === -1) {
    return false;
  }

  for (let index = lastPaginationClickIndex + 1; index < actionHistory.length; index += 1) {
    const entry = actionHistory[index]!;
    if (entry.result !== 'ok') {
      continue;
    }
    if (!isExtractionEvidenceObservation(entry.action)) {
      continue;
    }
    if (isAnswerEvidenceReadEntry(entry)) {
      return true;
    }
  }

  return false;
}

function getInteractionWithoutReadPattern(actionHistory: ActionHistoryEntry[]): {
  interactionCount: number;
  readObservationCount: number;
} {
  const recent = actionHistory.slice(-INTERACTION_READ_CHURN_WINDOW);

  let interactionCount = 0;
  let readObservationCount = 0;

  for (const entry of recent) {
    if (entry.result !== 'ok' && entry.result !== 'no_progress') {
      continue;
    }

    if (isReadObservation(entry.action)) {
      readObservationCount += 1;
      continue;
    }

    if (isInteractionAction(entry.action)) {
      interactionCount += 1;
    }
  }

  return { interactionCount, readObservationCount };
}

function isInteractionAction(action: string): boolean {
  return action === 'click'
    || action === 'close'
    || action === 'type'
    || action === 'select'
    || action === 'scroll'
    || action === 'wait';
}

function isAnswerEvidenceReadEntry(entry: ActionHistoryEntry): boolean {
  if (entry.readOutcome === 'answer_evidence') {
    return true;
  }
  if (entry.readOutcome === 'context_only' || entry.readOutcome === 'noise_repeat') {
    return false;
  }

  const value = (entry.value ?? '').trim();
  if (!value) {
    return false;
  }
  if (READ_EMPTY_PATTERN.test(value)) {
    return false;
  }
  if (/^Region ".+" contains \d+ notable node/i.test(value)) {
    return false;
  }
  if (/^Found \d+ elements? matching ".+"/i.test(value)) {
    return false;
  }
  if (entry.action === 'search_page' && /^Found \d+ matches? for ".+"/i.test(value)) {
    return false;
  }
  if (entry.action === 'count_elements' && /^Count for ".+": \d+/i.test(value)) {
    return true;
  }
  if (entry.action === 'get') {
    return true;
  }
  return /(?:\$|usd|eur|gbp|inr)|\b\d[\d,]*(?:\.\d+)?\b/i.test(value);
}

function isReadObservation(action: string): boolean {
  return action === 'get'
    || action === 'search_page'
    || action === 'find_elements'
    || action === 'count_elements'
    || action === 'inspect_region';
}

function isFormInteractionAction(action: Action['kind']): boolean {
  return action === 'click'
    || action === 'close'
    || action === 'type'
    || action === 'select';
}

function countRecentFormInputActions(actionHistory: ActionHistoryEntry[]): number {
  return actionHistory.slice(-FORM_SUBMIT_TRANSITION_WINDOW).filter(entry =>
    entry.result === 'ok'
    && (entry.action === 'type' || entry.action === 'select')
    && typeof entry.selector === 'string'
    && entry.selector.length > 0,
  ).length;
}

function getSubmitControlRecoveryPattern(actionHistory: ActionHistoryEntry[]): {
  failedSubmitLikeCount: number;
  hasPendingFailureRead: boolean;
  recentFormInputCount: number;
} {
  const recent = actionHistory.slice(-FORM_SUBMIT_TRANSITION_WINDOW);
  if (recent.length === 0) {
    return {
      failedSubmitLikeCount: 0,
      hasPendingFailureRead: false,
      recentFormInputCount: 0,
    };
  }

  const recentFormInputCount = recent.filter(entry =>
    entry.result === 'ok'
    && (entry.action === 'type' || entry.action === 'select'),
  ).length;

  let formInputsSeen = 0;
  const failureIndices: number[] = [];
  for (let index = 0; index < recent.length; index += 1) {
    const entry = recent[index]!;
    if (entry.result === 'ok' && (entry.action === 'type' || entry.action === 'select')) {
      formInputsSeen += 1;
      continue;
    }
    if (isSubmitLikeFailureEntry(entry, formInputsSeen)) {
      failureIndices.push(index);
    }
  }

  if (failureIndices.length === 0) {
    return {
      failedSubmitLikeCount: 0,
      hasPendingFailureRead: false,
      recentFormInputCount,
    };
  }

  const lastFailureIndex = failureIndices[failureIndices.length - 1]!;
  const hasReadAfterFailure = recent.slice(lastFailureIndex + 1).some(entry =>
    entry.result === 'ok'
    && isExtractionEvidenceObservation(entry.action),
  );

  return {
    failedSubmitLikeCount: failureIndices.length,
    hasPendingFailureRead: !hasReadAfterFailure,
    recentFormInputCount,
  };
}

function getWeakInteractionRepeatPattern(actionHistory: ActionHistoryEntry[]): {
  selector: string;
  repeatCount: number;
  recentFormInputCount: number;
  hasPendingRecovery: boolean;
} | undefined {
  const recent = actionHistory.slice(-FORM_SUBMIT_TRANSITION_WINDOW);
  if (recent.length === 0) {
    return undefined;
  }

  const recentFormInputCount = recent.filter(entry =>
    entry.result === 'ok'
    && (entry.action === 'type' || entry.action === 'select'),
  ).length;
  if (recentFormInputCount === 0) {
    return undefined;
  }

  const weakClickEntries = recent
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      entry.result === 'ok'
      && (entry.action === 'click' || entry.action === 'close')
      && typeof entry.selector === 'string'
      && entry.selector.length > 0
      && !isStrongTransitionEntry(entry),
    );

  if (weakClickEntries.length === 0) {
    return undefined;
  }

  const perSelector = new Map<string, number>();
  for (const { entry } of weakClickEntries) {
    const selector = entry.selector!;
    perSelector.set(selector, (perSelector.get(selector) ?? 0) + 1);
  }

  let bestSelector: string | undefined;
  let bestCount = 0;
  for (const [selector, count] of perSelector.entries()) {
    if (count > bestCount) {
      bestSelector = selector;
      bestCount = count;
    }
  }

  if (!bestSelector || bestCount < WEAK_INTERACTION_REPEAT_THRESHOLD) {
    return undefined;
  }

  const firstSelectorWeakClickIndex = weakClickEntries.find(({ entry }) =>
    selectorsEquivalent(entry.selector, bestSelector),
  )?.index;
  if (firstSelectorWeakClickIndex === undefined) {
    return undefined;
  }

  const subsequent = recent.slice(firstSelectorWeakClickIndex + 1);
  const hasResultTransition = subsequent.some(isStrongTransitionEntry);
  const hasAnswerEvidence = subsequent.some(entry =>
    entry.result === 'ok'
    && isExtractionEvidenceObservation(entry.action)
    && isAnswerEvidenceReadEntry(entry),
  );

  return {
    selector: bestSelector,
    repeatCount: bestCount,
    recentFormInputCount,
    hasPendingRecovery: !hasResultTransition && !hasAnswerEvidence,
  };
}

function getFormSubmitTransitionPattern(actionHistory: ActionHistoryEntry[]): {
  hasPendingSubmitRead: boolean;
  recentSubmitLikeCount: number;
  recentFormInputCount: number;
} {
  const recent = actionHistory.slice(-FORM_SUBMIT_TRANSITION_WINDOW);
  if (recent.length === 0) {
    return {
      hasPendingSubmitRead: false,
      recentSubmitLikeCount: 0,
      recentFormInputCount: 0,
    };
  }

  const recentFormInputCount = recent.filter(entry =>
    entry.result === 'ok'
    && (entry.action === 'type' || entry.action === 'select'),
  ).length;

  let lastSubmitLikeIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index]!;
    if (!isSubmitLikeInteractionEntry(entry)) {
      continue;
    }
    lastSubmitLikeIndex = index;
    break;
  }

  if (lastSubmitLikeIndex < 0) {
    return {
      hasPendingSubmitRead: false,
      recentSubmitLikeCount: 0,
      recentFormInputCount,
    };
  }

  const recentSubmitLikeCount = recent.filter(entry => isSubmitLikeInteractionEntry(entry)).length;
  const hasReadAfterSubmit = recent.slice(lastSubmitLikeIndex + 1).some(entry =>
    entry.result === 'ok'
    && isExtractionEvidenceObservation(entry.action),
  );

  return {
    hasPendingSubmitRead: !hasReadAfterSubmit,
    recentSubmitLikeCount,
    recentFormInputCount,
  };
}

function isSubmitLikeInteractionEntry(entry: ActionHistoryEntry): boolean {
  if (entry.result !== 'ok') {
    return false;
  }
  if (entry.action !== 'click' && entry.action !== 'close') {
    return false;
  }
  const selector = entry.selector ?? '';
  if (SUBMIT_SELECTOR_PATTERN.test(selector)) {
    return true;
  }
  const valueSample = `${entry.value ?? ''} ${entry.effect?.targetValue ?? ''}`.trim();
  if (!valueSample) {
    return false;
  }
  return SUBMIT_TEXT_PATTERN.test(valueSample);
}

function isSubmitLikeFailureEntry(entry: ActionHistoryEntry, formInputsSeen: number): boolean {
  if (entry.action !== 'click' && entry.action !== 'close') {
    return false;
  }

  if (
    entry.result !== 'not_found'
    && entry.result !== 'not_interactable'
    && entry.result !== 'execution_error'
    && entry.result !== 'timeout'
  ) {
    return false;
  }

  const selector = entry.selector ?? '';
  if (SUBMIT_SELECTOR_PATTERN.test(selector)) {
    return true;
  }

  const valueSample = `${entry.value ?? ''} ${entry.effect?.targetValue ?? ''}`.trim();
  if (valueSample && SUBMIT_TEXT_PATTERN.test(valueSample)) {
    return true;
  }

  return formInputsSeen >= 2;
}

function isStrongTransitionEntry(entry: ActionHistoryEntry): boolean {
  if (entry.result !== 'ok') {
    return false;
  }

  return entry.effect?.primarySignal === 'url_changed'
    || (entry.effect?.signals ?? []).includes('url_changed');
}

function isLikelySubmitTarget(selector: string, matches: FilteredNode[]): boolean {
  if (SUBMIT_SELECTOR_PATTERN.test(selector)) {
    return true;
  }

  return matches.some(node => {
    const nodeText = `${node.value} ${node.attrs?.ariaLabel ?? ''} ${node.attrs?.name ?? ''}`.trim();
    if (SUBMIT_TEXT_PATTERN.test(nodeText)) {
      return true;
    }
    const role = (node.meta?.role ?? node.attrs?.role ?? '').toLowerCase();
    const inputType = (node.attrs?.inputType ?? '').toLowerCase();
    if (inputType === 'submit') {
      return true;
    }
    if (role === 'button' && SUBMIT_TEXT_PATTERN.test(nodeText)) {
      return true;
    }
    return false;
  });
}

function countRepeatedNotFoundReads(selector: string, actionHistory: ActionHistoryEntry[]): number {
  return actionHistory.slice(-READ_SELECTOR_NOT_FOUND_LOOKBACK).filter(entry =>
    entry.action === 'get'
    && entry.result === 'not_found'
    && typeof entry.selector === 'string'
    && selectorsEquivalent(entry.selector, selector),
  ).length;
}

function countRepeatedNotFoundReadFamily(selector: string, actionHistory: ActionHistoryEntry[]): number {
  const selectorFamily = selectorFamilyFingerprint(selector);
  return actionHistory.slice(-READ_SELECTOR_NOT_FOUND_LOOKBACK).filter(entry =>
    entry.action === 'get'
    && entry.result === 'not_found'
    && typeof entry.selector === 'string'
    && selectorFamilyFingerprint(entry.selector) === selectorFamily,
  ).length;
}

function countRepeatedZeroMatchReads(
  actionKind: 'get' | 'find_elements' | 'count_elements',
  selector: string,
  actionHistory: ActionHistoryEntry[],
): number {
  return actionHistory.slice(-READ_SELECTOR_NOT_FOUND_LOOKBACK).filter(entry =>
    entry.action === actionKind
    && (entry.result === 'ok' || entry.result === 'no_progress')
    && typeof entry.selector === 'string'
    && selectorsEquivalent(entry.selector, selector)
    && isZeroMatchReadEntry(entry),
  ).length;
}

function isLikelyBrittleReadSelector(selector: string): boolean {
  const normalized = normalizeSelectorForComparison(selector);
  if (!normalized) {
    return false;
  }

  if (normalized.length >= 180) {
    return true;
  }

  const segments = normalized.split('>').map(segment => segment.trim()).filter(Boolean);
  const depth = segments.length;
  const nthSegments = segments.filter(segment => /:nth-(?:of-type|child)\(/i.test(segment)).length;
  const genericSegments = segments.filter(segment => /^(div|span|section|article|li|tr|td|th)(?:[:.#\[]|$)/i.test(segment)).length;

  if (depth >= 5 && genericSegments >= 3) {
    return true;
  }

  if (depth >= 4 && nthSegments >= 2) {
    return true;
  }

  return false;
}

function isZeroMatchReadEntry(entry: ActionHistoryEntry): boolean {
  if (entry.readOutcome === 'noise_repeat') {
    return true;
  }

  const value = (entry.value ?? '').trim();
  if (!value) {
    return false;
  }

  return READ_EMPTY_PATTERN.test(value)
    || /^Found 0 elements matching ".+"/i.test(value)
    || /^Count for ".+": 0/i.test(value);
}

function isExtractionEvidenceObservation(action: string): boolean {
  return action === 'get'
    || action === 'search_page'
    || action === 'find_elements'
    || action === 'count_elements';
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
