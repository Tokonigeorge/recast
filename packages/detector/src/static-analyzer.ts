import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { parse as babelParse } from "@babel/parser";
import * as _traverseMod from "@babel/traverse";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import { parse as parseHtml, type HTMLElement as HTMLNode } from "node-html-parser";
import type { Violation } from "@recast-a11y/classifier";
import { AST_RULES, getAttribute, getAttributeStringValue, type AstContext } from "./ast-rules.js";

// @babel/traverse is a CommonJS module — unwrap whichever export shape we got
const traverse = (
  (_traverseMod as unknown as { default?: { default?: unknown } }).default?.default ??
  (_traverseMod as unknown as { default?: unknown }).default ??
  _traverseMod
) as (ast: unknown, visitor: unknown) => void;

const JSX_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".ts"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const SCANNABLE = new Set([...JSX_EXTENSIONS, ...HTML_EXTENSIONS, ".vue", ".svelte"]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".svelte-kit",
  "coverage", "__pycache__", ".cache", ".output", "out", "public", "static",
  "vendor", "assets", ".turbo", ".vercel", ".yarn",
]);

const SKIP_FILE_PATTERNS = [
  /\.min\./, /\.bundle\./, /\.generated\./, /\.chunk\./,
  /redoc-static/, /swagger-ui/, /storybook-static/,
];

export interface StaticScanResult {
  file: string;
  violations: Violation[];
}

async function findSourceFiles(dir: string, maxFiles = 1000): Promise<string[]> {
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
        if (entry.name.startsWith(".")) continue;
        await walk(fullPath);
      } else if (SCANNABLE.has(extname(entry.name).toLowerCase())) {
        if (SKIP_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

/** Scan a JSX/TSX/JS/TS file using the Babel AST. */
function scanJsxFile(filePath: string, content: string): Violation[] {
  const ext = extname(filePath).toLowerCase();
  const plugins: Array<
    "jsx" | "typescript" | "decorators-legacy" | "classProperties" | "topLevelAwait"
  > = ["jsx", "topLevelAwait"];
  if (ext === ".tsx" || ext === ".ts") plugins.push("typescript");

  let ast;
  try {
    ast = babelParse(content, {
      sourceType: "module",
      plugins,
      errorRecovery: true,
    });
  } catch {
    return []; // Can't parse — skip silently
  }

  const ctx: AstContext = {
    filePath,
    sourceLines: content.split("\n"),
    allIds: new Set(),
    duplicateIds: new Map(),
    headingStack: [],
    labelFors: new Set(),
  };

  // First pass: collect all ids, htmlFor refs, duplicate detection
  traverse(ast, {
    JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
      const id = getAttributeStringValue(getAttribute(path.node, "id"));
      if (id) {
        ctx.duplicateIds.set(id, (ctx.duplicateIds.get(id) ?? 0) + 1);
        ctx.allIds.add(id);
      }
      const htmlFor = getAttributeStringValue(getAttribute(path.node, "htmlFor") ?? getAttribute(path.node, "for"));
      if (htmlFor) ctx.labelFors.add(htmlFor);
    },
  });

  const violations: Violation[] = [];
  const seen = new Set<string>();

  // Second pass: run rules + heading order tracking
  traverse(ast, {
    JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
      // Heading order
      const name = (() => {
        const n = path.node.name;
        if (t.isJSXIdentifier(n)) return n.name;
        return "";
      })();
      const headingMatch = /^h([1-6])$/i.exec(name);
      if (headingMatch) {
        const level = parseInt(headingMatch[1], 10);
        const last = ctx.headingStack[ctx.headingStack.length - 1];
        if (last && level > last.level + 1) {
          const lineNum = path.node.loc?.start.line ?? 1;
          const v: Violation = {
            ruleId: "heading-order",
            description: `Heading level skipped: h${last.level} → h${level}`,
            wcag: "1.3.1",
            impact: "moderate",
            html: ctx.sourceLines[lineNum - 1]?.trim().slice(0, 200) ?? "",
            target: `h${level}`,
            helpUrl: "https://dequeuniversity.com/rules/axe/4.10/heading-order",
            pageUrl: filePath,
            line: lineNum,
          };
          const key = `heading-order:${lineNum}`;
          if (!seen.has(key)) { seen.add(key); violations.push(v); }
        }
        ctx.headingStack.push({ level, line: path.node.loc?.start.line ?? 0 });
      }

      // Run all rules
      for (const rule of AST_RULES) {
        if (!rule.jsxElement) continue;
        const result = rule.jsxElement(path, ctx);
        if (!result) continue;
        const items = Array.isArray(result) ? result : [result];
        for (const v of items) {
          const key = `${v.ruleId}:${v.line}:${v.target}`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push(v);
          }
        }
      }
    },
  });

  return violations;
}

