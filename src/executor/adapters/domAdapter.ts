import type { Page } from 'playwright';
import { AdapterError } from '../browserAdapter';
import type { BrowserAdapter } from '../browserAdapter';
import type { BrowserRuntimeState } from '../types';
import { capturePageRuntimeState } from './runtimeState';

type DomActionResult<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; code: 'not_found' | 'not_interactable' | 'timeout' | 'execution_error'; message: string };

function compilePatternMatcher(pattern: string): { mode: 'regex' | 'text'; pattern: string } {
  try {
    new RegExp(pattern, 'i');
    return { mode: 'regex', pattern };
  } catch {
    return { mode: 'text', pattern };
  }
}

async function runDomResult<T>(page: Page, fn: () => Promise<DomActionResult<T>>): Promise<T> {
  const result = await fn();
  if (!result.ok) {
    throw new AdapterError(result.code, result.message, 'dom');
  }
  return result.value as T;
}

export class DomBrowserAdapter implements BrowserAdapter {
  readonly runtime = 'dom' as const;

  constructor(private readonly page?: Page) {}

  async isAvailable(): Promise<boolean> {
    if (!this.page) return false;
    return this.page.evaluate(() => typeof document !== 'undefined').catch(() => false);
  }

  async captureState(target?: string): Promise<BrowserRuntimeState> {
    const page = this.requirePage();
    return capturePageRuntimeState(page, target);
  }

  async click(target: string): Promise<void> {
    const page = this.requirePage();
    await runDomResult(page, () =>
      page.evaluate((selector): DomActionResult => {
        let el: HTMLElement | null = null;
        try {
          el = document.querySelector(selector) as HTMLElement | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return { ok: false, code: 'not_interactable', message: `Element not interactable: ${selector}` };
        }
        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          el.click();
          return { ok: true };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, target),
    );
  }

  async type(target: string, input: string, opts?: { clear: boolean }): Promise<void> {
    const page = this.requirePage();
    await runDomResult(page, () =>
      page.evaluate(([selector, value, clear]): DomActionResult => {
        let el: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
        try {
          el = document.querySelector(selector) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLElement
          | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return { ok: false, code: 'not_interactable', message: `Element not interactable: ${selector}` };
        }
        try {
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto = el instanceof HTMLInputElement
              ? HTMLInputElement.prototype
              : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (clear && setter) setter.call(el, '');
            if (setter) setter.call(el, value);
            else (el as HTMLInputElement).value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }
          if (el.isContentEditable) {
            if (clear) el.textContent = '';
            el.textContent = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }
          return { ok: false, code: 'not_interactable', message: `Element does not accept text: ${selector}` };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, [target, input, opts?.clear ?? true] as const),
    );
  }

  async scroll(direction: 'down' | 'up'): Promise<void> {
    const page = this.requirePage();
    await page.evaluate((dir: 'down' | 'up') => {
      const delta = dir === 'down' ? 600 : -600;
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }, direction);
  }

  async readValue(target: string): Promise<{ found: boolean; value: string }> {
    const page = this.requirePage();
    return page.evaluate((selector) => {
      let el: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;
      try {
        el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      } catch {
        return { found: false, value: '' };
      }
      if (!el) return { found: false, value: '' };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return { found: true, value: el.value ?? '' };
      }
      return { found: true, value: el.textContent?.trim() ?? '' };
    }, target);
  }

  async selectOption(target: string, option: string): Promise<void> {
    const page = this.requirePage();
    await runDomResult(page, () =>
      page.evaluate(([selector, value]): DomActionResult => {
        let el: HTMLSelectElement | null = null;
        try {
          el = document.querySelector(selector) as HTMLSelectElement | null;
        } catch (err) {
          return { ok: false, code: 'execution_error', message: `Invalid selector: ${selector} (${String(err)})` };
        }
        if (!el) return { ok: false, code: 'not_found', message: `Element not found: ${selector}` };
        try {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        } catch (err) {
          return { ok: false, code: 'execution_error', message: String(err) };
        }
      }, [target, option] as const),
    );
  }

  async waitForPattern(pattern: string, timeoutMs: number): Promise<boolean> {
    const page = this.requirePage();
    const matcher = compilePatternMatcher(pattern);
    return page.waitForFunction(
      ([mode, source]) => {
        const text = document.body?.innerText ?? document.documentElement?.textContent ?? '';
        if (mode === 'regex') {
          return new RegExp(source, 'i').test(text);
        }
        return text.toLowerCase().includes(source.toLowerCase());
      },
      [matcher.mode, matcher.pattern] as const,
      { timeout: timeoutMs },
    ).then(() => true).catch(() => false);
  }

  async sleep(timeoutMs: number): Promise<void> {
    const page = this.requirePage();
    await page.waitForTimeout(timeoutMs);
  }

  async recordClickCause(target: string): Promise<void> {
    const page = this.requirePage();
    await page.evaluate((selector) => {
      if ((window as any).__browsegent_brain2?.recordClick) {
        (window as any).__browsegent_brain2.recordClick(selector);
      }
    }, target).catch(() => {});
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new AdapterError('unsupported_runtime', 'DOM adapter requires a Playwright page', this.runtime);
    }
    return this.page;
  }
}
