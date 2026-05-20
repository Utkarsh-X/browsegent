import type { OperationalProjection } from '../brain1/projectionTypes';
import type { FailureEvidence } from './FailureClassifier';
import type { RuntimeUncertainty } from './UncertaintySignals';

export interface DeadStateAssessmentInput {
  projection: OperationalProjection;
  failures?: FailureEvidence[];
  uncertainty?: RuntimeUncertainty;
  localMechanismsExhausted: boolean;
}

export interface DeadStateEvidence {
  evidenceId: string;
  deadState: true;
  observationId: string;
  severity: 'warning' | 'critical';
  reasons: string[];
  failureKinds: string[];
  signals: string[];
}

export interface DeadStateAssessment {
  deadState: boolean;
  evidence?: DeadStateEvidence;
  pendingReasons: string[];
}

export class DeadStateDetector {
  assess(input: DeadStateAssessmentInput): DeadStateAssessment {
    const reasons = collectReasons(input);

    if (!input.localMechanismsExhausted || reasons.length === 0) {
      return {
        deadState: false,
        pendingReasons: reasons,
      };
    }

    const failureKinds = Array.from(new Set((input.failures ?? []).map(failure => failure.kind)));
    const signals = Array.from(new Set([
      ...reasons.map(reason => `reason:${reason}`),
      ...(input.uncertainty?.signals ?? []),
      ...failureKinds.map(kind => `failure:${kind}`),
    ]));

    return {
      deadState: true,
      pendingReasons: [],
      evidence: {
        evidenceId: `dead_state_${safeIdPart(input.projection.observationId)}`,
        deadState: true,
        observationId: input.projection.observationId,
        severity: reasons.includes('environment_block') || reasons.includes('empty_interactions') ? 'critical' : 'warning',
        reasons,
        failureKinds,
        signals,
      },
    };
  }
}

function collectReasons(input: DeadStateAssessmentInput): string[] {
  const reasons: string[] = [];

  if (input.projection.stats.interactionCount === 0) {
    reasons.push('empty_interactions');
  }

  for (const failure of input.failures ?? []) {
    if (failure.kind === 'environment_block') reasons.push('environment_block');
    if (failure.kind === 'empty_projection') reasons.push('empty_projection');
    if (failure.kind === 'stale_ref') reasons.push('stale_ref');
    if (failure.kind === 'low_confidence_ref') reasons.push('low_confidence_ref');
  }

  if (input.uncertainty?.level === 'high') {
    reasons.push('high_uncertainty');
  }

  return Array.from(new Set(reasons));
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, '_');
}
