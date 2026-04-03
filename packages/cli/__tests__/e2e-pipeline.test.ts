import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Renderer } from "@recast-a11y/renderer";
import { detect } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type { ClassifiedViolation } from "@recast-a11y/classifier";
import { traceInStaticHtml } from "@recast-a11y/tracer";
import { patchHtml } from "@recast-a11y/patcher";
import { generateDiff } from "@recast-a11y/reporter";

const B = "\x1b[1m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const RED = "\x1b[31m";
const D = "\x1b[2m";

const FIXTURE_PATH = resolve(import.meta.dirname!, "../../../fixtures/test-page.html");

describe("e2e pipeline: render → detect → classify → patch → diff", () => {
  let renderer: Renderer;
  let fixtureHtml: string;

  beforeAll(async () => {
    renderer = new Renderer({ concurrency: 1, timeout: 10_000 });
    fixtureHtml = await readFile(FIXTURE_PATH, "utf-8");
  });

  afterAll(async () => {
    await renderer.close();
  });

  it("full pipeline produces valid patches on test fixture", async () => {
    // ── Step 1: Render ──
    const { result, page } = await renderer.renderHtml(fixtureHtml, FIXTURE_PATH);
    expect(result.siteType).toBe("static");

    // ── Step 2: Detect ──
    const { violations, ariaSnapshot } = await detect(page, result.url);
    expect(violations.length).toBeGreaterThan(0);
    expect(ariaSnapshot).toBeTruthy();

    // ── Step 3: Classify ──
    const classification = classify(violations);
    expect(classification.high.length).toBeGreaterThan(0);

    // ── Step 4: Patch (dry run on a copy) ──
    let patchedHtml = fixtureHtml;
    const appliedPatches: Array<{
      cv: ClassifiedViolation;
      original: string;
      fixed: string;
      line: number;
    }> = [];

    // Sort high-confidence fixes by line number (descending) to avoid offset issues
    const sorted = [...classification.high].sort((a, b) => {
      const refA = traceInStaticHtml(fixtureHtml, FIXTURE_PATH, a.violation.html);
      const refB = traceInStaticHtml(fixtureHtml, FIXTURE_PATH, b.violation.html);
      return (refB?.line ?? 0) - (refA?.line ?? 0);
    });

    for (const cv of sorted) {
      const sourceRef = traceInStaticHtml(patchedHtml, FIXTURE_PATH, cv.violation.html);
      if (!sourceRef) continue;

      const result = patchHtml(patchedHtml, sourceRef, cv.violation.html, cv.fix);
      if (result) {
        const originalLines = patchedHtml.split("\n");
        const fixedLines = result.split("\n");
        appliedPatches.push({
          cv,
          original: originalLines[sourceRef.line - 1],
          fixed: fixedLines[sourceRef.line - 1],
          line: sourceRef.line,
        });
        patchedHtml = result;
      }
    }

    expect(appliedPatches.length).toBeGreaterThan(0);

    // ── Step 5: Verify patches ──
    expect(patchedHtml).toContain('lang="en"');
    expect(patchedHtml).toContain("<head>");
    expect(patchedHtml).toContain("</body>");
    expect(patchedHtml).toContain("</html>");

    // ── Step 6: Generate diff ──
    const patches = appliedPatches.map((p) => ({
      sourceRef: { file: "fixtures/test-page.html", line: p.line },
      violation: p.cv.violation,
      fix: p.cv.fix,
      originalCode: p.original.trim(),
      fixedCode: p.fixed.trim(),
    }));
    const diff = generateDiff(patches);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff).toContain("---");
    expect(diff).toContain("+++");

    // ── Step 7: Re-scan to confirm fixes ──
    const { result: result2, page: page2 } = await renderer.renderHtml(patchedHtml, FIXTURE_PATH);
    const { violations: remaining } = await detect(page2, result2.url);

    expect(remaining.map((v) => v.ruleId)).not.toContain("html-has-lang");
    expect(remaining.length).toBeLessThan(violations.length);

    // ── Pretty output ──
    const resolved = violations.length - remaining.length;
    const pct = Math.round((resolved / violations.length) * 100);

    console.log("");
    console.log(`  ${B}E2E Pipeline${R}  render → detect → classify → patch → verify`);
    console.log(`  ${D}─────────────────────────────────────────────────────${R}`);
    console.log(`  Before       ${B}${violations.length}${R} violations`);
    console.log(`  Patched      ${G}${appliedPatches.length}${R} high-confidence fixes applied`);
    console.log(`  After        ${B}${remaining.length}${R} violations remain`);
    console.log(`  Resolved     ${G}${resolved}${R} ${D}(${pct}% of detected)${R}`);
    console.log(`  ${D}─────────────────────────────────────────────────────${R}`);

    for (const p of appliedPatches) {
      const conf = p.cv.fix.confidence >= 0.95 ? G : "";
      console.log(`  ${conf}[${p.cv.fix.confidence.toFixed(2)}]${R} ${B}${p.cv.violation.ruleId}${R}`);
      console.log(`         ${RED}- ${p.original.trim()}${R}`);
      console.log(`         ${G}+ ${p.fixed.trim()}${R}`);
    }

    console.log(`  ${D}─────────────────────────────────────────────────────${R}`);

    renderer.releasePage(page);
    renderer.releasePage(page2);
  });
});
