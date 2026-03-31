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
  // Extract a distinctive pattern from the element HTML
  // Try to find a unique attribute combination
  const tagMatch = elementHtml.match(/<(\w+)\s+([^>]*)/);
  if (!tagMatch) return null;

  // Build a search pattern from the element's opening tag
  const searchPattern = tagMatch[0];
  const lines = html.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      return { file: filePath, line: i + 1 };
    }
  }

  // Fallback: try just the tag + first attribute
  const simpleMatch = elementHtml.match(/<\w+[^>]*(?:id|class|aria-)=["'][^"']+["']/);
  if (simpleMatch) {
    const pattern = simpleMatch[0];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  return null;
}
