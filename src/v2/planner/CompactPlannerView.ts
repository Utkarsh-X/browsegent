import type {
  PlannerInput,
  PlannerOutput,
  PlannerLastResultSummary,
  PlannerUncertainty,
} from './types';
import type { PlannerRecoveryState } from '../runtime/RecoveryState';

export interface CompactPlannerView {
  version: 'compact_planner_view.v1';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  observationEpoch?: {
    observationId?: string;
    generationId?: number;
    snapshotId?: string;
  };
  lastResult?: PlannerLastResultSummary;
  recovery?: PlannerRecoveryState;
  uncertainty?: PlannerUncertainty;
  actions: CompactActionRef[];
  reads: CompactReadRef[];
  omitted: {
    originalCurrentRefs: number;
    originalPrimaryRefs: number;
    originalSecondaryRefs: number;
    originalReadableEvidence: number;
  };
}

export interface CompactActionRef {
  id: number;
  refId: string;
  kind?: string;
  role?: string;
  label: string;
  tools: string[];
}

export interface CompactReadRef {
  id: number;
  refId: string;
  text: string;
}

export interface PlainInteractiveSnapshotBaseline {
  version: 'plain_interactive_snapshot_baseline.v1';
  episodeId?: string;
  refs: Array<{
    id: number;
    refId: string;
    role?: string;
    name?: string;
    text?: string;
    tools: string[];
  }>;
}

export interface CompactPlannerViewStats {
  originalBytes: number;
  compactBytes: number;
  baselineBytes: number;
  reductionRatio: number;
  baselineRatio: number;
}

export interface CompactPlannerCoverage {
  plannedRefs: string[];
  plannedActionRefs: string[];
  plannedReadRefs: string[];
  missingPlannedActionRefs: string[];
  missingPlannedReadRefs: string[];
  actionRefCoverage: number;
  readRefCoverage: number;
}

export function buildCompactPlannerView(input: Partial<PlannerInput>, options: { maxActions?: number; maxReads?: number } = {}): CompactPlannerView {
  const maxActions = options.maxActions ?? 24;
  const maxReads = options.maxReads ?? 16;
  const workingSet = input.workingSet;
  const currentRefs = input.current?.refs ?? {};
  const actionSurface = workingSet?.actionSurface ?? {};
  const toolByRef = buildToolMap(actionSurface as unknown as Record<string, string[]>);
  const rankedRefs = [
    ...(workingSet?.primaryRefs ?? []),
    ...(workingSet?.secondaryRefs ?? []),
  ];

  const actions = rankedRefs
    .filter((ref: any) => toolByRef.has(ref.refId))
    .slice(0, maxActions)
    .map((ref: any, index: number) => toCompactAction(index + 1, ref, currentRefs[ref.refId], toolByRef.get(ref.refId) ?? []));

  const reads = (workingSet?.readableEvidence ?? [])
    .slice(0, maxReads)
    .map((ref: any, index: number) => ({
      id: index + 1,
      refId: ref.refId,
      text: compactText(ref.text ?? '', 220),
    }));

  return {
    version: 'compact_planner_view.v1',
    episodeId: input.episodeId,
    goal: input.goal ?? '',
    url: input.continuity?.url,
    mode: workingSet?.mode,
    observationEpoch: {
      observationId: input.continuity?.observationId,
      generationId: input.continuity?.generationId,
      snapshotId: input.continuity?.snapshotId,
    },
    lastResult: input.lastResult,
    recovery: input.recovery,
    uncertainty: input.uncertainty,
    actions,
    reads,
    omitted: {
      originalCurrentRefs: Object.keys(currentRefs).length,
      originalPrimaryRefs: (workingSet?.primaryRefs ?? []).length,
      originalSecondaryRefs: (workingSet?.secondaryRefs ?? []).length,
      originalReadableEvidence: (workingSet?.readableEvidence ?? []).length,
    },
  };
}

