import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
import type { ContinuityGraphSnapshot } from '../graph/types';
import { LineageCompressor } from './LineageCompressor';
import { PlannerWorkingSetSelector } from './PlannerWorkingSetSelector';
import { RecoveryStateBuilder } from '../runtime/RecoveryState';
import type {
  PlannerContinuitySummary,
  PlannerDeadStateSummary,
  PlannerFailureSummary,
  PlannerInput,
  PlannerInputComposerInput,
  PlannerLastResultSummary,
  PlannerTransitionSummary,
  PlannerUncertainty,
  PlannerUncertaintyLevel,
} from './types';

export class PlannerInputComposer {
  private readonly lineageCompressor = new LineageCompressor();
  private readonly workingSetSelector = new PlannerWorkingSetSelector();
  private readonly recoveryStateBuilder = new RecoveryStateBuilder();

  compose(input: PlannerInputComposerInput): PlannerInput {
    const workingSetSelection = this.workingSetSelector.select({
      goal: input.goal,
      projection: input.projection,
      graphSnapshot: input.graphSnapshot,
      transitionEvidence: input.transitionEvidence,
      lastResult: input.lastResult,
      failureEvidence: input.failureEvidence,
    });
    const current = workingSetSelection.current;
    const recovery = this.recoveryStateBuilder.build({
      lastResult: input.lastResult,
      failures: input.failureEvidence,
      uncertaintySignals: input.runtimeUncertainty?.signals,
    });

    return {
      version: 'v2.planner_input.v2',
      episodeId: input.episodeId,
      goal: input.goal,
      current,
      workingSet: workingSetSelection.workingSet,
      workingSetDiagnostics: workingSetSelection.diagnostics,
      continuity: input.graphSnapshot ? summarizeContinuity(input.graphSnapshot) : undefined,
      transition: input.transitionEvidence ? summarizeTransition(input.transitionEvidence) : undefined,
      lastResult: input.lastResult ? summarizeLastResult(input.lastResult) : undefined,
      failures: input.failureEvidence?.map(summarizeFailure),
      deadState: input.deadStateEvidence ? summarizeDeadState(input.deadStateEvidence) : undefined,
      recovery,
      uncertainty: buildUncertainty(input),
      lineage: input.trace
        ? this.lineageCompressor.compress(input.trace, { maxSteps: input.maxLineageSteps })
        : undefined,
    };
  }
}

function summarizeContinuity(snapshot: ContinuityGraphSnapshot): PlannerContinuitySummary {
  const latestTransition = snapshot.transitions[snapshot.transitions.length - 1];

  return {
    snapshotId: snapshot.snapshotId,
    observationId: snapshot.observationId,
    generationId: snapshot.generationId,
    url: snapshot.url,
    refCount: snapshot.stats.refCount,
    presentRefCount: snapshot.stats.presentRefCount,
    regionCount: snapshot.stats.regionCount,
    transitionCount: snapshot.stats.transitionCount,
    latestTransition: latestTransition
      ? {
          transitionId: latestTransition.transitionId,
          transitionClass: latestTransition.transitionClass,
          strength: latestTransition.strength,
        }
      : undefined,
  };
}

function summarizeTransition(evidence: TransitionEvidence): PlannerTransitionSummary {
  return {
    beforeObservationId: evidence.beforeObservationId,
    afterObservationId: evidence.afterObservationId,
    transitionClass: evidence.transitionClass,
    strength: evidence.strength,
    generationChanged: evidence.generationChanged,
    urlChanged: evidence.urlChanged,
    refChangeCounts: {
      appeared: evidence.refChanges.appeared.length,
      disappeared: evidence.refChanges.disappeared.length,
      weakened: evidence.refChanges.weakened.length,
      preserved: evidence.refChanges.preserved.length,
    },
    notes: evidence.notes.slice(0, 8),
  };
}

function summarizeLastResult(result: V2ToolResult): PlannerLastResultSummary {
  return {
    success: result.success,
    kind: result.kind,
    traceStepId: result.traceStepId,
    targetRef: result.targetRef,
    valuePreview: previewResultEvidence(result),
    error: result.error
      ? {
          code: result.error.code,
          retryable: result.error.retryable,
        }
      : undefined,
    evidence: result.evidence
      ? {
          transitionClass: result.evidence.transitionClass,
          strength: result.evidence.strength,
        }
      : undefined,
  };
}

