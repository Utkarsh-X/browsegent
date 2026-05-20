import type { BrowserObservation, V2Ref } from '../runtime/types';
import type { BuildObservationInput, CapturedElement, ObservationCaptureInput } from './types';

export class ObservationService {
  private observationCounter = 0;

  async capture(input: ObservationCaptureInput): Promise<BrowserObservation> {
    const startedAt = Date.now();
    const [url, title, captured] = await Promise.all([
      input.page.url(),
      input.page.title(),
      input.page.evaluate<CapturedElement[]>(COLLECT_INTERACTIVE_ELEMENTS_SCRIPT),
    ]);

    const refs = captured.map((candidate, index): V2Ref => ({
      refId: `ref_${input.generationId}_${index + 1}`,
      generationId: input.generationId,
      targetId: candidate.targetId,
      selectorCandidates: candidate.selectorCandidates,
      role: candidate.role,
      name: candidate.name,
      text: candidate.text,
      box: candidate.box,
      visibility: candidate.visibility,
      actionability: candidate.actionability,
      continuityConfidence: 1,
      state: 'live',
    }));

    this.observationCounter += 1;

    return buildBrowserObservation({
      observationId: `obs_${input.generationId}_${this.observationCounter}`,
      sessionId: input.sessionId,
      generationId: input.generationId,
      url,
      title,
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      refs,
      warnings: [],
    });
  }
}

export function buildBrowserObservation(input: BuildObservationInput): BrowserObservation {
  return {
    observationId: input.observationId,
    sessionId: input.sessionId,
    generationId: input.generationId,
    url: input.url,
    title: input.title,
    timestamp: input.timestamp,
    refs: input.refs,
    warnings: input.warnings,
    stats: {
      refCount: input.refs.length,
      visibleRefCount: input.refs.filter(ref => ref.visibility === 'visible').length,
      durationMs: input.durationMs,
    },
  };
}

const COLLECT_INTERACTIVE_ELEMENTS_SCRIPT = `
(() => {
  const elements = [];

  function walk(root) {
    for (const child of Array.from(root.children || [])) {
      elements.push(child);
      if (child.shadowRoot) {
        walk(child.shadowRoot);
      }
      walk(child);
    }
  }

  function normalizedText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function escapeCssString(value) {
    return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  }

  function nthOfType(element) {
    let nth = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) {
        nth += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return nth;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function explicitOrNativeRole(element) {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit.toLowerCase();

    switch (element.tagName.toLowerCase()) {
      case 'a':
        return 'link';
      case 'button':
        return 'button';
      case 'input':
      case 'textarea':
        return 'textbox';
      case 'select':
        return 'combobox';
      default:
        return undefined;
    }
  }

  function accessibleName(element) {
    const direct =
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      element.getAttribute('name');

    if (direct) {
      return normalizedText(direct);
    }

    if (element instanceof HTMLInputElement && element.value) {
      return normalizedText(element.value);
    }

    return normalizedText(element.textContent || '') || undefined;
  }

  function buildSelectorCandidates(element) {
    const tagName = element.tagName.toLowerCase();
    const selectors = [];
    const id = element.getAttribute('id');
    if (id) selectors.push('#' + CSS.escape(id));

    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'href', 'placeholder', 'type']) {
      const value = element.getAttribute(attr);
      if (value) selectors.push(tagName + '[' + attr + '="' + escapeCssString(value) + '"]');
    }

    const className = Array.from(element.classList).find(Boolean);
    if (className) selectors.push(tagName + '.' + CSS.escape(className));

    selectors.push(tagName + ':nth-of-type(' + nthOfType(element) + ')');
    return Array.from(new Set(selectors));
  }

  function isInteractiveElement(element) {
    const tagName = element.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'option'].includes(tagName)) {
      return true;
    }

    const role = element.getAttribute('role') && element.getAttribute('role').toLowerCase();
    if (role && ['button', 'link', 'tab', 'option', 'menuitem', 'checkbox', 'radio', 'switch', 'textbox', 'combobox'].includes(role)) {
      return true;
    }

    if (element.getAttribute('contenteditable') === 'true') {
      return true;
    }

    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) {
      return true;
    }

    if (Array.from(element.getAttributeNames()).some(name => name.startsWith('on'))) {
      return true;
    }

    return getComputedStyle(element).cursor === 'pointer';
  }

  function computeVisibility(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      element.hasAttribute('hidden') ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return 'hidden';
    }

    const intersectsViewport = rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    return intersectsViewport ? 'visible' : 'offscreen';
  }

  function computeActionability(element, visibility) {
    const disabledProperty = 'disabled' in element && Boolean(element.disabled);
    if (disabledProperty || element.getAttribute('aria-disabled') === 'true') {
      return 'disabled';
    }
    if (visibility === 'hidden') {
      return 'blocked';
    }
    return 'ready';
  }

  walk(document);

  return elements
    .filter(isInteractiveElement)
    .map((element, index) => {
      const selectorCandidates = buildSelectorCandidates(element);
      const name = accessibleName(element);
      const text = normalizedText(element.textContent || '');
      const visibility = computeVisibility(element);
      const actionability = computeActionability(element, visibility);
      const rect = element.getBoundingClientRect();
      const box = Number.isFinite(rect.x)
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : undefined;

      return {
        targetId: 'target_' + hashString((selectorCandidates[0] || element.tagName) + '|' + (name || '') + '|' + text + '|' + index),
        selectorCandidates,
        tagName: element.tagName.toLowerCase(),
        role: explicitOrNativeRole(element),
        name,
        text: text || undefined,
        box,
        visibility,
        actionability,
      };
    });
})()
`;
