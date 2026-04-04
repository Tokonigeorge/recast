import type { Page } from "playwright";

/**
 * Discover internal links on a page. Returns unique absolute URLs
 * on the same origin, excluding anchors, mailto, tel, and external links.
 */
export async function discoverLinks(page: Page, baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;

  const links: string[] = await page.evaluate(({ origin }) => {
    const anchors = document.querySelectorAll("a[href]");
    const urls = new Set<string>();

    for (const a of anchors) {
      const href = (a as HTMLAnchorElement).href;
      if (!href) continue;
      try {
        const url = new URL(href);
        if (url.origin !== origin) continue;
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        // Normalize: strip hash, trailing slash
        url.hash = "";
        let path = url.pathname + url.search;
        if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
        urls.add(url.origin + path);
      } catch {}
    }

    return [...urls];
  }, { origin });

  // Filter out common non-page URLs
  return links.filter((url) => {
    const path = new URL(url).pathname;
    return !path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz)$/i);
  });
}
