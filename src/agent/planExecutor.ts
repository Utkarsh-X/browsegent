import { logger } from '../logger';
import type { Executor } from '../executor/executor';
import { normalizePlanStep } from '../executor/normalize';
import type { Action, ActionEffectStrength, ActionResult, LLMPlanStep } from '../executor/types';
import type { SemanticGraph } from '../graph/types';
import type { ActionHistoryEntry } from '../graph/serializer';
import { fingerprintGraph } from './loopDetector';

const MAX_PLAN_STEPS = 5;
const MUTATION_WAIT_MS = 1500;
const SIGNIFICANT_DELTA_COUNT = 3;
const NO_EFFECT_REPEAT_THRESHOLD = 3;
const SAME_VALUE_REPEAT_THRESHOLD = 3;
const OBSERVED_VALUE_REPEAT_THRESHOLD = 4;
const RECENT_EFFECT_WINDOW = 6;

type ProgressDecision = 'accept' | 'watch' | 'warn' | 'abort';

export interface PlanResult {
  completed: boolean;
  goalValue?: string;
  stepsExecuted: number;
  abortReason?: 'goal_met' | 'plan_stale' | 'step_failed' | 'max_steps' | 'no_progress';
  actionHistory: ActionHistoryEntry[];
  executedActions: Action[];
}

export interface ExecutePlanOptions {
  mutationWaitMs?: number;
  enforceProgressGuards?: boolean;
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

  logger.info('agent:planExecutor', 'Executing plan', { steps: steps.length, goal });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const action = normalizePlanStep(step);

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

    executedActions.push(action);
    const result = await executor.execute(action);
    const progress = assessActionProgress(action, result, history, graph);
    const historyEntry: ActionHistoryEntry = {
      action: action.kind,
      selector: action.target,
      result: toHistoryResult(result),
      timestamp: Date.now(),
      graphFingerprint: fingerprintGraph(graph),
      value: result.value,
      effect: result.metadata.effect,
      progressStrength: progress.strength,
      progressDecision: progress.decision,
      repeatCount: progress.repeatCount,
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
        selector: action.target,
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
): {
  decision: ProgressDecision;
  repeatCount: number;
  strength: ActionEffectStrength;
} {
  const strength = result.metadata.effect?.strength ?? 'none';
  const graphFingerprint = fingerprintGraph(graph);
  if (!result.success || !action.target) {
    return { decision: 'accept', repeatCount: 0, strength };
  }

  const recentMatches = history.slice(-RECENT_EFFECT_WINDOW).filter(entry =>
    entry.result === 'ok'
    && entry.action === action.kind
    && entry.selector === action.target
    && entry.graphFingerprint === graphFingerprint,
  );

  if (action.kind === 'get') {
    const normalizedValue = normalizeRepeatedValue(result.value ?? result.metadata.effect?.targetValue);
    if (normalizedValue === undefined) {
      return { decision: 'accept', repeatCount: 0, strength };
    }
    const sameValueCount = recentMatches.filter(entry =>
      normalizeRepeatedValue(entry.value ?? entry.effect?.targetValue) === normalizedValue,
    ).length + 1;
    const observedOnly = result.metadata.effect?.primarySignal === 'target_value_observed'
      && recentMatches.every(entry => (entry.effect?.primarySignal ?? 'none') === 'target_value_observed');
    return decideFromRepeatCount(
      sameValueCount,
      strength,
      observedOnly ? OBSERVED_VALUE_REPEAT_THRESHOLD : SAME_VALUE_REPEAT_THRESHOLD,
    );
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

function normalizeRepeatedValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}
