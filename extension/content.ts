// extension/content.ts
// Runs in the page world. No chrome.* APIs are available here.
// Brain1 + Brain2 unified content script.

(function() {
  'use strict';

  const goal: string = (window as any).__browsegent_goal ?? '';

  const HIGH_WINDOW = 300;
  const PAGE_INIT_MIN = 1200;
  const PAGE_INIT_MAX = 5000;
  const QUIET_PERIOD = 600;
  const MAX_PENDING = 20;
  const MAX_DELTAS = 50;
  const MAX_NODES = 10000;
  const MAX_OUTPUT_NODES = 240;
  const MIN_TEXT = 5;

  const NOISE_FETCH = /analytics|tracking|gtm|facebook|doubleclick|adservice|beacon|telemetry|hotjar|clarity|\/menu|\/nav|\/header|\/footer/i;
  const NOISE_CLICK = /nav|menu|header|footer|breadcrumb|sidebar/i;
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'video', 'audio', 'head', 'meta', 'link', 'br', 'hr', 'img']);
  const FORM_TAGS = new Set(['input', 'select', 'textarea']);
  const INTERACTIVE_TAGS = new Set(['button', 'a', 'summary', 'label']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'option', 'menuitem', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'searchbox']);
  const GENERIC_CONTAINER_TAGS = new Set(['body', 'main', 'section', 'article', 'div', 'span', 'ul', 'ol', 'li', 'nav', 'header', 'footer', 'form']);
  const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch']);
  const REGION_TAGS = new Set(['article', 'section', 'form', 'fieldset', 'li', 'tr', 'main', 'aside']);
  const TRIGGER_KW = /buy|submit|login|load\s*more|next|add\s*to|search|sign\s*in|continue|proceed|checkout|confirm|apply|get|download|register|subscribe|show|view|open|filter|sort|menu/i;
  const SEARCH_HINTS = /search|magnify|glass|lookup|find|query|searchbox|search-btn|search-button/i;
  const REGION_HINTS = /\b(card|item|result|row|listing|product|job|entry|module|panel|tile)\b/i;
  const NOISE_CLS = /\b(loader|spinner|hidden|skeleton|placeholder|overlay|backdrop|tooltip|sr-only|visually-hidden)\b/i;
  const TYPE_CAPS: Record<'input' | 'trigger' | 'data' | 'table_cell', number> = {
    input: 40,
    trigger: 60,
    data: 110,
    table_cell: 30,
  };

  type SelectorSource = 'id' | 'testid' | 'name' | 'aria' | 'href' | 'placeholder' | 'role' | 'type' | 'positional';
  type VisibilityState = 'visible' | 'offscreen' | 'hidden';
  type OutputNodeType = 'data' | 'trigger' | 'input' | 'table_cell';
  type InteractionKind = 'link' | 'button' | 'input' | 'select' | 'editable' | 'toggle' | 'generic';
  type ConfidenceState = 'high' | 'medium' | 'low';

  interface PendingCause {
    type: string;
    detail: string;
    timestamp: number;
  }

  interface SelectorCandidate {
    selector: string;
    source: SelectorSource;
    score: number;
  }

  interface VisibilityAssessment {
    state: VisibilityState;
    disabled: boolean;
    pointerEventsNone: boolean;
    isScrollable: boolean;
    rectWidth: number;
    rectHeight: number;
    largeEnough: boolean;
  }

  interface TraversalEntry {
    element: Element;
    inShadow: boolean;
    shadowHost: Element | null;
  }

  interface StagedNode {
    type: OutputNodeType;
    tag: string;
    value: string;
    sel: string;
    selType: SelectorSource;
    rule: string;
    attrs: {
      placeholder?: string;
      ariaLabel?: string;
      name?: string;
      href?: string;
      inputType?: string;
      role?: string;
      dataTestId?: string;
    };
    meta: {
      selectorScore: number;
      interactionScore: number;
      actionabilityScore: number;
      interactionKind: InteractionKind;
      confidence: ConfidenceState;
      enrichmentState: 'base' | 'enriched';
      visibility: VisibilityState;
      goalScore: number;
      nodeId: string;
      regionSelector?: string;
      disabled?: boolean;
      shadow?: boolean;
      role?: string;
      selectorSource?: SelectorSource;
    };
    totalScore: number;
  }

  const pending: PendingCause[] = [];
  const deltas: any[] = [];
  let pageInitComplete = false;
  let lastMutationTs = Date.now();
  let domContentLoadedAt = Date.now();
  let rttSamples: number[] = [];
  let calibratedMax = 1200;
  let injectionTime = Date.now();

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

  function addPending(cause: PendingCause): void {
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

  function normalizeText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
  }

  function escapeCssValue(value: string): string {
    return CSS.escape(value);
  }

  function getDirectText(el: Element): string {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += ` ${child.textContent ?? ''}`;
      }
    }
    return normalizeText(text);
  }

  function getElementText(el: Element, tag: string): string {
    if (FORM_TAGS.has(tag)) return '';
    if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '')) {
      return normalizeText((el.textContent ?? '').slice(0, 200));
    }
    const directText = getDirectText(el);
    if (directText) return directText.slice(0, 200);
    if (el.childElementCount <= 2) return normalizeText((el.textContent ?? '').slice(0, 200));
    return '';
  }

  function getElementFormValue(el: Element, tag: string): string {
    if (tag === 'input') {
      const input = el as HTMLInputElement;
      if (input.type === 'password') return '';
      return normalizeText((input.value ?? '').slice(0, 200));
    }
    if (tag === 'textarea') {
      return normalizeText((((el as HTMLTextAreaElement).value) ?? '').slice(0, 200));
    }
    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const selected = select.selectedOptions?.[0]?.textContent ?? select.value ?? '';
      return normalizeText(selected.slice(0, 200));
    }
    if ((el as HTMLElement).isContentEditable) {
      return normalizeText((((el as HTMLElement).textContent) ?? '').slice(0, 200));
    }
    return '';
  }

  function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function hasFormControlDescendant(el: Element, maxDepth = 2): boolean {
    const queue: Array<{ element: Element; depth: number }> = [{ element: el, depth: 0 }];
    while (queue.length) {
      const entry = queue.shift()!;
      if (entry.depth > maxDepth) continue;
      if (entry.element !== el) {
        const tag = entry.element.tagName.toLowerCase();
        if (FORM_TAGS.has(tag) || (entry.element as HTMLElement).isContentEditable) {
          return true;
        }
      }
      for (const child of Array.from(entry.element.children)) {
        queue.push({ element: child, depth: entry.depth + 1 });
      }
    }
    return false;
  }

  function hasSearchIndicator(el: Element, attrs: {
    placeholder?: string;
    ariaLabel?: string;
    name?: string;
    href?: string;
    inputType?: string;
    role?: string;
    dataTestId?: string;
  }): boolean {
    const className = `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''} ${attrs.dataTestId ?? ''}`;
    return SEARCH_HINTS.test(className)
      || SEARCH_HINTS.test(attrs.placeholder ?? '')
      || SEARCH_HINTS.test(attrs.ariaLabel ?? '')
      || SEARCH_HINTS.test(attrs.name ?? '')
      || SEARCH_HINTS.test(attrs.role ?? '');
  }

  function assessVisibility(el: Element): VisibilityAssessment {
    try {
      const style = window.getComputedStyle(el);
      const disabled = (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement).disabled === true
        || el.getAttribute('disabled') !== null
        || el.getAttribute('aria-disabled') === 'true';

      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || style.opacity === '0'
        || el.getAttribute('aria-hidden') === 'true'
      ) {
        return {
          state: 'hidden',
          disabled,
          pointerEventsNone: style.pointerEvents === 'none',
          isScrollable: false,
          rectWidth: 0,
          rectHeight: 0,
          largeEnough: false,
        };
      }

      const rect = el.getBoundingClientRect();
      const rectWidth = rect.width;
      const rectHeight = rect.height;
      const tooSmall = rectWidth < 2 || rectHeight < 2;
      const largeEnough = rectWidth >= 8 && rectHeight >= 8;
      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      const isScrollable = (
        el.scrollHeight > el.clientHeight + 8 ||
        el.scrollWidth > el.clientWidth + 8
      ) && rectWidth > 20 && rectHeight > 20;

      return {
        state: tooSmall ? 'hidden' : (inViewport ? 'visible' : 'offscreen'),
        disabled,
        pointerEventsNone: style.pointerEvents === 'none',
        isScrollable,
        rectWidth,
        rectHeight,
        largeEnough,
      };
    } catch {
      return {
        state: 'visible',
        disabled: false,
        pointerEventsNone: false,
        isScrollable: false,
        rectWidth: 0,
        rectHeight: 0,
        largeEnough: false,
      };
    }
  }

  function matchesOwnSelector(el: Element, selector: string): boolean {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  function countSelectorMatches(selector: string, cache?: Map<string, number>): number {
    const cached = cache?.get(selector);
    if (typeof cached === 'number') return cached;
    let count = Number.MAX_SAFE_INTEGER;
    try {
      count = document.querySelectorAll(selector).length;
    } catch {
      count = Number.MAX_SAFE_INTEGER;
    }
    cache?.set(selector, count);
    return count;
  }

  function buildPositionalSelector(el: Element): string {
    const segments: string[] = [];
    let current: Element | null = el;
    while (current && segments.length < 4 && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        segments.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(child => child.tagName === current!.tagName);
      const index = siblings.indexOf(current) + 1;
      segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = parent;
    }
    return segments.join(' > ') || el.tagName.toLowerCase();
  }

  function getRegionSelector(el: Element, cache?: Map<string, number>, shadowHost?: Element | null): string {
    if (shadowHost) {
      return getSelector(shadowHost, cache);
    }

    let current: Element | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const role = normalizeText(current.getAttribute('role'));
      const classLike = `${current.getAttribute('class') ?? ''} ${current.getAttribute('data-testid') ?? ''} ${current.getAttribute('data-test') ?? ''}`;
      if (
        REGION_TAGS.has(tag)
        || role === 'row'
        || role === 'article'
        || role === 'listitem'
        || role === 'group'
        || REGION_HINTS.test(classLike)
        || current.hasAttribute('data-testid')
        || current.hasAttribute('data-test')
      ) {
        return getSelector(current, cache);
      }
      current = current.parentElement;
    }

    return getSelector(el.parentElement ?? el, cache);
  }

  function getInteractionKind(
    el: Element,
    tag: string,
    role: string | undefined,
    wrappedControl: boolean,
  ): InteractionKind {
    if ((el as HTMLElement).isContentEditable) return 'editable';
    if (tag === 'select' || role === 'combobox') return 'select';
    if (FORM_TAGS.has(tag) || role === 'textbox' || role === 'searchbox') return 'input';
    if (tag === 'a' || role === 'link') return 'link';
    if (TOGGLE_ROLES.has(role ?? '')) return 'toggle';
    if (tag === 'button' || tag === 'summary' || role === 'button' || role === 'tab' || role === 'menuitem' || wrappedControl) {
      return 'button';
    }
    return 'generic';
  }

  function computeActionabilityScore(
    visibility: VisibilityAssessment,
    interactionKind: InteractionKind,
  ): number {
    let score = 0;
    if (visibility.state === 'visible') score += 62;
    if (visibility.state === 'offscreen') score += 26;
    if (visibility.largeEnough) score += 10;
    if (visibility.pointerEventsNone) score -= 24;
    if (visibility.disabled) score -= 32;
    if (visibility.isScrollable && interactionKind !== 'generic') score += 4;
    if (interactionKind === 'generic') score -= 8;
    return Math.max(0, Math.min(score, 100));
  }

  function deriveConfidence(
    selectorScore: number,
    interactionScore: number,
    actionabilityScore: number,
    visibility: VisibilityState,
  ): ConfidenceState {
    if (
      visibility === 'visible'
      && selectorScore >= 78
      && interactionScore >= 55
      && actionabilityScore >= 55
    ) {
      return 'high';
    }
    if (visibility !== 'hidden' && selectorScore >= 48 && actionabilityScore >= 34) {
      return 'medium';
    }
    return 'low';
  }

  function buildNodeId(selector: string, tag: string, interactionKind: InteractionKind, value: string): string {
    return `n_${hashString(`${selector}|${tag}|${interactionKind}|${value.slice(0, 80)}`)}`;
  }

  function buildSelectorCandidates(target: Element, cache?: Map<string, number>): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    const seen = new Set<string>();

    const push = (selector: string | null | undefined, source: SelectorSource, baseScore: number): void => {
      if (!selector || seen.has(selector) || !matchesOwnSelector(target, selector)) return;
      const count = countSelectorMatches(selector, cache);
      let score = baseScore;
      if (count === 1) score += 18;
      else if (count === 2) score += 8;
      else if (count <= 5) score += 3;
      else score -= Math.min(22, (count - 5) * 2);
      candidates.push({ selector, source, score });
      seen.add(selector);
    };

    const tag = target.tagName.toLowerCase();
    const id = normalizeText(target.id);
    if (id) push(`#${escapeCssValue(id)}`, 'id', 92);

    const dataTestId = normalizeText(target.getAttribute('data-testid'));
    if (dataTestId) push(`[data-testid="${escapeCssValue(dataTestId)}"]`, 'testid', 88);
    const dataTest = normalizeText(target.getAttribute('data-test'));
    if (dataTest) push(`[data-test="${escapeCssValue(dataTest)}"]`, 'testid', 86);

    const name = normalizeText(target.getAttribute('name'));
    if (name) push(`${tag}[name="${escapeCssValue(name)}"]`, 'name', 82);

    const ariaLabel = normalizeText(target.getAttribute('aria-label'));
    if (ariaLabel) push(`${tag}[aria-label="${escapeCssValue(ariaLabel)}"]`, 'aria', 76);

    const href = normalizeText(target.getAttribute('href'));
    if (href && tag === 'a') push(`a[href="${escapeCssValue(href)}"]`, 'href', 74);

    const placeholder = normalizeText(target.getAttribute('placeholder'));
    if (placeholder && FORM_TAGS.has(tag)) push(`${tag}[placeholder="${escapeCssValue(placeholder)}"]`, 'placeholder', 66);

    const role = normalizeText(target.getAttribute('role'));
    if (role) push(`${tag}[role="${escapeCssValue(role)}"]`, 'role', 58);

    const inputType = normalizeText(target.getAttribute('type'));
    if (inputType && tag === 'input') push(`input[type="${escapeCssValue(inputType)}"]`, 'type', 52);

    push(buildPositionalSelector(target), 'positional', 28);

    candidates.sort((left, right) => right.score - left.score);
    return candidates;
  }

  function getSelector(el: Element, cache?: Map<string, number>, shadowHost?: Element | null): string {
    const selectorTarget = shadowHost ?? el;
    const candidates = buildSelectorCandidates(selectorTarget, cache);
    return candidates[0]?.selector ?? selectorTarget.tagName.toLowerCase();
  }

  function getSelectorSource(el: Element, cache?: Map<string, number>, shadowHost?: Element | null): SelectorSource {
    const selectorTarget = shadowHost ?? el;
    const candidates = buildSelectorCandidates(selectorTarget, cache);
    return candidates[0]?.source ?? 'positional';
  }

  function getSelectorScore(el: Element, cache?: Map<string, number>, shadowHost?: Element | null): number {
    const selectorTarget = shadowHost ?? el;
    const candidates = buildSelectorCandidates(selectorTarget, cache);
    const score = candidates[0]?.score ?? 20;
    return shadowHost ? Math.max(12, score - 24) : score;
  }

  function buildGoalPatterns(goalText: string): RegExp | null {
    if (!goalText) return null;
    const STOP = new Set(['get', 'find', 'the', 'and', 'for', 'from', 'with', 'page', 'site', 'web', 'this', 'that', 'into', 'onto', 'login', 'sign', 'bank', 'account', 'after', 'what', 'which', 'where', 'right', 'shown', 'first', 'main', 'title']);
    const words = goalText
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length >= 4 && !STOP.has(word))
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return /password|username|user.?id|otp|search/i;
    return new RegExp(words.join('|'), 'i');
  }

  function scoreGoalFit(goalPat: RegExp | null, values: Array<string | undefined>): number {
    if (!goalPat) return 0;
    let score = 0;
    for (const value of values) {
      const normalized = normalizeText(value);
      if (!normalized) continue;
      if (goalPat.test(normalized)) score += normalized.length <= 80 ? 22 : 14;
    }
    return Math.min(score, 36);
  }

  function computeInteractionScore(
    el: Element,
    tag: string,
    visibility: VisibilityAssessment,
    attrs: {
      placeholder?: string;
      ariaLabel?: string;
      name?: string;
      href?: string;
      inputType?: string;
      role?: string;
      dataTestId?: string;
    },
    text: string,
    formValue: string,
    interactionKind: InteractionKind,
    wrappedControl: boolean,
    searchIndicator: boolean,
  ): number {
    let score = 0;
    const tabindex = Number(el.getAttribute('tabindex') ?? '');
    const style = window.getComputedStyle(el);

    if (FORM_TAGS.has(tag)) score += 55;
    if ((el as HTMLElement).isContentEditable) score += 50;
    if (INTERACTIVE_TAGS.has(tag)) score += 36;
    if (wrappedControl) score += 24;
    if (attrs.href) score += 16;
    if (attrs.inputType === 'submit' || attrs.inputType === 'button' || attrs.inputType === 'search') score += 18;
    if (INTERACTIVE_ROLES.has(attrs.role ?? '')) score += 36;
    if (Number.isFinite(tabindex) && tabindex >= 0) score += 16;
    if (el.getAttribute('onclick') || el.getAttribute('onmousedown') || el.getAttribute('onmouseup') || el.getAttribute('onkeydown')) score += 20;
    if (style.cursor === 'pointer') score += 16;
    if (searchIndicator) score += 18;
    if (
      TRIGGER_KW.test(text)
      || TRIGGER_KW.test(formValue)
      || TRIGGER_KW.test(attrs.ariaLabel ?? '')
      || TRIGGER_KW.test(attrs.placeholder ?? '')
    ) {
      score += 18;
    }
    if (visibility.isScrollable && tag !== 'body') score += 8;
    if (visibility.state === 'offscreen') score -= 10;
    if (visibility.pointerEventsNone) score -= 26;
    if (visibility.disabled) score -= 30;
    if (visibility.state === 'hidden') score -= 50;
    if (interactionKind === 'generic') score -= 6;

    return Math.max(0, Math.min(score, 100));
  }

  function classifyNode(
    el: Element,
    tag: string,
    visibility: VisibilityAssessment,
    interactionScore: number,
    actionabilityScore: number,
    interactionKind: InteractionKind,
    primaryValue: string,
    goalScore: number,
    text: string,
  ): { type: OutputNodeType | null; rule: string | null } {
    if (visibility.state === 'hidden') return { type: null, rule: null };

    if ((tag === 'td' || tag === 'th') && primaryValue.length > 0) {
      return { type: 'table_cell', rule: 'table_cell' };
    }

    if (FORM_TAGS.has(tag) || (el as HTMLElement).isContentEditable || interactionKind === 'input' || interactionKind === 'select' || interactionKind === 'editable') {
      return { type: 'input', rule: 'interactive_input' };
    }

    if (
      visibility.disabled &&
      (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '') || interactionKind !== 'generic')
    ) {
      return { type: 'trigger', rule: 'disabled_interactive_signal' };
    }

    if (interactionScore >= 42 || (interactionKind !== 'generic' && actionabilityScore >= 38)) {
      return { type: 'trigger', rule: 'interactive_signal' };
    }

    if (NOISE_CLS.test(el.getAttribute('class') ?? '') && text.length <= MIN_TEXT && goalScore === 0) {
      return { type: null, rule: null };
    }

    if (
      GENERIC_CONTAINER_TAGS.has(tag)
      && el.childElementCount > 4
      && goalScore < 16
      && primaryValue.length > 120
    ) {
      return { type: null, rule: null };
    }

    if (primaryValue.length >= MIN_TEXT) {
      return { type: 'data', rule: goalScore > 0 ? 'goal_relevant_data' : 'text_data' };
    }

    return { type: null, rule: null };
  }

  function buildStageNode(
    el: Element,
    goalPat: RegExp | null,
    cache?: Map<string, number>,
    shadowHost?: Element | null,
    inShadow = false,
  ): StagedNode | null {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    if (tag === 'input' && normalizeText(el.getAttribute('type')) === 'hidden') return null;

    const attrs = {
      placeholder: normalizeText(el.getAttribute('placeholder')) || undefined,
      ariaLabel: normalizeText(el.getAttribute('aria-label')) || undefined,
      name: normalizeText(el.getAttribute('name')) || undefined,
      href: normalizeText(el.getAttribute('href')) || undefined,
      inputType: normalizeText(el.getAttribute('type')) || undefined,
      role: normalizeText(el.getAttribute('role')) || undefined,
      dataTestId: normalizeText(el.getAttribute('data-testid') ?? el.getAttribute('data-test')) || undefined,
    };
    const text = getElementText(el, tag);
    const formValue = getElementFormValue(el, tag);
    const primaryValue = (
      text
      || formValue
      || attrs.placeholder
      || attrs.ariaLabel
      || attrs.name
      || attrs.href
      || ''
    ).slice(0, 200);
    if (!primaryValue && !attrs.role) return null;

    const visibility = assessVisibility(el);
    const goalScore = scoreGoalFit(goalPat, [
      primaryValue,
      attrs.placeholder,
      attrs.ariaLabel,
      attrs.name,
      attrs.href,
      attrs.role,
    ]);
    const wrappedControl = hasFormControlDescendant(el, 2);
    const searchIndicator = hasSearchIndicator(el, attrs);
    const interactionKind = getInteractionKind(el, tag, attrs.role, wrappedControl);
    const interactionScore = computeInteractionScore(el, tag, visibility, attrs, text, formValue, interactionKind, wrappedControl, searchIndicator);
    const actionabilityScore = computeActionabilityScore(visibility, interactionKind);
    const confidence = deriveConfidence(
      getSelectorScore(el, cache, shadowHost),
      interactionScore,
      actionabilityScore,
      visibility.state,
    );
    const classification = classifyNode(el, tag, visibility, interactionScore, actionabilityScore, interactionKind, primaryValue, goalScore, text);
    if (!classification.type || !classification.rule) return null;

    const sel = getSelector(el, cache, shadowHost);
    const selType = getSelectorSource(el, cache, shadowHost);
    const selectorScore = getSelectorScore(el, cache, shadowHost);
    const regionSelector = getRegionSelector(el, cache, shadowHost);
    const totalScore =
      goalScore * 4
      + interactionScore * 2
      + actionabilityScore * 2
      + selectorScore * 1.5
      + (visibility.state === 'visible' ? 18 : 6)
      + (confidence === 'high' ? 12 : confidence === 'medium' ? 4 : -8)
      - (inShadow ? 10 : 0)
      + (classification.type === 'input' ? 10 : classification.type === 'trigger' ? 8 : 0);

    return {
      type: classification.type,
      tag,
      value: primaryValue,
      sel,
      selType,
      rule: classification.rule,
      attrs,
      meta: {
        nodeId: buildNodeId(sel, tag, interactionKind, primaryValue),
        selectorScore,
        interactionScore,
        actionabilityScore,
        interactionKind,
        confidence,
        enrichmentState: 'base',
        visibility: visibility.state,
        goalScore,
        regionSelector,
        disabled: visibility.disabled || undefined,
        shadow: inShadow || undefined,
        role: attrs.role,
        selectorSource: selType,
      },
      totalScore,
    };
  }

  function pushChildren(container: ParentNode, stack: TraversalEntry[], inShadow: boolean, shadowHost: Element | null): void {
    const children = Array.from(container.children);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ element: children[i]!, inShadow, shadowHost });
    }
  }

  try {
    const origFetch = window.fetch.bind(window);
    (window as any).fetch = async function(...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? 'unknown';
      const startTs = Date.now();
      addPending({ type: 'fetch', detail: url, timestamp: startTs });
      const result = origFetch(...args);
      result.then(() => sampleRTT(url, startTs), () => sampleRTT(url, startTs));
      return result;
    };
  } catch (e) {
    console.warn('[browsegent] fetch hook failed:', e);
  }

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
  } catch (e) {
    console.warn('[browsegent] XHR hook failed:', e);
  }

  try {
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      addPending({ type: 'click', detail: getSelector(target), timestamp: Date.now() });
    }, true);
  } catch (e) {
    console.warn('[browsegent] click hook failed:', e);
  }

  try {
    let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('scroll', () => {
      if (scrollDebounce) clearTimeout(scrollDebounce);
      scrollDebounce = setTimeout(() => {
        addPending({ type: 'scroll', detail: `scrollY:${Math.round(window.scrollY)}`, timestamp: Date.now() });
      }, 50);
    }, { passive: true });
  } catch (e) {
    console.warn('[browsegent] scroll hook failed:', e);
  }

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
  } catch (e) {
    console.warn('[browsegent] SPA nav hook failed:', e);
  }

  function buildChain(ts: number): any {
    if (!pageInitComplete) {
      return { initiator: 'page-init', transport: null, confidence: 'high', windowMs: 0, unknownReason: undefined };
    }

    const candidates = pending.filter(cause => ts - cause.timestamp >= 0 && ts - cause.timestamp <= calibratedMax);
    if (!candidates.length) {
      const swActive = !!navigator.serviceWorker?.controller;
      return {
        initiator: 'unknown',
        transport: null,
        confidence: 'low',
        windowMs: 0,
        unknownReason: swActive ? 'service_worker' : 'no_pending_causes',
      };
    }

    const click = candidates.find(cause => cause.type === 'click');
    const net = candidates.find(cause => cause.type === 'fetch' || cause.type === 'xhr');
    const timer = candidates.find(cause => cause.type === 'timer');
    const scroll = candidates.find(cause => cause.type === 'scroll');

    if (click && net) {
      const windowMs = ts - net.timestamp;
      return {
        initiator: 'click',
        initiatorDetail: click.detail,
        transport: net.type,
        transportDetail: net.detail,
        confidence: NOISE_FETCH.test(net.detail) ? 'low' : windowMs <= HIGH_WINDOW ? 'high' : 'medium',
        windowMs,
      };
    }
    if (net) {
      const windowMs = ts - net.timestamp;
      return {
        initiator: 'unknown',
        transport: net.type,
        transportDetail: net.detail,
        confidence: NOISE_FETCH.test(net.detail) ? 'low' : windowMs <= HIGH_WINDOW ? 'high' : 'medium',
        windowMs,
      };
    }
    if (scroll) return { initiator: 'scroll', initiatorDetail: scroll.detail, transport: null, confidence: 'medium', windowMs: ts - scroll.timestamp };
    if (timer) return { initiator: 'timer', initiatorDetail: timer.detail, transport: null, confidence: 'medium', windowMs: ts - timer.timestamp };
    if (click) {
      const windowMs = ts - click.timestamp;
      return { initiator: 'click', initiatorDetail: click.detail, transport: 'direct', confidence: windowMs <= HIGH_WINDOW ? 'high' : 'medium', windowMs };
    }
    return { initiator: 'unknown', transport: null, confidence: 'low', windowMs: 0, unknownReason: 'timing_gap' };
  }

  function isNoise(chain: any): boolean {
    return chain.initiator === 'page-init'
      || (chain.confidence === 'low' && chain.unknownReason !== 'service_worker' && NOISE_FETCH.test(chain.transportDetail ?? ''))
      || (chain.initiator === 'click' && NOISE_CLICK.test(chain.initiatorDetail ?? ''));
  }

  try {
    const observeTarget = document.documentElement || document.body;
    if (observeTarget) {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          try {
            const tag = (mutation.target as Element).tagName?.toLowerCase();
            if (SKIP_TAGS.has(tag)) continue;
            const now = Date.now();
            lastMutationTs = now;
            const chain = buildChain(now);
            const noise = isNoise(chain);

            if (mutation.type === 'childList') {
              for (const node of mutation.addedNodes) {
                const el = node.nodeType === 1 ? node as Element : (node as Node).parentElement;
                if (!el) continue;
                const value = normalizeText((el.textContent ?? '').slice(0, 200));
                if (value.length < 3) continue;
                deltas.push({
                  timestamp: now,
                  nodeSelector: getSelector(el),
                  nodeTag: el.tagName?.toLowerCase(),
                  oldValue: '',
                  newValue: value,
                  mutationType: 'added',
                  chain,
                  isNoise: noise,
                });
                if (deltas.length > MAX_DELTAS) deltas.shift();
              }
            }

            if (mutation.type === 'characterData') {
              const newValue = normalizeText((mutation.target.textContent ?? '').slice(0, 200));
              const oldValue = normalizeText((mutation.oldValue ?? '').slice(0, 200));
              if (newValue === oldValue || newValue.length < 2) continue;
              const parent = (mutation.target as Node).parentElement;
              if (!parent) continue;
              deltas.push({
                timestamp: now,
                nodeSelector: getSelector(parent),
                nodeTag: parent.tagName?.toLowerCase(),
                oldValue,
                newValue,
                mutationType: 'textChanged',
                chain,
                isNoise: noise,
              });
              if (deltas.length > MAX_DELTAS) deltas.shift();
            }
          } catch {
            // Best-effort mutation capture.
          }
        }
      }).observe(observeTarget, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true,
        attributeFilter: ['value', 'placeholder', 'aria-label', 'data-price'],
      });
    } else {
      console.warn('[browsegent] No observe target at document_start; mutation observer skipped');
    }
  } catch (e) {
    console.warn('[browsegent] MutationObserver setup failed:', e);
  }

  function brain1Scan(rootEl: Element, goalText: string): any {
    const start = performance.now();
    const stack: TraversalEntry[] = [{ element: rootEl, inShadow: false, shadowHost: null }];
    const candidates: StagedNode[] = [];
    const selectorCache = new Map<string, number>();
    const goalPat = buildGoalPatterns(goalText);
    const rulesTriggered: Record<string, number> = {};
    const selectorTypes: Record<string, number> = {};
    const errors: string[] = [];
    let walked = 0;
    let shadowDomCount = 0;

    try {
      while (stack.length && walked < MAX_NODES) {
        const entry = stack.pop()!;
        const el = entry.element;
        if (!el?.tagName) continue;
        walked++;

        const candidate = buildStageNode(el, goalPat, selectorCache, entry.shadowHost, entry.inShadow);
        if (candidate) candidates.push(candidate);

        const shadowRoot = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (shadowRoot) {
          shadowDomCount++;
          pushChildren(shadowRoot, stack, true, el);
        }
        pushChildren(el, stack, entry.inShadow, entry.shadowHost);
      }
    } catch (err) {
      errors.push(String(err));
    }

    candidates.sort((left, right) => right.totalScore - left.totalScore);

    const bucketCounts: Record<OutputNodeType, number> = {
      input: 0,
      trigger: 0,
      data: 0,
      table_cell: 0,
    };
    let emitted = 0;

    const nodes = candidates.filter(node => {
      if (emitted >= MAX_OUTPUT_NODES) return false;
      if (bucketCounts[node.type] >= TYPE_CAPS[node.type]) return false;
      bucketCounts[node.type]++;
      emitted++;
      rulesTriggered[node.rule] = (rulesTriggered[node.rule] ?? 0) + 1;
      selectorTypes[node.selType] = (selectorTypes[node.selType] ?? 0) + 1;
      return true;
    }).map(node => ({
      type: node.type,
      tag: node.tag,
      value: node.value,
      sel: node.sel,
      selType: node.selType,
      rule: node.rule,
      attrs: node.attrs,
      meta: node.meta,
    }));

    return {
      nodes,
      metrics: {
        totalNodesWalked: walked,
        nodesKept: nodes.length,
        nodesDropped: Math.max(0, walked - nodes.length),
        walkTimeMs: performance.now() - start,
        shadowDomCount,
        rulesTriggered,
        selectorTypes,
      },
      errors,
    };
  }

  (window as any).__browsegent_brain1 = function(rootEl: Element, goalText?: string) {
    return brain1Scan(rootEl ?? document.body, goalText ?? goal);
  };

  (window as any).__browsegent_brain1_region = function(regionSelector: string, goalText?: string) {
    let regionRoot: Element | null = null;
    try {
      regionRoot = document.querySelector(regionSelector);
    } catch {
      regionRoot = null;
    }
    return brain1Scan(regionRoot ?? document.body, goalText ?? goal);
  };

  (window as any).__browsegent_brain2 = {
    getDeltas: () => deltas.slice(),
    clearDeltas: () => { deltas.length = 0; },
    getPending: () => pending.slice(),
    isReady: () => pageInitComplete,
    getCalibration: () => ({ samples: rttSamples, calibratedMax }),
    disconnect: () => {},
    recordClick: (selector: string) => {
      addPending({ type: 'click', detail: selector, timestamp: Date.now() });
    },
    getCalibratedMax: () => calibratedMax,
    getRttSamples: () => rttSamples.slice(),
  };

  console.log('[browsegent] Content script loaded (MAIN world, document_start)');
})();
