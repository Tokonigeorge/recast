import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Violation } from "@recast-a11y/classifier";

const SCANNABLE_EXTENSIONS = new Set([".jsx", ".tsx", ".html", ".htm", ".vue", ".svelte"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit",
  "coverage", "__pycache__", ".cache", ".output", "out", "public", "static",
  "vendor", "assets", ".turbo", ".vercel",
]);
const SKIP_FILE_PATTERNS = [
  /\.min\./,           // minified files
  /\.bundle\./,        // bundled files
  /\.generated\./,     // generated files
  /redoc-static/,      // generated API docs
  /swagger-ui/,        // generated API docs
  /\.chunk\./,         // webpack chunks
  /storybook-static/,  // storybook build output
];

export interface StaticScanResult {
  file: string;
  violations: Violation[];
}

/** Recursively find all scannable source files in a directory. */
async function findSourceFiles(dir: string, maxFiles = 500): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(currentDir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
      } else if (SCANNABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        if (SKIP_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

interface Rule {
  id: string;
  description: string;
  wcag: string;
  impact: "minor" | "moderate" | "serious" | "critical";
  check(line: string, lineNum: number, allLines: string[], file: string): Violation | null;
}

function makeViolation(
  rule: Rule,
  html: string,
  target: string,
  file: string,
  lineNum: number,
  description?: string,
): Violation {
  return {
    ruleId: rule.id,
    description: description ?? rule.description,
    wcag: rule.wcag,
    impact: rule.impact,
    html: html.trim().slice(0, 300),
    target,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${rule.id}`,
    pageUrl: file,
    line: lineNum + 1,
  };
}

const RULES: Rule[] = [
  // ── img without alt ──
  {
    id: "image-alt",
    description: "Images must have alternate text",
    wcag: "1.1.1",
    impact: "critical",
    check(line, ln, _all, file) {
      if (/<img\b/i.test(line) && !/\balt\s*=/.test(line) && !/\balt\s*\{/.test(line)) {
        return makeViolation(this, line, `img`, file, ln);
      }
      return null;
    },
  },

  // ── button with no text content (icon-only) ──
  {
    id: "button-name",
    description: "Buttons must have discernible text",
    wcag: "4.1.2",
    impact: "critical",
    check(line, ln, allLines, file) {
      if (/<button\b/i.test(line) && !/aria-label/i.test(line)) {
        const joined = allLines.slice(ln, Math.min(ln + 5, allLines.length)).join(" ");
        if (/<button[^>]*>\s*<svg\b/.test(joined) || /<button[^>]*>\s*<[A-Z]\w*Icon/.test(joined)) {
          return makeViolation(this, line, `button`, file, ln);
        }
      }
      return null;
    },
  },

  // ── html without lang ──
  {
    id: "html-has-lang",
    description: "html element must have a lang attribute",
    wcag: "3.1.1",
    impact: "serious",
    check(line, ln, _all, file) {
      if (/<html\b/i.test(line) && !/\blang\s*=/.test(line)) {
        return makeViolation(this, line, "html", file, ln);
      }
      return null;
    },
  },

  // ── link with no text (icon-only links) ──
  {
    id: "link-name",
    description: "Links must have discernible text",
    wcag: "2.4.4",
    impact: "serious",
    check(line, ln, allLines, file) {
      if (/<a\b/i.test(line) && !/aria-label/i.test(line)) {
        const joined = allLines.slice(ln, Math.min(ln + 3, allLines.length)).join(" ");
        if (/<a[^>]*>\s*<svg\b/.test(joined) || /<a[^>]*>\s*<[A-Z]\w*Icon/.test(joined)) {
          return makeViolation(this, line, "a", file, ln);
        }
        if (/<a[^>]*>\s*<img\b/.test(joined) && !/\balt\s*=/.test(joined)) {
          return makeViolation(this, line, "a", file, ln);
        }
      }
      return null;
    },
  },

  // ── input/textarea/select without label ──
  {
    id: "label",
    description: "Form elements must have labels",
    wcag: "1.3.1",
    impact: "critical",
    check(line, ln, allLines, file) {
      const match = line.match(/<(input|textarea|select)\b/i);
      if (!match) return null;
      const tag = match[1].toLowerCase();

      if (/aria-label/i.test(line) || /aria-labelledby/i.test(line)) return null;

      const idMatch = line.match(/\bid\s*=\s*["'{]([^"'}]+)/);
      if (idMatch) {
        const context = allLines.slice(Math.max(0, ln - 5), ln + 5).join(" ");
        if (new RegExp(`(htmlFor|for)\\s*=\\s*["'{]${idMatch[1]}`).test(context)) return null;
      }

      if (/placeholder\s*=/i.test(line)) return null;

      return makeViolation(this, line, tag, file, ln);
    },
  },

  // ── div/span with onClick but no role or keyboard handler ──
  {
    id: "click-without-keyboard",
    description: "Clickable elements must be keyboard accessible",
    wcag: "2.1.1",
    impact: "serious",
    check(line, ln, _all, file) {
      if (/<(div|span)\b/i.test(line) && /onClick/i.test(line)) {
        if (!/\brole\s*=/.test(line) && !/onKeyDown/i.test(line) && !/onKeyPress/i.test(line) && !/onKeyUp/i.test(line)) {
          const tag = line.match(/<(div|span)\b/i)![1];
          return makeViolation(this, line, tag, file, ln);
        }
      }
      return null;
    },
  },

  // ── button in form without type ──
  {
    id: "button-has-type",
    description: "Buttons should have an explicit type attribute",
    wcag: "3.2.2",
    impact: "moderate",
    check(line, ln, allLines, file) {
      if (/<button\b/i.test(line) && !/\btype\s*=/.test(line)) {
        for (let i = ln - 1; i >= Math.max(0, ln - 30); i--) {
          if (/<form\b/i.test(allLines[i])) {
            return makeViolation(this, line, "button", file, ln);
          }
          if (/<\/form/i.test(allLines[i])) break;
        }
      }
      return null;
    },
  },

  // ── heading order violations ──
  {
    id: "heading-order",
    description: "Heading levels should increase by one",
    wcag: "1.3.1",
    impact: "moderate",
    check() {
      return null; // Handled by scanFile directly
    },
  },

  // ── aria-hidden on focusable element ──
  {
    id: "aria-hidden-focus",
    description: "aria-hidden elements should not be focusable",
    wcag: "4.1.2",
    impact: "serious",
    check(line, ln, _all, file) {
      if (/aria-hidden\s*=\s*["'{\s]*true/i.test(line)) {
        if (/<(a|button|input|select|textarea)\b/i.test(line) && !/tabIndex\s*=\s*["'{]*-1/.test(line)) {
          const tag = line.match(/<(a|button|input|select|textarea)\b/i)![1];
          return makeViolation(this, line, tag, file, ln);
        }
      }
      return null;
    },
  },

  // ── broken aria-labelledby ──
  {
    id: "aria-labelledby-broken",
    description: "aria-labelledby must reference an existing element ID",
    wcag: "1.3.1",
    impact: "critical",
    check(line, ln, allLines, file) {
      const match = line.match(/aria-labelledby\s*=\s*["']([^"']+)["']/);
      if (!match) return null;
      const ids = match[1].split(/\s+/);
      const allContent = allLines.join("\n");
      for (const id of ids) {
        if (!new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(allContent)) {
          return makeViolation(this, line, `[aria-labelledby="${id}"]`, file, ln,
            `aria-labelledby references non-existent id="${id}"`);
        }
      }
      return null;
    },
  },
];

/** Scan a single file for static accessibility violations. */
function scanFile(filePath: string, content: string): Violation[] {
  const lines = content.split("\n");
  const violations: Violation[] = [];
  const seen = new Set<string>();
  let lastHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Heading order check (cross-line state)
    const headingMatch = line.match(/<h([1-6])\b/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
        const v: Violation = {
          ruleId: "heading-order",
          description: `Heading level skipped: h${lastHeadingLevel} → h${level}`,
          wcag: "1.3.1",
          impact: "moderate",
          html: line.trim().slice(0, 200),
          target: `h${level}`,
          helpUrl: "https://dequeuniversity.com/rules/axe/4.10/heading-order",
          pageUrl: filePath,
          line: i + 1,
        };
        violations.push(v);
      }
      lastHeadingLevel = level;
    }

    // Run all rules
    for (const rule of RULES) {
      if (rule.id === "heading-order") continue; // handled above
      const v = rule.check(line, i, lines, filePath);
      if (v) {
        // Deduplicate by file + line + rule
        const key = `${filePath}:${i}:${v.ruleId}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push(v);
        }
      }
    }
  }

  return violations;
}

/** Scan all source files in a project directory. */
export async function staticAnalyze(projectDir: string): Promise<StaticScanResult[]> {
  const files = await findSourceFiles(projectDir);
  const results: StaticScanResult[] = [];

  for (const file of files) {
    const fileInfo = await stat(file);
    if (fileInfo.size > 100_000) continue; // skip files over 100KB (likely generated)

    const content = await readFile(file, "utf-8");
    const violations = scanFile(file, content);
    if (violations.length > 0) {
      results.push({ file, violations });
    }
  }

  return results;
}