export function buildPlainInteractiveSnapshotBaseline(input: Partial<PlannerInput>, options: { maxRefs?: number } = {}): PlainInteractiveSnapshotBaseline {
  const maxRefs = options.maxRefs ?? 48;
  const workingSet = input.workingSet;
  const currentRefs = input.current?.refs ?? {};
  const actionSurface = workingSet?.actionSurface ?? {};
  const toolByRef = buildToolMap(actionSurface as unknown as Record<string, string[]>);
  const rankedRefs = [
    ...(workingSet?.primaryRefs ?? []),
    ...(workingSet?.secondaryRefs ?? []),
  ];

  const refs = rankedRefs
    .filter((ref: any) => toolByRef.has(ref.refId))
    .slice(0, maxRefs)
    .map((ref: any, index: number) => ({
      id: index + 1,
      refId: ref.refId,
      role: ref.role ?? currentRefs[ref.refId]?.role,
      name: ref.name ?? currentRefs[ref.refId]?.name,
      text: ref.text ?? currentRefs[ref.refId]?.text,
      tools: [...new Set(toolByRef.get(ref.refId) ?? [])].sort(),
    }));

  return {
    version: 'plain_interactive_snapshot_baseline.v1',
    episodeId: input.episodeId,
    refs,
  };
}

export function measureCompactPlannerView(
  input: Partial<PlannerInput>,
  view: CompactPlannerView,
  baseline = buildPlainInteractiveSnapshotBaseline(input),
): CompactPlannerViewStats {
  const originalBytes = byteLength(input);
  const compactBytes = byteLength(view);
  const baselineBytes = byteLength(baseline);
  return {
    originalBytes,
    compactBytes,
    baselineBytes,
    reductionRatio: originalBytes === 0 ? 0 : compactBytes / originalBytes,
    baselineRatio: originalBytes === 0 ? 0 : baselineBytes / originalBytes,
  };
}

export function evaluateCompactPlannerCoverage(
  view: CompactPlannerView,
  plannerOutput?: PlannerOutput,
): CompactPlannerCoverage {
  const plan = plannerOutput?.plan ?? [];
  const readTools = new Set(['get', 'inspect', 'read', 'extract', 'search']);

  const plannedActionRefs: string[] = [];
  const plannedReadRefs: string[] = [];

  for (const step of plan) {
    const ref = step.ref;
    if (!ref) continue;
    const toolLower = step.tool?.toLowerCase() ?? '';
    const isRead = step.tool && (
      readTools.has(toolLower) ||
      toolLower.startsWith('inspect') ||
      toolLower.startsWith('search')
    );
    if (isRead) {
      if (!plannedReadRefs.includes(ref)) {
        plannedReadRefs.push(ref);
      }
    } else {
      if (!plannedActionRefs.includes(ref)) {
        plannedActionRefs.push(ref);
      }
    }
  }

  const plannedRefs = [...new Set([...plannedActionRefs, ...plannedReadRefs])];

  const actionRefIds = new Set(view.actions.map(a => a.refId));
  const readRefIds = new Set(view.reads.map(r => r.refId));

  const missingPlannedActionRefs = plannedActionRefs.filter(ref => !actionRefIds.has(ref));
  const missingPlannedReadRefs = plannedReadRefs.filter(ref => !readRefIds.has(ref));

  return {
    plannedRefs,
    plannedActionRefs,
    plannedReadRefs,
    missingPlannedActionRefs,
    missingPlannedReadRefs,
    actionRefCoverage: plannedActionRefs.length === 0 ? 1 : (plannedActionRefs.length - missingPlannedActionRefs.length) / plannedActionRefs.length,
    readRefCoverage: plannedReadRefs.length === 0 ? 1 : (plannedReadRefs.length - missingPlannedReadRefs.length) / plannedReadRefs.length,
  };
}

function buildToolMap(actionSurface: Record<string, string[]>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [tool, refs] of Object.entries(actionSurface)) {
    if (!Array.isArray(refs)) continue;
    for (const refId of refs) {
      const tools = map.get(refId) ?? [];
      tools.push(tool.replace(/Refs$/, ''));
      map.set(refId, tools);
    }
  }
  return map;
}

function toCompactAction(id: number, ref: any, currentRef: any, tools: string[]): CompactActionRef {
  const parts = [ref.name, ref.text, currentRef?.name, currentRef?.text]
    .filter(Boolean)
    .map(part => String(part).trim());
  const uniqueParts = parts.filter((part, index, self) => self.indexOf(part) === index);
  return {
    id,
    refId: ref.refId,
    kind: ref.kind ?? currentRef?.kind,
    role: ref.role ?? currentRef?.role,
    label: compactText(uniqueParts.join(' '), 180),
    tools: [...new Set(tools)].sort(),
  };
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function byteLength(value: unknown): number {
  if (value === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
