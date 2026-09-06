import type { Page } from 'playwright';

import type { BrowserObservation, V2Ref } from '../runtime/types';
import { deriveRefCapabilities } from '../runtime/refCapabilities';
import { CdpBridge } from './CdpBridge';
import type { BuildObservationInput, CapturedElement, ObservationCaptureInput } from './types';
import type { ProseRef } from '../runtime/types';

const MAX_CDP_IDENTITY_ELEMENTS = 150;
const EMPTY_NAVIGATION_RETRY_WAIT_MS = 100;
const EMPTY_NAVIGATION_MAX_WAIT_MS = 6_000;

function isNavigationRaceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context.*(destroyed|not available)|target closed|navigating/i.test(message);
}

export class ObservationService {
  private observationCounter = 0;

  async capture(input: ObservationCaptureInput): Promise<BrowserObservation> {
    const startedAt = Date.now();
    let state: PageCaptureState;

    try {
      state = await capturePageState(input.page);
    } catch (error) {
      if (!isNavigationRaceError(error)) throw error;
      // Wait for navigation to settle, then retry once
      await input.page.waitForLoadState('domcontentloaded').catch(() => undefined);
      state = await capturePageState(input.page);
    }

    if (input.retryEmptyNavigationCapture && shouldWaitForEmptyNavigation(state)) {
      await input.page.waitForLoadState('domcontentloaded').catch(() => undefined);
      state = await waitForInteractiveNavigationState(input.page, state);
    }

    const { url, title, captured, prose, lang } = state;

    const identities = await resolveBackendNodeIds(input.page, captured.length, undefined, captured);
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
      inForm: candidate.inForm,
      value: candidate.value,
      placeholder: candidate.placeholder,
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
    const proseRefs = mapProseEntries(prose, refs);

    this.observationCounter += 1;

    return buildBrowserObservation({
      observationId: `obs_${input.generationId}_${this.observationCounter}`,
      sessionId: input.sessionId,
      generationId: input.generationId,
      url,
      title,
      lang,
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      refs,
      prose: proseRefs.length > 0 ? proseRefs : undefined,
      warnings: [],
    });
  }
}

interface PageReadiness {
  readyState: string;
  bodyTextLength: number;
  bodyChildCount: number;
}

interface PageCaptureState {
  url: string;
  title: string;
  prose: CapturedProse[];
  captured: CapturedElement[];
  readiness: PageReadiness;
  lang?: string;
}

interface CapturedProse {
  anchorIndexes: number[];
  text: string;
}

interface PageCaptureContent {
  captured: CapturedElement[];
  prose?: CapturedProse[];
  readiness: PageReadiness;
  lang?: unknown;
}

async function capturePageState(page: Page): Promise<PageCaptureState> {
  const [url, title, content] = await Promise.all([
    page.url(),
    page.title(),
    page.evaluate<PageCaptureContent | CapturedElement[]>(CAPTURE_PAGE_CONTENT_SCRIPT),
  ]);

  // The array branch keeps lightweight test doubles and older embedders
  // compatible while real pages use the combined capture payload.
  const captured = Array.isArray(content) ? content : content.captured;
  const readiness = Array.isArray(content)
    ? { readyState: 'unknown', bodyTextLength: 0, bodyChildCount: 0 }
    : content.readiness;
  const lang = Array.isArray(content) ? undefined : normalizeLang(content.lang);
  const prose = Array.isArray(content) ? [] : content.prose ?? [];
  return { url, title, captured, prose, readiness, lang };
}

/**
 * Node-side prose mapping (D1): assigns proseIds, maps anchor indexes to the
 * capture-ordered refIds, dedupes, and enforces the total character budget.
 * Pure so the unit suite can exercise it without a browser.
 */
export function mapProseEntries(
  entries: CapturedProse[],
  refs: V2Ref[],
): ProseRef[] {
  const prose: ProseRef[] = [];
  let budget = 2_500;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (prose.length >= 8 || budget <= 60) break;
    const text = String(entry.text ?? '').trim();
    if (!text) continue;
    const key = text.slice(0, 64);
    if (seen.has(key)) continue;
    seen.add(key);
    const bounded = text.slice(0, Math.min(300, budget));
    budget -= bounded.length;
    const anchorRefIds = (entry.anchorIndexes ?? [])
      .map(index => refs[index]?.refId)
      .filter((refId): refId is string => Boolean(refId));
    prose.push({ proseId: 'prose_' + (prose.length + 1), anchorRefIds, text: bounded, chars: bounded.length });
  }
  return prose;
}

