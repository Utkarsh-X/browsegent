// Plan Executor — executes multi-step plans, with staleness detection
import { logger } from '../logger';
import { ToolSystem } from '../executor/toolSystem';
import type { PlanStep } from './llm';
import type { SemanticGraph } from '../graph/types';
import type { ActionHistoryEntry } from '../graph/serializer';
import type { ActionContext } from '../executor/actions';

const MAX_PLAN_STEPS = 5;
const MUTATION_WAIT_MS = 1500;
const SIGNIFICANT_DELTA_COUNT = 3;

export interface PlanResult {
  completed: boolean;
  goalValue?: string;
  stepsExecuted: number;
  abortReason?: 'goal_met' | 'plan_stale' | 'step_failed' | 'max_steps';
  actionHistory: ActionHistoryEntry[];
}

export async function executePlan(
  plan: PlanStep[],
  goal: string,
  graph: SemanticGraph,
  ctx: ActionContext,
  existingHistory: ActionHistoryEntry[] = []
): Promise<PlanResult> {
  const tools = new ToolSystem(ctx);
  const history: ActionHistoryEntry[] = [...existingHistory];
  const deltaCountAtStart = graph.deltas.length;
  const steps = plan.slice(0, MAX_PLAN_STEPS);

  logger.info('agent:planExecutor', 'Executing plan', { steps: steps.length, goal });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    // Staleness check — if many deltas arrived since plan started,
    // the page has changed significantly and the plan may be outdated.
    // Return to LLM for a fresh decision based on new state.
    const newDeltas = graph.deltas.length - deltaCountAtStart;
    if (i > 0 && newDeltas >= SIGNIFICANT_DELTA_COUNT) {
      logger.info('agent:planExecutor', 'Plan stale — returning to LLM', { newDeltas, step: i });
      history.push({ action: step.tool, selector: step.sel, result: 'plan_stale', timestamp: Date.now() });
      return { completed: false, stepsExecuted: i, abortReason: 'plan_stale', actionHistory: history };
    }

    // Execute the step — no goal checking here.
    // In LLM-first architecture, the LLM decides goal completion
    // by reading the updated graph on the next loop iteration.
    const result = await tools.execute(step);
    history.push({
      action: step.tool,
      selector: step.sel,
      result: result.success ? 'ok' : 'error',
      timestamp: Date.now(),
    });

    if (!result.success) {
      logger.warn('agent:planExecutor', 'Step failed', { step: i, tool: step.tool, error: result.error });
      return { completed: false, stepsExecuted: i + 1, abortReason: 'step_failed', actionHistory: history };
    }

    // Wait for Brain 2 to capture mutations from this action
    await new Promise(r => setTimeout(r, MUTATION_WAIT_MS));
  }

  // All steps executed — return to LLM for goal assessment on fresh state
  return { completed: false, stepsExecuted: steps.length, abortReason: 'max_steps', actionHistory: history };
}