function summarizeFailure(failure: NonNullable<PlannerInputComposerInput['failureEvidence']>[number]): PlannerFailureSummary {
  return {
    failureId: failure.failureId,
    kind: failure.kind,
    category: failure.category,
    severity: failure.severity,
    persistence: failure.persistence,
    retryable: failure.retryable,
    observationId: failure.observationId,
    targetRef: failure.targetRef,
    signals: failure.signals.slice(0, 8),
  };
}

function summarizeDeadState(deadState: NonNullable<PlannerInputComposerInput['deadStateEvidence']>): PlannerDeadStateSummary {
  return {
    deadState: true,
    evidenceId: deadState.evidenceId,
    observationId: deadState.observationId,
    severity: deadState.severity,
    reasons: deadState.reasons.slice(0, 8),
    failureKinds: deadState.failureKinds.slice(0, 8),
    signals: deadState.signals.slice(0, 8),
  };
}

function buildUncertainty(input: PlannerInputComposerInput): PlannerUncertainty {
  if (input.runtimeUncertainty) {
    return {
      level: input.runtimeUncertainty.level,
      signals: input.runtimeUncertainty.signals.slice(0, 12),
    };
  }

  const signals: string[] = [];

  for (const warning of input.projection.warnings) {
    signals.push(`runtime_warning:${warning.code}`);
  }

  const weakenedCount = input.transitionEvidence?.refChanges.weakened.length ?? 0;
  if (weakenedCount > 0) {
    signals.push(`weakened_refs:${weakenedCount}`);
  }

  if (input.transitionEvidence?.strength === 'none') {
    signals.push('transition_strength:none');
  }

  if (input.transitionEvidence?.transitionClass === 'hard_reset') {
    signals.push('transition_class:hard_reset');
  }

  if (input.lastResult?.error) {
    signals.push(`last_error:${input.lastResult.error.code}`);
  }

  if (input.projection.stats.interactionCount === 0) {
    signals.push('empty_interactions');
  }

  for (const failure of input.failureEvidence ?? []) {
    signals.push(`failure:${failure.kind}`);
  }

  if (input.deadStateEvidence) {
    signals.push('dead_state_evidence');
  }

  return {
    level: chooseUncertaintyLevel(signals),
    signals,
  };
}

function chooseUncertaintyLevel(signals: string[]): PlannerUncertaintyLevel {
  if (
    signals.includes('transition_class:hard_reset')
    || signals.includes('empty_interactions')
    || signals.includes('dead_state_evidence')
    || signals.includes('failure:environment_block')
  ) {
    return 'high';
  }

  if (signals.some(signal => signal.startsWith('last_error:stale_ref') || signal.startsWith('last_error:target_blocked'))) {
    return 'high';
  }

  if (signals.length > 0) {
    return 'medium';
  }

  return 'none';
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const objectPreview = previewObjectValue(value);
  if (objectPreview) {
    return objectPreview;
  }

  return compactPreview(JSON.stringify(value));
}

function previewResultEvidence(result: V2ToolResult): string | undefined {
  const parts = [
    previewValue(result.value),
    previewToolTarget(result.target),
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  return parts.length > 0 ? compactPreview(parts.join(' ')) : undefined;
}

function previewObjectValue(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ['value', 'text', 'inputValue', 'url'] as const) {
    const part = record[key];
    if (typeof part === 'string' && part.trim().length > 0) {
      parts.push(part);
    }
  }

  const preview = record.preview;
  if (Array.isArray(preview)) {
    parts.push(...preview.filter((part): part is string => typeof part === 'string' && part.trim().length > 0));
  }

  return parts.length > 0 ? compactPreview(parts.join(' ')) : undefined;
}

function previewToolTarget(target: V2ToolResult['target']): string | undefined {
  if (!target) {
    return undefined;
  }

  const parts = [target.name, target.text, target.role]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  const uniqueParts = parts.filter((part, index) => parts.findIndex(existing => existing.toLowerCase() === part.toLowerCase()) === index);

  return uniqueParts.length > 0 ? compactPreview(uniqueParts.join(' ')) : undefined;
}

function compactPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}
