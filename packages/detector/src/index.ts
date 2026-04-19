export { detect, enrichViolation, type DetectionResult } from "./detector.js";
export { runAxe } from "./axe-runner.js";
export { runCustomChecks } from "./custom-checks.js";
export {
  captureAriaSnapshot,
  captureLocalAriaContext,
  getNearestLandmark,
} from "./aria-snapshot.js";
export { staticAnalyze, type StaticScanResult } from "./static-analyzer.js";
