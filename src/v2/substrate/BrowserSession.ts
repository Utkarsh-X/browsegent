import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { BrowserSessionOptions } from './types';

/**
 * Stealth launch (T1, probe-validated): persistent profile + --headless=new +
 * AutomationControlled disabled + coherent binary-derived UA. The probe cleared
 * Allrecipes and Google headless under this config where the plain launch was
 * walled. Opt-in via BROWSEGENT_STEALTH=1; unset keeps the legacy launch
 * byte-for-byte. Profile persists across the whole suite so any warm-up cost
 * amortizes to zero per task.
 *
 * UA is derived from the launched binary (never hardcoded — versions decay):
 * the native headless UA carries a HeadlessChrome token, which is the measured
 * Allrecipes/Google wall trigger; replacing it with Chrome while leaving
 * everything else native keeps UA, sec-ch-ua and navigator.userAgentData
 * pointing at the same binary version. No extraHTTPHeaders overrides: native
 * client hints are already coherent, and injected ones are partially ignored.
 */

let coherentUserAgentPromise: Promise<string> | undefined;

function coherentUserAgent(): Promise<string> {
  coherentUserAgentPromise ??= (async () => {
    const bootstrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-ua-'));
    try {
      const probe = await chromium.launchPersistentContext(bootstrapDir, {
        headless: false,
        args: ['--headless=new'],
      });
      try {
        const page = probe.pages()[0] ?? await probe.newPage();
        const native = await page.evaluate(() => navigator.userAgent);
        return native.replace('HeadlessChrome', 'Chrome');
      } finally {
        await probe.close().catch(() => undefined);
      }
    } finally {
      fs.rmSync(bootstrapDir, { recursive: true, force: true });
    }
  })();
  return coherentUserAgentPromise;
}

function stealthEnabled(): boolean {
  return process.env.BROWSEGENT_STEALTH?.trim() === '1';
}

