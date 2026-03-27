import type { MutationDelta } from '../brain2/types';
import type { FilteredNode } from '../brain1/types';
import type { CausalChain } from '../brain2/types';

export interface SemanticGraph {
  // Brain 1 snapshot — set once on page load, never mutated by Brain 2
  snapshot: FilteredNode[];

  // Brain 2 deltas — appended as mutations arrive
  deltas: MutationDelta[];

  // Page state
  status: 'loading' | 'live' | 'stable' | 'blocked' | 'dead';

  // Most recent non-noise causal chain (for agent quick-read)
  lastCause: CausalChain | null;

  // Errors from either brain
  errors: string[];

  // Metadata
  pageUrl: string;
  snapshotTimestamp: number;
  lastUpdateTimestamp: number;
}
