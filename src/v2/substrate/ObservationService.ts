import type { Page } from 'playwright';

import type { BrowserObservation, V2Ref } from '../runtime/types';
import { deriveRefCapabilities } from '../runtime/refCapabilities';
import { CdpBridge } from './CdpBridge';
import type { BuildObservationInput, CapturedElement, ObservationCaptureInput } from './types';

const MAX_CDP_IDENTITY_ELEMENTS = 150;

export class ObservationService {
  private observationCounter = 0;

  async capture(input: ObservationCaptureInput): Promise<BrowserObservation> {
    const startedAt = Date.now();
    const [url, title, captured] = await Promise.all([
      input.page.url(),
      input.page.title(),
      input.page.evaluate<CapturedElement[]>(COLLECT_INTERACTIVE_ELEMENTS_SCRIPT),
    ]);

    const identities = await resolveBackendNodeIds(input.page, captured.length);
    const refs = captured.map((candidate, index): V2Ref => ({
      refId: `ref_${input.generationId}_${index + 1}`,
      generationId: input.generationId,
      targetId: candidate.targetId,
      backendNodeId: identities[index]?.backendNodeId,
      frameId: identities[index]?.frameId ?? candidate.frameId,
      selectorCandidates: candidate.selectorCandidates,
      role: candidate.role,
      name: candidate.name,
      text: candidate.text,
      tagName: candidate.tagName,
      inputType: candidate.inputType,
      editableKind: candidate.editableKind,
      ariaAutocomplete: candidate.ariaAutocomplete,
      ariaHasPopup: candidate.ariaHasPopup,
      isContentEditable: candidate.isContentEditable,
      nthRoleName: candidate.nthRoleName,
      capabilities: deriveRefCapabilities(candidate),
      selectOptions: candidate.selectOptions,
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

export async function resolveBackendNodeIds(
  page: Page,
  count: number,
  createBridge: (page: Page) => Promise<CdpBridge> = CdpBridge.create,
): Promise<Array<{ backendNodeId?: number; frameId?: string }>> {
  const identities = Array.from({ length: count }, () => ({} as { backendNodeId?: number; frameId?: string }));
  let bridge: CdpBridge | undefined;

  try {
    bridge = await createBridge(page).catch(() => undefined);
    if (!bridge) {
      return identities;
    }

    const documentResult = await bridge.send<{ root?: { nodeId?: number } }>('DOM.getDocument', { depth: 0 });
    const rootNodeId = documentResult.root?.nodeId;
    if (typeof rootNodeId !== 'number') {
      return identities;
    }

    const queryResult = await bridge.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: '[data-browsegent-v2-marker]',
    });
    const nodeIds = (queryResult.nodeIds ?? []).slice(0, MAX_CDP_IDENTITY_ELEMENTS);

    for (const nodeId of nodeIds) {
      try {
        const described = await bridge.send<{
          node?: {
            backendNodeId?: number;
            frameId?: string;
            attributes?: string[];
          };
        }>('DOM.describeNode', { nodeId, depth: 0 });
        const marker = readAttribute(described.node?.attributes, 'data-browsegent-v2-marker');
        const index = markerIndex(marker);
        if (index >= 0 && index < identities.length) {
          identities[index] = {
            backendNodeId: described.node?.backendNodeId,
            frameId: described.node?.frameId,
          };
        }
      } catch {
        continue;
      }
    }

    return identities;
  } finally {
    await cleanupBackendMarkers(page);
    await bridge?.dispose().catch(() => undefined);
  }
}

function readAttribute(attributes: string[] | undefined, name: string): string | undefined {
  if (!attributes) {
    return undefined;
  }

  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) {
      return attributes[index + 1];
    }
  }
  return undefined;
}

function markerIndex(marker: string | undefined): number {
  const value = marker?.split('-').pop();
  const index = Number(value);
  return Number.isInteger(index) ? index : -1;
}

async function cleanupBackendMarkers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __browsegentV2MarkedElements?: Element[] };
    for (const element of Array.from(store.__browsegentV2MarkedElements ?? [])) {
      if (element instanceof Element) {
        element.removeAttribute('data-browsegent-v2-marker');
      }
    }
    delete store.__browsegentV2MarkedElements;
  }).catch(() => undefined);
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

  function selectOptions(element) {
    if (!(element instanceof HTMLSelectElement)) {
      return undefined;
    }

    return Array.from(element.options)
      .map(option => normalizedText(option.textContent || option.label || option.value || ''))
      .filter(Boolean)
      .slice(0, 20);
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
        switch (String(element.getAttribute('type') || 'text').toLowerCase()) {
          case 'button':
          case 'submit':
          case 'reset':
          case 'image':
            return 'button';
          case 'checkbox':
            return 'checkbox';
          case 'radio':
            return 'radio';
          case 'search':
            return 'searchbox';
          default:
            return 'textbox';
        }
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
      ariaLabelledByText(element) ||
      element.getAttribute('aria-label') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title');

    if (direct) {
      return normalizedText(direct);
    }

    if (element instanceof HTMLInputElement && element.value) {
      return normalizedText(element.value);
    }

    if (
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
      && element.labels
      && element.labels.length > 0
    ) {
      const labelText = Array.from(element.labels).map(label => normalizedText(label.textContent || '')).filter(Boolean).join(' ');
      if (labelText) {
        return labelText;
      }
    }

    const formName = element.getAttribute('name');
    if (formName) {
      return normalizedText(formName);
    }

    return normalizedText(element.textContent || '') || undefined;
  }

  function ariaLabelledByText(element) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (!labelledBy) {
      return undefined;
    }

    const text = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '')
      .map(normalizedText)
      .filter(Boolean)
      .join(' ');
    return text || undefined;
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

  const roleNameCounts = new Map();
  const markedElements = [];
  const markerPrefix = 'browsegent-v2-' + Math.random().toString(36).slice(2);

  return elements
    .filter(isInteractiveElement)
    .map((element, index) => {
      const marker = markerPrefix + '-' + index;
      element.setAttribute('data-browsegent-v2-marker', marker);
      markedElements.push(element);
      window.__browsegentV2MarkedElements = markedElements;
      const tagName = element.tagName.toLowerCase();
      const inputType = tagName === 'input' ? String(element.getAttribute('type') || 'text').toLowerCase() : undefined;
      const isContentEditable = element.getAttribute('contenteditable') === 'true' || element.isContentEditable === true;
      const ariaAutocomplete = element.getAttribute('aria-autocomplete') || undefined;
      const ariaHasPopup = element.getAttribute('aria-haspopup') || undefined;
      const editableKind = isContentEditable
        ? 'contenteditable'
        : tagName === 'textarea'
          ? 'text'
          : tagName === 'input' && inputType === 'search'
            ? 'search'
            : tagName === 'input' && ['text', 'email', 'url', 'tel', 'number', 'password'].includes(inputType)
              ? 'text'
              : 'none';
      const selectorCandidates = buildSelectorCandidates(element);
      const name = accessibleName(element);
      const text = normalizedText(element.textContent || '');
      const role = explicitOrNativeRole(element);
      const roleNameKey = (role || 'generic') + '|' + (name || text || '');
      const nthRoleName = (roleNameCounts.get(roleNameKey) || 0) + 1;
      roleNameCounts.set(roleNameKey, nthRoleName);
      const visibility = computeVisibility(element);
      const actionability = computeActionability(element, visibility);
      const rect = element.getBoundingClientRect();
      const box = Number.isFinite(rect.x)
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : undefined;

      return {
        targetId: 'target_' + hashString((selectorCandidates[0] || element.tagName) + '|' + (name || '') + '|' + text + '|' + index),
        selectorCandidates,
        tagName,
        inputType,
        editableKind,
        ariaAutocomplete,
        ariaHasPopup,
        isContentEditable,
        nthRoleName,
        role,
        name,
        text: text || undefined,
        box,
        visibility,
        actionability,
        selectOptions: selectOptions(element),
      };
    });
})()
`;
