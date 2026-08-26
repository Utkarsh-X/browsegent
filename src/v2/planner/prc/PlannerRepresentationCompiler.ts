import type { SerializedProjection, SerializedProjectionItem, SerializedProjectionRef } from '../../brain1/projectionTypes';
import type { PlannerInput, PlannerFailureSummary } from '../types';
import type { PlannerElementIR, PlannerElementLane, PlannerRepresentationIR, PlannerScoreTier, WorkingSetIR } from './types';
import type { PlannerActionSurface } from '../workingSetTypes';

export class PlannerRepresentationCompiler {
  compile(input: PlannerInput): PlannerRepresentationIR {
    const failureMap = buildFailureMap(input.failures ?? []);
    const pinnedRefIds = buildPinnedRefIds(input.workingSet);
    const surface = buildSurface(input.current, failureMap, pinnedRefIds, input.workingSet?.actionSurface);
    const workingSet = input.workingSet ? buildWorkingSet(input.workingSet) : undefined;
    const decisionSignals = input.workingSet ? buildDecisionSignals(input.workingSet) : undefined;
    const allElements = [...surface.groups.flatMap(group => group.elements), ...surface.remainder];

    return {
      execution: {
        goal: input.goal,
        page: input.current.page,
        focus: input.current.focus,
        continuity: input.continuity,
        transition: input.transition,
        lastResult: input.lastResult,
        failures: input.failures ?? [],
        deadState: input.deadState,
        recovery: input.recovery,
        answerFeedback: input.answerFeedback,
        evidenceCoverage: input.evidenceCoverage,
        uncertainty: input.uncertainty,
        lineage: input.lineage,
      },
      surface,
      workingSet,
      decisionSignals,
      stats: {
        inputRefCount: surface.inputRefCount,
        surfaceRefCount: surface.surfaceRefCount,
        omittedRegionMembers: surface.groups.reduce((sum, group) => sum + group.omittedCount, 0),
        failureAnnotations: allElements.filter(element => element.failure).length,
        anomalyCount: allElements.reduce((sum, element) => sum + element.anomalies.length, 0),
      },
    };
  }
}

function buildSurface(
  current: SerializedProjection,
  failureMap: Map<string, PlannerElementIR['failure']>,
  pinnedRefIds: Set<string>,
  actionSurface?: PlannerActionSurface,
) {
  const laneByRef = new Map<string, { lane: PlannerElementLane; rank: number }>();
  addLane(laneByRef, current.interactions, 'interaction');
  addLane(laneByRef, current.readables, 'readable');
  addLane(laneByRef, current.navigation, 'navigation');

  const elementsByRef = new Map<string, PlannerElementIR>();
  for (const [refId, ref] of Object.entries(current.refs)) {
    const laneInfo = laneByRef.get(refId);
    const tools: string[] = [];
    if (actionSurface) {
      if (actionSurface.clickableRefs.includes(refId)) tools.push('c');
      if (actionSurface.typeableRefs.includes(refId)) tools.push('t');
      if (actionSurface.selectableRefs.includes(refId)) tools.push('s');
      if (actionSurface.readableRefs.includes(refId)) tools.push('r');
      if (actionSurface.ambiguousRefs.includes(refId)) tools.push('a');
    }
    elementsByRef.set(
      refId,
      normalizeElement(
        ref,
        laneInfo?.lane ?? 'mixed',
        laneInfo?.rank,
        failureMap.get(refId),
        tools.length > 0 ? tools : undefined,
      ),
    );
  }

  const groupedRefs = new Set<string>();
  const groups = current.regions
    .map(region => {
      const regionElements = region.refIds
        .map(refId => elementsByRef.get(refId))
        .filter((element): element is PlannerElementIR => Boolean(element));
      for (const element of regionElements) groupedRefs.add(element.refId);
      const maxVisible = regionElements.length <= 5 ? regionElements.length : regionElements.length <= 20 ? 3 : 2;
      const visibleElements = selectVisibleRegionElements(regionElements, maxVisible, pinnedRefIds);
      return {
        regionId: region.regionId,
        label: region.label,
        kind: region.kind,
        elements: visibleElements,
        omittedCount: Math.max(0, regionElements.length - visibleElements.length),
        totalCount: regionElements.length,
      };
    })
    .filter(group => group.totalCount > 0);

  const remainder = [...elementsByRef.values()].filter(element => !groupedRefs.has(element.refId));

  return {
    groups,
    remainder,
    inputRefCount: Object.keys(current.refs).length,
    surfaceRefCount: groups.reduce((sum, group) => sum + group.elements.length, 0) + remainder.length,
  };
}

function selectVisibleRegionElements(
  regionElements: PlannerElementIR[],
  maxVisible: number,
  pinnedRefIds: Set<string>,
): PlannerElementIR[] {
  const visible = regionElements.slice(0, maxVisible);
  const visibleRefIds = new Set(visible.map(element => element.refId));

  for (const element of regionElements) {
    if (!pinnedRefIds.has(element.refId) || visibleRefIds.has(element.refId)) continue;
    visible.push(element);
    visibleRefIds.add(element.refId);
  }

  return visible;
}

