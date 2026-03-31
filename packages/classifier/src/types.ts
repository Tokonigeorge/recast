/** Impact severity from axe-core */
export type Impact = "minor" | "moderate" | "serious" | "critical";

/** Confidence level for a fix */
export type ConfidenceLevel = "high" | "low";

/** Fix types the system can produce */
export type FixType =
  | "add-attribute"
  | "remove-attribute"
  | "change-element"
  | "add-element"
  | "restructure"
  | "manual-required";

/** A detected accessibility violation */
export interface Violation {
  /** axe-core rule ID (e.g., "button-name", "image-alt") */
  ruleId: string;
  /** Human-readable description */
  description: string;
  /** WCAG criterion (e.g., "4.1.2 Name, Role, Value") */
  wcag: string;
  /** Impact severity */
  impact: Impact;
  /** The outer HTML of the violating element */
  html: string;
  /** CSS selector path to the element */
  target: string;
  /** axe-core help URL */
  helpUrl: string;
  /** Page URL or file path where the violation was found */
  pageUrl: string;
}

/** A violation enriched with ARIA context for LLM processing */
export interface EnrichedViolation extends Violation {
  /** YAML aria snapshot of the element and surrounding context */
  ariaContext: string;
  /** Nearest landmark role and its accessible name */
  section: string;
  /** document.title of the page */
  pageTitle: string;
}

/** Source location in user's codebase */
export interface SourceRef {
  file: string;
  line: number;
  column?: number;
}

/** A proposed fix for a violation */
export interface Fix {
  type: FixType;
  /** Only for add-attribute / remove-attribute */
  attribute?: string;
  /** Only for add-attribute */
  value?: string;
  /** Only for change-element */
  newElement?: string;
  /** Only for restructure */
  newHtml?: string;
  /** Only for manual-required */
  note?: string;
  /** One-sentence explanation */
  reasoning: string;
  /** 0.0–1.0 */
  confidence: number;
}

/** Classified violation with its proposed fix */
export interface ClassifiedViolation {
  violation: Violation;
  level: ConfidenceLevel;
  fix: Fix;
}

/** Result of classification: split into high and low confidence */
export interface ClassificationResult {
  high: ClassifiedViolation[];
  low: ClassifiedViolation[];
}

/** A patch to apply to a source file */
export interface Patch {
  sourceRef: SourceRef;
  violation: Violation;
  fix: Fix;
  /** The original code at the source location */
  originalCode: string;
  /** The fixed code to replace it with */
  fixedCode: string;
}

/** Site type for tiered rendering */
export type SiteType = "static" | "ssr" | "spa";

/** Result of rendering a page */
export interface RenderResult {
  /** The full HTML of the rendered page */
  html: string;
  /** The detected site type */
  siteType: SiteType;
  /** The page URL */
  url: string;
}

/** Result of a full scan of one page */
export interface PageScanResult {
  url: string;
  violations: Violation[];
  classification: ClassificationResult;
  patches: Patch[];
  /** Violations that could not be traced to source */
  untraceable: ClassifiedViolation[];
}

/** Summary stats for the full run */
export interface ScanSummary {
  totalPages: number;
  totalViolations: number;
  autoFixed: number;
  flaggedForReview: number;
  byImpact: Record<Impact, number>;
  bySiteType: Record<SiteType, number>;
  modifiedFiles: string[];
}
