// Brain 2 — MutationObserver (confirmation layer)
// Receives DOM mutations, calls correlator, emits MutationDeltas

import { logger } from '../logger';
import { buildCausalChain, isNoiseChain, evictStaleCauses } from './correlator';
import type { MutationDelta } from './types';

// Callback type for external consumers (graph updater, test harness)
export type DeltaCallback = (delta: MutationDelta) => void;

const SKIP_MUTATION_TAGS = new Set(['script', 'style', 'noscript', 'head', 'meta', 'svg']);
const STYLE_ONLY_ATTRS = new Set(['style', 'class', 'id', 'tabindex', 'aria-hidden']);

let _observer: MutationObserver | null = null;
let _onDelta: DeltaCallback | null = null;

export function setupObserver(onDelta: DeltaCallback): MutationObserver {
  try {
    _onDelta = onDelta;

    // P1 Fix: interval-based eviction (not mutation-triggered)
    setInterval(evictStaleCauses, 300);

    _observer = new MutationObserver((mutations) => {

      for (const mutation of mutations) {
        try {
          processMutation(mutation);
        } catch (err) {
          logger.error('brain2:observer', 'processMutation failed', err);
        }
      }
    });

    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['value', 'placeholder', 'aria-label', 'data-price', 'data-value'],
    });

    logger.info('brain2:observer', 'MutationObserver installed');
    return _observer;

  } catch (err) {
    logger.error('brain2:observer', 'setupObserver failed', err);
    throw err; // observer failure is fatal — Phase 2 cannot function without it
  }
}

function processMutation(mutation: MutationRecord): void {
  const target = mutation.target as Element;
  const tag = target.tagName?.toLowerCase() ?? 'unknown';

  // Skip noise tags entirely
  if (SKIP_MUTATION_TAGS.has(tag)) return;

  const now = Date.now();
  const chain = buildCausalChain(now);
  const isNoise = isNoiseChain(chain);

  // Handle childList mutations (nodes added/removed)
  if (mutation.type === 'childList') {
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) continue;

      const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      if (!el) continue;

      const newValue = el.textContent?.trim().slice(0, 200) ?? '';
      if (newValue.length < 3) continue;

      const delta: MutationDelta = {
        timestamp: now,
        nodeSelector: getNodeSelector(el),
        nodeTag: el.tagName?.toLowerCase() ?? 'text',
        oldValue: '',
        newValue,
        mutationType: 'added',
        chain,
        isNoise,
      };

      _onDelta?.(delta);
    }

    for (const node of Array.from(mutation.removedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      const oldValue = el.textContent?.trim().slice(0, 200) ?? '';
      if (oldValue.length < 3) continue;

      const delta: MutationDelta = {
        timestamp: now,
        nodeSelector: getNodeSelector(el),
        nodeTag: el.tagName?.toLowerCase() ?? 'unknown',
        oldValue,
        newValue: '',
        mutationType: 'removed',
        chain,
        isNoise,
      };

      _onDelta?.(delta);
    }
  }

  // Handle characterData mutations (text node changes)
  if (mutation.type === 'characterData') {
    const newValue = mutation.target.textContent?.trim().slice(0, 200) ?? '';
    const oldValue = mutation.oldValue?.trim().slice(0, 200) ?? '';

    if (newValue === oldValue) return;
    if (newValue.length < 2) return;

    const parent = mutation.target.parentElement;
    if (!parent) return;

    const delta: MutationDelta = {
      timestamp: now,
      nodeSelector: getNodeSelector(parent),
      nodeTag: parent.tagName?.toLowerCase() ?? 'text',
      oldValue,
      newValue,
      mutationType: 'textChanged',
      chain,
      isNoise,
    };

    _onDelta?.(delta);
  }

  // Handle attribute mutations (value changes on inputs, etc.)
  if (mutation.type === 'attributes') {
    const attrName = mutation.attributeName ?? '';
    if (STYLE_ONLY_ATTRS.has(attrName) && attrName !== 'aria-label') return;

    const newValue = target.getAttribute(attrName) ?? '';
    const oldValue = mutation.oldValue ?? '';

    if (newValue === oldValue) return;

    const delta: MutationDelta = {
      timestamp: now,
      nodeSelector: getNodeSelector(target),
      nodeTag: tag,
      oldValue,
      newValue,
      mutationType: 'attributeChanged',
      chain,
      isNoise,
    };

    _onDelta?.(delta);
  }
}

function getNodeSelector(el: Element): string {
  try {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const aria = el.getAttribute('aria-label');
    if (aria) return `[aria-label="${aria}"]`;
    const name = el.getAttribute('name');
    if (name) return `[name="${name}"]`;
    return el.tagName?.toLowerCase() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function disconnectObserver(): void {
  _observer?.disconnect();
  _observer = null;
}
