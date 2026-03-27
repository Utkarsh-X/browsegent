// Brain 2 — Type Definitions
// The complete type system for mutation watching + cause attribution

// P10: The complete causal chain — initiator → transport → mutation
export interface CausalChain {
  initiator: 'click' | 'scroll' | 'timer' | 'keyboard' | 'page-init' | 'unknown';
  initiatorDetail: string;      // selector (click), 'scroll', interval ms (timer), ''
  transport: 'fetch' | 'xhr' | 'direct' | null;
  transportDetail: string;      // URL for fetch/xhr, '' for direct/null
  confidence: 'high' | 'medium' | 'low';
  windowMs: number;             // actual ms between initiator and mutation (diagnostic)
  unknownReason?: 'no_pending_causes' | 'window_exceeded' | 'all_noise' | 'service_worker' | 'timing_gap';
}

// A pending cause waiting to be matched to a mutation
export interface PendingCause {
  type: 'fetch' | 'xhr' | 'click' | 'scroll' | 'timer';
  detail: string;               // URL, selector, interval
  timestamp: number;
  chainSoFar: Partial<CausalChain>;  // click may precede fetch — chain builds up
}

// A single mutation event, fully attributed
export interface MutationDelta {
  timestamp: number;
  nodeSelector: string;         // selector from Brain 1 FilteredNode, or best-effort
  nodeTag: string;
  oldValue: string;             // trimmed, max 200 chars
  newValue: string;             // trimmed, max 200 chars
  mutationType: 'added' | 'removed' | 'textChanged' | 'attributeChanged';
  chain: CausalChain;
  isNoise: boolean;             // true if page-init, nav-click, or style-only
}

// Confidence thresholds — define here, not inline in correlator
export const CONFIDENCE_THRESHOLDS = {
  HIGH_WINDOW_MS: 300,     // mutation within 300ms of cause = high confidence
  MEDIUM_WINDOW_MS: 800,   // 300–800ms = medium
  MAX_WINDOW_MS: 1200,     // beyond 1200ms = no attribution (unknown)
  PAGE_INIT_MS: 2500,      // page-init window after DOMContentLoaded
} as const;

// URLs/patterns that indicate noise fetches (nav, analytics, ads)
export const NOISE_FETCH_PATTERNS = /analytics|tracking|gtm|facebook|doubleclick|adservice|beacon|telemetry|hotjar|clarity|\/menu|\/nav|\/header|\/footer/i;

// Click targets that indicate navigation (not task-relevant actions)
export const NOISE_CLICK_PATTERNS = /nav|menu|header|footer|breadcrumb|sidebar/i;
