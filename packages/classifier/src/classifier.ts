import type {
  Violation,
  ClassifiedViolation,
  ClassificationResult,
  ConfidenceLevel,
} from "./types.js";
import { tryHighConfidenceFix } from "./rules.js";

/** Default: auto-apply fixes at or above this confidence */
const DEFAULT_THRESHOLD = 0.85;

/**
 * Classify violations into high-confidence (rule-based) and low-confidence (needs LLM).
 *
 * High-confidence violations get an immediate fix from the rules engine.
 * Low-confidence violations are passed through with a placeholder requiring LLM processing.
 */
export function classify(
  violations: Violation[],
  threshold = DEFAULT_THRESHOLD,
): ClassificationResult {
  const high: ClassifiedViolation[] = [];
  const low: ClassifiedViolation[] = [];

  for (const violation of violations) {
    const fix = tryHighConfidenceFix(violation);

    if (fix && fix.confidence >= threshold) {
      high.push({ violation, level: "high" as ConfidenceLevel, fix });
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

  return { high, low };
}
