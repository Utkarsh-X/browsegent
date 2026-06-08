export interface CompactPlannerView {
  version: 'compact_planner_view.v0';
  episodeId?: string;
  goal: string;
  url?: string;
  mode?: string;
  lastResult?: unknown;
  recovery?: unknown;
  uncertainty?: unknown;
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

export interface CompactPlannerViewStats {
  originalBytes: number;
  compactBytes: number;
  reductionRatio: number;
}

export function buildCompactPlannerView(input: Record<string, any>, options: { maxActions?: number; maxReads?: number } = {}): CompactPlannerView {
  const maxActions = options.maxActions ?? 24;
  const maxReads = options.maxReads ?? 16;
  const workingSet = input.workingSet ?? {};
  const currentRefs = input.current?.refs ?? {};
  const actionSurface = workingSet.actionSurface ?? {};
  const toolByRef = buildToolMap(actionSurface);
  const rankedRefs = [
    ...(workingSet.primaryRefs ?? []),
    ...(workingSet.secondaryRefs ?? []),
  ];

  const actions = rankedRefs
    .filter((ref: any) => toolByRef.has(ref.refId))
    .slice(0, maxActions)
    .map((ref: any, index: number) => toCompactAction(index + 1, ref, currentRefs[ref.refId], toolByRef.get(ref.refId) ?? []));

  const reads = (workingSet.readableEvidence ?? [])
    .slice(0, maxReads)
    .map((ref: any, index: number) => ({
      id: index + 1,
      refId: ref.refId,
      text: compactText(ref.text ?? '', 220),
    }));

  return {
    version: 'compact_planner_view.v0',
    episodeId: input.episodeId,
    goal: input.goal ?? '',
    url: input.continuity?.url,
    mode: workingSet.mode,
    lastResult: input.lastResult,
    recovery: input.recovery,
    uncertainty: input.uncertainty,
    actions,
    reads,
    omitted: {
      originalCurrentRefs: Object.keys(currentRefs).length,
      originalPrimaryRefs: (workingSet.primaryRefs ?? []).length,
      originalSecondaryRefs: (workingSet.secondaryRefs ?? []).length,
      originalReadableEvidence: (workingSet.readableEvidence ?? []).length,
    },
  };
}

export function measureCompactPlannerView(input: Record<string, any>, view: CompactPlannerView): CompactPlannerViewStats {
  const originalBytes = byteLength(input);
  const compactBytes = byteLength(view);
  return {
    originalBytes,
    compactBytes,
    reductionRatio: originalBytes === 0 ? 0 : compactBytes / originalBytes,
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
    .map(part => part.trim());
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
