export { generateDiff } from "./diff.js";
export {
  printScanStart,
  printViolationSummary,
  printPatchSummary,
  printFlaggedForReview,
  printSummary,
  printCostSummary,
  type CostSummaryData,
} from "./console.js";
export { buildReportData, generateHtmlReport, type ReportData } from "./html-report.js";
export { serveReport, type ServeOptions } from "./serve.js";
