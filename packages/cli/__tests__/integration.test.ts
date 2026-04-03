import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Renderer } from "@recast-a11y/renderer";
import { detect } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type { Impact } from "@recast-a11y/classifier";

const B = "\x1b[1m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const D = "\x1b[2m";
const RED = "\x1b[31m";

const IMPACT_COLOR: Record<string, string> = { critical: RED, serious: Y, moderate: C, minor: D };

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../../fixtures/test-page.html");

describe("integration: detect + classify on test fixture", () => {
  let renderer: Renderer;

  beforeAll(async () => {
    renderer = new Renderer({ concurrency: 1, timeout: 10_000 });
  });

  afterAll(async () => {
    await renderer.close();
  });

  it("detects violations in test fixture", async () => {
    const html = await readFile(FIXTURE_PATH, "utf-8");
    const { result, page } = await renderer.renderHtml(html, FIXTURE_PATH);

    expect(result.siteType).toBe("static");

    const { violations, ariaSnapshot } = await detect(page, result.url);
    expect(violations.length).toBeGreaterThan(0);
    expect(ariaSnapshot.length).toBeGreaterThan(0);

    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("html-has-lang");
    expect(ruleIds).toContain("image-alt");

    const classification = classify(violations);
    expect(classification.high.length).toBeGreaterThan(0);
    expect(classification.low.length).toBeGreaterThan(0);

    const highRuleIds = classification.high.map((cv) => cv.violation.ruleId);
    expect(highRuleIds).toContain("html-has-lang");

    // ── Pretty output ──
    const byImpact: Record<string, number> = {};
    for (const v of violations) byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;

    const impactStr = (["critical", "serious", "moderate", "minor"] as Impact[])
      .filter((i) => byImpact[i])
      .map((i) => `${IMPACT_COLOR[i]}${byImpact[i]} ${i}${R}`)
      .join(D + " · " + R);

    console.log("");
    console.log(`  ${B}Detect + Classify${R}  fixtures/test-page.html`);
    console.log(`  ${D}─────────────────────────────────────────────${R}`);
    console.log(`  Violations   ${B}${violations.length}${R}  ${D}(${impactStr}${D})${R}`);
    console.log(`  Auto-fixable ${G}${classification.high.length}${R}  ${D}rule-based, no LLM${R}`);
    console.log(`  Needs LLM    ${Y}${classification.low.length}${R}  ${D}judgment required${R}`);
    console.log(`  ARIA tree    ${D}${ariaSnapshot.length} chars captured${R}`);
    console.log(`  ${D}─────────────────────────────────────────────${R}`);
    console.log(`  Rules: ${D}${[...new Set(ruleIds)].join(", ")}${R}`);

    renderer.releasePage(page);
  });
});
