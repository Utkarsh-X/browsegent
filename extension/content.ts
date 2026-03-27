// extension/content.ts
// Runs in MAIN world — no chrome.* APIs available here
// Brain 1 + Brain 2 unified content script

(function() {
  'use strict';

  // ── Read goal set by test runner ──────────────────────────────────────────
  const goal: string = (window as any).__browsegent_goal ?? '';

  // ── Brain 2 constants (mirrored from src/brain2/types.ts) ────────────────
  const HIGH_WINDOW = 300;
  const MEDIUM_WINDOW = 800;
  const PAGE_INIT_MIN = 1200;
  const PAGE_INIT_MAX = 5000;
  const QUIET_PERIOD = 600;
  const MAX_PENDING = 20;
  const MAX_DELTAS = 50;

  const NOISE_FETCH = /analytics|tracking|gtm|facebook|doubleclick|adservice|beacon|telemetry|hotjar|clarity|\/menu|\/nav|\/header|\/footer/i;
  const NOISE_CLICK = /nav|menu|header|footer|breadcrumb|sidebar/i;
  const SKIP_TAGS = new Set(['script','style','noscript','svg','iframe','canvas','video','audio','head','meta','link','br','hr','img']);

  // ── Brain 2 state ─────────────────────────────────────────────────────────
  const pending: Array<{type:string; detail:string; timestamp:number}> = [];
  const deltas: any[] = [];
  let pageInitComplete = false;
  let lastMutationTs = Date.now();
  let domContentLoadedAt = Date.now();
  let rttSamples: number[] = [];
  let calibratedMax = 1200;
  let injectionTime = Date.now();

  // ── Page-init readiness signal ────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      domContentLoadedAt = Date.now();
    }, { once: true });
  } else {
    domContentLoadedAt = Date.now();
  }

  const readinessCheck = setInterval(() => {
    const age = Date.now() - domContentLoadedAt;
    const quietFor = Date.now() - lastMutationTs;
    if (age >= PAGE_INIT_MAX || (age >= PAGE_INIT_MIN && quietFor >= QUIET_PERIOD)) {
      pageInitComplete = true;
      clearInterval(readinessCheck);
    }
  }, 200);

  // ── Pending cause helpers ─────────────────────────────────────────────────
  function addPending(cause: {type:string; detail:string; timestamp:number}): void {
    pending.push(cause);
    if (pending.length > MAX_PENDING) pending.shift();
  }

  function evictStale(): void {
    const cutoff = Date.now() - calibratedMax * 1.5;
    let i = 0;
    while (i < pending.length && pending[i]!.timestamp < cutoff) i++;
    if (i > 0) pending.splice(0, i);
  }

  setInterval(evictStale, 300);

  // ── RTT sampling ──────────────────────────────────────────────────────────
  function sampleRTT(url: string, startTs: number): void {
    const rtt = Date.now() - startTs;
    const withinWindow = Date.now() - injectionTime < 10000;
    if (withinWindow && rttSamples.length < 3 && !NOISE_FETCH.test(url)) {
      rttSamples.push(rtt);
      if (rttSamples.length >= 2) {
        const avg = rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length;
        calibratedMax = Math.max(800, Math.min(4000, avg * 2.5));
        console.log('[browsegent] RTT calibrated:', { samples: rttSamples, calibratedMax });
      }
    }
  }

  // ── Hooks (each wrapped in try-catch to prevent silent crashes on system Chrome) ──

  // fetch hook
  try {
    const origFetch = window.fetch.bind(window);
    (window as any).fetch = async function(...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0]
                 : (args[0] as Request)?.url ?? 'unknown';
      const startTs = Date.now();
      addPending({ type: 'fetch', detail: url, timestamp: startTs });
      const result = origFetch(...args);
      result.then(() => sampleRTT(url, startTs), () => sampleRTT(url, startTs));
      return result;
    };
  } catch (e) { console.warn('[browsegent] fetch hook failed:', e); }

  // XHR hook
  try {
    const OrigXHR = (window as any).XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function(method: string, url: string, ...rest: any[]) {
      (this as any)._bgUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    OrigXHR.prototype.send = function(...args: any[]) {
      const url = (this as any)._bgUrl ?? 'unknown';
      addPending({ type: 'xhr', detail: url, timestamp: Date.now() });
      return origSend.apply(this, args);
    };
  } catch (e) { console.warn('[browsegent] XHR hook failed:', e); }

  // Click hook
  try {
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const sel = target.id ? `#${CSS.escape(target.id)}`
                 : target.getAttribute('aria-label') ? `[aria-label="${target.getAttribute('aria-label')}"]`
                 : target.tagName.toLowerCase();
      addPending({ type: 'click', detail: sel, timestamp: Date.now() });
    }, true);
  } catch (e) { console.warn('[browsegent] click hook failed:', e); }

  // Scroll hook
  try {
    let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('scroll', () => {
      if (scrollDebounce) clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => {
        addPending({ type: 'scroll', detail: `scrollY:${Math.round(window.scrollY)}`, timestamp: Date.now() });
      }, 50);
    }, { passive: true });
  } catch (e) { console.warn('[browsegent] scroll hook failed:', e); }

  // SPA navigation
  try {
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function(...args: Parameters<typeof history.pushState>) {
      origPush(...args);
      window.dispatchEvent(new CustomEvent('browsegent:navigate', { detail: { url: location.href } }));
    };
    history.replaceState = function(...args: Parameters<typeof history.replaceState>) {
      origReplace(...args);
      window.dispatchEvent(new CustomEvent('browsegent:navigate', { detail: { url: location.href } }));
    };
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new CustomEvent('browsegent:navigate', { detail: { url: location.href } }));
    });
  } catch (e) { console.warn('[browsegent] SPA nav hook failed:', e); }

  // ── Causal chain builder ──────────────────────────────────────────────────
  function buildChain(ts: number): any {
    if (!pageInitComplete) {
      return { initiator: 'page-init', transport: null, confidence: 'high', windowMs: 0, unknownReason: undefined };
    }

    const candidates = pending.filter(c => ts - c.timestamp >= 0 && ts - c.timestamp <= calibratedMax);
    if (!candidates.length) {
      // No pending causes — check if service worker might be intercepting
      const swActive = !!navigator.serviceWorker?.controller;
      return { initiator: 'unknown', transport: null, confidence: 'low', windowMs: 0, unknownReason: swActive ? 'service_worker' : 'no_pending_causes' };
    }

    const click = candidates.find(c => c.type === 'click');
    const net = candidates.find(c => c.type === 'fetch' || c.type === 'xhr');
    const timer = candidates.find(c => c.type === 'timer');
    const scroll = candidates.find(c => c.type === 'scroll');

    if (click && net) {
      const w = ts - net.timestamp;
      return { initiator: 'click', initiatorDetail: click.detail, transport: net.type, transportDetail: net.detail, confidence: NOISE_FETCH.test(net.detail) ? 'low' : w <= HIGH_WINDOW ? 'high' : 'medium', windowMs: w };
    }
    if (net) {
      const w = ts - net.timestamp;
      return { initiator: 'unknown', transport: net.type, transportDetail: net.detail, confidence: NOISE_FETCH.test(net.detail) ? 'low' : w <= HIGH_WINDOW ? 'high' : 'medium', windowMs: w };
    }
    if (scroll) return { initiator: 'scroll', initiatorDetail: scroll.detail, transport: null, confidence: 'medium', windowMs: ts - scroll.timestamp };
    if (timer) return { initiator: 'timer', initiatorDetail: timer.detail, transport: null, confidence: 'medium', windowMs: ts - timer.timestamp };
    if (click) {
      const w = ts - click.timestamp;
      return { initiator: 'click', initiatorDetail: click.detail, transport: 'direct', confidence: w <= HIGH_WINDOW ? 'high' : 'medium', windowMs: w };
    }
    return { initiator: 'unknown', transport: null, confidence: 'low', windowMs: 0, unknownReason: 'timing_gap' };
  }

  function isNoise(chain: any): boolean {
    return chain.initiator === 'page-init'
      || (chain.confidence === 'low' && chain.unknownReason !== 'service_worker' && NOISE_FETCH.test(chain.transportDetail ?? ''))
      || (chain.initiator === 'click' && NOISE_CLICK.test(chain.initiatorDetail ?? ''));
  }

  // ── MutationObserver ──────────────────────────────────────────────────────
  function getSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const a = el.getAttribute('aria-label'); if (a) return `[aria-label="${a}"]`;
    const n = el.getAttribute('name'); if (n) return `[name="${n}"]`;
    return el.tagName.toLowerCase();
  }

  // Observe documentElement (available at document_start) — body may not exist yet
  try {
    const observeTarget = document.documentElement || document.body;
    if (observeTarget) {
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          try {
            const tag = (m.target as Element).tagName?.toLowerCase();
            if (SKIP_TAGS.has(tag)) continue;
            const now = Date.now();
            lastMutationTs = now;
            const chain = buildChain(now);
            const noise = isNoise(chain);

            if (m.type === 'childList') {
              for (const node of m.addedNodes) {
                const el = node.nodeType === 1 ? node as Element : (node as Node).parentElement;
                if (!el) continue;
                const val = (el.textContent ?? '').trim().slice(0, 200);
                if (val.length < 3) continue;
                const delta = { timestamp: now, nodeSelector: getSelector(el), nodeTag: el.tagName?.toLowerCase(), oldValue: '', newValue: val, mutationType: 'added', chain, isNoise: noise };
                deltas.push(delta);
                if (deltas.length > MAX_DELTAS) deltas.shift();
              }
            }
            if (m.type === 'characterData') {
              const nv = (m.target.textContent ?? '').trim().slice(0, 200);
              const ov = (m.oldValue ?? '').trim().slice(0, 200);
              if (nv === ov || nv.length < 2) continue;
              const parent = (m.target as Node).parentElement;
              if (!parent) continue;
              const delta = { timestamp: now, nodeSelector: getSelector(parent), nodeTag: parent.tagName?.toLowerCase(), oldValue: ov, newValue: nv, mutationType: 'textChanged', chain, isNoise: noise };
              deltas.push(delta);
              if (deltas.length > MAX_DELTAS) deltas.shift();
            }
          } catch { /* P1 degradation */ }
        }
      }).observe(observeTarget, {
        childList: true, subtree: true, characterData: true,
        characterDataOldValue: true, attributes: true,
        attributeFilter: ['value', 'placeholder', 'aria-label', 'data-price']
      });
    } else {
      console.warn('[browsegent] No observe target at document_start — mutation observer skipped');
    }
  } catch (e) { console.warn('[browsegent] MutationObserver setup failed:', e); }

  // ── Brain 1 filtering rules (mirrored from src/brain1/filter.ts) ──────────
  const MIN_TEXT = 5;
  const MAX_NODES = 10000;
  const TRIGGER_KW = /buy|submit|login|load\s*more|next|add\s*to|search|sign\s*in|continue|proceed|checkout|confirm|apply|get|download|register|subscribe/i;
  const NOISE_CLS = /\b(loader|spinner|hidden|skeleton|placeholder|overlay|backdrop|tooltip|sr-only|visually-hidden)\b/i;
  const FORM_TAGS = new Set(['input','select','textarea']);
  const INTERACTIVE_TAGS = new Set(['button','a']);

  function isVisible(el: Element): boolean {
    try {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch { return true; }
  }

  function shouldKeep(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (!isVisible(el)) return false;
    if (FORM_TAGS.has(tag)) {
      if (tag === 'input' && el.getAttribute('type') === 'hidden') return false;
      return true;
    }
    const cls = el.getAttribute('class') ?? '';
    const text = (el.textContent ?? '').trim();
    if (NOISE_CLS.test(cls) && text.length <= MIN_TEXT) return false;
    if (tag === 'td' || tag === 'th') return text.length > 0;
    if (INTERACTIVE_TAGS.has(tag)) {
      if (TRIGGER_KW.test(text) || TRIGGER_KW.test((el as HTMLInputElement).value ?? '')) return true;
      if (tag === 'a' && el.getAttribute('href') && text.length > MIN_TEXT) return true;
    }
    if ((el as HTMLInputElement).value || el.getAttribute('placeholder') || el.getAttribute('aria-label')) return true;
    return text.length > MIN_TEXT;
  }

  function buildGoalPatterns(g: string): RegExp | null {
    if (!g) return null;
    const STOP = new Set(['get','find','the','and','for','from','with','page','site','web','this','that','into','onto','login','sign','bank','account','after']);
    const words = g.toLowerCase().split(/\s+/).filter(w => w.length >= 6 && !STOP.has(w));
    if (!words.length) return /password|username|user.?id|otp/i;
    return new RegExp(words.join('|'), 'i');
  }

  function brain1Scan(root: Element, goalStr: string): any {
    const start = performance.now();
    const nodes: any[] = [];
    const errors: string[] = [];
    const stack: Element[] = [root];
    let walked = 0;
    const goalPat = buildGoalPatterns(goalStr);
    let shadowDomCount = 0;

    try {
      while (stack.length && walked < MAX_NODES) {
        const el = stack.pop()!;
        if (!el?.tagName) continue;
        walked++;
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;

        // shadow DOM detection
        if ((el as any).shadowRoot) {
          shadowDomCount++;
          console.warn('[browsegent] Shadow DOM detected:', getSelector(el));
        }

        if (shouldKeep(el)) {
          // Get text but exclude script/style children to avoid JSON-LD/CSS leaking in
          let rawText = '';
          for (const child of el.childNodes) {
            if (child.nodeType === 3) rawText += child.textContent ?? '';
            else if (child.nodeType === 1 && !SKIP_TAGS.has((child as Element).tagName?.toLowerCase())) {
              rawText += (child as Element).textContent ?? '';
            }
          }
          const text = rawText.trim().slice(0, 200);
          const val = (el as HTMLInputElement).value ?? '';
          const value = text || val;

          // goal-driven filter on data nodes
          const type = FORM_TAGS.has(tag) ? 'input' : INTERACTIVE_TAGS.has(tag) ? 'trigger' : 'data';
          if (type === 'data' && goalPat && !goalPat.test(value)) { /* skip */ }
          else {
            nodes.push({ type, tag, value, selector: getSelector(el), attributes: {
              placeholder: el.getAttribute('placeholder') ?? undefined,
              ariaLabel: el.getAttribute('aria-label') ?? undefined,
              name: el.getAttribute('name') ?? undefined,
              href: el.getAttribute('href') ?? undefined,
              inputType: el.getAttribute('type') ?? undefined,
            }});
          }
        }

        const children = Array.from(el.children);
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
      }
    } catch (err) {
      errors.push(String(err));
    }

    return { nodes, totalNodesWalked: walked, walkTimeMs: performance.now() - start, errors, shadowDomCount };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  (window as any).__browsegent_brain1 = function(root: Element, goalStr?: string) {
    return brain1Scan(root ?? document.body, goalStr ?? goal);
  };

  (window as any).__browsegent_brain2 = {
    getDeltas: () => deltas.slice(),
    clearDeltas: () => { deltas.length = 0; },
    getPending: () => pending.slice(),
    isReady: () => pageInitComplete,
    getCalibration: () => ({ samples: rttSamples, calibratedMax }),
    disconnect: () => {},
    recordClick: (sel: string) => {
      addPending({ type: 'click', detail: sel, timestamp: Date.now() });
    },
    getCalibratedMax: () => calibratedMax,
    getRttSamples: () => rttSamples.slice(),
  };

  console.log('[browsegent] Content script loaded (MAIN world, document_start)');
})();
