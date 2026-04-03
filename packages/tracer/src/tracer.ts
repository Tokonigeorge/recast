import type { Page } from "playwright";
import type { SourceRef } from "@recast-a11y/classifier";

/**
 * Source tracing: find the original source file + line for a DOM element.
 * Follows the priority chain from the architecture doc:
 * 1. Domscribe data-ds stamp (most reliable)
 * 2. Sourcemap tracing via CDP
 * 3. Framework fiber walking (React __reactFiber, Vue __vue__)
 * 4. null (flag for manual location)
 */
export async function traceToSource(
  page: Page,
  target: string,
): Promise<SourceRef | null> {
  // Try all methods inside the browser context
  const ref = await page.evaluate((selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;

    // Method 1: Domscribe stamp
    const stamp = el.getAttribute("data-ds");
    if (stamp) {
      const [file, lineStr] = stamp.split(":");
      const line = parseInt(lineStr, 10);
      if (file && !isNaN(line)) return { file, line };
    }

    // Method 3: React fiber (dev mode)
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    if (fiberKey) {
      const fiber = (el as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | undefined;
      if (fiber) {
        // Walk up to find _debugSource
        let current: Record<string, unknown> | undefined = fiber;
        for (let i = 0; i < 10 && current; i++) {
          const source = current._debugSource as
            | { fileName: string; lineNumber: number; columnNumber?: number }
            | undefined;
          if (source?.fileName) {
            return {
              file: source.fileName,
              line: source.lineNumber,
              column: source.columnNumber,
            };
          }
          current = current.return as Record<string, unknown> | undefined;
        }
      }
    }

    // Method 3b: Vue __vue__
    const vueInst = (el as unknown as Record<string, unknown>).__vue__ as
      | { $options?: { __file?: string } }
      | undefined;
    if (vueInst?.$options?.__file) {
      return { file: vueInst.$options.__file, line: 1 };
    }

    return null;
  }, target);

  return ref;
}

/**
 * Trace source for static HTML files — the file IS the source.
 * Match the element in the raw HTML to find the line number.
 */
export function traceInStaticHtml(
  html: string,
  filePath: string,
  elementHtml: string,
): SourceRef | null {
  const lines = html.split("\n");

  // Strategy 1: Match the full opening tag pattern (tag + attributes)
  const tagWithAttrs = elementHtml.match(/<(\w+)\s+([^>]*)/);
  if (tagWithAttrs) {
    const searchPattern = tagWithAttrs[0];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchPattern)) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  // Strategy 2: Match by distinctive attribute (id, class, aria-*)
  const attrMatch = elementHtml.match(/<\w+[^>]*(?:id|class|aria-)=["'][^"']+["']/);
  if (attrMatch) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(attrMatch[0])) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  // Strategy 3: Match bare tag (e.g., <html>, <body>) — for elements with no attributes
  const bareTag = elementHtml.match(/<(\w+)\s*>/);
  if (bareTag) {
    const tag = bareTag[1];
    for (let i = 0; i < lines.length; i++) {
      // Match the bare opening tag, not a closing tag or a tag with attributes
      const lineMatch = lines[i].match(new RegExp(`<${tag}(?:\\s*>|\\s+)`));
      if (lineMatch) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  return null;
}
