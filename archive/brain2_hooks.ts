// Brain 2 — Pre-Mutation Intent Hooks (P8, P11)
// Fires BEFORE DOM changes, recording what triggered the change.

import { logger } from '../logger';
import { isPageInitComplete } from './pageInit';
import { NOISE_FETCH_PATTERNS, NOISE_CLICK_PATTERNS } from './types';
import type { PendingCause } from './types';

// Shared pending causes queue — read by correlator
export const pendingCauses: PendingCause[] = [];

const MAX_PENDING = 20; // prevent memory leak on fast-firing pages

function addPending(cause: PendingCause): void {
  pendingCauses.push(cause);
  if (pendingCauses.length > MAX_PENDING) {
    pendingCauses.shift();
  }
}

// P0 Fix: executor-driven click recording — bypasses CDP event propagation
export function recordClickDirectly(selector: string): void {
  addPending({
    type: 'click',
    detail: selector,
    timestamp: Date.now(),
    chainSoFar: { initiator: 'click', initiatorDetail: selector },
  });
}

// ─── HOOK 1: fetch() ─────────────────────────────────────────────────────────
export function hookFetch(): boolean {
  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0]
                : args[0] instanceof URL ? args[0].toString()
                : args[0] instanceof Request ? args[0].url
                : 'unknown';

      addPending({
        type: 'fetch',
        detail: url,
        timestamp: Date.now(),
        chainSoFar: {
          transport: 'fetch',
          transportDetail: url,
        }
      });

      return originalFetch(...args);
    };
    logger.info('brain2:hooks', 'fetch() hook installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook fetch()', err);
    return false;
  }
}

// ─── HOOK 2: XMLHttpRequest (P11 — equal citizen) ─────────────────────────────
export function hookXHR(): boolean {
  try {
    const OrigXHR = window.XMLHttpRequest;
    const xhrOpenOriginal = OrigXHR.prototype.open;
    const xhrSendOriginal = OrigXHR.prototype.send;

    // Capture URL on open()
    OrigXHR.prototype.open = function(this: XMLHttpRequest, method: string, url: string | URL) {
      (this as any)._bgUrl = typeof url === 'string' ? url : url.toString();
      return xhrOpenOriginal.apply(this, arguments as any);
    };

    // Record pending cause on send()
    OrigXHR.prototype.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const url = (this as any)._bgUrl || 'unknown';
      addPending({
        type: 'xhr',
        detail: url,
        timestamp: Date.now(),
        chainSoFar: {
          transport: 'xhr',
          transportDetail: url,
        }
      });
      return xhrSendOriginal.call(this, body);
    };

    logger.info('brain2:hooks', 'XHR hook installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook XHR', err);
    return false;
  }
}

// ─── HOOK 3: Click events ─────────────────────────────────────────────────────
export function hookClicks(): boolean {
  try {
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      const selector = target.id ? `#${target.id}`
                     : target.getAttribute('aria-label') ? `[aria-label="${target.getAttribute('aria-label')}"]`
                     : target.tagName.toLowerCase();

      const isNoise = NOISE_CLICK_PATTERNS.test(
        (typeof target.className === 'string' ? target.className : '') || ''
      ) || NOISE_CLICK_PATTERNS.test(
        (typeof target.closest?.('[class]')?.className === 'string'
          ? target.closest('[class]')!.className as string
          : '') || ''
      );

      addPending({
        type: 'click',
        detail: selector,
        timestamp: Date.now(),
        chainSoFar: {
          initiator: 'click',
          initiatorDetail: selector,
        }
      });

      if (isNoise) {
        logger.info('brain2:hooks', 'Click on noise target — will tag as noise', { selector });
      }
    }, true); // capture phase — fires before element handlers

    logger.info('brain2:hooks', 'Click hook installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook clicks', err);
    return false;
  }
}

