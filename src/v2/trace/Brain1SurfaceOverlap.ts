import type { FilteredNode } from '../../brain1/types';
import type { V2Ref } from '../runtime/types';

export interface SurfaceOverlapReport {
  brain1NodeCount: number;
  v2RefCount: number;
  matchedCount: number;
  brain1OnlyCount: number;
  v2OnlyCount: number;
  brain1Only: Array<{ sel: string; value: string; rule: string }>;
  v2Only: Array<{ refId: string; role?: string; name?: string }>;
  brain1ScanDurationMs?: number;
  v2ObservationDurationMs?: number;
}

/**
 * Map Brain1 FilteredNodes to V2 Refs by selector string overlap.
 * A Brain1 node "matches" a V2 ref if the node's `sel` appears in the ref's `selectorCandidates`.
 * Conservative: selectors must be identical strings.
 *
 * Reports surface overlap, not target coverage — no fixture declares intended targets.
 */
export function mapBrain1NodesToV2Refs(
  brain1Nodes: Array<Pick<FilteredNode, 'sel' | 'value' | 'tag' | 'rule' | 'selType'>>,
  v2Refs: Array<Pick<V2Ref, 'refId' | 'selectorCandidates' | 'role' | 'name'>>,
): SurfaceOverlapReport {
  const v2SelectorIndex = new Map<string, string>();
  for (const ref of v2Refs) {
    for (const sel of ref.selectorCandidates) {
      v2SelectorIndex.set(sel, ref.refId);
    }
  }

  const matchedV2RefIds = new Set<string>();
  const brain1Only: SurfaceOverlapReport['brain1Only'] = [];

  for (const node of brain1Nodes) {
    const matchedRefId = v2SelectorIndex.get(node.sel);
    if (matchedRefId) {
      matchedV2RefIds.add(matchedRefId);
    } else {
      brain1Only.push({ sel: node.sel, value: node.value, rule: node.rule });
    }
  }

  const v2Only = v2Refs
    .filter(ref => !matchedV2RefIds.has(ref.refId))
    .map(ref => ({ refId: ref.refId, role: ref.role, name: ref.name }));

  return {
    brain1NodeCount: brain1Nodes.length,
    v2RefCount: v2Refs.length,
    matchedCount: matchedV2RefIds.size,
    brain1OnlyCount: brain1Only.length,
    v2OnlyCount: v2Only.length,
    brain1Only,
    v2Only,
  };
}

/**
 * Run a non-acting surface overlap comparison on a live Playwright page.
 *
 * PREREQUISITE: The page must have the Brain1 scanner bootstrapped via
 * `page.addScriptTag({ path: 'extension/content.js' })` before calling this.
 * V2 harness pages do NOT install the extension automatically.
 *
 * This is a fixture-level diagnostic — not a production runtime component.
 */
export async function runFixtureSurfaceOverlap(
  page: import('playwright').Page,
  goal: string,
  brain1Scan: (goal: string) => Promise<{ nodes: Array<Pick<FilteredNode, 'sel' | 'value' | 'tag' | 'rule' | 'selType'>> }>,
  v2Capture: () => Promise<{ refs: Array<Pick<V2Ref, 'refId' | 'selectorCandidates' | 'role' | 'name'>>; stats: { durationMs: number } }>,
): Promise<SurfaceOverlapReport> {
  const brain1Start = Date.now();
  const brain1Result = await brain1Scan(goal);
  const brain1DurationMs = Date.now() - brain1Start;

  const v2Start = Date.now();
  const observation = await v2Capture();
  const v2DurationMs = Date.now() - v2Start;

  const report = mapBrain1NodesToV2Refs(brain1Result.nodes, observation.refs);
  report.brain1ScanDurationMs = brain1DurationMs;
  report.v2ObservationDurationMs = v2DurationMs;
  return report;
}
