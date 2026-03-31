import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * Manages a single shared Chromium instance with a pool of reusable pages.
 * Avoids spinning up a new browser per page — one process handles all rendering.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private availablePages: Page[] = [];
  private maxPages: number;

  constructor(maxPages = 4) {
    this.maxPages = maxPages;
  }

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      // Disable images/media for speed — we only need the DOM
      javaScriptEnabled: true,
      bypassCSP: true,
    });
  }

  async acquirePage(): Promise<Page> {
    await this.init();
    const page = this.availablePages.pop();
    if (page) return page;
    return this.context!.newPage();
  }

  releasePage(page: Page): void {
    if (this.availablePages.length < this.maxPages) {
      this.availablePages.push(page);
    } else {
      page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    for (const page of this.availablePages) {
      await page.close().catch(() => {});
    }
    this.availablePages = [];
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }
}
