import { logger } from '../logger';
import { serializeGraph, type ActionHistoryEntry } from '../graph/serializer';
import { callLLM, type EscalationContext, type LLMCallResult } from './llm';
import { executePlan } from './planExecutor';
import type { SemanticGraph } from '../graph/types';
import type { Executor } from '../executor/executor';
import { LoopDetector } from './loopDetector';
import { selectorFamilyFingerprint } from './selectorMatch';
import { getRuntimeConfig } from '../config/runtime';
import { extractAnswerCandidate } from './readOutcome';

const MAX_STEPS = 15;
const STALE_SELECTOR_NOT_FOUND_THRESHOLD = 3;
const STALE_SELECTOR_WINDOW = 8;
const UTILITY_GUARD_REPLAN_WARNING_THRESHOLD = 2;
const UTILITY_GUARD_REPLAN_ABORT_THRESHOLD = 4;
const UTILITY_GUARD_REPLAN_WINDOW = 8;
const UTILITY_GUARD_ACCUMULATED_WINDOW = 10;
const UTILITY_GUARD_ACCUMULATED_ABORT_THRESHOLD = 3;
const UTILITY_GUARD_ACCUMULATED_STAGNATION_THRESHOLD = 4;
const RECENT_NO_PROGRESS_WINDOW = 3;
const NO_PROGRESS_STAGNATION_ABORT_THRESHOLD = 6;
const LOW_VALUE_READ_WINDOW = 8;
const LOW_VALUE_READ_WARNING_THRESHOLD = 3;
const LOW_VALUE_READ_ABORT_THRESHOLD = 5;
const LOW_VALUE_READ_ABORT_STAGNATION_THRESHOLD = 4;
const LOW_VALUE_READ_REPEAT_VALUE_THRESHOLD = 3;
const SEARCH_MISS_WINDOW = 8;
const SEARCH_MISS_WARNING_THRESHOLD = 2;
const SEARCH_MISS_ABORT_THRESHOLD = 4;
const SEARCH_MISS_ABORT_STAGNATION_THRESHOLD = 4;
const ANSWER_EVIDENCE_LOOKBACK = 10;
const STALE_SELECTOR_FAMILY_NOT_FOUND_THRESHOLD = 2;
const STALE_SELECTOR_FAMILY_SAMPLE_LIMIT = 2;

export interface AgentLoopConfig {
  goal: string;
  graph: SemanticGraph;
  executor: Executor;
  maxSteps?: number;
  beforeStep?: () => Promise<void>;
  afterAct?: () => Promise<void>;
  llmCaller?: (ctx: EscalationContext) => Promise<LLMCallResult>;
  planMutationWaitMs?: number;
}

export interface AgentResult {
  success: boolean;
  value?: string;
  totalSteps: number;
  llmCallCount: number;
  llmCallReasons: string[];
  failureReason?: string;
  actionHistory: ActionHistoryEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLlmDurationMs: number;
}

interface UtilityGuardPattern {
  reason: string;
  count: number;
}

interface LowValueReadPattern {
  count: number;
  repeatedValueCount: number;
  repeatedAction?: string;
  repeatedSelector?: string;
  repeatedValue?: string;
}

