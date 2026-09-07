import type { TransitionEvidence, V2ToolResult } from '../runtime/types';
import type { ContinuityGraphSnapshot } from '../graph/types';
import { LineageCompressor } from './LineageCompressor';
import { measureProjectionSize } from './ProjectionSizeDiagnostics';
import { PlannerWorkingSetSelector } from './PlannerWorkingSetSelector';
import { RecoveryStateBuilder } from '../runtime/RecoveryState';
import { buildTaskProgress } from '../agent/TaskProgress';
import { evaluateGoalProgress, parseGoalRequirements } from './GoalProgressTracker';
import { commitPhaseReady } from './CommitPhase';
import { detectDateHorizon, findSubmitControls, findTargetDateCells } from './HorizonDetector';
import type { PlannerGoalProgress } from './GoalProgressTracker';
import type { SurfaceHorizon } from './HorizonDetector';
import type { CompressedLineage } from './types';
import type {
  PlannerContinuitySummary,
  PlannerDeadStateSummary,
  PlannerEvidenceSnapshot,
  PlannerFailureSummary,
  PlannerInput,
  PlannerInputComposerInput,
  PlannerLastResultSummary,
  PlannerTransitionSummary,
  PlannerUncertainty,
  PlannerUncertaintyLevel,
} from './types';

const DEFAULT_RESULT_PREVIEW_LIMIT = 240;
const READ_RESULT_PREVIEW_LIMIT = 1_500;
/**
 * Requirement evidence (e.g. a destination typed several steps ago) is
 * long-horizon state; the rendered lineage stays a short recent window but the
 * checklist must not forget it just because the window slid past it.
 */
const GOAL_PROGRESS_LINEAGE_HORIZON_STEPS = 48;

export class PlannerInputComposer {
  private readonly lineageCompressor = new LineageCompressor();
  private readonly workingSetSelector = new PlannerWorkingSetSelector();
  private readonly recoveryStateBuilder = new RecoveryStateBuilder();

  compose(input: PlannerInputComposerInput): PlannerInput {
    const workingSetSelector = input.workingSetOptions
      ? new PlannerWorkingSetSelector(input.workingSetOptions)
      : this.workingSetSelector;
    const evidenceSnapshot = restrictEvidenceSnapshotToCurrentInteractions(input.evidenceSnapshot, input.projection);
    const evidenceRefIds = evidenceSnapshot
      ? [...new Set(evidenceSnapshot.cards.flatMap(card => card.refIds))].slice(0, 16)
      : undefined;
    const lineage = input.trace
      ? this.lineageCompressor.compress(input.trace, { maxSteps: input.maxLineageSteps })
      : undefined;
    const goalLineage = input.trace
      ? this.lineageCompressor.compress(input.trace, { maxSteps: GOAL_PROGRESS_LINEAGE_HORIZON_STEPS })
      : undefined;
    const goalProgress = input.goalProgress ?? evaluateGoalProgress(input.goal, {
      url: input.graphSnapshot?.url,
      lineage: goalLineage,
      lang: input.projection.lang,
    });
    const horizon = detectHorizonForFocus(input.projection, input.goal, goalProgress);
    const targetValueRefs = horizon
      ? undefined
      : findTargetValueRefs(input.projection, input.goal, goalProgress);
    const submitControlRefs = findSubmitControlRefs(input.projection, goalProgress, goalLineage);
    const workingSetSelection = workingSetSelector.select({
      goal: input.goal,
      projection: input.projection,
      evidenceRefIds,
      horizonControlRefs: horizon?.navControls.map(control => control.refId),
      targetValueRefs,
      submitControlRefs,
      graphSnapshot: input.graphSnapshot,
      transitionEvidence: input.transitionEvidence,
      lastResult: input.lastResult,
      failureEvidence: input.failureEvidence,
      uncertaintySignals: input.runtimeUncertainty?.signals,
      previousRenderedRefs: input.previousRenderedRefs,
    });
    const current = workingSetSelection.current;
    const taskProgress = buildTaskProgress({
      goal: input.goal,
      projection: input.projection,
      lastResult: input.lastResult,
      trace: input.trace,
    });
    const recovery = this.recoveryStateBuilder.build({
      projection: input.projection,
      lastResult: input.lastResult,
      failures: input.failureEvidence,
      uncertaintySignals: input.runtimeUncertainty?.signals,
      evidenceCoverageStatus: input.evidenceCoverage?.status,
    });

    const plannerInput: PlannerInput = {
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
      answerFeedback: input.answerFeedback,
      evidenceCoverage: input.evidenceCoverage,
      taskProgress: taskProgress.items.length > 0 ? taskProgress : undefined,
      evidenceSnapshot,
      uncertainty: buildUncertainty(input),
      lineage,
    };

    if (goalProgress !== undefined) {
      plannerInput.goalProgress = goalProgress;
    }
    if (horizon !== undefined) {
      plannerInput.horizon = horizon;
    }

    plannerInput.sizeDiagnostics = measureProjectionSize({
      current: plannerInput.current,
      workingSet: plannerInput.workingSet,
      plannerInput,
    });

    return plannerInput;
  }
}

