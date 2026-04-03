import { readFile, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { Renderer } from "@recast-a11y/renderer";
import { detect, enrichViolation } from "@recast-a11y/detector";
import { classify } from "@recast-a11y/classifier";
import type {
  ClassifiedViolation,
  Patch,
  ScanSummary,
  Impact,
  SiteType,
} from "@recast-a11y/classifier";
import { GeminiClient } from "@recast-a11y/llm";
import { traceToSource, traceInStaticHtml } from "@recast-a11y/tracer";
import { writePatch } from "@recast-a11y/patcher";
import {
  generateDiff,
  printScanStart,
  printViolationSummary,
  printPatchSummary,
  printFlaggedForReview,
  printSummary,
  printCostSummary,
} from "@recast-a11y/reporter";
import type { RecastConfig } from "./config.js";

export async function runScan(config: RecastConfig): Promise<void> {
  const allTargets = [...config.urls, ...config.files];
  if (allTargets.length === 0 && !config.dir) {
    console.error("No URLs, files, or directory specified. Use --help for usage.");
    process.exit(1);
  }

  printScanStart(allTargets);

  const renderer = new Renderer({
    concurrency: config.concurrency,
    timeout: config.timeout,
  });

  const llmClient = config.geminiApiKey
    ? new GeminiClient({ apiKey: config.geminiApiKey })
    : null;

  const allPatches: Patch[] = [];
  const allFlagged: ClassifiedViolation[] = [];
  const allViolations: ClassifiedViolation[] = [];
  const modifiedFiles = new Set<string>();
  const byImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const bySiteType: Record<SiteType, number> = { static: 0, ssr: 0, spa: 0 };

  for (const target of allTargets) {
    let page: Page | null = null;
    try {
      const isUrl = target.startsWith("http");
      const rendered = isUrl
        ? await renderer.renderUrl(target)
        : await renderer.renderHtml(
            await readFile(target, "utf-8"),
            `file://${target}`,
          );

      const p = rendered.page;
      page = p;
      const { result } = rendered;
      bySiteType[result.siteType]++;

      const { violations } = await detect(p, result.url);
      const classification = classify(violations, config.autoFixAbove);
      const allClassified = [...classification.high, ...classification.low];
      allViolations.push(...allClassified);

      for (const v of allClassified) {
        byImpact[v.violation.impact]++;
      }

      printViolationSummary(allClassified);

      for (const cv of classification.high) {
        const sourceRef = isUrl
          ? await traceToSource(p, cv.violation.target)
          : traceInStaticHtml(result.html, target, cv.violation.html);

        if (sourceRef && config.apply) {
          const patch = await writePatch(cv.violation, cv.fix, sourceRef);
          if (patch) {
            allPatches.push(patch);
            modifiedFiles.add(sourceRef.file);
          }
        } else if (sourceRef) {
          allPatches.push({
            sourceRef,
            violation: cv.violation,
            fix: cv.fix,
            originalCode: "",
            fixedCode: "",
          });
        }
      }

      if (llmClient && classification.low.length > 0) {
        const enriched = await Promise.all(
          classification.low.map((cv) => enrichViolation(p, cv.violation)),
        );
        const fixes = await llmClient.generateFixes(enriched);

        for (let i = 0; i < classification.low.length; i++) {
          const cv = classification.low[i];
          const fix = fixes[i];
          const updatedCv = { ...cv, fix };

          if (fix.confidence >= config.autoFixAbove) {
            const sourceRef = isUrl
              ? await traceToSource(p, cv.violation.target)
              : traceInStaticHtml(result.html, target, cv.violation.html);

            if (sourceRef && config.apply) {
              const patch = await writePatch(cv.violation, fix, sourceRef);
              if (patch) {
                allPatches.push(patch);
                modifiedFiles.add(sourceRef.file);
                continue;
              }
            }
          }
          allFlagged.push(updatedCv);
        }
      } else {
        allFlagged.push(...classification.low);
      }
    } catch (error) {
      console.error(`Error scanning ${target}:`, error);
    } finally {
      if (page) renderer.releasePage(page);
    }
  }

  printPatchSummary(allPatches);
  printFlaggedForReview(allFlagged);

  const summary: ScanSummary = {
    totalPages: allTargets.length,
    totalViolations: allViolations.length,
    autoFixed: allPatches.length,
    flaggedForReview: allFlagged.length,
    byImpact,
    bySiteType,
    modifiedFiles: [...modifiedFiles],
  };

  printSummary(summary);

  if (llmClient) {
    printCostSummary(llmClient.getCostSummary());
  }

  if (config.diffOutput && allPatches.length > 0) {
    const diff = generateDiff(allPatches);
    await writeFile(config.diffOutput, diff, "utf-8");
    console.log(`Diff written to ${config.diffOutput}`);
  } else if (!config.apply && allPatches.length > 0) {
    console.log("\n" + generateDiff(allPatches));
  }

  await renderer.close();
}
