import type {
  Violation,
  ClassifiedViolation,
  ClassificationResult,
  ConfidenceLevel,
} from "./types.js";
import { tryHighConfidenceFix, SKIP_RULES } from "./rules.js";

/** Default: auto-apply fixes at or above this confidence */
const DEFAULT_THRESHOLD = 0.85;

/**
 * Classify violations into high-confidence (rule-based), low-confidence (needs LLM),
 * and skipped (CSS-only / unfixable by Recast).
 *
 * High-confidence violations get an immediate fix from the rules engine.
 * Low-confidence violations are passed through for LLM processing.
 * Skipped violations are reported but never sent to the LLM.
 */
export function classify(
  violations: Violation[],
  threshold = DEFAULT_THRESHOLD,
): ClassificationResult {
  const high: ClassifiedViolation[] = [];
  const low: ClassifiedViolation[] = [];
  const skipped: ClassifiedViolation[] = [];

  for (const violation of violations) {
    // Skip CSS-only and unfixable violations entirely
    if (SKIP_RULES.has(violation.ruleId)) {
      skipped.push({
        violation,
        level: "skip" as ConfidenceLevel,
        fix: {
          type: "manual-required",
          reasoning: violation.description,
          confidence: 0,
        },
      });
      continue;
    }

    const fix = tryHighConfidenceFix(violation);

    if (fix && fix.confidence >= threshold) {
      high.push({ violation, level: "high" as ConfidenceLevel, fix });
    } else if (fix && fix.type === "manual-required" && fix.confidence === 0) {
      // Rules that explicitly return manual-required with 0 confidence
      // are structural issues — report but don't send to LLM
      skipped.push({ violation, level: "skip" as ConfidenceLevel, fix });
    } else {
      low.push({
        violation,
        level: "low" as ConfidenceLevel,
        fix: fix ?? {
          type: "manual-required",
          reasoning: "Requires LLM analysis for correct fix",
          confidence: 0,
        },
      });
    }
  }

  return { high, low, skipped };
}