function normalizeLang(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function shouldWaitForEmptyNavigation(state: PageCaptureState): boolean {
  // A transition capture that found zero interactive elements is worth a
  // bounded wait regardless of title or body text: SPA shells routinely ship
  // a title and server-rendered text before hydrating interactive content
  // (observed: titled search-results shell with zero refs mid-transition).
  return state.captured.length === 0;
}

async function waitForInteractiveNavigationState(page: Page, initial: PageCaptureState): Promise<PageCaptureState> {
  const deadline = Date.now() + EMPTY_NAVIGATION_MAX_WAIT_MS;
  let state = initial;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await page.waitForTimeout(Math.min(EMPTY_NAVIGATION_RETRY_WAIT_MS, Math.max(1, remaining))).catch(() => undefined);
    try {
      state = await capturePageState(page);
    } catch (error) {
      // A navigation committing under a poll is "not ready yet", not a
      // capture failure. Keep polling until the deadline, then return the
      // last known state instead of crashing the run.
      if (!isNavigationRaceError(error)) throw error;
      continue;
    }
    if (state.captured.length > 0) {
      return state;
    }
  }

  return state;
}

export function buildBrowserObservation(input: BuildObservationInput): BrowserObservation {
  return {
    observationId: input.observationId,
    sessionId: input.sessionId,
    generationId: input.generationId,
    url: input.url,
    title: input.title,
    lang: input.lang,
    timestamp: input.timestamp,
    refs: input.refs,
    prose: input.prose,
    warnings: input.warnings,
    stats: {
      refCount: input.refs.length,
      visibleRefCount: input.refs.filter(ref => ref.visibility === 'visible').length,
      durationMs: input.durationMs,
      bodyTextLength: input.bodyTextLength,
    },
  };
}

/** Above this captured-element count the batched tree payload is capped out
 *  and the legacy marker+describeNode path takes over (D4 blueprint guard). */
const BATCH_IDENTITY_MAX_ELEMENTS = 2_000;

interface CdpTreeNode {
  nodeId?: number;
  nodeName?: string;
  nodeType?: number;
  backendNodeId?: number;
  children?: CdpTreeNode[];
  shadowRoots?: CdpTreeNode[];
  templateContents?: CdpTreeNode[];
  contentDocument?: CdpTreeNode;
  frameId?: string;
}

/**
 * Flattens a CDP node tree in the exact pre-order the in-page walk uses:
 * for each element — yield it, then its shadow subtrees, then its light
 * children — so position i in this list is the element with walkIndex i.
 * Text nodes, template contents, and nested documents are skipped (the
 * in-page walk never crosses them).
 */
