import type { Page } from 'playwright';

import type { BrowserRuntimeState } from '../executor/types';

const CAPTURE_RUNTIME_STATE_FN = new Function('selector', `
  const normalizeText = (value, limit = 200) =>
    (value ?? '').trim().replace(/\\s+/g, ' ').slice(0, limit);

  const safeQuery = (candidate) => {
    if (!candidate) return null;
    try {
      return document.querySelector(candidate);
    } catch {
      return null;
    }
  };

  const describeElement = (node) => {
    if (!node) return undefined;
    const parts = [node.tagName.toLowerCase()];
    const id = node.getAttribute('id')?.trim();
    if (id) parts.push('#' + id.slice(0, 40));
    const name = node.getAttribute('name')?.trim();
    if (name) parts.push('[name="' + name.slice(0, 40) + '"]');
    const aria = node.getAttribute('aria-label')?.trim();
    if (aria) parts.push('[aria-label="' + aria.slice(0, 40) + '"]');
    const role = node.getAttribute('role')?.trim();
    if (role) parts.push('[role="' + role.slice(0, 20) + '"]');
    return parts.join('');
  };

  const targetEl = safeQuery(selector);
  const targetValue =
    targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement || targetEl instanceof HTMLSelectElement
      ? normalizeText(targetEl.value)
      : targetEl && targetEl.isContentEditable
        ? normalizeText(targetEl.textContent)
        : normalizeText(targetEl?.textContent);

  const snapshotText = normalizeText(
    document.body?.innerText ?? document.documentElement?.textContent ?? '',
    400,
  );
  let textHash = 0;
  for (let i = 0; i < snapshotText.length; i++) {
    textHash = ((textHash << 5) - textHash + snapshotText.charCodeAt(i)) | 0;
  }

  const interactiveCount = document.querySelectorAll(
    'a,button,input,select,textarea,[role],[tabindex],[contenteditable=""],[contenteditable="true"]',
  ).length;

  return {
    url: location.href,
    baseUrl: location.origin + location.pathname + location.search,
    hash: location.hash ?? '',
    scrollX: Math.round(window.scrollX ?? 0),
    scrollY: Math.round(window.scrollY ?? 0),
    focusKey: describeElement(document.activeElement instanceof Element ? document.activeElement : null),
    targetFound: !!targetEl,
    targetValue: targetEl ? targetValue : undefined,
    domSignature: [
      normalizeText(document.title, 80),
      document.body?.childElementCount ?? 0,
      interactiveCount,
      textHash,
    ].join('|'),
  };
`) as (selector?: string) => BrowserRuntimeState;

export async function capturePageRuntimeState(page: Page, target?: string): Promise<BrowserRuntimeState> {
  return page.evaluate(CAPTURE_RUNTIME_STATE_FN, target);
}
