import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';

import type { BrowserSessionOptions } from './types';

/**
 * Stealth launch (T1, probe-validated): persistent profile + --headless=new +
 * AutomationControlled disabled + consistent client hints. The probe cleared
 * Allrecipes and Google headless under this config where the plain launch was
 * walled. Opt-in via BROWSEGENT_STEALTH=1; unset keeps the legacy launch
 * byte-for-byte. Profile persists across the whole suite so any warm-up cost
 * amortizes to zero per task.
 */
const STEALTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

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

  private async openStealth(url: string): Promise<void> {
    const profileDir = stealthProfileDir();
    fs.mkdirSync(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: [
        ...(!this.options.headed ? ['--headless=new'] : []),
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        `--window-size=${this.options.viewport.width},${this.options.viewport.height}`,
      ],
      viewport: this.options.viewport,
      userAgent: STEALTH_UA,
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="134", "Google Chrome";v="134", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });
    this.context = context;
    const pages = context.pages();
    this.page = pages.length > 0 ? pages[0] : await context.newPage();
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
        return;
      }
      await this.installSettlementSampler(this.page!).catch(() => undefined);
      let attempts = 0;
      while (attempts < 3) {
        try {
          await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          break;
        } catch (error) {
          attempts += 1;
          if (attempts >= 3) throw error;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      return;
    }

    if (!this.browser) {
      this.browser = await chromium.launch({ headless: !this.options.headed });
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