function restrictEvidenceSnapshotToCurrentInteractions(
  snapshot: PlannerEvidenceSnapshot | undefined,
  projection: PlannerInputComposerInput['projection'],
): PlannerEvidenceSnapshot | undefined {
  if (!snapshot) return undefined;

  const currentInteractionRefs = new Set(projection.interactions.map(item => item.refId));
  return {
    ...snapshot,
    cards: snapshot.cards.map(card => ({
      ...card,
      refIds: card.refIds.filter(refId => currentInteractionRefs.has(refId)),
    })),
  };
}

/**
 * Runs the horizon detector only while the focused requirement is a concrete,
 * unsatisfied dates target. Detection is deterministic; failure degrades to no
 * annotation, never to invented facts. When the target month IS visible, the
 * detector's matched target-date cells are force-selected instead so the
 * planner can act on the exact value it needs.
 */
function detectHorizonForFocus(
  projection: PlannerInputComposerInput['projection'],
  goal: string,
  goalProgress: PlannerGoalProgress | undefined,
): SurfaceHorizon | undefined {
  if (!goalProgress || goalProgress.focus !== 'dates') return undefined;

  const datesEntry = goalProgress.entries.find(entry => entry.key === 'dates');
  if (!datesEntry || !(datesEntry.state === 'NOT_SET' || datesEntry.state.startsWith('partial:'))) return undefined;

  const requirements = parseGoalRequirements(goal);
  if (!requirements) return undefined;

  const horizon = detectDateHorizon(projection, requirements);
  if (!horizon || horizon.covered || horizon.navControls.length === 0) return undefined;

  return horizon;
}

/**
 * Commit phase: every parsed requirement is addressed (no focus remains) and
 * no submission has been attempted in the goal lineage — the form's submit
 * control must stay visible so the planner can confirm the entry.
 */
function findSubmitControlRefs(
  projection: PlannerInputComposerInput['projection'],
  goalProgress: PlannerGoalProgress | undefined,
  goalLineage: CompressedLineage | undefined,
): string[] | undefined {
  // Same predicate the submit_form refusal guard uses: promotion and refusal
  // can never disagree about when the commit phase is open.
  if (!commitPhaseReady(goalProgress, goalLineage)) return undefined;
  const submits = findSubmitControls(projection);
  return submits.length > 0 ? submits.map(control => control.refId) : undefined;
}

function findTargetValueRefs(
  projection: PlannerInputComposerInput['projection'],
  goal: string,
  goalProgress: PlannerGoalProgress | undefined,
): string[] | undefined {
  if (!goalProgress || goalProgress.focus !== 'dates') return undefined;

  const datesEntry = goalProgress.entries.find(entry => entry.key === 'dates');
  if (!datesEntry || !(datesEntry.state === 'NOT_SET' || datesEntry.state.startsWith('partial:'))) return undefined;

  const requirements = parseGoalRequirements(goal);
  if (!requirements) return undefined;

  const matched = findTargetDateCells(projection, requirements);
  return matched.length > 0 ? matched.map(cell => cell.refId) : undefined;
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
    effect: result.success ? summarizeActionEffect(result.evidence) : undefined,
    error: result.error
      ? {
          code: result.error.code,
          retryable: result.error.retryable,
          diagnostics: result.error.diagnostics,
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

/**
 * Deterministic post-action verdict: did the action change the page at all?
 * 'page' = URL moved, 'local' = same-page structural change, 'none' = the
 * runtime measured no observable change (the planner must not repeat it).
 */
function summarizeActionEffect(evidence: TransitionEvidence | undefined): 'page' | 'local' | 'none' {
  if (!evidence) return 'none';
  if (evidence.urlChanged) return 'page';
  if (evidence.generationChanged || evidence.refChanges.appeared.length > 0) return 'local';
  return 'none';
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
  return previewValueWithLimit(value, DEFAULT_RESULT_PREVIEW_LIMIT);
}

function previewValueWithLimit(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return compactPreview(value, maxLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const objectPreview = previewObjectValue(value, maxLength);
  if (objectPreview) {
    return objectPreview;
  }

  return compactPreview(JSON.stringify(value), maxLength);
}

function previewResultEvidence(result: V2ToolResult): string | undefined {
  const maxLength = isReadResult(result.kind) ? READ_RESULT_PREVIEW_LIMIT : DEFAULT_RESULT_PREVIEW_LIMIT;
  const parts = [
    previewValueWithLimit(result.value, maxLength),
    previewToolTarget(result.target),
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  return parts.length > 0 ? compactPreview(parts.join(' '), maxLength) : undefined;
}

function previewObjectValue(value: unknown, maxLength: number): string | undefined {
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

  return parts.length > 0 ? compactPreview(parts.join(' '), maxLength) : undefined;
}

function previewToolTarget(target: V2ToolResult['target']): string | undefined {
  if (!target) {
    return undefined;
  }

  const parts = [target.name, target.text, target.role]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  const uniqueParts = parts.filter((part, index) => parts.findIndex(existing => existing.toLowerCase() === part.toLowerCase()) === index);

  return uniqueParts.length > 0 ? compactPreview(uniqueParts.join(' '), DEFAULT_RESULT_PREVIEW_LIMIT) : undefined;
}

function compactPreview(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isReadResult(kind: string | undefined): boolean {
  return kind === 'get' || kind === 'inspect_region' || kind === 'search_page';
}
