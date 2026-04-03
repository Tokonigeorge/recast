import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";
import type { Page } from "playwright";
import { Renderer } from "@recast-a11y/renderer";
import { detect, enrichViolation } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type { ClassifiedViolation, Patch } from "@recast-a11y/classifier";
import { LlmClient, detectProvider } from "@recast-a11y/llm";
import { traceInStaticHtml } from "@recast-a11y/tracer";
import { patchHtml, writePatch } from "@recast-a11y/patcher";
import { printCostSummary, buildReportData, generateHtmlReport, serveReport } from "@recast-a11y/reporter";
import type { RecastConfig } from "../config.js";
import {
  spinner, confirm, choose,
  printDiffBlock, printHeader, printViolationTable,
  type ViolationRow,
} from "../ui.js";

const B = "\x1b[1m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const D = "\x1b[2m";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

async function resolveTargets(targets: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const t of targets) {
    if (t.startsWith("http")) { files.push(t); continue; }
    try {
      const entries = await readdir(t, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && HTML_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          files.push(join(t, entry.name));
        }
      }
    } catch { files.push(t); }
  }
  return files;
}

function isGitRepo(): boolean {
  try { execSync("git rev-parse --git-dir", { stdio: "pipe" }); return true; }
  catch { return false; }
}

function isGitClean(): boolean {
  try {
    execSync("git rev-parse --git-dir", { stdio: "pipe" });
    return execSync("git status --porcelain", { stdio: "pipe" }).toString().trim().length === 0;
  } catch { return true; }
}

function conciseDiff(
  fullHtml: string,
  sourceRef: { file: string; line: number },
  elementHtml: string,
  fix: { type: string; attribute?: string; value?: string; newElement?: string },
): { original: string; fixed: string } {
  const line = fullHtml.split("\n")[sourceRef.line - 1] ?? "";

  if (line.length < 200) {
    const patched = patchHtml(fullHtml, sourceRef, elementHtml, fix as Parameters<typeof patchHtml>[3]);
    const fixedLine = patched ? patched.split("\n")[sourceRef.line - 1] ?? "" : line;
    return { original: line.trim(), fixed: fixedLine.trim() };
  }

  const original = elementHtml.slice(0, 200);
  let fixed = original;
  if (fix.type === "add-attribute" && fix.attribute && fix.value !== undefined) {
    const tagMatch = original.match(/<(\w+)/);
    if (tagMatch) fixed = original.replace(new RegExp(`(<${tagMatch[1]}\\b)`), `$1 ${fix.attribute}="${fix.value}"`);
  } else if (fix.type === "remove-attribute" && fix.attribute) {
    fixed = original.replace(new RegExp(`\\s*${fix.attribute}\\s*=\\s*"[^"]*"`), "");
  } else if (fix.type === "change-element" && fix.newElement) {
    const tagMatch = original.match(/<(\w+)/);
    if (tagMatch) fixed = original.replace(tagMatch[1], fix.newElement);
  }
  return { original, fixed };
}

