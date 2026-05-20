import type { TraceJsonValue, TraceManifest, TraceStep } from '../trace/types';
import type { CompressedLineage, CompressedLineageStep, LineageCompressOptions } from './types';

const DEFAULT_MAX_LINEAGE_STEPS = 5;

export class LineageCompressor {
  compress(input: TraceManifest | TraceStep[], options: LineageCompressOptions = {}): CompressedLineage {
    const steps = Array.isArray(input) ? input : input.steps;
    const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_LINEAGE_STEPS);
    const recent = steps.slice(-maxSteps);

    return {
      totalSteps: steps.length,
      truncated: steps.length > recent.length,
      steps: recent.map(compressStep),
    };
  }
}

function compressStep(step: TraceStep): CompressedLineageStep {
  const result = asRecord(step.result);
  const error = asRecord(result?.error);
  const evidence = asRecord(result?.evidence);

  return {
    stepId: step.stepId,
    index: step.index,
    kind: step.kind,
    status: step.status,
    targetRef: step.targetRef ?? stringValue(result?.targetRef),
    beforeObservationId: step.beforeObservationId,
    afterObservationId: step.afterObservationId,
    errorCode: stringValue(error?.code),
    transitionClass: transitionClassValue(evidence?.transitionClass),
    strength: transitionStrengthValue(evidence?.strength),
  };
}

function asRecord(value: TraceJsonValue | undefined): Record<string, TraceJsonValue> | undefined {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }

  return value;
}

function stringValue(value: TraceJsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function transitionClassValue(value: TraceJsonValue | undefined): CompressedLineageStep['transitionClass'] {
  if (
    value === 'microstate'
    || value === 'structural_local'
    || value === 'structural_macrostate'
    || value === 'hard_reset'
  ) {
    return value;
  }

  return undefined;
}

function transitionStrengthValue(value: TraceJsonValue | undefined): CompressedLineageStep['strength'] {
  if (
    value === 'none'
    || value === 'weak'
    || value === 'moderate'
    || value === 'strong'
    || value === 'negative'
  ) {
    return value;
  }

  return undefined;
}
