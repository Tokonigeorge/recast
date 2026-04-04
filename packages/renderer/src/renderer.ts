import { readFile } from "node:fs/promises";
import { type Page } from "playwright";
import type { SiteType, RenderResult } from "@recast-a11y/classifier";
import { BrowserPool } from "./browser-pool.js";
import { detectSiteType } from "./detect.js";

export interface RendererOptions {
  /** Max concurrent Playwright pages */
  concurrency?: number;
  /** Timeout for page load in ms */
  timeout?: number;
}

/**
 * Tiered renderer that detects site type and renders accordingly.
 *
 * For Phase 1, all rendering goes through Playwright (required for ariaSnapshot).
 * The site type detection still runs — it informs the user and can be used
 * to optimize in later phases (jsdom for axe-only runs, cloud browser for SPAs).
 */
export class Renderer {
  private pool: BrowserPool;
  private timeout: number;

  constructor(opts: RendererOptions = {}) {
    this.pool = new BrowserPool(opts.concurrency ?? 4);
    this.timeout = opts.timeout ?? 15_000;
  }

  /** Render a URL and return the full HTML + detected site type */
  async renderUrl(url: string): Promise<{ result: RenderResult; page: Page }> {
    const page = await this.pool.acquirePage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeout,
      });
      // Wait a bit for JS-heavy sites to settle
      await page.waitForTimeout(1000);
      const html = await page.content();
      const siteType = detectSiteType(html);
      return { result: { html, siteType, url }, page };
    } catch (err) {
      // Retry once with networkidle for stubborn sites
      try {
        await page.goto(url, {
          waitUntil: "networkidle",
          timeout: this.timeout,
        });
        const html = await page.content();
        const siteType = detectSiteType(html);
        return { result: { html, siteType, url }, page };
      } catch {
        this.pool.releasePage(page);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ERR_HTTP2") || msg.includes("ERR_CONNECTION") || msg.includes("ERR_NAME")) {
          throw new Error(`Could not load ${url} — the site may be blocking automated browsers or is unreachable.`);
        }
        throw err;
      }
    }
  }

  /** Render a local HTML file */
  async renderFile(filePath: string): Promise<{ result: RenderResult; page: Page }> {
    const html = await readFile(filePath, "utf-8");
    return this.renderHtml(html, `file://${filePath}`);
  }

  /** Render an HTML string directly (for testing or static files) */
  async renderHtml(html: string, url = "inline"): Promise<{ result: RenderResult; page: Page }> {
    const page = await this.pool.acquirePage();
    try {
      await page.setContent(html, {
        waitUntil: "domcontentloaded",
        timeout: this.timeout,
      });
      const siteType = detectSiteType(html);
      return { result: { html, siteType, url }, page };
    } catch (err) {
      this.pool.releasePage(page);
      throw err;
    }
  }

  /** Release a page back to the pool after scanning is done */
  releasePage(page: Page): void {
    this.pool.releasePage(page);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}