function stealthProfileDir(): string {
  return process.env.BROWSEGENT_STEALTH_PROFILE?.trim() || path.resolve('logs', 'stealth-profile');
}

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly options: Required<BrowserSessionOptions>;

  constructor(options: BrowserSessionOptions = {}) {
    this.options = {
      headed: options.headed ?? true,
      viewport: options.viewport ?? { width: 1280, height: 720 },
    };
  }

  /**
   * One launch attempt of the stealth persistent context. Verifies the browser
   * actually came up and the acquired page is live: run-23 telemetry showed
   * Chromium processes dying at/near launch (profile exit_type "Crashed",
   * 40-114s stuck startups), which previously surfaced as confusing downstream
   * "no active page" errors instead of a precise launch failure.
   */
  private async launchStealthAttempt(): Promise<{ context: BrowserContext; page: Page }> {
    const profileDir = stealthProfileDir();
    fs.mkdirSync(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: [
        ...(!this.options.headed ? ['--headless=new'] : ['--window-position=50,50']),
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        // Slightly larger than the viewport so innerWidth/outerWidth differ,
        // as on a real browser (headless otherwise reports inner==outer).
        `--window-size=${this.options.viewport.width + 84},${this.options.viewport.height + 132}`,
      ],
      viewport: this.options.viewport,
      userAgent: await coherentUserAgent(),
      locale: 'en-US',
    });
    try {
      const pages = context.pages().filter(p => !p.isClosed());
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      if (page.isClosed()) throw new Error('acquired page is already closed');
      if (this.options.headed) {
        await page.bringToFront().catch(() => undefined);
      }
      await this.installSettlementSampler(page).catch(() => undefined);
      return { context, page };
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  /** Launch with one self-healing retry (transient crashes, stale profile locks). */
  private async openStealthContext(): Promise<{ context: BrowserContext; page: Page }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.launchStealthAttempt();
      } catch (error) {
        lastError = error;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`stealth_launch_failed after retry: ${detail}`);
  }

  /** goto with the legacy 3-attempt loop; a page that dies mid-load fails fast. */
  private async gotoWithRetry(page: Page, url: string): Promise<void> {
    let attempts = 0;
    while (attempts < 3) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        return;
      } catch (error) {
        if (page.isClosed()) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`page closed while loading ${url}: ${detail}`);
        }
        attempts += 1;
        if (attempts >= 3) throw error;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /** open() must either deliver a live page or throw precisely — never resolve broken. */
  private assertLivePage(source: string): void {
    if (!this.page || this.page.isClosed()) {
      throw new Error(`${source} open() finished without a live page`);
    }
  }

  private async openStealth(url: string): Promise<void> {
    const launched = await this.openStealthContext();
    this.context = launched.context;
    this.page = launched.page;
    await this.gotoWithRetry(launched.page, url);
  }

  async open(url: string): Promise<void> {
    if (stealthEnabled()) {
      if (this.page) {
        await this.page.close().catch(() => undefined);
        this.page = undefined;
      }
      // Reuse the persistent context across tasks: the profile's cookie trust
      // is the point. Closed only via close().
      if (!this.context) {
        await this.openStealth(url);
        this.assertLivePage('stealth');
        return;
      }
      // Context reuse (in-task navigate): secure a live page on the existing
      // context; if the context died underneath us, rebuild from scratch.
      let page: Page;
      try {
        page = await this.context.newPage();
        if (page.isClosed()) throw new Error('new page closed immediately');
        if (this.options.headed) {
          await page.bringToFront().catch(() => undefined);
        }
        await this.installSettlementSampler(page).catch(() => undefined);
      } catch {
        this.page = undefined;
        const dead = this.context;
        this.context = undefined;
        await dead.close().catch(() => undefined);
        await this.openStealth(url);
        this.assertLivePage('stealth');
        return;
      }
      this.page = page;
      await this.gotoWithRetry(page, url);
      this.assertLivePage('stealth');
      return;
    }

    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: !this.options.headed,
        args: this.options.headed ? ['--window-position=50,50'] : [],
      });
    }

    if (this.page) {
      await this.page.close();
      this.page = undefined;
    }
    if (this.context) {
      await this.context.close();
      this.context = undefined;
    }

    // Opt-in authenticated sessions: benchmark runs against WebArena need the
    // official storage states (require_login tasks). Unset env var keeps the
    // previous behavior byte-for-byte.
    const storageStatePath = process.env.BROWSEGENT_STORAGE_STATE?.trim();
    if (storageStatePath) {
      this.context = await this.browser.newContext({
        storageState: storageStatePath,
        viewport: this.options.viewport,
      });
      this.page = await this.context.newPage();
    } else {
      this.page = await this.browser.newPage({ viewport: this.options.viewport });
    }
    if (this.options.headed) {
      await this.page.bringToFront().catch(() => undefined);
    }
    await this.installSettlementSampler(this.page).catch(() => undefined);

    let attempts = 0;
    while (attempts < 3) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (error) {
        attempts += 1;
        if (attempts >= 3) throw error;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    this.assertLivePage('legacy');
  }

  /**
   * D3 settlement sampler: records the timestamp of the last DOM mutation so
   * the stabilization service can wait for real quiet instead of a fixed
   * 75 ms guess. Installed as an init script so every navigation re-arms it;
   * failure to install degrades silently to the legacy fixed window.
   */
  private async installSettlementSampler(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const store = window as unknown as { __bgSettle?: { lastMutationTs: number } };
      store.__bgSettle = { lastMutationTs: Date.now() };
      const mark = () => {
        if (store.__bgSettle) store.__bgSettle.lastMutationTs = Date.now();
      };
      const install = () => {
        try {
          const observer = new MutationObserver(mark);
          observer.observe(document.documentElement || document, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
        } catch {
          // Observer unavailable: the fixed window remains the behavior.
        }
      };
      if (document.documentElement) {
        install();
      } else {
        document.addEventListener('DOMContentLoaded', install, { once: true });
      }
    });
  }

  currentPage(): Page {
    if (!this.page) {
      throw new Error('BrowserSession has no active page. Call open(url) first.');
    }
    return this.page;
  }

  async close(): Promise<void> {
    const page = this.page;
    this.page = undefined;
    if (page && !page.isClosed()) {
      await page.close();
    }

    const context = this.context;
    this.context = undefined;
    if (context) {
      await context.close();
    }

    const browser = this.browser;
    this.browser = undefined;
    if (browser) {
      await browser.close();
    }
  }
}
