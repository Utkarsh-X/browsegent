import type { CompressedLineage } from './types';
import type { PlannerGoalProgress } from './GoalProgressTracker';

/**
 * Single source of truth for the commit phase: every parsed requirement is
 * addressed (no focus remains) and no Enter/submit has already been pressed.
 * Used by the working-set submit-control promotion and by the `submit_form`
 * refusal guard, so promotion and refusal can never disagree.
 */
export function commitPhaseReady(
  goalProgress: PlannerGoalProgress | undefined,
  goalLineage: CompressedLineage | undefined,
): boolean {
  if (!goalProgress || goalProgress.focus !== undefined) return false;
  if (goalLineage?.steps.some(step => step.kind === 'press' && step.status === 'completed')) return false;
  return true;
}
