import { logger } from '../logger';
import { serializeGraph, type ActionHistoryEntry } from '../graph/serializer';
import { callLLM, type EscalationContext, type LLMCallResult } from './llm';
import { executePlan } from './planExecutor';
import type { SemanticGraph } from '../graph/types';
import type { Executor } from '../executor/executor';
import { LoopDetector } from './loopDetector';
import { getRuntimeConfig } from '../config/runtime';

const MAX_STEPS = 15;
const STALE_SELECTOR_NOT_FOUND_THRESHOLD = 3;
const STALE_SELECTOR_WINDOW = 8;

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
    const executionWarnings = buildExecutionWarnings(actionHistory);
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

function buildExecutionWarnings(actionHistory: ActionHistoryEntry[]): string[] {
  if (actionHistory.length === 0) {
    return [];
  }

  const warnings: string[] = [];
  const recent = actionHistory.slice(-STALE_SELECTOR_WINDOW);
  const notFoundCounts = new Map<string, number>();

  for (const entry of recent) {
    if (entry.result !== 'not_found' || !entry.selector) {
      continue;
    }
    notFoundCounts.set(entry.selector, (notFoundCounts.get(entry.selector) ?? 0) + 1);
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

  return warnings;
}
