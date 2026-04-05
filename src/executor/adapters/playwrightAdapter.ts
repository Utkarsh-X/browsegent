import type { ElementHandle, Page } from 'playwright';
import { AdapterError } from '../browserAdapter';
import type { BrowserAdapter } from '../browserAdapter';
import type { BrowserRuntimeState } from '../types';
import { capturePageRuntimeState } from './runtimeState';
import {
  countElementsSummary,
  findElementsSummary,
  inspectRegionSummary,
  searchPageText,
} from './readTools';

function classifyPlaywrightError(err: unknown): AdapterError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes('timeout')) return new AdapterError('timeout', message, 'playwright');
  if (lower.includes('not visible') || lower.includes('not enabled') || lower.includes('not editable')) {
    return new AdapterError('not_interactable', message, 'playwright');
  }
  return new AdapterError('execution_error', message, 'playwright');
}

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  readonly runtime = 'playwright' as const;

  constructor(private readonly page?: Page) {}

  async isAvailable(): Promise<boolean> {
    return !!this.page;
  }

  async captureState(target?: string): Promise<BrowserRuntimeState> {
    const page = this.requirePage();
    return capturePageRuntimeState(page, target);
  }

  async click(target: string): Promise<void> {
    const el = await this.waitForElement(target);
    try {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click();
    } catch (err) {
      throw classifyPlaywrightError(err);
    }
  }

  async type(target: string, input: string, opts?: { clear: boolean }): Promise<void> {
    const page = this.requirePage();
    await this.waitForElement(target);
    try {
      const locator = page.locator(target).first();
      await locator.click();
      if (opts?.clear ?? true) {
        await locator.fill('');
      }
      await page.keyboard.type(input);
    } catch (err) {
      throw classifyPlaywrightError(err);
    }
  }

  async scroll(direction: 'down' | 'up'): Promise<void> {
    const page = this.requirePage();
    try {
      await page.evaluate((dir: 'down' | 'up') => {
        const delta = dir === 'down' ? 600 : -600;
        window.scrollBy({ top: delta, behavior: 'smooth' });
      }, direction);
    } catch (err) {
      throw classifyPlaywrightError(err);
    }
  }

  async readValue(target: string): Promise<{ found: boolean; value: string }> {
    const page = this.requirePage();
    const el = await this.tryWaitForElement(target);
    if (!el) return { found: false, value: '' };
    try {
      const value = await page.$eval(target, (node: Element) =>
        (node as HTMLInputElement).value || node.textContent?.trim() || ''
      );
      return { found: true, value: value ?? '' };
    } catch (err) {
      throw classifyPlaywrightError(err);
    }
  }

  async searchPage(pattern: string, scopeSelector?: string): Promise<string> {
    const page = this.requirePage();
    return searchPageText(page, pattern, scopeSelector);
  }

  async findElements(selector: string): Promise<string> {
    const page = this.requirePage();
    return findElementsSummary(page, selector);
  }

  async countElements(selector: string): Promise<string> {
    const page = this.requirePage();
    return countElementsSummary(page, selector);
  }

  async inspectRegion(selector: string): Promise<string> {
    const page = this.requirePage();
    return inspectRegionSummary(page, selector);
  }

  async selectOption(target: string, option: string): Promise<void> {
    const page = this.requirePage();
    await this.waitForElement(target);
    try {
      await page.selectOption(target, option);
    } catch (err) {
      throw classifyPlaywrightError(err);
    }
  }

  async waitForPattern(pattern: string, timeoutMs: number): Promise<boolean> {
    const page = this.requirePage();
    try {
      await page.waitForFunction(
        (source) => {
          const text = document.body?.innerText ?? document.documentElement?.textContent ?? '';
          try {
            return new RegExp(source, 'i').test(text);
          } catch {
            return text.toLowerCase().includes(source.toLowerCase());
          }
        },
        pattern,
        { timeout: timeoutMs },
      );
      return true;
    } catch {
      return false;
    }
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

  private async waitForElement(target: string, timeout = 2000): Promise<ElementHandle<SVGElement | HTMLElement>> {
    const el = await this.tryWaitForElement(target, timeout);
    if (!el) {
      throw new AdapterError('not_found', `Element not found: ${target}`, this.runtime);
    }
    return el;
  }

  private async tryWaitForElement(target: string, timeout = 2000): Promise<ElementHandle<SVGElement | HTMLElement> | null> {
    const page = this.requirePage();
    try {
      const el = await page.waitForSelector(target, { timeout, state: 'attached' });
      return el;
    } catch (err) {
      if (String(err).toLowerCase().includes('timeout')) {
        return null;
      }
      throw classifyPlaywrightError(err);
    }
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new AdapterError('unsupported_runtime', 'Playwright adapter requires a Playwright page', this.runtime);
    }
    return this.page;
  }
}
