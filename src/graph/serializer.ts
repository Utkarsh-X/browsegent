// Graph Serializer — compact LLM-first schema
import { logger } from '../logger';
import { countTokens } from '../brain1/serializer';
import type { SemanticGraph } from './types';
import type { CausalChain } from '../brain2/types';

export interface ActionHistoryEntry {
  action: string;
  selector?: string;
  result: 'ok' | 'timeout' | 'error' | 'goal_met' | 'plan_stale';
  timestamp: number;
}

export interface SerializedGraph {
  g: string;
  s: string;
  lc: string;
  d: Array<[string, string, string, string]>;
  tr: Array<[string, string, string | null]>;
  del: Array<[string, string, string]>;
  h: Array<[string, string, string]>;
  err: string[];
}

export function serializeGraph(
  graph: SemanticGraph,
  goal: string,
  actionHistory: ActionHistoryEntry[] = []
): { serialized: SerializedGraph; tokenCount: number } {
  try {
    const dataNodes = graph.snapshot
      .filter(n => n.type === 'data' || n.type === 'input')
      .slice(0, 30)
      .map(n => [
        n.type[0]!,
        n.value.slice(0, 200),
        n.sel,
        '',
      ] as [string, string, string, string]);

    // Enrich with cause from deltas
    for (const delta of graph.deltas) {
      const existing = dataNodes.find(d => d[2] === delta.nodeSelector);
      if (existing) {
        existing[3] = buildCauseSummary(delta.chain);
      }
    }

    const triggers = graph.snapshot
      .filter(n => n.type === 'trigger')
      .slice(0, 10)
      .map(n => [
        n.value.slice(0, 40),
        n.sel,
        null,
      ] as [string, string, string | null]);

    const recentDeltas = graph.deltas
      .filter(d => !d.isNoise)
      .slice(-3)
      .map(d => [
        d.oldValue.slice(0, 60),
        d.newValue.slice(0, 60),
        buildCauseSummary(d.chain),
      ] as [string, string, string]);

    const history = actionHistory
      .slice(-5)
      .map(h => [h.action, h.selector ?? '', h.result] as [string, string, string]);

    const serialized: SerializedGraph = {
      g: goal,
      s: graph.status,
      lc: graph.lastCause ? buildCauseSummary(graph.lastCause) : 'none',
      d: dataNodes,
      tr: triggers,
      del: recentDeltas,
      h: history,
      err: graph.errors.slice(-3),
    };

    const json = JSON.stringify(serialized);
    const tokenCount = countTokens(json);

    logger.info('graph:serializer', 'Graph serialized', {
      dataNodes: dataNodes.length,
      triggers: triggers.length,
      deltas: recentDeltas.length,
      tokens: tokenCount,
    });

    return { serialized, tokenCount };

  } catch (err) {
    logger.error('graph:serializer', 'serializeGraph failed', err);
    return {
      serialized: { g: goal, s: 'error', lc: 'none', d: [], tr: [], del: [], h: [], err: [String(err)] },
      tokenCount: 0,
    };
  }
}

function buildCauseSummary(chain: CausalChain): string {
  if (chain.initiator === 'page-init') return 'init';
  if (chain.initiator === 'unknown') {
    if (chain.transport) {
      const detail = chain.transportDetail?.slice(0, 60) ?? '';
      return `${chain.transport}:${detail}`;
    }
    return 'unknown';
  }
  // Rich format: "click→fetch:/api/products (high)"
  let summary = chain.initiator as string;
  if (chain.initiatorDetail) summary += `:${chain.initiatorDetail.slice(0, 20)}`;
  if (chain.transport) {
    const detail = chain.transportDetail?.slice(0, 60) ?? '';
    summary += `→${chain.transport}:${detail}`;
  }
  if (chain.confidence) summary += ` (${chain.confidence})`;
  return summary;
}
