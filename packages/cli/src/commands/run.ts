import { readFile, readdir } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Page } from "playwright";
import { Renderer, discoverLinks } from "@recast-a11y/renderer";
import { detect, enrichViolation, staticAnalyze } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type { Violation, ClassifiedViolation, Patch } from "@recast-a11y/classifier";
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
  const allPatches: Patch[] = [];

  // ── Static analysis first (instant, no server needed) ──
  // Only run on targets that have a real local project (not bare URLs)
  const projectRoots = new Set<string>();
  for (const t of targets) {
    if (t.serverProcess || t.clonedProject) {
      // Has a dev server we started — it's a real project
      projectRoots.add(t.projectRoot);
    }
  }
  for (const t of config.targets) {
    if (t.startsWith("http")) continue;
    if (parseGitHubTarget(t)) continue;
    projectRoots.add(resolve(t));
  }

  let reportServer: { url: string; close: () => void } | null = null;

  let staticViolationCount = 0;
  const staticResults: Array<{ file: string; violations: Violation[] }> = [];

  for (const root of projectRoots) {
    const s = spinner(`Scanning source files in ${root.split("/").slice(-2).join("/")}`);
    try {
      const results = await staticAnalyze(root);
      s.stop();
      for (const r of results) {
        staticResults.push(r);
        staticViolationCount += r.violations.length;
      }
    } catch {
      s.stop();
    }
  }

  if (staticViolationCount > 0) {
    console.log(`  ${B}Static analysis:${R} found ${B}${staticViolationCount}${R} violations across ${staticResults.length} files\n`);

    // Classify and build patches from static results
    const allStaticViolations: Violation[] = [];
    for (const r of staticResults) {
      allStaticViolations.push(...r.violations);
    }

    const classification = classify(allStaticViolations, config.autoFixAbove);

    // Show table
    const rows: ViolationRow[] = [
      ...classification.high.map((cv) => row(cv, "high")),
      ...classification.low.map((cv) => row(cv, "low")),
      ...classification.skipped.map((cv) => row(cv, "skip")),
    ];
    printViolationTable(rows, "Source files");

    const fixable = [...classification.high];

    // Run LLM for low-confidence violations with chunked processing for large codebases
    if (llmClient && classification.low.length > 0) {
      const CHUNK_SIZE = 100;
      const HARD_CAP = 500;
      const total = classification.low.length;

      // Estimate cost: ~1900 input + 150 output tokens per violation, flash-lite pricing
      const estTokens = total * 2050;
      const estCost = (total * 1900 / 1_000_000) * 0.10 + (total * 150 / 1_000_000) * 0.40;
      const estMinutes = Math.ceil(total / 5 * 2.5 / 60); // ~2.5s per batch of 5

      let toProcess: ClassifiedViolation[] = classification.low;

      if (total > HARD_CAP) {
        console.log(`  ${Y}⚠  ${total} violations need LLM fixes — too many to process at once.${R}`);
        console.log(`  ${D}Processing in chunks of ${CHUNK_SIZE}. You'll confirm between chunks.${R}\n`);
      } else if (total > CHUNK_SIZE) {
        console.log(`  ${Y}${total} violations need LLM fixes.${R}`);
        console.log(`  ${D}Estimated: ~${estMinutes} min, ~$${estCost.toFixed(3)}, ~${estTokens.toLocaleString()} tokens${R}`);
        const all = await confirm(`Process all ${total} now? (n = chunks of ${CHUNK_SIZE} with confirmation)`);
        if (!all) {
          // Fall through to chunked mode
        }
      }

      // Process in chunks, streaming results as each batch completes
      let processed = 0;
      while (processed < toProcess.length) {
        const end = Math.min(processed + CHUNK_SIZE, toProcess.length);
        const chunk = toProcess.slice(processed, end);

        const s3 = spinner(
          `Generating fixes ${processed + 1}-${end} of ${total} via ${llmClient.providerName}`,
        );
        const enriched = chunk.map((cv) => ({
          ...cv.violation,
          ariaContext: "",
          section: "unknown",
          pageTitle: "unknown",
        }));
        const fixes = await llmClient.generateFixes(enriched);
        s3.stop();

        let added = 0;
        for (let i = 0; i < chunk.length; i++) {
          const updated = { ...chunk[i], fix: fixes[i] };
          // Update the classification.low entry so it carries the LLM fix/reasoning
          // for display in the browser report (even if below threshold)
          const idx = classification.low.indexOf(chunk[i]);
          if (idx >= 0) classification.low[idx] = updated;
          if (fixes[i].confidence >= config.autoFixAbove) {
            fixable.push(updated);
            added++;
          }
        }
        const belowThreshold = chunk.length - added;
        console.log(
          `  ${G}✓${R} Batch ${Math.floor(processed / CHUNK_SIZE) + 1}: ` +
          `${chunk.length} processed — ${G}${added} ready${R}` +
          (belowThreshold > 0 ? `, ${Y}${belowThreshold} flagged${R} ${D}(below ${config.autoFixAbove} confidence — visible in browser report)${R}` : ""),
        );

        processed = end;

        // Ask to continue between chunks if there are more and we exceeded CHUNK_SIZE
        if (processed < toProcess.length && total > CHUNK_SIZE) {
          const remaining = toProcess.length - processed;
          const keepGoing = await confirm(`Continue with next ${Math.min(CHUNK_SIZE, remaining)} of ${remaining} remaining?`);
          if (!keepGoing) {
            console.log(`  ${D}Stopped. ${processed} of ${total} violations processed.${R}\n`);
            break;
          }
        }
      }
    }

    console.log(
      `\n  ${B}${allStaticViolations.length}${R} violations` +
      `  ${G}${fixable.length} fixable${R}` +
      `  ${D}${classification.skipped.length} skipped (CSS/manual)${R}\n`,
    );

    // Build patches — track why any fixes drop so we can diagnose
    const staticPatches: Array<{ cv: ClassifiedViolation; patch: Patch }> = [];
    const dropped: Array<{ cv: ClassifiedViolation; reason: string }> = [];

    for (const cv of fixable) {
      // If the LLM gave up (manual-required with 0 confidence), it's not a real fix
      if (cv.fix.type === "manual-required") {
        dropped.push({ cv, reason: `LLM couldn't produce a fix: ${cv.fix.reasoning}` });
        continue;
      }

      const sourceRef = cv.violation.line
        ? { file: cv.violation.pageUrl, line: cv.violation.line }
        : traceInStaticHtml(
            await readFile(cv.violation.pageUrl, "utf-8"),
            cv.violation.pageUrl,
            cv.violation.html,
          );
      if (!sourceRef) {
        dropped.push({ cv, reason: "Could not locate element in source file" });
        continue;
      }

      const sourceContents = await readFile(sourceRef.file, "utf-8");
      const ext = sourceRef.file.match(/\.(jsx|tsx|js|ts)$/i);
      const patched = ext
        ? patchJsx(sourceContents, sourceRef, cv.violation.html, cv.fix)
        : patchHtml(sourceContents, sourceRef, cv.violation.html, cv.fix);

      if (!patched) {
        dropped.push({ cv, reason: `Patcher could not apply ${cv.fix.type} — element structure too complex` });
        continue;
      }
      if (patched === sourceContents) {
        dropped.push({ cv, reason: "Attribute already present or patch was a no-op" });
        continue;
      }

      const origLines = sourceContents.split("\n");
      const newLines = patched.split("\n");
      let changedLine = sourceRef.line - 1;
      for (let i = sourceRef.line - 1; i < Math.min(origLines.length, newLines.length); i++) {
        if (origLines[i] !== newLines[i]) { changedLine = i; break; }
      }
      const original = origLines[changedLine]?.trim() ?? "";
      const fixed = newLines[changedLine]?.trim() ?? "";
      if (original === fixed) {
        dropped.push({ cv, reason: "Diff was empty after patching" });
        continue;
      }

      staticPatches.push({
        cv,
        patch: {
          sourceRef: { ...sourceRef, line: changedLine + 1 },
          violation: cv.violation, fix: cv.fix,
          originalCode: original, fixedCode: fixed,
        },
      });
    }

    // Show diagnostics if any fixes dropped
    if (dropped.length > 0) {
      const byReason: Record<string, number> = {};
      const examplesByReason: Record<string, string> = {};
      for (const d of dropped) {
        // Group by a normalized reason key
        const key = d.reason.split(":")[0].split("—")[0].trim();
        byReason[key] = (byReason[key] ?? 0) + 1;
        if (!examplesByReason[key]) {
          examplesByReason[key] = `${d.cv.violation.ruleId} in ${d.cv.violation.pageUrl.split("/").slice(-2).join("/")}:${d.cv.violation.line}`;
        }
      }

      console.log(`  ${Y}${dropped.length} fixes dropped${R} ${D}(LLM approved but couldn't be applied):${R}`);
      for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${D}${count}× ${R}${reason}`);
        console.log(`      ${D}e.g. ${examplesByReason[reason]}${R}`);
      }
      console.log();
    }

    // Open browser report for static analysis violations
    const projectRootForReport = [...projectRoots][0] ?? process.cwd();
    const staticReportData = buildReportData(
      projectRootForReport,
      classification.high,
      classification.low,
      classification.skipped,
      staticPatches,
    );
    const staticReportHtml = generateHtmlReport(staticReportData);
    reportServer = await serveReport({
      html: staticReportHtml,
      onFix: async (indices) => {
        let count = 0;
        for (const idx of indices) {
          const v = staticReportData.violations[idx];
          if (!v?.diff) continue;
          const match = staticPatches.find(
            (tp) => tp.patch.sourceRef.file === v.diff!.file && tp.patch.sourceRef.line === v.diff!.line,
          );
          if (match) {
            const applied = await writePatch(match.cv.violation, match.cv.fix, match.patch.sourceRef);
            if (applied) { allPatches.push(applied); count++; }
          }
        }
        return count;
      },
    });
    console.log(`  ${D}Report: ${reportServer.url}${R}\n`);

    if (staticPatches.length > 0) {
      console.log(`  ${B}${staticPatches.length} fixes:${R}\n`);
      for (const { cv, patch } of staticPatches) {
        console.log(`  ${D}[${cv.fix.confidence.toFixed(2)}]${R} ${B}${cv.violation.ruleId}${R} — ${cv.fix.reasoning}`);
        printDiffBlock(patch.originalCode, patch.fixedCode, patch.sourceRef.file, patch.sourceRef.line);
      }

      if (isGitRepo() && !isGitClean()) {
        console.log(`  ${Y}You have uncommitted changes.${R}`);
        console.log(`  ${D}Tip: git stash, run recast, then git stash pop${R}\n`);
      }

      const shouldApply = await confirm(`Apply ${staticPatches.length} fixes?`);
      if (shouldApply) {
        for (const { cv, patch } of staticPatches) {
          const applied = await writePatch(cv.violation, cv.fix, patch.sourceRef);
          if (applied) allPatches.push(applied);
        }
        const modifiedFiles = [...new Set(staticPatches.map((tp) => tp.patch.sourceRef.file))];
        console.log(`  ${G}✓ Applied ${staticPatches.length} fixes to ${modifiedFiles.length} file${modifiedFiles.length > 1 ? "s" : ""}:${R}`);
        for (const f of modifiedFiles) console.log(`    ${D}${f}${R}`);
        if (isGitRepo()) console.log(`  ${D}Review: git diff | Revert: git checkout -- <file>${R}`);
        console.log();
      }
    }

    // Ask if user wants browser scan too
    if (targets.some((t) => t.isUrl)) {
      const doBrowser = await confirm("Run browser scan for color contrast, ARIA tree, and keyboard issues?", false);
      if (!doBrowser) {
        // Skip browser scan — cleanup and exit
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
        await new Promise<void>((r) => setTimeout(r, 100));
        process.exit(0);
      }
    }
  } else if (targets.length === 0) {
    console.error("No scannable targets found.");
    process.exit(1);
  }

  // ── Browser scan (deeper analysis) ──
  if (!targets.some((t) => t.isUrl)) {
    // No URLs to scan — we're done
    if (allPatches.length > 0) {
      const fileCount = new Set(allPatches.map((p) => p.sourceRef.file)).size;
      console.log(`${B}Done: ${allPatches.length} fixes applied across ${fileCount} file${fileCount > 1 ? "s" : ""}${R}\n`);
    }
    process.exit(0);
  }

  console.log(`\n  ${B}Browser scan${R} ${D}(color contrast, ARIA tree, keyboard issues)${R}\n`);

  const renderer = new Renderer({ concurrency: config.concurrency, timeout: config.timeout });
  // Close any existing static report server before opening a new one for the browser scan
  if (reportServer) { reportServer.close(); reportServer = null; }
  const scannedUrls = new Set<string>();

  const queue: ScanTarget[] = [...targets.filter((t) => t.isUrl)];

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
      let rendered;
      try {
        rendered = target.isUrl
          ? await renderer.renderUrl(target.url)
          : await renderer.renderHtml(
              await readFile(target.url.replace("file://", ""), "utf-8"),
              target.url,
            );
        s1.stop();
      } catch (loadErr) {
        s1.stop(`  ${Y}✗ ${target.url}${R} — ${loadErr instanceof Error ? loadErr.message : "failed to load"}`);
        continue;
      }
      page = rendered.page;
      const p = page;

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
