// P9: Page-init window guard
// P1 Fix: readiness-signal approach instead of fixed timer
// All mutations before page is settled are tagged page-init

import { CONFIDENCE_THRESHOLDS } from './types';

const MIN_INIT_MS = 1200;      // never declare ready before this
const MAX_INIT_MS = 5000;      // always declare ready by this
const QUIET_PERIOD_MS = 600;   // 600ms of no mutations = page settled

let _pageInitComplete = false;
let _domContentLoadedAt: number | null = null;
let _lastMutationTimestamp: number = Date.now();
let _readinessInterval: ReturnType<typeof setInterval> | null = null;

export function initPageInitGuard(): void {
  if (typeof document === 'undefined') return;

  _domContentLoadedAt = Date.now();
  _lastMutationTimestamp = Date.now();

  const startReadinessCheck = () => {
    _readinessInterval = setInterval(() => {
      const age = Date.now() - (_domContentLoadedAt ?? Date.now());
      const quietFor = Date.now() - _lastMutationTimestamp;

      if (age >= MAX_INIT_MS || (age >= MIN_INIT_MS && quietFor >= QUIET_PERIOD_MS)) {
        _pageInitComplete = true;
        if (_readinessInterval) {
          clearInterval(_readinessInterval);
          _readinessInterval = null;
        }
      }
    }, 200);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      _domContentLoadedAt = Date.now();
      startReadinessCheck();
    }, { once: true });
  } else {
    startReadinessCheck();
  }
}

// Called by observer on every mutation to track last activity
export function updateLastMutationTimestamp(): void {
  _lastMutationTimestamp = Date.now();
}

export function isPageInitComplete(): boolean {
  return _pageInitComplete;
}

export function getPageInitAge(): number {
  if (!_domContentLoadedAt) return 0;
  return Date.now() - _domContentLoadedAt;
}

// For testing — allow resetting state
export function _resetForTest(): void {
  _pageInitComplete = false;
  _domContentLoadedAt = null;
  _lastMutationTimestamp = Date.now();
  if (_readinessInterval) {
    clearInterval(_readinessInterval);
    _readinessInterval = null;
  }
}

export function _setPageInitComplete(val: boolean): void {
  _pageInitComplete = val;
}

