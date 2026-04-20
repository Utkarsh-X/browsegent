import { logger } from '../logger';
import { getBrain1NodePriority } from '../brain1/scoring';
import type { FilteredNode } from '../brain1/types';
import type { Executor } from '../executor/executor';
import { normalizePlanStep } from '../executor/normalize';
import type { Action, ActionEffectStrength, ActionResult, LLMPlanStep } from '../executor/types';
import type { SemanticGraph } from '../graph/types';
import type { ActionHistoryEntry } from '../graph/serializer';
import { fingerprintGraph } from './loopDetector';
import { assessTargetUtilityGuard, buildTargetUtilityHistoryValue } from './targetUtility';
import { selectorFamilyFingerprint, selectorsEquivalent } from './selectorMatch';
import { classifyReadOutcome, type ReadOutcome, normalizeReadValue } from './readOutcome';

const MAX_PLAN_STEPS = 5;
const MUTATION_WAIT_MS = 1500;
const SIGNIFICANT_DELTA_COUNT = 3;
const NO_EFFECT_REPEAT_THRESHOLD = 3;
const SAME_VALUE_REPEAT_THRESHOLD = 3;
const OBSERVED_VALUE_REPEAT_THRESHOLD = 4;
const CONTEXT_READ_REPEAT_THRESHOLD = 4;
const INSPECT_REGION_CONTEXT_REPEAT_THRESHOLD = 3;
const NOISE_READ_REPEAT_THRESHOLD = 3;
const RECENT_EFFECT_WINDOW = 6;
const STALE_SELECTOR_REPLAN_WINDOW = 12;
const STALE_SELECTOR_REPLAN_THRESHOLD = 3;
const STALE_SELECTOR_FAMILY_REPLAN_THRESHOLD = 2;

type ProgressDecision = 'accept' | 'watch' | 'warn' | 'abort';

export interface PlanResult {
  completed: boolean;
  goalValue?: string;
  stepsExecuted: number;
  abortReason?: 'goal_met' | 'plan_stale' | 'step_failed' | 'max_steps' | 'no_progress' | 'page_changed';
  actionHistory: ActionHistoryEntry[];
  executedActions: Action[];
}

export interface ExecutePlanOptions {
  mutationWaitMs?: number;
  enforceProgressGuards?: boolean;
  enforceTargetUtilityGuards?: boolean;
}

