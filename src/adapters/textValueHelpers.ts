import type { Page } from 'playwright';
import type { ActionErrorCode } from '../executor/types';

type TextErrorCode = Extract<ActionErrorCode, 'not_found' | 'not_interactable' | 'execution_error'>;

export interface TextSetResult {
  ok: boolean;
  code?: TextErrorCode;
  message?: string;
}

export interface TextReadResult {
  found: boolean;
  value: string;
}

const SET_TEXT_VALUE_SCRIPT = String.raw`([targetSelector, targetValue, shouldClear]) => {
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isEditableCandidate = (el) => {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.disabled || el.readOnly) {
        return false;
      }
      return true;
    }

    if (el.isContentEditable) {
      return true;
    }

    const role = (el.getAttribute('role') ?? '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      const ariaDisabled = (el.getAttribute('aria-disabled') ?? '').toLowerCase() === 'true';
      const ariaReadonly = (el.getAttribute('aria-readonly') ?? '').toLowerCase() === 'true';
      return !ariaDisabled && !ariaReadonly;
    }

    return false;
  };

  const walkEditableDescendant = (root) => {
    const queue = [root];
    const seen = new Set();
    let fallback = null;

    while (queue.length > 0 && seen.size < 320) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (isEditableCandidate(current)) {
        if (isVisible(current)) {
          return current;
        }
        if (!fallback) {
          fallback = current;
        }
      }

      if (current instanceof HTMLElement && current.shadowRoot) {
        queue.push(...Array.from(current.shadowRoot.children));
      }

      queue.push(...Array.from(current.children));
    }

    return fallback;
  };

  const dispatchInputEvents = (el, nextValue) => {
    try {
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: nextValue,
        inputType: 'insertText',
      });
      el.dispatchEvent(inputEvent);
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const setHostValue = (el, nextValue) => {
    try {
      if (!('value' in el)) {
        return false;
      }
      el.value = nextValue;
      dispatchInputEvents(el, nextValue);
      return true;
    } catch {
      return false;
    }
  };

  const setEditableValue = (el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (shouldClear && setter) {
        setter.call(el, '');
      } else if (shouldClear) {
        el.value = '';
      }

      if (setter) {
        setter.call(el, targetValue);
      } else {
        el.value = targetValue;
      }
      dispatchInputEvents(el, targetValue);
      return true;
    }

    if (el.isContentEditable) {
      if (shouldClear) {
        el.textContent = '';
      }
      el.textContent = targetValue;
      dispatchInputEvents(el, targetValue);
      return true;
    }

    const role = (el.getAttribute('role') ?? '').toLowerCase();
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      if (shouldClear) {
        el.textContent = '';
      }
      el.textContent = targetValue;
      dispatchInputEvents(el, targetValue);
      return true;
    }

    return false;
  };

  let host = null;
  try {
    host = document.querySelector(targetSelector);
  } catch (error) {
    return {
      ok: false,
      code: 'execution_error',
      message: 'Invalid selector: ' + targetSelector + ' (' + String(error) + ')',
    };
  }

  if (!host || !(host instanceof HTMLElement)) {
    return {
      ok: false,
      code: 'not_found',
      message: 'Element not found: ' + targetSelector,
    };
  }

  const editable = walkEditableDescendant(host);
  const target = editable ?? host;

  try {
    target.focus();
  } catch {
    // Best effort only.
  }

  const edited = setEditableValue(target) || setHostValue(target, targetValue);
  if (edited) {
    if (target !== host) {
      setHostValue(host, targetValue);
    }
    return { ok: true };
  }

  if (target !== host && setHostValue(host, targetValue)) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'not_interactable',
    message: 'Element does not accept text and has no editable descendant: ' + targetSelector,
  };
}`;

const READ_TEXT_VALUE_SCRIPT = String.raw`(targetSelector) => {
  const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();

  const isEditableCandidate = (el) => {
    if (!(el instanceof HTMLElement)) {
      return false;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return true;
    }
    if (el.isContentEditable) {
      return true;
    }
    const role = (el.getAttribute('role') ?? '').toLowerCase();
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  };

  const walkEditableDescendant = (root) => {
    const queue = [root];
    const seen = new Set();

    while (queue.length > 0 && seen.size < 320) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (isEditableCandidate(current)) {
        return current;
      }

      if (current instanceof HTMLElement && current.shadowRoot) {
        queue.push(...Array.from(current.shadowRoot.children));
      }
      queue.push(...Array.from(current.children));
    }

    return null;
  };

  const readValue = (el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return normalize(el.value);
    }
    if ('value' in el && typeof el.value === 'string') {
      return normalize(el.value);
    }
    return normalize(el.textContent);
  };

  let host = null;
  try {
    host = document.querySelector(targetSelector);
  } catch {
    return { found: false, value: '' };
  }

  if (!host || !(host instanceof HTMLElement)) {
    return { found: false, value: '' };
  }

  const editable = walkEditableDescendant(host);
  if (editable) {
    const value = readValue(editable);
    if (value) {
      return { found: true, value };
    }
  }

  const hostValue = readValue(host);
  return { found: true, value: hostValue };
}`;

function buildPageExpression(script: string, arg: unknown): string {
  return `(${script})(${JSON.stringify(arg)})`;
}

export async function setTextValueWithFallback(
  page: Page,
  selector: string,
  value: string,
  clear: boolean,
): Promise<TextSetResult> {
  const expression = buildPageExpression(SET_TEXT_VALUE_SCRIPT, [selector, value, clear]);
  return page.evaluate(expression);
}

export async function readTextValueWithFallback(page: Page, selector: string): Promise<TextReadResult> {
  const expression = buildPageExpression(READ_TEXT_VALUE_SCRIPT, selector);
  return page.evaluate(expression);
}
