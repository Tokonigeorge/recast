import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { SourceRef } from "@recast-a11y/classifier";

/** Trace a DOM element back to its source file via React fiber _debugStack, Domscribe stamp, or Vue internals. */
export async function traceToSource(
  page: Page,
  target: string,
): Promise<SourceRef | null> {
  return page.evaluate((selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;

    // 1. Domscribe stamp
    const stamp = el.getAttribute("data-ds");
    if (stamp) {
      const [file, lineStr] = stamp.split(":");
      const line = parseInt(lineStr, 10);
      if (file && !isNaN(line)) return { file, line };
    }

    // 2. React fiber _debugStack (React 19+)
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    if (fiberKey) {
      let current = (el as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | undefined;
      for (let i = 0; i < 10 && current; i++) {
        const debugStack = current._debugStack as { stack?: string } | undefined;
        if (debugStack?.stack) {
          const match = debugStack.stack.match(/at \w+ \((http[^)]+):(\d+):(\d+)\)/);
          if (match) {
            try {
              const pathname = new URL(match[1]).pathname;
              return { file: pathname, line: parseInt(match[2], 10), column: parseInt(match[3], 10) };
            } catch {
              return { file: match[1], line: parseInt(match[2], 10), column: parseInt(match[3], 10) };
            }
          }
        }

        // React 18: _debugSource
        const source = current._debugSource as { fileName?: string; lineNumber?: number; columnNumber?: number } | undefined;
        if (source?.fileName) {
          return { file: source.fileName, line: source.lineNumber ?? 1, column: source.columnNumber };
        }

        current = current.return as Record<string, unknown> | undefined;
      }
    }

    // 3. Vue __vue__
    const vueInst = (el as unknown as Record<string, unknown>).__vue__ as
      | { $options?: { __file?: string } }
      | undefined;
    if (vueInst?.$options?.__file) {
      return { file: vueInst.$options.__file, line: 1 };
    }

    return null;
  }, target);
}

/**
 * Resolve a traced source path (e.g. /src/components/Header.jsx) to an absolute path.
 * Searches projectRoot first, then subdirectories with package.json if not found.
 */
export function resolveSourcePath(tracedFile: string, projectRoot: string): string {
  // Already absolute and exists
  if (!tracedFile.startsWith("/src/") && !tracedFile.startsWith("/app/") && !tracedFile.startsWith("/lib/")) {
    if (existsSync(tracedFile)) return tracedFile;
  }

  // Direct: projectRoot + tracedFile
  const direct = join(projectRoot, tracedFile);
  if (existsSync(direct)) return direct;

  // Search subdirectories for the file (handles monorepos where cwd != project root)
  try {
    const entries = require("node:fs").readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      const candidate = join(projectRoot, entry.name, tracedFile);
      if (existsSync(candidate)) return candidate;
    }
  } catch {}

  return direct;
}

/** Trace source for static HTML files — the file IS the source. */
export function traceInStaticHtml(
  html: string,
  filePath: string,
  elementHtml: string,
): SourceRef | null {
  const lines = html.split("\n");

  const tagWithAttrs = elementHtml.match(/<(\w+)\s+([^>]*)/);
  if (tagWithAttrs) {
    const searchPattern = tagWithAttrs[0];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(searchPattern)) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  const attrMatch = elementHtml.match(/<\w+[^>]*(?:id|class|aria-)=["'][^"']+["']/);
  if (attrMatch) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(attrMatch[0])) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  const bareTag = elementHtml.match(/<(\w+)\s*>/);
  if (bareTag) {
    const tag = bareTag[1];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(new RegExp(`<${tag}(?:\\s*>|\\s+)`))) {
        return { file: filePath, line: i + 1 };
      }
    }
  }

  return null;
}
