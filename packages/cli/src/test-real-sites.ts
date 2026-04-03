#!/usr/bin/env npx tsx
/**
 * Real-world codebase test runner.
 *
 * Clones a public repo into a temp directory, builds it (if needed),
 * serves or opens its HTML files, runs the full Recast pipeline,
 * and reports violations + patches + cost.
 *
 * Usage:
 *   npx tsx scripts/test-real-sites.ts                          # run all default projects
 *   npx tsx scripts/test-real-sites.ts ./path/to/local/project  # test a local project
 *   GEMINI_API_KEY=... npx tsx scripts/test-real-sites.ts       # with LLM fixes
 */
import { execSync } from "node:child_process";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { Renderer } from "@recast-a11y/renderer";
import { detect, enrichViolation } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import { GeminiClient } from "@recast-a11y/llm";
import { traceInStaticHtml } from "@recast-a11y/tracer";
import { patchHtml } from "@recast-a11y/patcher";
import { printCostSummary } from "@recast-a11y/reporter";

// ── Test projects: repos with HTML/template files to scan ──
const DEFAULT_PROJECTS = [
  {
    repo: "https://github.com/h5bp/html5-boilerplate.git",
    label: "HTML5 Boilerplate",
    glob: "**/*.html",
    description: "Industry-standard HTML starter — should be mostly clean",
  },
  {
    repo: "https://github.com/foundation/foundation-sites.git",
    label: "Foundation Sites",
    glob: "docs/**/*.html",
    description: "Popular CSS framework — docs have real-world patterns",
  },
  {
    repo: "https://github.com/twbs/bootstrap.git",
    label: "Bootstrap",
    glob: "site/content/docs/**/*.html",
    description: "Most popular CSS framework — example HTML files",
  },
];

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

interface ProjectResult {
  label: string;
  filesScanned: number;
  totalViolations: number;
  highConfidence: number;
  lowConfidence: number;
  skippedCount: number;
  patchesGenerated: number;
  topRules: Array<{ rule: string; count: number }>;
  scanDurationMs: number;
  error?: string;
}

