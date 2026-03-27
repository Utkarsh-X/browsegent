// Executor Actions — pure browser interaction functions
import { jitter, typeDelay, actionSettle } from './stealth';
import { logger } from '../logger';

export type ActionResult = 'ok' | 'not_found' | 'timeout' | 'error';

export interface ActionContext {
  page?: import('playwright').Page;
}

export async function doClick(selector: string, ctx: ActionContext): Promise<ActionResult> {
  try {
    if (ctx.page) {
      const el = await ctx.page.$(selector);
      if (!el) { logger.warn('executor:actions', 'click: not found', { selector }); return 'not_found'; }
      // P0 Fix: record click cause via Brain 2 API before CDP click
      await ctx.page.evaluate((sel) => {
        if ((window as any).__browsegent_brain2?.recordClick) {
          (window as any).__browsegent_brain2.recordClick(sel);
        }
      }, selector);
      await el.click();
      await jitter(100, 300);
      return 'ok';
    } else {
      const el = document.querySelector(selector);
      if (!el) return 'not_found';
      (el as HTMLElement).click();
      await jitter(100, 300);
      return 'ok';
    }
  } catch (err) { logger.error('executor:actions', 'click failed', err); return 'error'; }
}

export async function doType(selector: string, text: string, ctx: ActionContext): Promise<ActionResult> {
  try {
    if (ctx.page) {
      const el = await ctx.page.$(selector);
      if (!el) return 'not_found';
      await el.click();
      await jitter(50, 150);
      for (const char of text) {
        await ctx.page.keyboard.type(char);
        await typeDelay();
      }
      return 'ok';
    } else {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) return 'not_found';
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }
  } catch (err) { logger.error('executor:actions', 'type failed', err); return 'error'; }
}

export async function doScroll(direction: 'down' | 'up', ctx: ActionContext): Promise<ActionResult> {
  try {
    const delta = direction === 'down' ? 600 : -600;
    if (ctx.page) {
      await ctx.page.evaluate((d: number) => window.scrollBy({ top: d, behavior: 'smooth' }), delta);
    } else {
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }
    await actionSettle(400, 800);
    return 'ok';
  } catch (err) { logger.error('executor:actions', 'scroll failed', err); return 'error'; }
}

export async function doGetValue(selector: string, ctx: ActionContext): Promise<string> {
  try {
    if (ctx.page) {
      return await ctx.page.$eval(selector, (el: Element) =>
        (el as HTMLInputElement).value || el.textContent?.trim() || ''
      ) ?? '';
    } else {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      return el?.value || el?.textContent?.trim() || '';
    }
  } catch (err) { logger.error('executor:actions', 'getValue failed', err); return ''; }
}

export async function doCloseModal(selector: string, ctx: ActionContext): Promise<ActionResult> {
  try {
    if (ctx.page) {
      const el = await ctx.page.$(selector);
      if (!el) return 'not_found';
      await el.click();
      await jitter(200, 400);
      return 'ok';
    } else {
      const el = document.querySelector(selector);
      if (!el) return 'not_found';
      (el as HTMLElement).click();
      return 'ok';
    }
  } catch (err) { logger.error('executor:actions', 'closeModal failed', err); return 'error'; }
}

export async function doSelectOption(selector: string, value: string, ctx: ActionContext): Promise<ActionResult> {
  try {
    if (ctx.page) {
      await ctx.page.selectOption(selector, value);
      await jitter(100, 200);
      return 'ok';
    } else {
      const el = document.querySelector(selector) as HTMLSelectElement | null;
      if (!el) return 'not_found';
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    }
  } catch (err) { logger.error('executor:actions', 'selectOption failed', err); return 'error'; }
}
