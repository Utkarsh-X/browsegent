import type { TransitionClass, TransitionStrength } from '../runtime/types';
import type { RefComparison } from '../runtime/refResolution';

export type RefChangeSummary = RefComparison;

export interface ProgressEvidenceInput {
  transitionClass: TransitionClass;
  refChanges: RefChangeSummary;
  changedRefs: string[];
  boxChangedRefs: string[];
}

export function calculateProgressStrength(input: ProgressEvidenceInput): TransitionStrength {
  if (input.transitionClass === 'hard_reset' || input.transitionClass === 'structural_macrostate') {
    return 'strong';
  }

  if (input.transitionClass === 'structural_local') {
    return 'moderate';
  }

  if (input.boxChangedRefs.length > 0) {
    return 'weak';
  }

  return 'none';
}