export async function executePlan(
  plan: LLMPlanStep[],
  goal: string,
  graph: SemanticGraph,
  executor: Executor,
  existingHistory: ActionHistoryEntry[] = [],
  options: ExecutePlanOptions = {},
): Promise<PlanResult> {
  const history: ActionHistoryEntry[] = [...existingHistory];
  const executedActions: Action[] = [];
  const deltaCountAtStart = graph.deltas.length;
  const steps = plan.slice(0, MAX_PLAN_STEPS);
  const mutationWaitMs = options.mutationWaitMs ?? MUTATION_WAIT_MS;
  const enforceProgressGuards = options.enforceProgressGuards ?? true;
  const enforceTargetUtilityGuards = options.enforceTargetUtilityGuards ?? true;

  logger.info('agent:planExecutor', 'Executing plan', { steps: steps.length, goal });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const action = withTargetHint(normalizePlanStep(step), graph);

    const newDeltas = graph.deltas.length - deltaCountAtStart;
    if (i > 0 && newDeltas >= SIGNIFICANT_DELTA_COUNT) {
      logger.info('agent:planExecutor', 'Plan stale - returning to LLM', { newDeltas, step: i });
      history.push({ action: action.kind, selector: action.target, result: 'plan_stale', timestamp: Date.now() });
      return {
        completed: false,
        stepsExecuted: i,
        abortReason: 'plan_stale',
        actionHistory: history,
        executedActions,
      };
    }

    const actionHistoryKey = getActionHistoryKey(action);
    if (actionHistoryKey && shouldReplanForRepeatedNotFound(action, actionHistoryKey, history)) {
      history.push({
        action: action.kind,
        selector: actionHistoryKey,
        result: 'plan_stale',
        timestamp: Date.now(),
        graphFingerprint: fingerprintGraph(graph),
        value: 'utility_guard:stale_selector',
        progressStrength: 'none',
        progressDecision: 'warn',
        repeatCount: 1,
      });
      logger.warn('agent:planExecutor', 'Selector stale guard requested replan', {
        step: i,
        tool: action.kind,
        selector: actionHistoryKey,
      });
      return {
        completed: false,
        stepsExecuted: i,
        abortReason: 'plan_stale',
        actionHistory: history,
        executedActions,
      };
    }

    if (enforceTargetUtilityGuards) {
      const utilityGuardSignal = assessTargetUtilityGuard(action, goal, graph, history);
      if (utilityGuardSignal.shouldBlock) {
        const historyValue = buildTargetUtilityHistoryValue(utilityGuardSignal);
        const selector = actionHistoryKey;
        history.push({
          action: action.kind,
          selector,
          result: 'plan_stale',
          timestamp: Date.now(),
          graphFingerprint: fingerprintGraph(graph),
          value: historyValue,
          progressStrength: 'none',
          progressDecision: 'warn',
          repeatCount: 1,
        });
        logger.warn('agent:planExecutor', 'Target utility guard requested replan', {
          step: i,
          tool: action.kind,
          selector,
          reason: utilityGuardSignal.reason,
          matchedNodes: utilityGuardSignal.matchedNodes,
          actionableNodes: utilityGuardSignal.actionableNodes,
          highConfidenceNodes: utilityGuardSignal.highConfidenceNodes,
          maxGoalScore: utilityGuardSignal.maxGoalScore,
          message: utilityGuardSignal.message,
        });
        return {
          completed: false,
          stepsExecuted: i,
          abortReason: 'plan_stale',
          actionHistory: history,
          executedActions,
        };
      }
    }

    executedActions.push(action);
    const result = await executor.execute(action);
    const progress = assessActionProgress(action, result, history, graph, goal);
    const historyEntry: ActionHistoryEntry = {
      action: action.kind,
      selector: actionHistoryKey,
      result: toHistoryResult(result),
      timestamp: Date.now(),
      graphFingerprint: fingerprintGraph(graph),
      value: result.value,
      effect: result.metadata.effect,
      progressStrength: progress.strength,
      progressDecision: progress.decision,
      repeatCount: progress.repeatCount,
      readOutcome: progress.readOutcome,
    };
    history.push(historyEntry);

    logger.info('agent:progress', 'Action progress assessed', {
      step: i,
      action: action.kind,
      selector: action.target,
      success: result.success,
      effect: result.metadata.effect?.primarySignal ?? 'none',
      strength: progress.strength,
      repeatCount: progress.repeatCount,
      decision: progress.decision,
      readOutcome: progress.readOutcome,
      graphFingerprint: historyEntry.graphFingerprint,
      targetValue: truncateProgressValue(result.value ?? result.metadata.effect?.targetValue),
    });

    if (!result.success) {
      logger.warn('agent:planExecutor', 'Step failed', {
        step: i,
        tool: action.kind,
        errorCode: result.error?.code,
        error: result.error?.message,
      });
      return {
        completed: false,
        stepsExecuted: i + 1,
        abortReason: 'step_failed',
        actionHistory: history,
        executedActions,
      };
    }

    if (progress.decision === 'abort' && enforceProgressGuards) {
      historyEntry.result = 'no_progress';
      logger.warn('agent:planExecutor', 'Repeated no-progress action detected', {
        step: i,
        tool: action.kind,
        selector: actionHistoryKey,
        effect: result.metadata.effect?.primarySignal,
        strength: progress.strength,
        repeatCount: progress.repeatCount,
        value: truncateProgressValue(result.value ?? result.metadata.effect?.targetValue),
      });
      return {
        completed: false,
        stepsExecuted: i + 1,
        abortReason: 'no_progress',
        actionHistory: history,
        executedActions,
      };
    }

    if (shouldStopPlanAfterPageChange(action, result)) {
      logger.info('agent:planExecutor', 'Plan interrupted after page change', {
        step: i,
        tool: action.kind,
        selector: actionHistoryKey,
        effect: result.metadata.effect?.signals,
      });
      return {
        completed: false,
        stepsExecuted: i + 1,
        abortReason: 'page_changed',
        actionHistory: history,
        executedActions,
      };
    }

    await new Promise(resolve => setTimeout(resolve, mutationWaitMs));
  }

  return {
    completed: false,
    stepsExecuted: steps.length,
    abortReason: 'max_steps',
    actionHistory: history,
    executedActions,
  };
}

function toHistoryResult(result: ActionResult): ActionHistoryEntry['result'] {
  return result.success ? 'ok' : (result.error?.code ?? 'execution_error');
}