/** Scan a plain HTML file using node-html-parser (pseudo-AST). */
function scanHtmlFile(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  let root: HTMLNode;
  try { root = parseHtml(content); } catch { return []; }

  // Collect all ids and label fors
  const allIds = new Set<string>();
  const duplicateIds = new Map<string, number>();
  const labelFors = new Set<string>();

  root.querySelectorAll("*").forEach((el) => {
    const id = el.getAttribute("id");
    if (id) {
      duplicateIds.set(id, (duplicateIds.get(id) ?? 0) + 1);
      allIds.add(id);
    }
    if (el.tagName?.toLowerCase() === "label") {
      const htmlFor = el.getAttribute("for");
      if (htmlFor) labelFors.add(htmlFor);
    }
  });

  // Helper: find line number of an element by its source position
  function lineOf(el: HTMLNode | null): number {
    if (!el) return 1;
    const outer = el.outerHTML.slice(0, 80);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(outer.slice(0, 40))) return i + 1;
    }
    return 1;
  }

  function push(v: Violation): void {
    const key = `${v.ruleId}:${v.line}:${v.target}`;
    if (!seen.has(key)) { seen.add(key); violations.push(v); }
  }

  // Direct HTML rules (simpler set — most of the AST rules apply conceptually)
  const html = root.querySelector("html");
  if (html && !html.getAttribute("lang")) {
    push({
      ruleId: "html-has-lang",
      description: "html element must have a lang attribute",
      wcag: "3.1.1", impact: "serious",
      html: "<html>", target: "html",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/html-has-lang",
      pageUrl: filePath, line: lineOf(html),
    });
  }

  root.querySelectorAll("img").forEach((img) => {
    if (img.hasAttribute("alt") || img.hasAttribute("aria-label") || img.hasAttribute("role")) return;
    push({
      ruleId: "image-alt",
      description: "Images must have alternate text",
      wcag: "1.1.1", impact: "critical",
      html: img.outerHTML.slice(0, 200), target: "img",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
      pageUrl: filePath, line: lineOf(img),
    });
  });

  root.querySelectorAll("input, textarea, select").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    if (tag === "input" && (type === "hidden" || type === "submit" || type === "button" || type === "reset")) return;
    if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.hasAttribute("title")) return;
    const id = el.getAttribute("id");
    if (id && labelFors.has(id)) return;
    push({
      ruleId: "label",
      description: "Form elements must have labels",
      wcag: "1.3.1", impact: "critical",
      html: el.outerHTML.slice(0, 200), target: tag,
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
      pageUrl: filePath, line: lineOf(el),
    });
  });

  root.querySelectorAll("button").forEach((btn) => {
    if (btn.hasAttribute("aria-label") || btn.hasAttribute("title")) return;
    if (btn.textContent?.trim().length) return;
    push({
      ruleId: "button-name",
      description: "Buttons must have discernible text",
      wcag: "4.1.2", impact: "critical",
      html: btn.outerHTML.slice(0, 200), target: "button",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/button-name",
      pageUrl: filePath, line: lineOf(btn),
    });
  });

  root.querySelectorAll("form button:not([type])").forEach((btn) => {
    push({
      ruleId: "button-has-type",
      description: "Buttons in forms should have an explicit type attribute",
      wcag: "3.2.2", impact: "moderate",
      html: btn.outerHTML.slice(0, 200), target: "button",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/button-has-type",
      pageUrl: filePath, line: lineOf(btn),
    });
  });

  root.querySelectorAll("[aria-labelledby]").forEach((el) => {
    const ref = el.getAttribute("aria-labelledby");
    if (!ref) return;
    const missing = ref.split(/\s+/).filter((id) => id && !allIds.has(id));
    if (missing.length === 0) return;
    push({
      ruleId: "aria-labelledby-broken",
      description: `aria-labelledby references non-existent id="${missing[0]}"`,
      wcag: "1.3.1", impact: "critical",
      html: el.outerHTML.slice(0, 200), target: `[aria-labelledby="${ref}"]`,
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/aria-labelledby",
      pageUrl: filePath, line: lineOf(el),
    });
  });

  for (const [id, count] of duplicateIds) {
    if (count <= 1) continue;
    const el = root.querySelector(`[id="${id}"]`);
    push({
      ruleId: "duplicate-id",
      description: `id="${id}" is used on multiple elements`,
      wcag: "4.1.1", impact: "moderate",
      html: el?.outerHTML.slice(0, 200) ?? `<[id="${id}"]>`, target: `#${id}`,
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/duplicate-id",
      pageUrl: filePath, line: lineOf(el),
    });
  }

  // Heading order
  const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let lastLevel = 0;
  for (const h of headings) {
    const level = parseInt(h.tagName[1], 10);
    if (lastLevel > 0 && level > lastLevel + 1) {
      push({
        ruleId: "heading-order",
        description: `Heading level skipped: h${lastLevel} → h${level}`,
        wcag: "1.3.1", impact: "moderate",
        html: h.outerHTML.slice(0, 200), target: `h${level}`,
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/heading-order",
        pageUrl: filePath, line: lineOf(h),
      });
    }
    lastLevel = level;
  }

  return violations;
}

export async function staticAnalyze(projectDir: string): Promise<StaticScanResult[]> {
  const files = await findSourceFiles(projectDir);
  const results: StaticScanResult[] = [];

  for (const file of files) {
    const fileInfo = await stat(file);
    if (fileInfo.size > 500_000) continue; // skip files over 500KB

    const content = await readFile(file, "utf-8");
    const ext = extname(file).toLowerCase();

    const violations = JSX_EXTENSIONS.has(ext)
      ? scanJsxFile(file, content)
      : HTML_EXTENSIONS.has(ext)
      ? scanHtmlFile(file, content)
      : [];

    if (violations.length > 0) {
      results.push({ file, violations });
    }
  }

  return results;
}