interface SearchMissPattern {
  count: number;
  selector?: string;
  selectorCount?: number;
  value?: string;
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentResult> {
  const { goal, graph, executor, maxSteps = MAX_STEPS } = config;
  const llmCaller = config.llmCaller ?? callLLM;
  let steps = 0;
  let llmCallCount = 0;
  const llmCallReasons: string[] = [];
  const actionHistory: ActionHistoryEntry[] = [];
  const loopDetector = new LoopDetector();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLlmDurationMs = 0;

  logger.info('agent:loop', 'Starting agent loop', { goal, maxSteps });

  const dataNodes = graph.snapshot.filter(node => node.type === 'data' || node.type === 'table_cell');
  if (dataNodes.length < 3) {
    logger.warn('agent:loop', 'Near-empty snapshot - likely error/CAPTCHA/consent wall', {
      totalNodes: graph.snapshot.length,
      dataNodes: dataNodes.length,
    });
    return {
      success: false,
      value: '',
      totalSteps: 0,
      llmCallCount: 0,
      llmCallReasons: [],
      actionHistory: [],
      failureReason: 'user_needed: near-empty page (likely error/CAPTCHA/consent wall)',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalLlmDurationMs: 0,
    };
  }

  while (steps < maxSteps) {
    steps++;

    if (config.beforeStep) {
      await config.beforeStep();
    }

    loopDetector.recordGraphState(graph);
    const loopSignal = loopDetector.getSignal();
    const repeatedUtilityGuard = getRepeatedUtilityGuardPattern(actionHistory);
    const accumulatedUtilityGuard = getAccumulatedUtilityGuardPattern(actionHistory);
    const lowValueReadPattern = getLowValueReadPattern(actionHistory);
    const searchMissPattern = getRepeatedSearchMissPattern(actionHistory);
    if (repeatedUtilityGuard && repeatedUtilityGuard.count >= UTILITY_GUARD_REPLAN_ABORT_THRESHOLD) {
      logger.warn('agent:loop', 'Repeated utility-guard replans detected', {
        step: steps,
        reason: repeatedUtilityGuard.reason,
        count: repeatedUtilityGuard.count,
        decision: 'abort',
      });
      return {
        success: false,
        failureReason: 'no_progress_detected',
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }
    if (
      accumulatedUtilityGuard
      && accumulatedUtilityGuard.count >= UTILITY_GUARD_ACCUMULATED_ABORT_THRESHOLD
      && (loopSignal?.stagnantSteps ?? 0) >= UTILITY_GUARD_ACCUMULATED_STAGNATION_THRESHOLD
    ) {
      logger.warn('agent:loop', 'Accumulated utility-guard churn detected', {
        step: steps,
        reason: accumulatedUtilityGuard.reason,
        count: accumulatedUtilityGuard.count,
        stagnantSteps: loopSignal?.stagnantSteps ?? 0,
        decision: 'abort',
      });
      return {
        success: false,
        failureReason: 'no_progress_detected',
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }
    if (
      lowValueReadPattern
      && lowValueReadPattern.count >= LOW_VALUE_READ_ABORT_THRESHOLD
      && lowValueReadPattern.repeatedValueCount >= LOW_VALUE_READ_REPEAT_VALUE_THRESHOLD
      && (loopSignal?.stagnantSteps ?? 0) >= LOW_VALUE_READ_ABORT_STAGNATION_THRESHOLD
    ) {
      logger.warn('agent:loop', 'Persistent low-value read churn detected', {
        step: steps,
        count: lowValueReadPattern.count,
        repeatedValueCount: lowValueReadPattern.repeatedValueCount,
        repeatedAction: lowValueReadPattern.repeatedAction,
        repeatedSelector: lowValueReadPattern.repeatedSelector,
        stagnantSteps: loopSignal?.stagnantSteps ?? 0,
        decision: 'abort',
      });
      return {
        success: false,
        failureReason: 'no_progress_detected',
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }
    if (
      searchMissPattern
      && searchMissPattern.count >= SEARCH_MISS_ABORT_THRESHOLD
      && (loopSignal?.stagnantSteps ?? 0) >= SEARCH_MISS_ABORT_STAGNATION_THRESHOLD
    ) {
      logger.warn('agent:loop', 'Repeated no-match search_page churn detected', {
        step: steps,
        count: searchMissPattern.count,
        selector: searchMissPattern.selector,
        selectorCount: searchMissPattern.selectorCount,
        value: searchMissPattern.value,
        stagnantSteps: loopSignal?.stagnantSteps ?? 0,
        decision: 'abort',
      });
      return {
        success: false,
        failureReason: 'no_progress_detected',
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }
    const executionWarnings = buildExecutionWarnings(actionHistory, repeatedUtilityGuard, goal);
    if (loopSignal) {
      logger.warn('agent:loop', 'Loop signal detected', {
        step: steps,
        severity: loopSignal.severity,
        type: loopSignal.type,
        repeatedFingerprint: loopSignal.repeatedFingerprint,
        repetitionCount: loopSignal.repetitionCount,
        stagnantSteps: loopSignal.stagnantSteps,
        shouldAbort: loopSignal.shouldAbort,
      });
      if (loopSignal.shouldAbort) {
        return {
          success: false,
          failureReason: 'no_progress_detected',
          totalSteps: steps,
          llmCallCount,
          llmCallReasons,
          actionHistory,
          totalInputTokens,
          totalOutputTokens,
          totalLlmDurationMs,
        };
      }
    }
    if (shouldAbortForPersistentNoProgress(actionHistory, loopSignal)) {
      logger.warn('agent:loop', 'Persistent no-progress with stagnant graph detected', {
        step: steps,
        stagnantSteps: loopSignal?.stagnantSteps ?? 0,
        lookback: RECENT_NO_PROGRESS_WINDOW,
      });
      return {
        success: false,
        failureReason: 'no_progress_detected',
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }

    logger.info('agent:loop', `Step ${steps}`, { goal, graphStatus: graph.status });

    const { serialized } = serializeGraph(graph, goal, actionHistory);
    const graphJson = JSON.stringify(serialized);

    llmCallCount++;
    llmCallReasons.push(`step_${steps}`);

    logger.info('agent:loop', 'Calling LLM', { step: steps, goal });

    const llmCallResult = await llmCaller({
      goal,
      graphJson,
      actionHistory,
      reason: `step_${steps}`,
      stepCount: steps,
      contextWarnings: buildContextWarnings(loopSignal?.message, executionWarnings),
    });

    const llmResponse = llmCallResult.plan;
    totalInputTokens += llmCallResult.metrics.inputTokens;
    totalOutputTokens += llmCallResult.metrics.outputTokens;
    totalLlmDurationMs += llmCallResult.metrics.durationMs;

    logger.info('agent:loop', 'LLM response', {
      hasPlan: !!llmResponse.plan?.length,
      isDone: !!llmResponse.done,
      escalate: llmResponse.escalate,
      planSteps: llmResponse.plan?.length ?? 0,
    });

    if (llmResponse.done && llmResponse.val) {
      logger.info('agent:loop', 'LLM answered directly from graph', {
        value: llmResponse.val,
      });
      return {
        success: true,
        value: llmResponse.val,
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }

    if (llmResponse.escalate === 'user_needed') {
      logger.info('agent:loop', 'LLM escalated: user_needed', {
        reason: llmResponse.reason,
      });
      return {
        success: false,
        failureReason: `User input required: ${llmResponse.reason}`,
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }

    if (llmResponse.escalate === 'captcha') {
      logger.info('agent:loop', 'LLM escalated: captcha', {
        reason: llmResponse.reason,
      });
      return {
        success: false,
        failureReason: `captcha_detected: ${llmResponse.reason ?? 'verification wall encountered'}`,
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }

    if (llmResponse.escalate === 'dead_end') {
      logger.info('agent:loop', 'LLM escalated: dead_end', {
        reason: llmResponse.reason,
      });
      return {
        success: false,
        failureReason: `Dead end: ${llmResponse.reason}`,
        totalSteps: steps,
        llmCallCount,
        llmCallReasons,
        actionHistory,
        totalInputTokens,
        totalOutputTokens,
        totalLlmDurationMs,
      };
    }

    if (llmResponse.plan && llmResponse.plan.length > 0) {
      logger.info('agent:loop', 'LLM plan', {
        steps: llmResponse.plan.length,
        confidence: llmResponse.confidence,
      });

      const planResult = await executePlan(
        llmResponse.plan,
        goal,
        graph,
        executor,
        actionHistory,
        {
          mutationWaitMs: config.planMutationWaitMs,
          enforceProgressGuards: getRuntimeConfig().agent.enforceProgressGuards,
          enforceTargetUtilityGuards: getRuntimeConfig().agent.enforceTargetUtilityGuards,
        },
      );

      loopDetector.recordActions(planResult.executedActions);

      for (const entry of planResult.actionHistory) {
        if (!actionHistory.includes(entry)) actionHistory.push(entry);
      }

      if (planResult.completed && planResult.goalValue) {
        return {
          success: true,
          value: planResult.goalValue,
          totalSteps: steps,
          llmCallCount,
          llmCallReasons,
          actionHistory,
          totalInputTokens,
          totalOutputTokens,
          totalLlmDurationMs,
        };
      }

      if (config.afterAct) {
        await config.afterAct();
      }

      continue;
    }

    logger.warn('agent:loop', 'LLM response unusable - no plan, done, or escalate', {
      response: llmResponse,
    });
    return {
      success: false,
      failureReason: 'LLM response unusable',
      totalSteps: steps,
      llmCallCount,
      llmCallReasons,
      actionHistory,
      totalInputTokens,
      totalOutputTokens,
      totalLlmDurationMs,
    };
  }

  return {
    success: false,
    failureReason: 'max_steps_exceeded',
    totalSteps: steps,
    llmCallCount,
    llmCallReasons,
    actionHistory,
    totalInputTokens,
    totalOutputTokens,
    totalLlmDurationMs,
  };
}

function buildContextWarnings(loopMessage: string | undefined, executionWarnings: string[]): string[] | undefined {
  const warnings: string[] = [];
  if (loopMessage) {
    warnings.push(loopMessage);
  }
  for (const warning of executionWarnings) {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }
  return warnings.length > 0 ? warnings : undefined;
}

function buildExecutionWarnings(
  actionHistory: ActionHistoryEntry[],
  repeatedUtilityGuard: UtilityGuardPattern | undefined,
  goal: string,
): string[] {
  if (actionHistory.length === 0) {
    return [];
  }

  const warnings: string[] = [];
  const recent = actionHistory.slice(-STALE_SELECTOR_WINDOW);
  const notFoundCounts = new Map<string, number>();
  const notFoundFamilyCounts = new Map<string, number>();
  const notFoundFamilySamples = new Map<string, string[]>();

  for (const entry of recent) {
    if (entry.result !== 'not_found' || !entry.selector) {
      continue;
    }
    notFoundCounts.set(entry.selector, (notFoundCounts.get(entry.selector) ?? 0) + 1);
    const family = selectorFamilyFingerprint(entry.selector);
    notFoundFamilyCounts.set(family, (notFoundFamilyCounts.get(family) ?? 0) + 1);
    const samples = notFoundFamilySamples.get(family) ?? [];
    if (samples.length < STALE_SELECTOR_FAMILY_SAMPLE_LIMIT && !samples.includes(entry.selector)) {
      samples.push(entry.selector);
      notFoundFamilySamples.set(family, samples);
    }
  }

  let staleSelector: string | undefined;
  let staleSelectorCount = 0;
  for (const [selector, count] of notFoundCounts.entries()) {
    if (count > staleSelectorCount) {
      staleSelector = selector;
      staleSelectorCount = count;
    }
  }

  if (staleSelector && staleSelectorCount >= STALE_SELECTOR_NOT_FOUND_THRESHOLD) {
    warnings.push(
      `Recent attempts on selector "${staleSelector}" failed with not_found ${staleSelectorCount} times. ` +
      'This selector is likely stale on the current page. Do not retry it; choose a currently visible selector or use read-only tools to extract from visible data.',
    );
  }

  let staleSelectorFamily: string | undefined;
  let staleSelectorFamilyCount = 0;
  for (const [family, count] of notFoundFamilyCounts.entries()) {
    if (count > staleSelectorFamilyCount) {
      staleSelectorFamily = family;
      staleSelectorFamilyCount = count;
    }
  }

  if (staleSelectorFamily && staleSelectorFamilyCount >= STALE_SELECTOR_FAMILY_NOT_FOUND_THRESHOLD) {
    const samples = notFoundFamilySamples.get(staleSelectorFamily) ?? [];
    const sampleText = samples.length > 0
      ? ` Similar failed selectors: ${samples.map(sample => `"${sample}"`).join(', ')}.`
      : '';
    warnings.push(
      `Recent not_found failures are repeating across a selector family (${staleSelectorFamilyCount} times), which indicates stale positional targeting.` +
      `${sampleText} Stop trying sibling selector variants; switch to read-only discovery (find_elements/search_page/inspect_region) and then choose a stable visible selector.`,
    );
  }

  const recentUtilityGuard = [...recent]
    .reverse()
    .find(entry => entry.result === 'plan_stale' && entry.value?.startsWith('utility_guard:'));
  if (recentUtilityGuard?.value) {
    const reason = recentUtilityGuard.value.slice('utility_guard:'.length);
    if (reason === 'read_before_click') {
      warnings.push(
        'Recent click plan was skipped because the target looked ambiguous and low-utility for this extraction goal. ' +
        'Use read-only tools (search_page/find_elements/count_elements/inspect_region) before clicking.',
      );
    } else if (reason === 'low_actionability') {
      warnings.push(
        'Recent click plan was skipped because the target had no visible actionable candidates. ' +
        'Choose a different selector from visible nodes before mutating the page.',
      );
    } else if (reason === 'same_page_anchor') {
      warnings.push(
        'Recent click plan was a same-page anchor and is unlikely to reveal new answer data. ' +
        'Prefer read-only tools on current content first.',
      );
    } else if (reason === 'stale_selector') {
      warnings.push(
        'Recent selector has repeated not_found failures and is now treated as stale. ' +
        'Do not use this selector again; choose a visible selector from the current graph state.',
      );
    } else if (reason === 'stale_read_selector') {
      warnings.push(
        'Recent read selector repeatedly produced no matches and is likely stale or over-specific for this page state. ' +
        'Stop repeating it; use broader read-only discovery first (find_elements/search_page) and then choose a visible stable selector.',
      );
    } else if (reason === 'read_before_navigation') {
      warnings.push(
        'Current page already appears to contain goal-relevant data. ' +
        'Use read-only tools or answer from current data before navigating to outbound links.',
      );
    } else if (reason === 'pagination_churn') {
      warnings.push(
        'Recent steps repeatedly paginated, or continued pagination without reading answer evidence after page changes. ' +
        'Stop moving to more pages and use read-only tools on the current page to extract the requested value.',
      );
    } else if (reason === 'pagination_answer_observed') {
      warnings.push(
        'Answer evidence has already been observed after pagination for this extraction goal. ' +
        'Do not continue paginating; extract and return the answer from current page evidence.',
      );
    } else if (reason === 'read_after_interaction_churn') {
      warnings.push(
        'Recent steps performed many interactions without any read observation. ' +
        'This pattern is not making progress. Use read-only tools now to verify answer evidence on the current page before more clicks/typing.',
      );
    } else if (reason === 'read_after_submit_transition') {
      warnings.push(
        'A submit-like interaction likely completed form entry, but no read evidence was collected afterward. ' +
        'This pattern is not making progress. Stop further typing/clicking and use read-only tools now (get/find_elements/count_elements/search_page) on the current page.',
      );
    } else if (reason === 'submit_control_recovery') {
      warnings.push(
        'A submit-like control failed after form entry and the agent is retyping without discovery. ' +
        'This pattern is not making progress. Use read-only discovery first (find_elements/get/search_page) to locate the actual actionable submit/result target before more typing.',
      );
    } else if (reason === 'weak_interaction_repeat') {
      warnings.push(
        'The same weak interaction control was clicked repeatedly after form entry without a result-page transition or answer evidence. ' +
        'This pattern is not making progress. Stop repeating that control; use read-only discovery to identify a true submit/result target first.',
      );
    }
  }

  if (
    repeatedUtilityGuard
    && repeatedUtilityGuard.count >= UTILITY_GUARD_REPLAN_WARNING_THRESHOLD
  ) {
    warnings.push(
      `The last ${repeatedUtilityGuard.count} plans were blocked by utility guard "${repeatedUtilityGuard.reason}" and this pattern is not making progress. ` +
      'Change strategy: use read-only tools on visible data or choose a different actionable target.',
    );
  }

  const lowValueReadPattern = getLowValueReadPattern(actionHistory);
  if (lowValueReadPattern && lowValueReadPattern.count >= LOW_VALUE_READ_WARNING_THRESHOLD) {
    warnings.push(
      `Recent read-only actions are repeating low-value observations (${lowValueReadPattern.count} times) without new answer evidence. ` +
      'This pattern is not making progress. Stop repeating inspect_region summaries and use concrete selectors with find_elements/count_elements/get on the current results area.',
    );
  }

  const searchMissPattern = getRepeatedSearchMissPattern(actionHistory);
  if (searchMissPattern && searchMissPattern.count >= SEARCH_MISS_WARNING_THRESHOLD) {
    const selectorHint = searchMissPattern.selector
      ? `; most frequent query key: "${searchMissPattern.selector}" (${searchMissPattern.selectorCount ?? 0}x)`
      : '';
    warnings.push(
      `search_page has returned no matches repeatedly (${searchMissPattern.count} times)${selectorHint}. ` +
      'This pattern is not making progress. Use a simpler literal pattern (avoid over-escaped punctuation) or switch to find_elements/get on visible selectors instead of repeating search_page.',
    );
  }

  const answerEvidence = getRecentAnswerEvidenceHint(actionHistory, goal);
  if (answerEvidence) {
    warnings.push(
      `Recent read evidence likely already contains the answer: "${answerEvidence.candidate}". ` +
      'If this satisfies the goal, return done with this value now instead of taking more actions.',
    );
  }

  return warnings;
}

function getRepeatedUtilityGuardPattern(actionHistory: ActionHistoryEntry[]): UtilityGuardPattern | undefined {
  const recent = actionHistory.slice(-UTILITY_GUARD_REPLAN_WINDOW);
  if (recent.length === 0) {
    return undefined;
  }

  let reason: string | undefined;
  let count = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index]!;
    if (entry.result !== 'plan_stale' || !entry.value?.startsWith('utility_guard:')) {
      break;
    }

    const entryReason = entry.value.slice('utility_guard:'.length);
    if (!reason) {
      reason = entryReason;
    }
    if (entryReason !== reason) {
      break;
    }

    count += 1;
  }

  if (!reason || count === 0) {
    return undefined;
  }

  return { reason, count };
}

function getAccumulatedUtilityGuardPattern(actionHistory: ActionHistoryEntry[]): UtilityGuardPattern | undefined {
  const recent = actionHistory.slice(-UTILITY_GUARD_ACCUMULATED_WINDOW);
  if (recent.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const entry of recent) {
    if (entry.result !== 'plan_stale' || !entry.value?.startsWith('utility_guard:')) {
      continue;
    }
    const reason = entry.value.slice('utility_guard:'.length);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  let bestReason: string | undefined;
  let bestCount = 0;
  for (const [reason, count] of counts.entries()) {
    if (count > bestCount) {
      bestReason = reason;
      bestCount = count;
    }
  }

  if (!bestReason || bestCount === 0) {
    return undefined;
  }

  return { reason: bestReason, count: bestCount };
}

function shouldAbortForPersistentNoProgress(
  actionHistory: ActionHistoryEntry[],
  loopSignal: ReturnType<LoopDetector['getSignal']>,
): boolean {
  const stagnantSteps = loopSignal?.stagnantSteps ?? 0;
  if (stagnantSteps < NO_PROGRESS_STAGNATION_ABORT_THRESHOLD) {
    return false;
  }

  const recent = actionHistory.slice(-RECENT_NO_PROGRESS_WINDOW);
  return recent.some(entry => entry.result === 'no_progress');
}

function getLowValueReadPattern(actionHistory: ActionHistoryEntry[]): LowValueReadPattern | undefined {
  const recent = actionHistory
    .slice(-LOW_VALUE_READ_WINDOW)
    .filter(entry =>
      (entry.result === 'ok' || entry.result === 'no_progress')
      && isReadObservation(entry.action),
    );

  if (recent.length === 0) {
    return undefined;
  }

  const lowValueEntries = recent.filter(isLowValueReadEntry);
  if (lowValueEntries.length === 0) {
    return undefined;
  }

  const repeated = getMostRepeatedReadValue(lowValueEntries);
  return {
    count: lowValueEntries.length,
    repeatedValueCount: repeated.count,
    repeatedAction: repeated.action,
    repeatedSelector: repeated.selector,
    repeatedValue: repeated.value,
  };
}

function getRepeatedSearchMissPattern(actionHistory: ActionHistoryEntry[]): SearchMissPattern | undefined {
  const recent = actionHistory
    .slice(-SEARCH_MISS_WINDOW)
    .filter(entry =>
      entry.action === 'search_page'
      && (entry.result === 'ok' || entry.result === 'no_progress')
      && (
        entry.readOutcome === 'noise_repeat'
        || /\b(no matches found|found 0 matches)\b/i.test(entry.value ?? '')
      ),
    );

  if (recent.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  const values = new Map<string, string | undefined>();
  for (const entry of recent) {
    const key = entry.selector ?? '(missing-pattern)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!values.has(key)) {
      values.set(key, normalizeReadValue(entry.value));
    }
  }

  let bestKey: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  if (!bestKey || bestCount === 0) {
    return undefined;
  }

  return {
    count: recent.length,
    selector: bestKey,
    selectorCount: bestCount,
    value: values.get(bestKey),
  };
}

function isReadObservation(action: string): boolean {
  return action === 'get'
    || action === 'search_page'
    || action === 'find_elements'
    || action === 'count_elements'
    || action === 'inspect_region';
}

function isLowValueReadEntry(entry: ActionHistoryEntry): boolean {
  if (entry.readOutcome === 'context_only' || entry.readOutcome === 'noise_repeat') {
    return true;
  }

  if (entry.readOutcome === 'answer_evidence') {
    return false;
  }

  const value = (entry.value ?? '').trim();
  if (!value) {
    return true;
  }

  if (/^(Region ".+" contains \d+ notable node|Region text:|Found \d+ elements? matching|Found \d+ matches? for|Count for ".+": \d+)/i.test(value)) {
    return true;
  }

  if (/\b(not found|no matches found|found 0 elements)\b/i.test(value)) {
    return true;
  }

  return false;
}

function getMostRepeatedReadValue(entries: ActionHistoryEntry[]): {
  count: number;
  action?: string;
  selector?: string;
  value?: string;
} {
  const counts = new Map<string, number>();
  const meta = new Map<string, { action?: string; selector?: string; value?: string }>();

  for (const entry of entries) {
    const value = normalizeReadValue(entry.value);
    if (!value) {
      continue;
    }
    const key = `${entry.action}|${entry.selector ?? ''}|${value}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!meta.has(key)) {
      meta.set(key, { action: entry.action, selector: entry.selector, value });
    }
  }

  let bestKey: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }

  if (!bestKey) {
    return { count: 0 };
  }

  const bestMeta = meta.get(bestKey);
  return {
    count: bestCount,
    action: bestMeta?.action,
    selector: bestMeta?.selector,
    value: bestMeta?.value,
  };
}

function normalizeReadValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 240);
  return normalized.length > 0 ? normalized : undefined;
}

function getRecentAnswerEvidenceHint(
  actionHistory: ActionHistoryEntry[],
  goal: string,
): { candidate: string } | undefined {
  const recent = actionHistory.slice(-ANSWER_EVIDENCE_LOOKBACK);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index]!;
    if (entry.result !== 'ok' || !isReadObservation(entry.action)) {
      continue;
    }
    if (entry.readOutcome !== 'answer_evidence') {
      continue;
    }

    const candidate = extractAnswerCandidate(goal, entry.value ?? entry.effect?.targetValue)
      ?? normalizeReadValue(entry.value ?? entry.effect?.targetValue);
    if (!candidate) {
      continue;
    }

    return { candidate: candidate.slice(0, 120) };
  }

  return undefined;
}
