export type Impact = "minor" | "moderate" | "serious" | "critical";

export type ConfidenceLevel = "high" | "low" | "skip";

export type FixType =
  | "add-attribute"
  | "remove-attribute"
  | "change-element"
  | "add-element"
  | "restructure"
  | "manual-required";

export interface Violation {
  ruleId: string;
  description: string;
  wcag: string;
  impact: Impact;
  html: string;
  target: string;
  helpUrl: string;
  pageUrl: string;
  /** Line number in source file (set by static analyzer, optional for browser-detected) */
  line?: number;
}

export interface EnrichedViolation extends Violation {
  ariaContext: string;
  section: string;
  pageTitle: string;
}

export interface SourceRef {
  file: string;
  line: number;
  column?: number;
}

export interface Fix {
  type: FixType;
  attribute?: string;
  value?: string;
  newElement?: string;
  newHtml?: string;
  note?: string;
  reasoning: string;
  confidence: number;
}

export interface ClassifiedViolation {
  violation: Violation;
  level: ConfidenceLevel;
  fix: Fix;
}

export interface ClassificationResult {
  high: ClassifiedViolation[];
  low: ClassifiedViolation[];
  skipped: ClassifiedViolation[];
}

export interface Patch {
  sourceRef: SourceRef;
  violation: Violation;
  fix: Fix;
  originalCode: string;
  fixedCode: string;
}

export type SiteType = "static" | "ssr" | "spa";

export interface RenderResult {
  html: string;
  siteType: SiteType;
  url: string;
}

export interface PageScanResult {
  url: string;
  violations: Violation[];
  classification: ClassificationResult;
  patches: Patch[];
  untraceable: ClassifiedViolation[];
}

export interface ScanSummary {
  totalPages: number;
  totalViolations: number;
  autoFixed: number;
  flaggedForReview: number;
  byImpact: Record<Impact, number>;
  bySiteType: Record<SiteType, number>;
  modifiedFiles: string[];
}
