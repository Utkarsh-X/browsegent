import type { V2Ref } from './types';

export interface RefSelfHealDecision {
  allow: boolean;
  reason:
    | 'verified_runtime_resolution_required'
    | 'ref_not_weakened'
    | 'continuity_confidence_too_low'
    | 'target_not_visible_ready'
    | 'action_not_compatible'
    | 'missing_selector_candidates';
}

export function shouldAttemptWeakenedRefSelfHeal(actionKind: string, ref: V2Ref | undefined): RefSelfHealDecision {
  if (!ref || ref.state !== 'weakened') {
    return { allow: false, reason: 'ref_not_weakened' };
  }
  if (ref.continuityConfidence < 0.5) {
    return { allow: false, reason: 'continuity_confidence_too_low' };
  }
  // Offscreen-but-ready elements remain clickable: the runtime scrolls them
  // into view natively. Only truly hidden or non-ready targets are refused.
  // (A calendar cell 3.5px past the fold was refused here and lost the step.)
  if (ref.visibility === 'hidden' || ref.actionability !== 'ready') {
    return { allow: false, reason: 'target_not_visible_ready' };
  }
  if (ref.selectorCandidates.length === 0) {
    return { allow: false, reason: 'missing_selector_candidates' };
  }

  const caps = ref.capabilities;
  if (actionKind === 'click' && caps?.clickable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if (actionKind === 'type' && caps?.typeable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if (actionKind === 'select' && caps?.selectable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }
  if ((actionKind === 'get' || actionKind === 'inspect_region') && caps?.readable === false) {
    return { allow: false, reason: 'action_not_compatible' };
  }

  return { allow: true, reason: 'verified_runtime_resolution_required' };
}
