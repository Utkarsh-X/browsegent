import { hasResultClaimSignal } from './AnswerContract';
import type { PlannerGoalProgress } from '../planner/GoalProgressTracker';

/**
 * Requirement-completion gate for accepted answers: when the goal parsed
 * concrete date requirements, an answer that claims results while the dates
 * were never entered, were reset, or were committed without executing the
 * search is exactly the "answered from a surface that was never searched"
 * failure class (e.g. naming hotels while the search form is still showing).
 * Reasons feed the answerFeedback steering loop, so the planner gets a bounded
 * chance to complete the flow or escalate honestly instead of answering.
 */
export function findUnaddressedDateRequirements(input: {
  goal: string;
  goalProgress: PlannerGoalProgress | undefined;
  answer: string;
}): string[] {
  if (!input.goalProgress) return [];
  const datesEntry = input.goalProgress.entries.find(entry => entry.key === 'dates');
  if (!datesEntry) return [];
  if (!hasResultClaimSignal(input.answer)) return [];

  const state = datesEntry.state;
  if (state === 'in_url') return [];
  if (state === 'NOT_SET') return ['requirements_unaddressed:dates_not_entered'];
  if (state.startsWith('stale:')) return ['requirements_unaddressed:dates_stale_reset'];
  if (state.startsWith('partial:')) return ['requirements_unaddressed:dates_partially_selected'];
  if (state.startsWith('typed:') || state.startsWith('selected:')) {
    return ['requirements_unaddressed:search_not_executed'];
  }
  return [];
}
