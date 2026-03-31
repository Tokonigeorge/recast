import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { Violation, Impact } from "@recast-a11y/classifier";

const require = createRequire(import.meta.url);

let axeSource: string | null = null;

/** Load axe-core source once and cache it */
async function getAxeSource(): Promise<string> {
  if (axeSource) return axeSource;
  const axePath = require.resolve("axe-core/axe.min.js");
  axeSource = await readFile(axePath, "utf-8");
  return axeSource;
}

interface AxeNode {
  html: string;
  target: string[];
}

interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

interface AxeResults {
  violations: AxeViolation[];
}

/** Map axe-core tags to WCAG criterion strings */
function extractWcag(tags: string[]): string {
  for (const tag of tags) {
    // Tags like "wcag2a", "wcag2aa", "wcag412" etc.
    const match = tag.match(/^wcag(\d)(\d)(\d)$/);
    if (match) {
      return `${match[1]}.${match[2]}.${match[3]}`;
    }
  }
  // Fallback: return best-effort from tags
  const wcagTag = tags.find((t) => t.startsWith("wcag"));
  return wcagTag ?? "unknown";
}

/**
 * Run axe-core inside a Playwright page and return normalized violations.
 * Injects axe source directly — no network dependency.
 */
export async function runAxe(
  page: Page,
  pageUrl: string,
): Promise<Violation[]> {
  const source = await getAxeSource();
  await page.evaluate(source);

  const results: AxeResults = await page.evaluate(() => {
    return (window as unknown as { axe: { run: (el: Document, opts: unknown) => Promise<AxeResults> } }).axe.run(
      document,
      {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        resultTypes: ["violations"],
      },
    );
  });

  const violations: Violation[] = [];

  for (const v of results.violations) {
    for (const node of v.nodes) {
      violations.push({
        ruleId: v.id,
        description: v.help,
        wcag: extractWcag(v.tags),
        impact: (v.impact as Impact) ?? "moderate",
        html: node.html,
        target: node.target[0] ?? "",
        helpUrl: v.helpUrl,
        pageUrl,
      });
    }
  }

  return violations;
}
