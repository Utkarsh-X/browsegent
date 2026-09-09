import { ProjectionService } from '../brain1/ProjectionService';
import { detectDateHorizon, findTargetDateCells } from '../planner/HorizonDetector';
import { parseGoalRequirements } from '../planner/GoalProgressTracker';
import type { BrowserObservation } from '../runtime/types';
import type { SeekIterationVerdict } from '../tools/types';

/**
 * Stop condition for the `seek` macro when the goal has a concrete date
 * target: keep advancing the widget while its visible window does not cover
 * the target month; stop as soon as the goal-exact target cells are present
 * (the planner can then click them normally). All semantics are deterministic
 * horizon machinery — the loop never invents facts and never acts beyond
 * clicking the control the planner selected.
 */
export function createDateSeekStop(goal: string): (observation: BrowserObservation) => SeekIterationVerdict {
  const requirements = parseGoalRequirements(goal);
  if (!requirements || !requirements.dateFrom) {
    return () => ({ stop: true, reason: 'no_date_target' });
  }

  const projectionService = new ProjectionService();

  return (observation: BrowserObservation): SeekIterationVerdict => {
    const lang = observation.lang?.trim();
    if (!lang) {
      return { stop: true, reason: 'page_language_unknown' };
    }

    const projection = projectionService.project(observation);
    const horizon = detectDateHorizon(projection, requirements);
    if (horizon) {
      // Widget present, target still outside the window: keep advancing.
      return {
        stop: false,
        reason: 'window_advancing',
        progressKey: horizon.visibleMonths.join(','),
      };
    }

    // No horizon reported: either the target month is covered (done) or the
    // widget is gone (calendar closed). Distinguish honestly.
    const matched = findTargetDateCells(projection, requirements);
    if (matched.length > 0) {
      return { stop: true, reason: 'target_reachable', progressKey: 'covered' };
    }
    return { stop: true, reason: 'widget_unavailable', progressKey: 'gone' };
  };
}
