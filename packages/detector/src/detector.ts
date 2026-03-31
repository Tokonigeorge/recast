import type { Page } from "playwright";
import type { Violation, EnrichedViolation } from "@recast-a11y/classifier";
import { runAxe } from "./axe-runner.js";
import { runCustomChecks } from "./custom-checks.js";
import {
  captureAriaSnapshot,
  captureLocalAriaContext,
  getNearestLandmark,
} from "./aria-snapshot.js";

export interface DetectionResult {
  /** All violations found (axe-core + custom checks) */
  violations: Violation[];
  /** Full page ARIA snapshot (YAML) */
  ariaSnapshot: string;
}

/**
 * Run all violation detection on an already-rendered page.
 * Combines axe-core results with custom checks. Deduplicates by target + ruleId.
 */
export async function detect(
  page: Page,
  pageUrl: string,
): Promise<DetectionResult> {
  // Run axe-core and custom checks in parallel
  const [axeViolations, customViolations, ariaSnapshot] = await Promise.all([
    runAxe(page, pageUrl),
    runCustomChecks(page, pageUrl),
    captureAriaSnapshot(page),
  ]);

  // Deduplicate: custom checks may overlap with axe-core
  const seen = new Set<string>();
  const violations: Violation[] = [];

  for (const v of [...axeViolations, ...customViolations]) {
    const key = `${v.ruleId}::${v.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push(v);
    }
  }

  return { violations, ariaSnapshot };
}

/**
 * Enrich low-confidence violations with ARIA context for LLM processing.
 * Only called for violations that need LLM — saves time on high-confidence ones.
 */
export async function enrichViolation(
  page: Page,
  violation: Violation,
): Promise<EnrichedViolation> {
  const [ariaContext, landmark] = await Promise.all([
    captureLocalAriaContext(page, violation.target),
    getNearestLandmark(page, violation.target),
  ]);

  return {
    ...violation,
    ariaContext,
    section: landmark.section,
    pageTitle: landmark.pageTitle,
  };
}
