import type { OperationalProjection } from '../brain1/projectionTypes';
import type { ContinuityGraphSnapshot } from '../graph/types';
import type { TransitionEvidence } from './types';
import type { DeadStateEvidence } from './DeadStateDetector';
import type { FailureEvidence } from './FailureClassifier';

export interface RuntimeUncertaintyInput {
  projection?: OperationalProjection;
  transitionEvidence?: TransitionEvidence;
  lastResult?: import('./types').V2ToolResult;
  graphSnapshot?: ContinuityGraphSnapshot;
  failures?: FailureEvidence[];
  deadStateEvidence?: DeadStateEvidence;
  extraSignals?: string[];
}

export interface RuntimeUncertainty {
  level: 'none' | 'low' | 'medium' | 'high';
  signals: string[];
}

const MAX_EXPLICIT_LOW_CONFIDENCE_REFS = 4;

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

  const lowConfidenceRefIds = Array.from(new Set(
    (input.projection?.interactions ?? [])
      .filter(item => item.state === 'weakened' || item.continuityConfidence < 0.7)
      .map(item => item.refId),
  ));
  if (lowConfidenceRefIds.length > 0) {
    signals.push(`low_confidence_refs:${lowConfidenceRefIds.length}`);
    for (const refId of lowConfidenceRefIds.slice(0, MAX_EXPLICIT_LOW_CONFIDENCE_REFS)) {
      signals.push(`low_confidence_ref:${refId}`);
    }
  }

  for (const warning of input.projection?.warnings ?? []) {
    signals.push(`runtime_warning:${warning.code}`);
  }

  if (input.transitionEvidence?.refChanges.weakened.length) {
    signals.push(`weakened_refs:${input.transitionEvidence.refChanges.weakened.length}`);
  }

  if (input.transitionEvidence?.strength === 'none') {
    signals.push('transition_strength:none');
  }

  if (input.transitionEvidence?.transitionClass === 'hard_reset') {
    signals.push('transition_class:hard_reset');
  }

  if (
    input.lastResult?.success
    && input.lastResult.kind === 'navigate'
    && input.transitionEvidence?.urlChanged === false
  ) {
    // A navigation that did not change the URL is a self-inflicted reset:
    // it clears in-progress form state without moving the task forward.
    signals.push('no_op_navigation');
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

  for (const signal of input.extraSignals ?? []) {
    signals.push(signal);
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
    || signals.includes('navigation_oscillation')
  ) {
    return 'high';
  }

  if (
    signals.some(signal =>
      signal.startsWith('failure:')
      || signal.startsWith('low_confidence_ref:')
      || signal.startsWith('low_confidence_refs:')
      || signal.startsWith('weakened_refs:')
      || signal.startsWith('repeated_no_progress_transition:')
      || signal.startsWith('repeated_no_progress_target:')
      || signal.startsWith('repeated_value_preview:')
      || signal === 'transition_class:hard_reset'
      || signal === 'click_no_navigation',
    )
  ) {
    return 'medium';
  }

  if (signals.length > 0) {
    return 'low';
  }

  return 'none';
}

/**
 * True when the recent observation-URL history alternates between two pages
 * (A,B,A,B in the last four entries) or repeats one URL three times within the
 * last five entries — the navigation-churn pattern where the planner bounces
 * between surfaces instead of acting on the one that can advance the goal.
 */
export function detectNavigationOscillation(recentUrls: string[]): boolean {
  const urls = recentUrls.filter(url => typeof url === 'string' && url.length > 0);
  if (urls.length >= 4) {
    const [a, b, c, d] = urls.slice(-4);
    if (a === c && b === d && a !== b) return true;
  }
  if (urls.length >= 5) {
    const window = urls.slice(-5);
    const last = window[window.length - 1];
    const repeats = window.filter(url => url === last).length;
    if (repeats >= 3) return true;
  }
  return false;
}