function assessActionProgress(
  action: Action,
  result: ActionResult,
  history: ActionHistoryEntry[],
  graph: SemanticGraph,
  goal: string,
): {
  decision: ProgressDecision;
  repeatCount: number;
  strength: ActionEffectStrength;
  readOutcome?: ReadOutcome;
} {
  const strength = result.metadata.effect?.strength ?? 'none';
  const graphFingerprint = fingerprintGraph(graph);
  const actionHistoryKey = getActionHistoryKey(action);
  if (!result.success || !actionHistoryKey) {
    return { decision: 'accept', repeatCount: 0, strength };
  }

  const recentMatches = history.slice(-RECENT_EFFECT_WINDOW).filter(entry =>
    entry.result === 'ok'
    && entry.action === action.kind
    && entry.selector === actionHistoryKey
    && entry.graphFingerprint === graphFingerprint,
  );

  if (isObservationAction(action.kind)) {
    const readOutcome = classifyReadOutcome({
      action,
      value: result.value ?? result.metadata.effect?.targetValue,
      goal,
      history,
      graphFingerprint,
    });
    if (readOutcome.normalizedValue === undefined) {
      return { decision: 'accept', repeatCount: 0, strength, readOutcome: readOutcome.outcome };
    }
    const sameValueCount = recentMatches.filter(entry =>
      normalizeReadValue(entry.value ?? entry.effect?.targetValue) === readOutcome.normalizedValue,
    ).length + 1;
    const observedOnly = result.metadata.effect?.primarySignal === 'target_value_observed'
      && recentMatches.every(entry => (entry.effect?.primarySignal ?? 'none') === 'target_value_observed');
    const threshold = getReadObservationAbortThreshold(action.kind, readOutcome.outcome, observedOnly);
    const decision = decideFromRepeatCount(
      sameValueCount,
      strength,
      threshold,
    );
    return {
      ...decision,
      readOutcome: readOutcome.outcome,
    };
  }

  if (action.kind === 'click' || action.kind === 'close') {
    const weakOrNoneCount = recentMatches.filter(entry =>
      (entry.progressStrength ?? entry.effect?.strength ?? 'none') !== 'strong',
    ).length + 1;
    if (strength === 'strong') {
      return { decision: 'accept', repeatCount: weakOrNoneCount, strength };
    }
    return decideFromRepeatCount(weakOrNoneCount, strength, NO_EFFECT_REPEAT_THRESHOLD);
  }

  if (strength === 'weak') {
    const weakRepeatCount = recentMatches.filter(entry =>
      (entry.progressStrength ?? entry.effect?.strength ?? 'none') === 'weak',
    ).length + 1;
    if (weakRepeatCount >= 2) {
      return { decision: 'watch', repeatCount: weakRepeatCount, strength };
    }
  }

  return { decision: 'accept', repeatCount: 1, strength };
}

function getReadObservationAbortThreshold(
  kind: Action['kind'],
  outcome: ReadOutcome,
  observedOnly: boolean,
): number {
  if (outcome === 'noise_repeat') {
    return NOISE_READ_REPEAT_THRESHOLD;
  }

  if (outcome === 'context_only') {
    if (kind === 'inspect_region') {
      return INSPECT_REGION_CONTEXT_REPEAT_THRESHOLD;
    }
    return CONTEXT_READ_REPEAT_THRESHOLD;
  }

  return observedOnly ? OBSERVED_VALUE_REPEAT_THRESHOLD : SAME_VALUE_REPEAT_THRESHOLD;
}

function isObservationAction(kind: Action['kind']): boolean {
  return kind === 'get'
    || kind === 'search_page'
    || kind === 'find_elements'
    || kind === 'count_elements'
    || kind === 'inspect_region';
}

function getActionHistoryKey(action: Action): string | undefined {
  if (action.kind === 'search_page') {
    if (!action.pattern) {
      return undefined;
    }
    return action.target
      ? `pattern:${action.pattern} @ ${action.target}`
      : `pattern:${action.pattern}`;
  }

  if (action.target) {
    return action.target;
  }

  if (action.kind === 'wait' && action.pattern) {
    return `pattern:${action.pattern}`;
  }

  return undefined;
}

function shouldStopPlanAfterPageChange(action: Action, result: ActionResult): boolean {
  if (!result.success || !result.metadata.mutating) {
    return false;
  }

  const signals = result.metadata.effect?.signals ?? [];
  if (signals.includes('url_changed')) {
    return true;
  }

  return (action.kind === 'click' || action.kind === 'close') && signals.includes('hash_changed');
}