// ─── HOOK 4: Scroll ───────────────────────────────────────────────────────────
export function hookScroll(): boolean {
  try {
    let scrollDebounce: ReturnType<typeof setTimeout> | null = null;

    window.addEventListener('scroll', () => {
      if (scrollDebounce) clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => {
        addPending({
          type: 'scroll',
          detail: `scrollY:${Math.round(window.scrollY)}`,
          timestamp: Date.now(),
          chainSoFar: {
            initiator: 'scroll',
            initiatorDetail: `scrollY:${Math.round(window.scrollY)}`,
          }
        });
      }, 100);
    }, { passive: true });

    logger.info('brain2:hooks', 'Scroll hook installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook scroll', err);
    return false;
  }
}

// ─── HOOK 5: setTimeout / setInterval (timer-driven mutations) ────────────────
export function hookTimers(): boolean {
  try {
    const origSetTimeout = window.setTimeout.bind(window);
    const origSetInterval = window.setInterval.bind(window);

    (window as any).setTimeout = function(handler: TimerHandler, delay?: number, ...args: unknown[]) {
      const wrappedHandler = typeof handler === 'function'
        ? function(this: unknown) {
            addPending({
              type: 'timer',
              detail: `setTimeout:${delay ?? 0}ms`,
              timestamp: Date.now(),
              chainSoFar: {
                initiator: 'timer',
                initiatorDetail: `timeout:${delay ?? 0}ms`,
              }
            });
            return (handler as Function).apply(this, args);
          }
        : handler;
      return origSetTimeout(wrappedHandler, delay, ...args);
    } as typeof setTimeout;

    // setInterval wrapping — only first 5 firings to avoid queue saturation
    let intervalFireCount = 0;
    (window as any).setInterval = function(handler: TimerHandler, delay?: number, ...args: unknown[]) {
      const wrappedHandler = typeof handler === 'function'
        ? function(this: unknown) {
            if (intervalFireCount < 5) {
              intervalFireCount++;
              addPending({
                type: 'timer',
                detail: `setInterval:${delay ?? 0}ms`,
                timestamp: Date.now(),
                chainSoFar: {
                  initiator: 'timer',
                  initiatorDetail: `interval:${delay ?? 0}ms`,
                }
              });
            }
            return (handler as Function).apply(this, args);
          }
        : handler;
      return origSetInterval(wrappedHandler, delay, ...args);
    } as typeof setInterval;

    logger.info('brain2:hooks', 'Timer hooks installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook timers', err);
    return false;
  }
}

// ─── HOOK 6: SPA navigation (history.pushState / replaceState) — P19 ─────────
export function hookSPANavigation(onNavigate: (url: string) => void): boolean {
  try {
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    history.pushState = function(...args: Parameters<typeof history.pushState>) {
      origPushState(...args);
      const url = typeof args[2] === 'string' ? args[2] : location.href;
      logger.info('brain2:hooks', 'SPA pushState detected', { url });
      onNavigate(url);
    };

    history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
      origReplaceState(...args);
      const url = typeof args[2] === 'string' ? args[2] : location.href;
      logger.info('brain2:hooks', 'SPA replaceState detected', { url });
      onNavigate(url);
    };

    window.addEventListener('popstate', () => {
      logger.info('brain2:hooks', 'SPA popstate detected', { url: location.href });
      onNavigate(location.href);
    });

    logger.info('brain2:hooks', 'SPA navigation hook installed');
    return true;
  } catch (err) {
    logger.error('brain2:hooks', 'Failed to hook SPA navigation', err);
    return false;
  }
}

// ─── Install all hooks ────────────────────────────────────────────────────────
export interface HookInstallResult {
  fetch: boolean;
  xhr: boolean;
  clicks: boolean;
  scroll: boolean;
  timers: boolean;
  spa: boolean;
}

export function installAllHooks(onNavigate?: (url: string) => void): HookInstallResult {
  return {
    fetch: hookFetch(),
    xhr: hookXHR(),
    clicks: hookClicks(),
    scroll: hookScroll(),
    timers: hookTimers(),
    spa: onNavigate ? hookSPANavigation(onNavigate) : false,
  };
}
