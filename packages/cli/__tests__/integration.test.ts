import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Renderer } from "@recast-a11y/renderer";
import { detect } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";

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

    // Should find multiple violations
    expect(violations.length).toBeGreaterThan(0);

    // Check specific expected violations
    const ruleIds = violations.map((v) => v.ruleId);

    // html-has-lang should be detected (either by axe or custom checks)
    expect(ruleIds).toContain("html-has-lang");

    // image-alt should be detected
    expect(ruleIds).toContain("image-alt");

    // ARIA snapshot should be a non-empty string
    expect(ariaSnapshot.length).toBeGreaterThan(0);

    // Classify the violations
    const classification = classify(violations);

    // html-has-lang should be high confidence
    const highRuleIds = classification.high.map((cv) => cv.violation.ruleId);
    expect(highRuleIds).toContain("html-has-lang");

    // Some violations should be low confidence (need LLM)
    expect(classification.low.length).toBeGreaterThan(0);

    console.log(`\nDetected ${violations.length} violations:`);
    console.log(`  High confidence: ${classification.high.length}`);
    console.log(`  Low confidence:  ${classification.low.length}`);
    console.log(`\nViolation rules found:`, [...new Set(ruleIds)].join(", "));
    console.log(`\nARIA snapshot preview (first 500 chars):`);
    console.log(ariaSnapshot.slice(0, 500));

    renderer.releasePage(page);
  });
});