function flattenCdpElementOrder(root: CdpTreeNode): CdpTreeNode[] {
  const out: CdpTreeNode[] = [];
  const visit = (node: CdpTreeNode): void => {
    if (node.nodeType === 1) out.push(node);
    for (const shadow of node.shadowRoots ?? []) {
      visit(shadow);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

export async function resolveBackendNodeIds(
  page: Page,
  count: number,
  createBridge: (page: Page) => Promise<CdpBridge> = CdpBridge.create,
  captured?: Array<{ walkIndex?: number; tagName?: string }>,
): Promise<Array<{ backendNodeId?: number; frameId?: string }>> {
  const identities = Array.from({ length: count }, () => ({} as { backendNodeId?: number; frameId?: string }));
  let bridge: CdpBridge | undefined;

  try {
    bridge = await createBridge(page).catch(() => undefined);
    if (!bridge) {
      return identities;
    }

    // D4 batched identity: one getDocument(-1, pierce) round trip replaces up
    // to 150 sequential describeNode calls and pierces shadow roots, so
    // shadow refs gain real backendNodeIds. Position-aligned join against the
    // in-page walk order with a tagName guard; any page-level failure falls
    // through to the legacy marker path unchanged.
    if (count > 0 && captured && count <= BATCH_IDENTITY_MAX_ELEMENTS) {
      try {
        const tree = await bridge.send<{ root?: CdpTreeNode }>('DOM.getDocument', { depth: -1, pierce: true });
        const root = tree.root;
        if (root?.nodeId !== undefined) {
          const ordered = flattenCdpElementOrder(root);
          let matched = 0;
          for (let index = 0; index < count; index += 1) {
            const walkIndex = captured[index]?.walkIndex;
            const tagName = captured[index]?.tagName;
            if (walkIndex === undefined || walkIndex >= ordered.length) continue;
            const node = ordered[walkIndex];
            const expected = String(tagName ?? '').toUpperCase();
            const actual = String(node.nodeName ?? '').toUpperCase();
            if (expected && expected !== actual) continue;
            identities[index].backendNodeId = node.backendNodeId;
            identities[index].frameId = root.frameId;
            matched += 1;
          }
          if (matched > 0) {
            return identities;
          }
          // Complete join failure: fall through to the legacy path below.
        }
      } catch (error) {
        console.warn('[ObservationService] batched CDP identity failed, falling back to legacy path:', error instanceof Error ? error.message : error);
      }
    }

    let rootNodeId: number | undefined;
    let nodeIds: number[] = [];

    const fetchNodeIds = async () => {
      const documentResult = await bridge!.send<{ root?: { nodeId?: number } }>('DOM.getDocument', { depth: 0 });
      rootNodeId = documentResult.root?.nodeId;
      if (typeof rootNodeId !== 'number') {
        return;
      }
      const queryResult = await bridge!.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', {
        nodeId: rootNodeId,
        selector: '[data-browsegent-v2-marker]',
      });
      nodeIds = (queryResult.nodeIds ?? []).slice(0, MAX_CDP_IDENTITY_ELEMENTS);
    };

    try {
      await fetchNodeIds();
    } catch (err) {
      // Retry once after a brief settlement delay
      await new Promise(resolve => setTimeout(resolve, 30));
      try {
        await fetchNodeIds();
      } catch (retryErr) {
        console.warn('[ObservationService] CDP DOM querySelectorAll failed persistently:', retryErr);
        return identities;
      }
    }

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
  const previousMarkers = window.__browsegentV2MarkedElements || [];
  for (const element of previousMarkers) {
    if (element instanceof Element) {
      element.removeAttribute('data-browsegent-v2-marker');
    }
  }
  delete window.__browsegentV2MarkedElements;

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

  function boundedText(text, maxLength) {
    const normalized = normalizedText(text);
    return normalized ? normalized.slice(0, maxLength) : undefined;
  }

  function currentValue(element, inputType) {
    if (inputType === 'password') return undefined;
    if ('value' in element) return boundedText(element.value, 160);
    if (element.isContentEditable) return boundedText(element.textContent, 160);
    return undefined;
  }

  function normalizedSemanticIdentity(text) {
    return normalizedText(text).toLowerCase();
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
    if (role && ['button', 'link', 'tab', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'searchbox'].includes(role)) {
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

  const walkIndexByElement = new Map();
  elements.forEach((el, walkIdx) => walkIndexByElement.set(el, walkIdx));

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
      const inputType = tagName === 'input'
        ? String(element.getAttribute('type') || 'text').toLowerCase()
        : tagName === 'button'
          ? String(element.getAttribute('type') || '').toLowerCase() || undefined
          : undefined;
      // Spec semantics: a <button> without an explicit type defaults to
      // submit WHEN it belongs to a form — the commit-phase machinery needs
      // that fact and it is language-free.
      const inForm = tagName === 'button' ? Boolean(element.closest('form')) : false;
      const isContentEditable = element.getAttribute('contenteditable') === 'true' || element.isContentEditable === true;
      const ariaAutocomplete = element.getAttribute('aria-autocomplete') || undefined;
      const ariaHasPopup = element.getAttribute('aria-haspopup') || undefined;
      const value = currentValue(element, inputType);
      const placeholder = boundedText(element.getAttribute('placeholder'), 160);
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
      const roleNameKey = normalizedSemanticIdentity(role || 'generic') + '|' + normalizedSemanticIdentity(name || text || '');
      const nthRoleName = (roleNameCounts.get(roleNameKey) || 0) + 1;
      roleNameCounts.set(roleNameKey, nthRoleName);
      const visibility = computeVisibility(element);
      const actionability = computeActionability(element, visibility);
      const rect = element.getBoundingClientRect();
      const box = Number.isFinite(rect.x)
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : undefined;

      return {
        walkIndex: walkIndexByElement.get(element),
        targetId: 'target_' + hashString((selectorCandidates[0] || element.tagName) + '|' + (name || '') + '|' + text + '|' + index),
        selectorCandidates,
        tagName,
        inputType,
        inForm,
        value,
        placeholder,
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

const COLLECT_PROSE_SCRIPT = `
(() => {
  const NODE_CAP = 300;
  const SECTION_CAP = 800;
  const TOTAL_CAP = 2500;
  const REF_CAP = 8;

  const marked = Array.from(document.querySelectorAll('[data-browsegent-v2-marker]'));
  const interactive = new Set(marked);

  function normalized(t) {
    return String(t || '').replace(/\s+/g, ' ').trim();
  }
  function visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function inInteractive(el) {
    let c = el;
    while (c) {
      if (interactive.has(c)) return true;
      c = c.parentElement;
    }
    return false;
  }
  function inChrome(el) {
    for (let c = el; c && c.tagName; c = c.parentElement) {
      const t = c.tagName.toLowerCase();
      const role = (c.getAttribute && c.getAttribute('role') || '').toLowerCase();
      if (t === 'nav' || t === 'footer' || t === 'header' || t === 'script' || t === 'style' || t === 'noscript' || t === 'svg' || role === 'navigation') return true;
    }
    return false;
  }
  function markerIndex(el) {
    const parts = (el.getAttribute('data-browsegent-v2-marker') || '').split('-');
    const n = Number(parts[parts.length - 1]);
    return Number.isFinite(n) ? n : undefined;
  }
  function containerFor(anchor) {
    return anchor.closest('section, article, [role=region], li, td, dd, blockquote, form')
      || anchor.parentElement
      || anchor;
  }

  const used = new Set();
  const out = [];
  let budget = TOTAL_CAP;
  function push(entry) {
    if (out.length >= REF_CAP || budget <= 60) return;
    const text = normalized(entry.text).slice(0, Math.min(NODE_CAP, budget));
    if (text.length < 24) return;
    const key = text.slice(0, 64);
    if (used.has(key)) return;
    used.add(key);
    budget -= text.length;
    out.push({ anchorIndexes: entry.anchorIndexes, text: text });
  }

  for (const el of marked) {
    if (out.length >= REF_CAP || budget <= 60) break;
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (!['a', 'button', 'summary'].includes(tag) && !['link', 'button', 'heading', 'tab', 'menuitem'].includes(role)) continue;
    const name = normalized(el.getAttribute('aria-label') || el.textContent || '');
    if (name.length < 4) continue;
    const container = containerFor(el);
    if (!container || container === document.body) continue;
    if (container.querySelectorAll('[data-browsegent-v2-marker]').length > 12) continue;
    if (!visible(container) || inChrome(container)) continue;
    const text = normalized(container.textContent || '');
    if (text.length < 40 || text.length > SECTION_CAP * 3) continue;
    const idx = markerIndex(el);
    push({ anchorIndexes: idx === undefined ? [] : [idx], text: text.slice(0, SECTION_CAP) });
  }

  for (const el of Array.from(document.querySelectorAll('h1, h2, h3, h4, li, p'))) {
    if (out.length >= REF_CAP || budget <= 60) break;
    if (interactive.has(el) || inInteractive(el) || !visible(el) || inChrome(el)) continue;
    if (el.querySelectorAll('[data-browsegent-v2-marker]').length > 0) continue;
    const tag = el.tagName.toLowerCase();
    const text = normalized(el.textContent || '');
    if (!text) continue;
    const isHeading = /^h[1-4]$/.test(tag);
    const isLi = tag === 'li';
    const isParagraph = tag === 'p';
    if (isHeading) { if (text.length < 8) continue; }
    else if (isLi) { if (text.length < 24) continue; }
    else if (isParagraph) { if (text.length < 60) continue; }
    else continue;
    push({ anchorIndexes: [], text: text.slice(0, NODE_CAP) });
  }

  return out.slice(0, REF_CAP);
})()
`;

const READ_PAGE_READINESS_SCRIPT = `
(() => ({
  readyState: document.readyState,
  bodyTextLength: (document.body?.innerText || '').trim().length,
  bodyChildCount: document.body?.children.length || 0,
}))()
`;

const READ_PAGE_LANG_SCRIPT = `
(() => document.documentElement?.getAttribute('lang') || '')()
`;

const CAPTURE_PAGE_CONTENT_SCRIPT = `
(() => ({
  captured: ${COLLECT_INTERACTIVE_ELEMENTS_SCRIPT},
  prose: ${COLLECT_PROSE_SCRIPT},
  readiness: ${READ_PAGE_READINESS_SCRIPT},
  lang: ${READ_PAGE_LANG_SCRIPT},
}))()
`;
