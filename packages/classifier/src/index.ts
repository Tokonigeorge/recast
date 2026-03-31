export { classify } from "./classifier.js";
export { tryHighConfidenceFix, HIGH_CONFIDENCE_RULES } from "./rules.js";
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
