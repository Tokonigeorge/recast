import type {
  ScanSummary,
  ClassifiedViolation,
  Patch,
  Impact,
} from "@recast-a11y/classifier";

export interface CostSummaryData {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  byRule: Record<string, { calls: number; tokens: number; cost: number }>;
}

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

function formatUsd(amount: number): string {
  if (amount < 0.001) return `$${amount.toFixed(6)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function printCostSummary(cost: CostSummaryData): void {
  if (cost.totalCalls === 0) {
    console.log(`${BOLD}─── LLM Cost ───${RESET}`);
    console.log("No LLM calls made (all fixes were high-confidence rules).\n");
    return;
  }

  const DIM = "\x1b[2m";

  console.log(`${BOLD}─── LLM Cost ───${RESET}`);
  console.log(`Total LLM calls:     ${cost.totalCalls}`);
  console.log(`Input tokens:        ${cost.totalInputTokens.toLocaleString()}${cost.totalCachedTokens > 0 ? ` ${DIM}(${cost.totalCachedTokens.toLocaleString()} cached)${RESET}` : ""}`);
  console.log(`Output tokens:       ${cost.totalOutputTokens.toLocaleString()}`);
  console.log(`Total tokens:        ${cost.totalTokens.toLocaleString()}`);
  console.log(`${BOLD}Total cost:          ${formatUsd(cost.totalCost)}${RESET}`);

  // By model breakdown
  const models = Object.entries(cost.byModel);
  if (models.length > 0) {
    console.log(`\n  By model:`);
    for (const [model, data] of models) {
      const shortName = model.replace(/^gemini-/, "").replace(/-preview.*$/, "");
      console.log(`    ${shortName}: ${data.calls} calls, ${data.tokens.toLocaleString()} tokens, ${formatUsd(data.cost)}`);
    }
  }

  // Top rules by cost
  const rules = Object.entries(cost.byRule).sort((a, b) => b[1].cost - a[1].cost);
  if (rules.length > 0) {
    console.log(`\n  By rule:`);
    for (const [rule, data] of rules.slice(0, 5)) {
      console.log(`    ${rule}: ${data.calls} calls, ${formatUsd(data.cost)}`);
    }
  }

  console.log();
}