export async function run(config: RecastConfig): Promise<void> {
  const targets = await resolveTargets(config.targets);
  if (targets.length === 0) {
    console.error("No HTML files found in the given targets.");
    process.exit(1);
  }

  printHeader();

  // ── Detect LLM provider ──
  const resolved = detectProvider({ provider: config.provider, apiKey: config.apiKey });
  let llmClient: LlmClient | null = null;

  if (resolved) {
    llmClient = new LlmClient({
      provider: resolved.provider,
      apiKey: resolved.apiKey,
      model: config.model,
    });
    console.log(`  ${D}LLM: ${resolved.provider} (${llmClient.modelName})${R}\n`);
  } else {
    console.log(`  ${D}No API key found. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for LLM fixes.${R}`);
    console.log(`  ${D}Proceeding with rule-based auto-fixes only.${R}\n`);
  }

  const renderer = new Renderer({ concurrency: config.concurrency, timeout: config.timeout });
  const allPatches: Patch[] = [];
  let reportServer: { url: string; close: () => void } | null = null;

  for (const target of targets) {
    let page: Page | null = null;

    try {
      // ── 1. Scan ──
      const s1 = spinner(`Scanning ${target}`);
      const isUrl = target.startsWith("http");
      const rendered = isUrl
        ? await renderer.renderUrl(target)
        : await renderer.renderHtml(await readFile(target, "utf-8"), `file://${target}`);
      page = rendered.page;
      const p = page;
      s1.stop();

      const s2 = spinner("Running accessibility checks");
      const { violations } = await detect(p, rendered.result.url);
      s2.stop();

      if (violations.length === 0) {
        console.log(`  ${G}✓${R} ${target} — no violations\n`);
        continue;
      }

      const classification = classify(violations, config.autoFixAbove);
      const html = isUrl ? rendered.result.html : await readFile(target, "utf-8");

      // ── 2. Run LLM for low-confidence violations (before showing anything) ──
      const allFixable: ClassifiedViolation[] = [...classification.high];

      if (llmClient && classification.low.length > 0) {
        const s3 = spinner(`Generating ${classification.low.length} fixes via ${llmClient.providerName}`);
        const enriched = await Promise.all(
          classification.low.map((cv) => enrichViolation(p, cv.violation)),
        );
        const fixes = await llmClient.generateFixes(enriched);
        s3.stop();

        for (let i = 0; i < classification.low.length; i++) {
          const fix = fixes[i];
          const updated = { ...classification.low[i], fix };
          if (fix.confidence >= config.autoFixAbove) {
            allFixable.push(updated);
            classification.low[i] = updated; // update for display
          }
        }
      }

      // ── 3. Build all patches ──
      const allPatchData: Array<{ cv: ClassifiedViolation; patch: Patch }> = [];
      for (const cv of allFixable) {
        const sourceRef = traceInStaticHtml(html, target, cv.violation.html);
        if (!sourceRef) continue;
        const patched = patchHtml(html, sourceRef, cv.violation.html, cv.fix);
        if (!patched || patched === html) continue;
        const { original, fixed } = conciseDiff(html, sourceRef, cv.violation.html, cv.fix);
        allPatchData.push({
          cv,
          patch: { sourceRef, violation: cv.violation, fix: cv.fix, originalCode: original, fixedCode: fixed },
        });
      }

      // ── 4. Show violations table ──
      const rows: ViolationRow[] = [
        ...classification.high.map((cv) => row(cv, "high")),
        ...classification.low.map((cv) => row(cv, "low")),
        ...classification.skipped.map((cv) => row(cv, "skip")),
      ];
      printViolationTable(rows, target);

      const fixableCount = allPatchData.length;
      const llmFlagged = classification.low.filter((cv) => cv.fix.confidence < config.autoFixAbove).length;

      console.log(
        `\n  ${B}${violations.length}${R} violations` +
        `  ${G}${fixableCount} fixable${R}` +
        (llmFlagged > 0 ? `  ${Y}${llmFlagged} flagged for review${R}` : "") +
        `  ${D}${classification.skipped.length} skipped${R}`,
      );

      // ── 5. Open browser report (with all diffs ready) ──
      const reportData = buildReportData(target, classification.high, classification.low, classification.skipped, allPatchData);
      const reportHtml = generateHtmlReport(reportData);
      reportServer = await serveReport({
        html: reportHtml,
        onFix: async (indices) => {
          let count = 0;
          for (const idx of indices) {
            const v = reportData.violations[idx];
            if (!v?.diff) continue;
            const match = allPatchData.find((tp) => tp.patch.sourceRef.line === v.diff!.line);
            if (match) {
              const applied = await writePatch(match.cv.violation, match.cv.fix, match.patch.sourceRef);
              if (applied) { allPatches.push(applied); count++; }
            }
          }
          return count;
        },
      });
      console.log(`  ${D}Report: ${reportServer.url}${R}\n`);

      if (fixableCount === 0) {
        console.log(`  ${D}No fixes above confidence threshold.${R}\n`);
        continue;
      }

      // ── 6. Show diffs ──
      console.log(`  ${B}${fixableCount} fixes ready:${R}\n`);
      for (const { cv, patch } of allPatchData) {
        console.log(`  ${D}[${cv.fix.confidence.toFixed(2)}]${R} ${B}${cv.violation.ruleId}${R} — ${cv.fix.reasoning}`);
        printDiffBlock(patch.originalCode, patch.fixedCode, patch.sourceRef.file, patch.sourceRef.line);
      }

      // ── 7. Apply (local files only — URLs can't be patched) ──
      if (isUrl) {
        console.log(`  ${D}Scanning a URL — diffs shown above. To apply, run recast against local source files.${R}\n`);
        continue;
      }

      if (isGitRepo() && !isGitClean()) {
        console.log(`  ${Y}You have uncommitted changes.${R} Fixes will be mixed with your working tree.`);
        console.log(`  ${D}Tip: git stash, run recast, then git stash pop${R}\n`);
      }

      const shouldApply = await confirm(`Apply ${fixableCount} fixes?`);

      if (!shouldApply) {
        console.log(`  ${D}Skipped.${R}\n`);
        continue;
      }

      for (const { cv, patch } of allPatchData) {
        const applied = await writePatch(cv.violation, cv.fix, patch.sourceRef);
        if (applied) allPatches.push(applied);
      }
      console.log(`  ${G}✓ Applied ${fixableCount} fixes${R}`);

      if (isGitRepo()) {
        const files = [...new Set(allPatchData.map((tp) => tp.patch.sourceRef.file))];
        try {
          execSync(`git add ${files.map((f) => `"${f}"`).join(" ")}`, { stdio: "pipe" });
          execSync(`git commit -m "recast: fix ${fixableCount} a11y violations"`, { stdio: "pipe" });
          console.log(`  ${D}Committed. Review: git diff HEAD~1 | Revert: git reset HEAD~1${R}\n`);
        } catch {
          console.log(`  ${D}Git commit failed — changes are unstaged.${R}\n`);
        }
      }

    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : error}\n`);
    } finally {
      if (page) renderer.releasePage(page);
    }
  }

  if (reportServer) reportServer.close();
  if (llmClient) printCostSummary(llmClient.getCostSummary());

  if (allPatches.length > 0) {
    const fileCount = new Set(allPatches.map((p) => p.sourceRef.file)).size;
    console.log(`${B}Done: ${allPatches.length} fixes applied across ${fileCount} file${fileCount > 1 ? "s" : ""}${R}\n`);
  }

  await renderer.close();
}

function row(cv: ClassifiedViolation, confidence: "high" | "low" | "skip"): ViolationRow {
  return {
    ruleId: cv.violation.ruleId,
    impact: cv.violation.impact,
    target: cv.violation.target,
    confidence,
    fix: confidence === "high" ? cv.fix.type : confidence === "skip" ? "css/manual" : "needs LLM",
  };
}
