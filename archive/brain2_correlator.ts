// Brain 2 — Cause Correlator
// Takes a mutation event + pending causes queue, builds a CausalChain (P10)

import { logger } from '../logger';
import { pendingCauses } from './hooks';
import { isPageInitComplete } from './pageInit';
import {
  CONFIDENCE_THRESHOLDS,
  NOISE_FETCH_PATTERNS,
  NOISE_CLICK_PATTERNS,
} from './types';
import type { CausalChain, PendingCause } from './types';

// P1 Fix: dynamic correlation window — updated by RTT sampling
let calibratedWindowMs: number = CONFIDENCE_THRESHOLDS.MAX_WINDOW_MS;

export function setCalibratedWindow(ms: number): void {
  calibratedWindowMs = Math.max(800, Math.min(4000, ms));
}

export function getCalibratedWindow(): number {
  return calibratedWindowMs;
}

export function buildCausalChain(mutationTimestamp: number): CausalChain {
  // P9: page-init guard — all mutations during init are tagged as such
  if (!isPageInitComplete()) {
    return {
      initiator: 'page-init',
      initiatorDetail: '',
      transport: null,
      transportDetail: '',
      confidence: 'high', // high confidence it IS page-init
      windowMs: 0,
    };
  }

  try {
    // Find all pending causes within the max attribution window
    const candidates = pendingCauses.filter(c =>
      mutationTimestamp - c.timestamp >= 0 &&
      mutationTimestamp - c.timestamp <= calibratedWindowMs
    );

    if (candidates.length === 0) {
      // P0 Fix: detect service worker as specific reason
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        return unknownChain(0, 'service_worker');
      }
      return unknownChain(0, 'no_pending_causes');
    }

    // Try to build the fullest chain: click → fetch → mutation
    const clickCause = candidates.find(c => c.type === 'click');
    const fetchCause = candidates.find(c => c.type === 'fetch' || c.type === 'xhr');
    const timerCause = candidates.find(c => c.type === 'timer');
    const scrollCause = candidates.find(c => c.type === 'scroll');

    // Best case: click initiated a fetch which caused the mutation
    if (clickCause && fetchCause) {
      const windowMs = mutationTimestamp - fetchCause.timestamp;
      const isNoiseClick = NOISE_CLICK_PATTERNS.test(clickCause.detail);
      const isNoiseFetch = NOISE_FETCH_PATTERNS.test(fetchCause.detail);

      return {
        initiator: 'click',
        initiatorDetail: clickCause.detail,
        transport: fetchCause.type === 'xhr' ? 'xhr' : 'fetch',
        transportDetail: fetchCause.detail,
        confidence: (isNoiseClick || isNoiseFetch) ? 'low'
                  : windowMs <= CONFIDENCE_THRESHOLDS.HIGH_WINDOW_MS ? 'high'
                  : 'medium',
        windowMs,
      };
    }

    // Fetch alone (no preceding click within window)
    if (fetchCause) {
      const windowMs = mutationTimestamp - fetchCause.timestamp;
      return {
        initiator: 'unknown',
        initiatorDetail: '',
        transport: fetchCause.type === 'xhr' ? 'xhr' : 'fetch',
        transportDetail: fetchCause.detail,
        confidence: NOISE_FETCH_PATTERNS.test(fetchCause.detail) ? 'low'
                  : windowMs <= CONFIDENCE_THRESHOLDS.HIGH_WINDOW_MS ? 'high'
                  : 'medium',
        windowMs,
      };
    }

    // Scroll
    if (scrollCause) {
      const windowMs = mutationTimestamp - scrollCause.timestamp;
      return {
        initiator: 'scroll',
        initiatorDetail: scrollCause.detail,
        transport: null,
        transportDetail: '',
        confidence: windowMs <= CONFIDENCE_THRESHOLDS.HIGH_WINDOW_MS ? 'high' : 'medium',
        windowMs,
      };
    }

    // Timer
    if (timerCause) {
      const windowMs = mutationTimestamp - timerCause.timestamp;
      return {
        initiator: 'timer',
        initiatorDetail: timerCause.detail,
        transport: null,
        transportDetail: '',
        confidence: 'medium',
        windowMs,
      };
    }

    // Click alone (direct DOM manipulation, no network)
    if (clickCause) {
      const windowMs = mutationTimestamp - clickCause.timestamp;
      return {
        initiator: 'click',
        initiatorDetail: clickCause.detail,
        transport: 'direct',
        transportDetail: '',
        confidence: windowMs <= CONFIDENCE_THRESHOLDS.HIGH_WINDOW_MS ? 'high' : 'medium',
        windowMs,
      };
    }

    return unknownChain(0, 'timing_gap');

  } catch (err) {
    logger.error('brain2:correlator', 'buildCausalChain failed', err);
    return unknownChain(0, 'timing_gap');
  }
}

function unknownChain(windowMs: number, reason?: CausalChain['unknownReason']): CausalChain {
  return {
    initiator: 'unknown',
    initiatorDetail: '',
    transport: null,
    transportDetail: '',
    confidence: 'low',
    windowMs,
    unknownReason: reason,
  };
}

// Determine if a chain represents noise (should be hidden from agent)
export function isNoiseChain(chain: CausalChain): boolean {
  if (chain.initiator === 'page-init') return true;
  if (chain.confidence === 'low' && NOISE_FETCH_PATTERNS.test(chain.transportDetail)) return true;
  if (chain.initiator === 'click' && NOISE_CLICK_PATTERNS.test(chain.initiatorDetail)) return true;
  return false;
}

// Evict old pending causes to prevent memory leak
export function evictStaleCauses(): void {
  const cutoff = Date.now() - calibratedWindowMs;
  let i = 0;
  while (i < pendingCauses.length && pendingCauses[i]!.timestamp < cutoff) i++;
  if (i > 0) pendingCauses.splice(0, i);
}
