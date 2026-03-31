import type {
  ScanSummary,
  ClassifiedViolation,
  Patch,
  Impact,
} from "@recast-a11y/classifier";

const IMPACT_COLORS: Record<Impact, string> = {
  critical: "\x1b[31m", // red
  serious: "\x1b[33m",  // yellow
  moderate: "\x1b[36m", // cyan
  minor: "\x1b[90m",    // gray
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";

export function printScanStart(urls: string[]): void {
  console.log(`\n${BOLD}Recast${RESET} — Automated Accessibility Rewriter\n`);
  console.log(`Scanning ${urls.length} page${urls.length > 1 ? "s" : ""}...\n`);
}

export function printViolationSummary(
  violations: ClassifiedViolation[],
): void {
  const byImpact: Record<string, number> = {};
  for (const v of violations) {
    const imp = v.violation.impact;
    byImpact[imp] = (byImpact[imp] ?? 0) + 1;
  }

  console.log(
    `Found ${BOLD}${violations.length}${RESET} violations:`,
  );
  for (const impact of ["critical", "serious", "moderate", "minor"] as Impact[]) {
    const count = byImpact[impact] ?? 0;
    if (count > 0) {
      console.log(
        `  ${IMPACT_COLORS[impact]}${impact}${RESET}: ${count}`,
      );
    }
  }
  console.log();
}

export function printPatchSummary(patches: Patch[]): void {
  if (patches.length === 0) {
    console.log("No patches applied.\n");
    return;
  }

  const byFile = new Map<string, number>();
  for (const p of patches) {
    byFile.set(p.sourceRef.file, (byFile.get(p.sourceRef.file) ?? 0) + 1);
  }

  console.log(`${GREEN}Auto-fixed ${patches.length} violation${patches.length > 1 ? "s" : ""}:${RESET}`);
  for (const [file, count] of byFile) {
    console.log(`  ${file}: ${count} fix${count > 1 ? "es" : ""}`);
  }
  console.log();
}

export function printFlaggedForReview(violations: ClassifiedViolation[]): void {
  if (violations.length === 0) return;

  console.log(
    `Flagged ${BOLD}${violations.length}${RESET} violation${violations.length > 1 ? "s" : ""} for review:\n`,
  );

  for (const v of violations) {
    const imp = v.violation.impact;
    console.log(
      `  ${IMPACT_COLORS[imp]}[${imp}]${RESET} ${v.violation.ruleId} — ${v.violation.description}`,
    );
    console.log(`    ${v.violation.target}`);
    if (v.fix.reasoning) {
      console.log(`    → ${v.fix.reasoning}`);
    }
    console.log();
  }
}

export function printSummary(summary: ScanSummary): void {
  console.log(`${BOLD}─── Summary ───${RESET}`);
  console.log(`Pages scanned:       ${summary.totalPages}`);
  console.log(`Total violations:    ${summary.totalViolations}`);
  console.log(`${GREEN}Auto-fixed:          ${summary.autoFixed}${RESET}`);
  console.log(`Flagged for review:  ${summary.flaggedForReview}`);

  if (summary.modifiedFiles.length > 0) {
    console.log(`\nModified files:`);
    for (const f of summary.modifiedFiles) {
      console.log(`  ${f}`);
    }
  }

  const pct = summary.totalViolations > 0
    ? Math.round((summary.autoFixed / summary.totalViolations) * 100)
    : 0;
  console.log(
    `\nEstimated compliance improvement: ${summary.autoFixed}/${summary.totalViolations} violations resolved (${pct}%)\n`,
  );
}
