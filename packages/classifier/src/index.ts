export { classify } from "./classifier.js";
export { tryHighConfidenceFix, HIGH_CONFIDENCE_RULES, SKIP_RULES } from "./rules.js";
export type {
  Violation,
  EnrichedViolation,
  Fix,
  FixType,
  Impact,
  ConfidenceLevel,
  ClassifiedViolation,
  ClassificationResult,
  SourceRef,
  Patch,
  SiteType,
  RenderResult,
  PageScanResult,
  ScanSummary,
} from "./types.js";