/** Recursively find HTML files in a directory */
async function findHtmlFiles(dir: string, maxFiles = 20): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, vendor, dist, build
        if (["node_modules", ".git", "vendor", "dist", "build", "__pycache__"].includes(entry.name)) continue;
        await walk(fullPath);
      } else if (HTML_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function testProject(
  renderer: Renderer,
  projectDir: string,
  label: string,
  llmClient: GeminiClient | null,
): Promise<ProjectResult> {
  const start = performance.now();
  console.log(`\n${BOLD}── ${label} ──${RESET}`);
  console.log(`${DIM}${projectDir}${RESET}\n`);

  try {
    const htmlFiles = await findHtmlFiles(projectDir);
    if (htmlFiles.length === 0) {
      console.log(`  ${YELLOW}No HTML files found${RESET}`);
      return {
        label, filesScanned: 0, totalViolations: 0, highConfidence: 0,
        lowConfidence: 0, skippedCount: 0, patchesGenerated: 0, topRules: [],
        scanDurationMs: performance.now() - start, error: "No HTML files found",
      };
    }

    console.log(`  Found ${htmlFiles.length} HTML file${htmlFiles.length > 1 ? "s" : ""}`);

    let totalViolations = 0;
    let totalHigh = 0;
    let totalLow = 0;
    let totalSkipped = 0;
    let totalPatches = 0;
    const ruleCount: Record<string, number> = {};
    const allDiffParts: string[] = [];

    for (const filePath of htmlFiles) {
      const relativePath = filePath.replace(projectDir + "/", "");
      const html = await readFile(filePath, "utf-8");

      // Skip tiny files (likely partials/fragments)
      if (html.length < 50) continue;

      const { result, page } = await renderer.renderHtml(html, `file://${filePath}`);
      const { violations } = await detect(page, result.url);

      if (violations.length === 0) {
        console.log(`  ${GREEN}✓${RESET} ${relativePath} — clean`);
        renderer.releasePage(page);
        continue;
      }

      const classification = classify(violations);
      totalViolations += violations.length;
      totalHigh += classification.high.length;
      totalLow += classification.low.length;
      totalSkipped += classification.skipped.length;

      for (const v of violations) {
        ruleCount[v.ruleId] = (ruleCount[v.ruleId] ?? 0) + 1;
      }

      // Try to patch high-confidence fixes
      let patchedHtml = html;
      let filePatches = 0;

      for (const cv of classification.high) {
        const sourceRef = traceInStaticHtml(patchedHtml, filePath, cv.violation.html);
        if (!sourceRef) continue;

        const patched = patchHtml(patchedHtml, sourceRef, cv.violation.html, cv.fix);
        if (patched && patched !== patchedHtml) {
          const origLine = patchedHtml.split("\n")[sourceRef.line - 1];
          const fixLine = patched.split("\n")[sourceRef.line - 1];
          allDiffParts.push(
            `--- a/${relativePath}\n+++ b/${relativePath}\n@@ -${sourceRef.line},1 +${sourceRef.line},1 @@\n-${origLine}\n+${fixLine}`,
          );
          patchedHtml = patched;
          filePatches++;
        }
      }
      totalPatches += filePatches;

      // Run LLM on low-confidence if available
      if (llmClient && classification.low.length > 0) {
        try {
          console.log(`  ${DIM}Enriching ${classification.low.length} violations for LLM...${RESET}`);
          const enriched = await Promise.all(
            classification.low.map((cv) => enrichViolation(page, cv.violation)),
          );
          console.log(`  ${DIM}Sending ${enriched.length} violations to Gemini...${RESET}`);
          const fixes = await llmClient.generateFixes(enriched);
          const succeeded = fixes.filter((f) => f.confidence > 0).length;
          console.log(`  ${DIM}LLM returned ${succeeded}/${fixes.length} valid fixes${RESET}`);
        } catch (err) {
          console.log(`  ${RED}LLM pipeline error: ${err instanceof Error ? err.message : err}${RESET}`);
        }
      }

      const patchLabel = filePatches > 0 ? ` ${GREEN}(${filePatches} patched)${RESET}` : "";
      const skipLabel = classification.skipped.length > 0 ? `, ${DIM}${classification.skipped.length} skipped${RESET}` : "";
      console.log(
        `  ${RED}✗${RESET} ${relativePath} — ${violations.length} violations (${classification.high.length} auto, ${classification.low.length} LLM${skipLabel})${patchLabel}`,
      );

      renderer.releasePage(page);
    }

    // Top rules
    const topRules = Object.entries(ruleCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([rule, count]) => ({ rule, count }));

    // Print per-project summary
    console.log(`\n  ${BOLD}Project summary:${RESET}`);
    console.log(`  Files scanned:  ${htmlFiles.length}`);
    console.log(`  Violations:     ${totalViolations}`);
    console.log(`  Auto-fixable:   ${GREEN}${totalHigh}${RESET}`);
    console.log(`  Need LLM:       ${totalLow}`);
    console.log(`  Skipped:        ${DIM}${totalSkipped} (CSS/design — can't patch HTML)${RESET}`);
    console.log(`  Patches ready:  ${GREEN}${totalPatches}${RESET}`);
    console.log(`  Top rules:      ${topRules.map((r) => `${r.rule}(${r.count})`).join(", ")}`);

    if (allDiffParts.length > 0) {
      console.log(`\n  ${BOLD}Sample diff (first 3):${RESET}`);
      for (const diff of allDiffParts.slice(0, 3)) {
        for (const line of diff.split("\n")) {
          const prefix = line.startsWith("-") ? RED : line.startsWith("+") ? GREEN : DIM;
          console.log(`    ${prefix}${line}${RESET}`);
        }
        console.log();
      }
    }

    return {
      label,
      filesScanned: htmlFiles.length,
      totalViolations,
      highConfidence: totalHigh,
      lowConfidence: totalLow,
      skippedCount: totalSkipped,
      patchesGenerated: totalPatches,
      topRules,
      scanDurationMs: performance.now() - start,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`  ${RED}Error: ${errMsg}${RESET}`);
    return {
      label, filesScanned: 0, totalViolations: 0, highConfidence: 0,
      lowConfidence: 0, skippedCount: 0, patchesGenerated: 0, topRules: [],
      scanDurationMs: performance.now() - start, error: errMsg,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log(`\n${BOLD}Recast — Real-World Codebase Tester${RESET}\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    console.log(`${GREEN}Gemini API key found — LLM fixes will be tested${RESET}`);
  } else {
    console.log(`${DIM}No GEMINI_API_KEY — detection + rule-based patching only${RESET}`);
  }

  const renderer = new Renderer({ concurrency: 2, timeout: 15_000 });
  const llmClient = apiKey ? new GeminiClient({ apiKey }) : null;
  const results: ProjectResult[] = [];

  if (args.length > 0) {
    // Test local directories provided as arguments
    for (const dir of args) {
      const absDir = resolve(dir);
      const result = await testProject(renderer, absDir, absDir, llmClient);
      results.push(result);
    }
  } else {
    // Clone and test default repos
    const tmpBase = await mkdtemp(join(tmpdir(), "recast-test-"));
    console.log(`${DIM}Temp directory: ${tmpBase}${RESET}`);

    for (const project of DEFAULT_PROJECTS) {
      const projectDir = join(tmpBase, project.label.replace(/\s+/g, "-").toLowerCase());
      console.log(`\n${DIM}Cloning ${project.repo}...${RESET}`);

      try {
        execSync(`git clone --depth 1 ${project.repo} "${projectDir}"`, {
          stdio: "pipe",
          timeout: 30_000,
        });
      } catch (err) {
        console.log(`${RED}Clone failed: ${err instanceof Error ? err.message : err}${RESET}`);
        continue;
      }

      const result = await testProject(renderer, projectDir, project.label, llmClient);
      results.push(result);
    }

    // Cleanup
    console.log(`\n${DIM}Cleaning up temp directory...${RESET}`);
    await rm(tmpBase, { recursive: true, force: true });
  }

  // ── Final summary table ──
  console.log(`\n\n${BOLD}═══ Final Summary ═══${RESET}\n`);
  console.log(
    `${"Project".padEnd(25)} ${"Files".padEnd(7)} ${"Violations".padEnd(12)} ${"Auto-fix".padEnd(10)} ${"LLM".padEnd(7)} ${"Patches".padEnd(9)} ${"Time".padEnd(8)}`,
  );
  console.log("─".repeat(85));

  let sumViolations = 0, sumHigh = 0, sumLow = 0, sumPatches = 0;

  for (const r of results) {
    if (r.error && r.filesScanned === 0) {
      console.log(`${r.label.padEnd(25)} ${RED}${r.error}${RESET}`);
      continue;
    }
    sumViolations += r.totalViolations;
    sumHigh += r.highConfidence;
    sumLow += r.lowConfidence;
    sumPatches += r.patchesGenerated;

    console.log(
      `${r.label.padEnd(25)} ${String(r.filesScanned).padEnd(7)} ${String(r.totalViolations).padEnd(12)} ${GREEN}${String(r.highConfidence).padEnd(10)}${RESET} ${String(r.lowConfidence).padEnd(7)} ${GREEN}${String(r.patchesGenerated).padEnd(9)}${RESET} ${((r.scanDurationMs / 1000).toFixed(1) + "s").padEnd(8)}`,
    );
  }

  console.log("─".repeat(85));
  console.log(
    `${"TOTAL".padEnd(25)} ${"".padEnd(7)} ${String(sumViolations).padEnd(12)} ${GREEN}${String(sumHigh).padEnd(10)}${RESET} ${String(sumLow).padEnd(7)} ${GREEN}${String(sumPatches).padEnd(9)}${RESET}`,
  );

  const fixRate = sumViolations > 0 ? Math.round((sumHigh / sumViolations) * 100) : 0;
  console.log(`\n${BOLD}Rule-based fix rate: ${fixRate}%${RESET} of violations fixable without LLM`);
  if (sumPatches > 0) {
    console.log(`${BOLD}Patches generated:  ${sumPatches}${RESET} source code patches ready to apply`);
  }

  if (llmClient) {
    console.log();
    printCostSummary(llmClient.getCostSummary());
  }

  await renderer.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
