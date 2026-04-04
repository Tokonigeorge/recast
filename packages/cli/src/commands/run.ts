import { readFile, readdir, access } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Page } from "playwright";
import { Renderer, discoverLinks } from "@recast-a11y/renderer";
import { detect, enrichViolation } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type { ClassifiedViolation, Patch } from "@recast-a11y/classifier";
import { LlmClient, detectProvider } from "@recast-a11y/llm";
import { traceToSource, traceInStaticHtml, resolveSourcePath } from "@recast-a11y/tracer";
import { patchHtml, patchJsx, writePatch } from "@recast-a11y/patcher";
import { printCostSummary, buildReportData, generateHtmlReport, serveReport } from "@recast-a11y/reporter";
import type { RecastConfig } from "../config.js";
import { detectProject, startDevServer, stopDevServer, parseGitHubTarget, cloneAndInstall, type ClonedProject } from "../project.js";
import {
  spinner, confirm, waitForEnter,
  printDiffBlock, printHeader, printViolationTable,
  type ViolationRow,
} from "../ui.js";

const B = "\x1b[1m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const D = "\x1b[2m";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

interface ScanTarget {
  url: string;
  projectRoot: string;
  isUrl: boolean;
  serverProcess?: ChildProcess;
  clonedProject?: ClonedProject;
}

async function resolveTargets(rawTargets: string[], configRoot?: string): Promise<ScanTarget[]> {
  const targets: ScanTarget[] = [];

  for (const t of rawTargets) {
    // GitHub shorthand: github:user/repo or https://github.com/user/repo
    const gh = parseGitHubTarget(t);
    if (gh) {
      let cloned: ClonedProject | null = null;
      const s = spinner(`Cloning ${gh.repo}`);
      try {
        cloned = await cloneAndInstall(gh.url, (msg) => {
          s.stop();
          console.log(`  ${D}${msg}...${R}`);
        });
        s.stop(`  ${G}✓${R} Cloned ${gh.repo}`);

        const project = await detectProject(cloned.root);
        if (project) {
          const s2 = spinner(`Starting ${project.framework} dev server`);
          const { process: child, url } = await startDevServer(project);
          s2.stop(`  ${G}✓${R} ${project.framework} server running at ${D}${url}${R}`);
          targets.push({ url, projectRoot: project.root, isUrl: true, serverProcess: child, clonedProject: cloned });
        } else {
          console.log(`  ${Y}No framework detected in ${gh.repo}${R}`);
          await cloned.cleanup();
        }
      } catch (err) {
        s.stop(`  ${Y}Failed: ${err instanceof Error ? err.message : err}${R}`);
        if (cloned) await cloned.cleanup().catch(() => {});
      }
      continue;
    }

    // Regular URL (live site audit)
    if (t.startsWith("http")) {
      targets.push({ url: t, projectRoot: configRoot ?? process.cwd(), isUrl: true });
      continue;
    }

    const absPath = resolve(t);

    // Project directory (has package.json)
    const project = await detectProject(absPath);
    if (project) {
      const s = spinner(`Starting ${project.framework} dev server`);
      try {
        const { process: child, url } = await startDevServer(project);
        s.stop(`  ${G}✓${R} ${project.framework} server running at ${D}${url}${R}`);
        targets.push({ url, projectRoot: project.root, isUrl: true, serverProcess: child });
      } catch (err) {
        s.stop(`  ${Y}Could not start dev server: ${err instanceof Error ? err.message : err}${R}`);
      }
      continue;
    }

    // Plain directory — find HTML files
    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && HTML_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          const filePath = join(absPath, entry.name);
          targets.push({ url: `file://${filePath}`, projectRoot: absPath, isUrl: false });
        }
      }
    } catch {
      targets.push({ url: `file://${absPath}`, projectRoot: configRoot ?? process.cwd(), isUrl: false });
    }
  }

  return targets;
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
  if (config.targets.length === 0) {
    console.error("No targets specified. Use --help for usage.");
    process.exit(1);
  }

  printHeader();

  const resolved = detectProvider({ provider: config.provider, apiKey: config.apiKey });
  let llmClient: LlmClient | null = null;

  if (resolved) {
    llmClient = new LlmClient({ provider: resolved.provider, apiKey: resolved.apiKey, model: config.model });
    console.log(`  ${D}LLM: ${resolved.provider} (${llmClient.modelName})${R}\n`);
  } else {
    console.log(`  ${D}No API key found. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for LLM fixes.${R}`);
    console.log(`  ${D}Proceeding with rule-based auto-fixes only.${R}\n`);
  }

  const targets = await resolveTargets(config.targets, config.projectRoot);
  if (targets.length === 0) {
    console.error("No scannable targets found.");
    process.exit(1);
  }

  const renderer = new Renderer({ concurrency: config.concurrency, timeout: config.timeout });
  const allPatches: Patch[] = [];
  let reportServer: { url: string; close: () => void } | null = null;
  const scannedUrls = new Set<string>();

  // Build a mutable queue — crawled pages get added during the loop
  const queue: ScanTarget[] = [...targets];

  while (queue.length > 0) {
    const target = queue.shift()!;

    // Skip duplicate URLs (from crawling)
    const normalizedUrl = target.url.replace(/\/$/, "");
    if (scannedUrls.has(normalizedUrl)) continue;
    scannedUrls.add(normalizedUrl);
    let page: Page | null = null;

    try {
      // ── 1. Scan ──
      const s1 = spinner(`Scanning ${target.url}`);
      const rendered = target.isUrl
        ? await renderer.renderUrl(target.url)
        : await renderer.renderHtml(
            await readFile(target.url.replace("file://", ""), "utf-8"),
            target.url,
          );
      page = rendered.page;
      const p = page;
      s1.stop();

      // Discover internal links for multi-page crawling
      if (target.isUrl && scannedUrls.size <= 20) {
        try {
          const links = await discoverLinks(p, target.url);
          const newLinks = links.filter((l) => !scannedUrls.has(l.replace(/\/$/, "")));
          if (newLinks.length > 0) {
            console.log(`  ${D}Found ${newLinks.length} more pages to scan${R}`);
            for (const link of newLinks.slice(0, 20 - scannedUrls.size)) {
              queue.push({ url: link, projectRoot: target.projectRoot, isUrl: true, serverProcess: undefined });
            }
          }
        } catch {}
      }

      const s2 = spinner("Running accessibility checks");
      const { violations: rawViolations } = await detect(p, rendered.result.url);
      s2.stop();

      // Filter out dev tooling (Vite error overlay, HMR elements, etc.)
      const DEV_TOOL_PATTERNS = ["vite-error-overlay", "__vite", "__next", "__nuxt", "webpack-dev-server"];
      const violations = rawViolations.filter((v) =>
        !DEV_TOOL_PATTERNS.some((p) => v.target.includes(p) || v.html.includes(p)),
      );

      if (violations.length === 0) {
        console.log(`  ${G}✓${R} ${target.url} — no violations\n`);
        continue;
      }

      const classification = classify(violations, config.autoFixAbove);
      const html = rendered.result.html;

      // ── 2. Run LLM for low-confidence violations ──
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
            classification.low[i] = updated;
          }
        }
      }

      // ── 3. Build patches (trace to source for URL scans) ──
      const projectRoot = target.projectRoot;
      const allPatchData: Array<{ cv: ClassifiedViolation; patch: Patch }> = [];

      for (const cv of allFixable) {
        let sourceRef;

        if (target.isUrl) {
          // Root HTML violations (html-has-lang, document-title) target <html>
          // which has no React fiber — fall back to the project's index.html
          if (cv.violation.target === "html" || cv.violation.html.startsWith("<html")) {
            const indexPath = join(projectRoot, "index.html");
            try {
              const indexContents = await readFile(indexPath, "utf-8");
              sourceRef = traceInStaticHtml(indexContents, indexPath, cv.violation.html);
            } catch {}
          }

          if (!sourceRef) {
            const traced = await traceToSource(p, cv.violation.target);
            if (traced) {
              const resolvedFile = resolveSourcePath(traced.file, projectRoot);
              try {
                const sourceContents = await readFile(resolvedFile, "utf-8");
                const jsxHtml = cv.violation.html.replace(/\bclass="/g, 'className="').replace(/\bfor="/g, 'htmlFor="');
                sourceRef = traceInStaticHtml(sourceContents, resolvedFile, cv.violation.html)
                  ?? traceInStaticHtml(sourceContents, resolvedFile, jsxHtml)
                  ?? { file: resolvedFile, line: traced.line };
              } catch {
                sourceRef = { file: resolvedFile, line: traced.line };
              }
            }
          }
        } else {
          const localFile = target.url.replace("file://", "");
          sourceRef = traceInStaticHtml(html, localFile, cv.violation.html);
        }

        if (!sourceRef) continue;

        let original: string;
        let fixed: string;

        if (target.isUrl && sourceRef.file !== target.url) {
          try {
            const sourceContents = await readFile(sourceRef.file, "utf-8");
            const ext = sourceRef.file.match(/\.(jsx|tsx|js|ts)$/i);
            const patched = ext
              ? patchJsx(sourceContents, sourceRef, cv.violation.html, cv.fix)
              : patchHtml(sourceContents, sourceRef, cv.violation.html, cv.fix);
            if (!patched || patched === sourceContents) continue;
            original = sourceContents.split("\n")[sourceRef.line - 1]?.trim() ?? "";
            fixed = patched.split("\n")[sourceRef.line - 1]?.trim() ?? "";
          } catch { continue; }
        } else {
          const patched = patchHtml(html, sourceRef, cv.violation.html, cv.fix);
          if (!patched || patched === html) continue;
          const d = conciseDiff(html, sourceRef, cv.violation.html, cv.fix);
          original = d.original;
          fixed = d.fixed;
        }

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
      printViolationTable(rows, target.url);

      const fixableCount = allPatchData.length;
      const llmFlagged = classification.low.filter((cv) => cv.fix.confidence < config.autoFixAbove).length;

      console.log(
        `\n  ${B}${violations.length}${R} violations` +
        `  ${G}${fixableCount} fixable${R}` +
        (llmFlagged > 0 ? `  ${Y}${llmFlagged} flagged${R}` : "") +
        `  ${D}${classification.skipped.length} skipped (CSS/manual)${R}`,
      );

      // Explain flagged violations so the user knows what to do
      if (llmFlagged > 0) {
        const flaggedItems = classification.low.filter((cv) => cv.fix.confidence < config.autoFixAbove);
        console.log(`\n  ${Y}Flagged for review${R} ${D}(LLM suggested a fix but confidence < ${config.autoFixAbove} — needs human judgment):${R}`);
        for (const cv of flaggedItems) {
          const conf = cv.fix.confidence > 0 ? ` [${cv.fix.confidence.toFixed(2)}]` : "";
          console.log(`    ${Y}${cv.violation.ruleId}${R}${D}${conf}${R} ${cv.violation.target}`);
          if (cv.fix.reasoning && cv.fix.reasoning !== "Requires LLM analysis for correct fix") {
            console.log(`      ${D}Suggestion: ${cv.fix.reasoning}${R}`);
          }
        }
        console.log();
      }

      // ── 5. Open browser report ──
      const reportData = buildReportData(target.url, classification.high, classification.low, classification.skipped, allPatchData);
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
        console.log(`  ${D}No fixes above confidence threshold.${R}`);
        if (violations.length > 0) {
          console.log(`  ${D}Review the ${violations.length} violations in the browser report above.${R}`);
          await waitForEnter();
        }
        continue;
      }

      // ── 6. Show diffs ──
      console.log(`  ${B}${fixableCount} fixes:${R}\n`);
      for (const { cv, patch } of allPatchData) {
        console.log(`  ${D}[${cv.fix.confidence.toFixed(2)}]${R} ${B}${cv.violation.ruleId}${R} — ${cv.fix.reasoning}`);
        printDiffBlock(patch.originalCode, patch.fixedCode, patch.sourceRef.file, patch.sourceRef.line);
      }

      // ── 7. Apply ──
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

      const modifiedFiles = [...new Set(allPatchData.map((tp) => tp.patch.sourceRef.file))];
      console.log(`  ${G}✓ Applied ${fixableCount} fixes to ${modifiedFiles.length} file${modifiedFiles.length > 1 ? "s" : ""}:${R}`);
      for (const f of modifiedFiles) {
        console.log(`    ${D}${f}${R}`);
      }
      if (isGitRepo()) {
        console.log(`  ${D}Review: git diff | Revert: git checkout -- <file>${R}\n`);
      }

    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : error}\n`);
    } finally {
      if (page) renderer.releasePage(page);
    }
  }

  // Cleanup
  if (reportServer) reportServer.close();
  for (const t of targets) {
    if (t.serverProcess) stopDevServer(t.serverProcess);
    if (t.clonedProject) await t.clonedProject.cleanup();
  }
  if (llmClient && llmClient.getCostSummary().totalCalls > 0) {
    printCostSummary(llmClient.getCostSummary());
  }

  if (allPatches.length > 0) {
    const fileCount = new Set(allPatches.map((p) => p.sourceRef.file)).size;
    console.log(`${B}Done: ${allPatches.length} fixes applied across ${fileCount} file${fileCount > 1 ? "s" : ""}${R}\n`);
  }

  await renderer.close();
  process.exit(0);
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
