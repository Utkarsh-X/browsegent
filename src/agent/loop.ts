// Agent Loop — LLM-first decision loop
import { logger } from '../logger';
import { serializeGraph, type ActionHistoryEntry } from '../graph/serializer';
import { callLLM } from './llm';
import { executePlan } from './planExecutor';
import type { SemanticGraph } from '../graph/types';
import type { ActionContext } from '../executor/actions';

const MAX_STEPS = 15;

export interface AgentLoopConfig {
  goal: string;
  graph: SemanticGraph;
  ctx: ActionContext;
  maxSteps?: number;
  /** Called before each LLM step — syncs Brain 2 deltas from page */
  beforeStep?: () => Promise<void>;
  /** Called after every plan execution — re-observes page with Brain 1 */
  afterAct?: () => Promise<void>;
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
  const { goal, graph, ctx, maxSteps = MAX_STEPS } = config;
  let steps = 0;
  let llmCallCount = 0;
  const llmCallReasons: string[] = [];
  const actionHistory: ActionHistoryEntry[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLlmDurationMs = 0;

  logger.info('agent:loop', 'Starting agent loop', { goal, maxSteps });

  // ── Near-empty page guard ─────────────────────────────────────────────────
  // If Brain 1 found fewer than 3 data nodes, the page likely didn't load
  // correctly (error page, CAPTCHA wall, consent gate). Don't waste LLM calls.
  const dataNodes = graph.snapshot.filter(n => n.type === 'data' || n.type === 'table_cell');
  if (dataNodes.length < 3) {
    logger.warn('agent:loop', 'Near-empty snapshot — likely error/CAPTCHA/consent wall', {
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

  // ── LLM-first loop ────────────────────────────────────────────────────────
  // The LLM sees the goal and Brain 1's filtered graph on every iteration.
  // It decides: answer directly (done+val), take actions (plan), or escalate.
  // No heuristic shortcuts — the LLM is the decision maker.

  while (steps < maxSteps) {
    steps++;

    // Sync Brain 2 deltas from page into graph before each LLM call
    if (config.beforeStep) await config.beforeStep();

    logger.info('agent:loop', `Step ${steps}`, { goal, graphStatus: graph.status });

    // Serialize current graph state — this is what the LLM reads
    const { serialized } = serializeGraph(graph, goal, actionHistory);
    const graphJson = JSON.stringify(serialized);

    // ── LLM call — mandatory on every step ──────────────────────────────────
    llmCallCount++;
    llmCallReasons.push(`step_${steps}`);

    logger.info('agent:loop', 'Calling LLM', { step: steps, goal });

    const llmCallResult = await callLLM({
      goal,
      graphJson,
      actionHistory,
      reason: `step_${steps}`,
      stepCount: steps,
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

    // ── Handle LLM response ──────────────────────────────────────────────────

    // Case 1: LLM found the answer directly in the graph
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

    // Case 2: LLM says user input is required (CAPTCHA, login, 2FA)
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

    // Case 3: LLM says task is impossible
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

    // Case 4: LLM provided a plan of browser actions to execute
    if (llmResponse.plan && llmResponse.plan.length > 0) {
      logger.info('agent:loop', 'LLM plan', {
        steps: llmResponse.plan.length,
        confidence: llmResponse.confidence,
      });

      const planResult = await executePlan(
        llmResponse.plan,
        goal,
        graph,
        ctx,
        actionHistory
      );

      for (const entry of planResult.actionHistory) {
        if (!actionHistory.includes(entry)) actionHistory.push(entry);
      }

      // If the plan executor found the goal value during execution
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

      // ── RE-OBSERVE: Brain 1 rescans after action ──────────────────────────
      // This is the critical step that closes the observe→plan→act→repeat loop.
      // Without this, the next LLM call sees stale pre-action snapshot.
      if (config.afterAct) {
        await config.afterAct();
      }

      // Loop back — next iteration LLM sees fresh page state
      continue;
    }

    // Case 5: LLM returned an unusable response
    logger.warn('agent:loop', 'LLM response unusable — no plan, done, or escalate', {
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

  // Max steps reached
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
