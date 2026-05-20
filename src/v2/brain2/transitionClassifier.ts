import type { BrowserObservation, TransitionClass } from '../runtime/types';
import type { RefChangeSummary } from './progressEvidence';

export interface TransitionClassificationInput {
  before: BrowserObservation;
  after: BrowserObservation;
  refChanges: RefChangeSummary;
  changedRefs: string[];
}

export function classifyTransition(input: TransitionClassificationInput): TransitionClass {
  const generationChanged = input.before.generationId !== input.after.generationId;
  const urlChanged = input.before.url !== input.after.url;

  if (generationChanged && !urlChanged) {
    return 'hard_reset';
  }

  if (urlChanged) {
    return 'structural_macrostate';
  }

  if (
    input.refChanges.appeared.length > 0
    || input.refChanges.disappeared.length > 0
    || input.refChanges.weakened.length > 0
    || input.changedRefs.length > 0
  ) {
    return 'structural_local';
  }

  return 'microstate';
}
