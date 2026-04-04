import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { Violation, Impact } from "@recast-a11y/classifier";

const require = createRequire(import.meta.url);

let axeSource: string | null = null;

async function getAxeSource(): Promise<string> {
  if (axeSource) return axeSource;
  const axePath = require.resolve("axe-core/axe.min.js");
  axeSource = await readFile(axePath, "utf-8");
  return axeSource;
}

interface AxeCheckResult {
  id: string;
  data?: {
    fgColor?: string;
    bgColor?: string;
    contrastRatio?: number;
    expectedContrastRatio?: string;
    fontSize?: string;
    fontWeight?: string;
  };
  message?: string;
}

interface AxeNode {
  html: string;
  target: string[];
  any?: AxeCheckResult[];
  all?: AxeCheckResult[];
  none?: AxeCheckResult[];
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

function extractWcag(tags: string[]): string {
  for (const tag of tags) {
    const match = tag.match(/^wcag(\d)(\d)(\d)$/);
    if (match) return `${match[1]}.${match[2]}.${match[3]}`;
  }
  const wcagTag = tags.find((t) => t.startsWith("wcag"));
  return wcagTag ?? "unknown";
}

/** Extract color contrast details from axe check results */
function extractContrastInfo(node: AxeNode): string | null {
  const checks = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])];
  for (const check of checks) {
    if (check.data?.fgColor && check.data?.bgColor) {
      const { fgColor, bgColor, contrastRatio, expectedContrastRatio, fontSize, fontWeight } = check.data;
      const ratio = contrastRatio ? contrastRatio.toFixed(2) : "?";
      const expected = expectedContrastRatio ?? "4.5:1";
      let info = `Contrast ${ratio}:1 (needs ${expected}). Foreground: ${fgColor}, Background: ${bgColor}`;
      if (fontSize) info += `. Font: ${fontSize}${fontWeight ? ` ${fontWeight}` : ""}`;
      return info;
    }
  }
  return null;
}

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
      let description = v.help;

      // Enrich color-contrast violations with actual color data
      if (v.id === "color-contrast") {
        const contrastInfo = extractContrastInfo(node);
        if (contrastInfo) description = contrastInfo;
      }

      violations.push({
        ruleId: v.id,
        description,
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