function shouldReplanForRepeatedNotFound(
  action: Action,
  actionHistoryKey: string,
  history: ActionHistoryEntry[],
): boolean {
  if (!action.target) {
    return false;
  }
  if (action.kind !== 'click' && action.kind !== 'close' && action.kind !== 'type' && action.kind !== 'select' && action.kind !== 'get') {
    return false;
  }

  const repeatedNotFoundCount = history.slice(-RECENT_EFFECT_WINDOW).filter(entry =>
    entry.selector === actionHistoryKey
    && entry.result === 'not_found',
  ).length;

  if (repeatedNotFoundCount >= STALE_SELECTOR_REPLAN_THRESHOLD) {
    return true;
  }

  const selectorFamily = selectorFamilyFingerprint(actionHistoryKey);
  const repeatedFamilyNotFoundCount = history.slice(-STALE_SELECTOR_REPLAN_WINDOW).filter(entry =>
    typeof entry.selector === 'string'
    && entry.result === 'not_found'
    && selectorFamilyFingerprint(entry.selector) === selectorFamily,
  ).length;

  return repeatedFamilyNotFoundCount >= STALE_SELECTOR_FAMILY_REPLAN_THRESHOLD;
}

function decideFromRepeatCount(
  repeatCount: number,
  strength: ActionEffectStrength,
  abortThreshold: number,
): { decision: ProgressDecision; repeatCount: number; strength: ActionEffectStrength } {
  if (repeatCount >= abortThreshold) {
    return { decision: 'abort', repeatCount, strength };
  }
  if (repeatCount >= 2) {
    return { decision: 'warn', repeatCount, strength };
  }
  if (strength !== 'strong') {
    return { decision: 'watch', repeatCount, strength };
  }
  return { decision: 'accept', repeatCount, strength };
}

function truncateProgressValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.replace(/\s+/g, ' ').slice(0, 140);
}

function withTargetHint(action: Action, graph: SemanticGraph): Action {
  if (!action.target) {
    return action;
  }

  if (
    action.kind !== 'click'
    && action.kind !== 'type'
    && action.kind !== 'select'
    && action.kind !== 'get'
    && action.kind !== 'inspect_region'
  ) {
    return action;
  }

  const matchingNodes = graph.snapshot
    .filter(node => selectorsEquivalent(node.sel, action.target))
    .sort((left, right) => getNodeHintPriority(right, action.kind) - getNodeHintPriority(left, action.kind));

  const primaryNode = matchingNodes[0];
  const canonicalTarget = primaryNode?.sel ?? action.target;
  if (!primaryNode?.meta) {
    if (canonicalTarget !== action.target) {
      return { ...action, target: canonicalTarget };
    }
    return action;
  }

  const metaNodes = matchingNodes.filter(node => !!node.meta);
  const primaryMetaNode = metaNodes[0];
  if (!primaryMetaNode?.meta) {
    if (canonicalTarget !== action.target) {
      return { ...action, target: canonicalTarget };
    }
    return action;
  }

  const uniqueHashes = new Set(
    metaNodes
      .map(node => node.meta?.stableHash)
      .filter((stableHash): stableHash is string => !!stableHash),
  );
  const hint = {
    refId: primaryMetaNode.meta.refId,
    backendNodeId: primaryMetaNode.meta.backendNodeId,
    frameId: primaryMetaNode.meta.frameId,
    sessionId: primaryMetaNode.meta.sessionId,
    stableHash: primaryMetaNode.meta.stableHash,
    tag: primaryMetaNode.tag,
    role: primaryMetaNode.meta.role ?? primaryMetaNode.attrs?.role,
    valueSample: primaryMetaNode.value.slice(0, 160),
    nth: primaryMetaNode.meta.nth,
    confidence: primaryMetaNode.meta.confidence,
    selectorScore: primaryMetaNode.meta.selectorScore,
    actionabilityScore: primaryMetaNode.meta.actionabilityScore,
    ambiguousSelector: uniqueHashes.size > 1,
  };

  return { ...action, target: canonicalTarget, targetHint: hint };
}

function getNodeHintPriority(node: FilteredNode, actionKind: Action['kind']): number {
  let kindBonus = 0;
  if (actionKind === 'click') {
    kindBonus = node.type === 'trigger' ? 16 : node.type === 'input' ? 8 : 0;
  } else if (actionKind === 'type' || actionKind === 'select') {
    kindBonus = node.type === 'input' ? 18 : node.type === 'trigger' ? 4 : 0;
  } else if (actionKind === 'get') {
    kindBonus = node.type === 'data' || node.type === 'table_cell' ? 10 : 0;
  }
  return getBrain1NodePriority(node) + kindBonus;
}
