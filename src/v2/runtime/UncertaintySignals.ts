import type { OperationalProjection } from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { TransitionEvidence } from './types';
import type { DeadStateEvidence } from './DeadStateDetector';
import type { FailureEvidence } from './FailureClassifier';

export interface RuntimeUncertaintyInput {
  projection?: OperationalProjection;
  transitionEvidence?: TransitionEvidence;
  graphSnapshot?: ContinuityGraphSnapshot;
  failures?: FailureEvidence[];
  deadStateEvidence?: DeadStateEvidence;
}

export interface RuntimeUncertainty {
  level: 'none' | 'low' | 'medium' | 'high';
  signals: string[];
}

export class UncertaintySignals {
  fromRuntimeState(input: RuntimeUncertaintyInput): RuntimeUncertainty {
    const signals = collectSignals(input);

    return {
      level: chooseLevel(signals),
      signals,
    };
  }
}

function collectSignals(input: RuntimeUncertaintyInput): string[] {
  const signals: string[] = [];

  if (input.projection?.stats.interactionCount === 0) {
    signals.push('empty_interactions');
  }

  for (const item of input.projection?.interactions ?? []) {
    if (item.state === 'weakened' || item.continuityConfidence < 0.7) {
      signals.push(`low_confidence_ref:${item.refId}`);
    }
  }

  for (const warning of input.projection?.warnings ?? []) {
    signals.push(`runtime_warning:${warning.code}`);
  }

  if (input.transitionEvidence?.refChanges.weakened.length) {
    signals.push(`weakened_refs:${input.transitionEvidence.refChanges.weakened.length}`);
  }

  if (input.transitionEvidence?.transitionClass === 'hard_reset') {
    signals.push('transition_class:hard_reset');
  }

  if (input.graphSnapshot && input.graphSnapshot.stats.presentRefCount === 0) {
    signals.push('graph_present_refs:0');
  }

  for (const failure of input.failures ?? []) {
    signals.push(`failure:${failure.kind}`);
  }

  if (input.deadStateEvidence) {
    signals.push('dead_state_evidence');
  }

  return Array.from(new Set(signals));
}

function chooseLevel(signals: string[]): RuntimeUncertainty['level'] {
  if (
    signals.includes('dead_state_evidence')
    || signals.includes('empty_interactions')
    || signals.includes('graph_present_refs:0')
    || signals.includes('failure:environment_block')
    || signals.includes('failure:target_blocked')
  ) {
    return 'high';
  }

  if (
    signals.some(signal =>
      signal.startsWith('failure:')
      || signal.startsWith('low_confidence_ref:')
      || signal.startsWith('weakened_refs:')
      || signal === 'transition_class:hard_reset',
    )
  ) {
    return 'medium';
  }

  if (signals.length > 0) {
    return 'low';
  }

  return 'none';
}
