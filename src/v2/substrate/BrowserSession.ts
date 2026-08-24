import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import type { BrowserSessionOptions } from './types';

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

  async open(url: string): Promise<void> {
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
