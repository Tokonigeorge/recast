import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/** Single shared Chromium instance with a pool of reusable pages. */
export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private initPromise: Promise<void> | null = null;
  private availablePages: Page[] = [];
  private maxPages: number;

  constructor(maxPages = 4) {
    this.maxPages = maxPages;
  }

  /** Mutex-guarded init — safe to call concurrently. */
  async init(): Promise<void> {
    if (this.browser) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      javaScriptEnabled: true,
      bypassCSP: true,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });
  }

  async acquirePage(): Promise<Page> {
    await this.init();
    return this.availablePages.pop() ?? this.context!.newPage();
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
    this.initPromise = null;
  }
}
