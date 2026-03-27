// Brain 2 — Graph Updater
// Bridges Brain 2's delta stream and the SemanticGraph structure

import { logger } from '../logger';
import type { SemanticGraph } from '../graph/types';
import type { MutationDelta } from './types';
import type { FilteredNode } from '../brain1/types';

const MAX_DELTAS = 50; // hard cap — agent doesn't need full history

export function applyDelta(graph: SemanticGraph, delta: MutationDelta): void {
  try {
    // Always append to deltas (including noise — marked with isNoise flag)
    graph.deltas.push(delta);

    // Enforce cap — drop oldest
    if (graph.deltas.length > MAX_DELTAS) {
      graph.deltas.shift();
    }

    // Update last non-noise cause for agent quick-read
    if (!delta.isNoise) {
      graph.lastCause = delta.chain;
    }

    // Update page status based on chain
    if (delta.chain.initiator === 'page-init') {
      graph.status = 'loading';
    } else if (delta.chain.transport === 'fetch' || delta.chain.transport === 'xhr') {
      graph.status = 'live';
    } else if (delta.chain.initiator === 'unknown' && delta.chain.confidence === 'low') {
      // Don't downgrade status on unknown low-confidence deltas
    } else {
      graph.status = 'live';
    }

    graph.lastUpdateTimestamp = delta.timestamp;

  } catch (err) {
    logger.error('brain2:graphUpdater', 'applyDelta failed', err);
    graph.errors.push(`applyDelta: ${String(err)}`);
  }
}

export function createGraph(snapshot: FilteredNode[], pageUrl: string): SemanticGraph {
  return {
    snapshot,
    deltas: [],
    status: 'loading',
    lastCause: null,
    errors: [],
    pageUrl,
    snapshotTimestamp: Date.now(),
    lastUpdateTimestamp: Date.now(),
  };
}