function addLane(target: Map<string, { lane: PlannerElementLane; rank: number }>, items: SerializedProjectionItem[], lane: PlannerElementLane): void {
  for (const item of items) {
    const existing = target.get(item.refId);
    target.set(item.refId, { lane: existing ? 'mixed' : lane, rank: Math.min(existing?.rank ?? item.rank, item.rank) });
  }
}

function normalizeElement(
  ref: SerializedProjectionRef,
  lane: PlannerElementLane,
  rank: number | undefined,
  failure: PlannerElementIR['failure'],
  tools: string[] | undefined,
): PlannerElementIR {
  const anomalies: string[] = [];
  if (ref.visibility !== 'visible') anomalies.push(`visibility=${ref.visibility}`);
  if (ref.actionability !== 'ready') anomalies.push(`actionability=${ref.actionability}`);
  if (ref.state !== 'live') anomalies.push(`state=${ref.state}`);
  if (ref.confidence < 1) anomalies.push(`confidence=${ref.confidence.toFixed(2)}`);

  return {
    refId: ref.refId,
    kind: ref.kind,
    role: ref.role,
    name: ref.name ?? ref.text ?? ref.refId,
    text: ref.text && ref.text !== ref.name ? ref.text : undefined,
    lane,
    rank,
    scoreTier: scoreTier(ref.score),
    score: ref.score,
    regionId: ref.regionId,
    selectOptions: ref.selectOptions,
    anomalies,
    failure,
    tools,
  };
}

function scoreTier(score: number): PlannerScoreTier {
  // Thresholds match BrowseGent operational scoring bands
  if (score >= 110) return 'top';
  if (score >= 90) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

function buildFailureMap(failures: PlannerFailureSummary[]): Map<string, PlannerElementIR['failure']> {
  // First pass: composite key map to correctly count per ref+kind
  const byKind = new Map<string, { kind: string; count: number; retryable: boolean; persistence: 'transient' | 'persistent' | 'unknown' }>();
  for (const failure of failures) {
    if (!failure.targetRef) continue;
    const key = `${failure.targetRef}:${failure.kind}`;
    const existing = byKind.get(key);
    if (existing) {
      existing.count++;
      existing.retryable = existing.retryable || failure.retryable;
    } else {
      byKind.set(key, { kind: failure.kind, count: 1, retryable: failure.retryable, persistence: failure.persistence });
    }
  }
  // Second pass: collapse to per-ref map, picking highest count entry per ref
  const byRef = new Map<string, { kind: string; count: number; retryable: boolean; persistence: 'transient' | 'persistent' | 'unknown' }>();
  for (const [key, entry] of byKind) {
    // v2ref_N refIds contain no colons — split is safe here
    const refId = key.split(':')[0]!;
    const existing = byRef.get(refId);
    if (!existing || entry.count > existing.count) {
      byRef.set(refId, entry);
    }
  }
  return byRef;
}

function buildDecisionSignals(workingSet: NonNullable<PlannerInput['workingSet']>) {
  return {
    actionSurface: workingSet.actionSurface,
    suppressed: {
      count: workingSet.omitted.droppedRefCount,
      byReason: workingSet.omitted.droppedByReason,
    },
  };
}

function buildPinnedRefIds(workingSet: PlannerInput['workingSet']): Set<string> {
  const pinned = new Set<string>();
  if (!workingSet) return pinned;

  for (const ref of [
    ...workingSet.primaryRefs,
    ...workingSet.secondaryRefs,
    ...workingSet.navigationRefs,
    ...workingSet.failedRefs,
  ]) {
    pinned.add(ref.refId);
  }

  for (const refId of [
    ...workingSet.actionSurface.clickableRefs,
    ...workingSet.actionSurface.typeableRefs,
    ...workingSet.actionSurface.selectableRefs,
    ...workingSet.actionSurface.readableRefs,
  ]) {
    pinned.add(refId);
  }

  return pinned;
}

function buildWorkingSet(workingSet: NonNullable<PlannerInput['workingSet']>): WorkingSetIR {
  const compact = (refs: NonNullable<PlannerInput['workingSet']>['primaryRefs']) =>
    refs.map(ref => ({ refId: ref.refId, reasons: ref.reasons }));

  return {
    mode: workingSet.mode,
    modeReason: workingSet.modeReason,
    primary: compact(workingSet.primaryRefs),
    secondary: compact(workingSet.secondaryRefs),
    navigation: compact(workingSet.navigationRefs),
    failed: compact(workingSet.failedRefs),
    readableEvidence: workingSet.readableEvidence,
    changedRefs: workingSet.changedRefs,
    quarantinedActions: workingSet.quarantinedActions,
    regionSummaries: workingSet.regionSummaries,
    actionSurface: workingSet.actionSurface,
    omitted: workingSet.omitted ? {
      observed: workingSet.omitted.observedRefCount,
      selected: workingSet.omitted.selectedRefCount,
      dropped: workingSet.omitted.droppedRefCount,
      byReason: workingSet.omitted.droppedByReason,
    } : undefined,
  };
}
