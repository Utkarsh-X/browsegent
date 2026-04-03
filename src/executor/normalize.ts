import type { Action, LLMPlanStep } from './types';

export function normalizePlanStep(step: LLMPlanStep): Action {
  return {
    kind: step.tool,
    target: step.sel,
    input: step.text,
    option: step.value,
    direction: step.direction,
    timeoutMs: step.timeout,
    pattern: step.pattern,
    origin: 'llm',
    original: step,
  };
}
