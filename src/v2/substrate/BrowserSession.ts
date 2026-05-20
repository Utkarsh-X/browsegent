import { chromium, type Browser, type Page } from 'playwright';

import type { BrowserSessionOptions } from './types';

export class BrowserSession {
  private browser?: Browser;
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
    }

    this.page = await this.browser.newPage({ viewport: this.options.viewport });
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
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

    const browser = this.browser;
    this.browser = undefined;
    if (browser) {
      await browser.close();
    }
  }
}
