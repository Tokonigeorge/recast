import { parseArgs } from "node:util";

export interface RecastConfig {
  /** URLs to scan */
  urls: string[];
  /** Local directory to scan */
  dir?: string;
  /** Local HTML files to scan */
  files: string[];
  /** Confidence threshold for auto-fixing (0.0-1.0) */
  autoFixAbove: number;
  /** Apply fixes in place (write to source files) */
  apply: boolean;
  /** Output diff to this file */
  diffOutput?: string;
  /** Generate HTML report */
  report?: string;
  /** Gemini API key */
  geminiApiKey?: string;
  /** Max concurrent pages */
  concurrency: number;
  /** Page load timeout in ms */
  timeout: number;
}

export function parseConfig(args: string[]): RecastConfig {
  const { values, positionals } = parseArgs({
    args,
    options: {
      url: { type: "string", multiple: true, short: "u" },
      dir: { type: "string", short: "d" },
      file: { type: "string", multiple: true, short: "f" },
      "auto-fix-above": { type: "string", default: "0.85" },
      apply: { type: "boolean", default: false },
      "diff-output": { type: "string" },
      report: { type: "string" },
      "gemini-api-key": { type: "string" },
      concurrency: { type: "string", default: "4" },
      timeout: { type: "string", default: "15000" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const urls: string[] = [
    ...((values.url as string[] | undefined) ?? []),
    ...positionals.filter((p) => p.startsWith("http")),
  ];

  const files: string[] = [
    ...((values.file as string[] | undefined) ?? []),
    ...positionals.filter((p) => !p.startsWith("http")),
  ];

  return {
    urls,
    dir: values.dir as string | undefined,
    files,
    autoFixAbove: parseFloat(values["auto-fix-above"] as string) || 0.85,
    apply: values.apply as boolean,
    diffOutput: values["diff-output"] as string | undefined,
    report: values.report as string | undefined,
    geminiApiKey:
      (values["gemini-api-key"] as string) ??
      process.env.GEMINI_API_KEY,
    concurrency: parseInt(values.concurrency as string, 10) || 4,
    timeout: parseInt(values.timeout as string, 10) || 15_000,
  };
}

function printHelp(): void {
  console.log(`
recast — Automated Accessibility Rewriter

Usage:
  recast [options] [urls...]
  recast --url https://mysite.com
  recast --dir ./dist
  recast --file index.html

Options:
  -u, --url <url>           URL to scan (can specify multiple)
  -d, --dir <path>          Local directory to scan
  -f, --file <path>         Local HTML file to scan (can specify multiple)
  --auto-fix-above <n>      Confidence threshold for auto-fixing (default: 0.85)
  --apply                   Apply fixes in place (write to source files)
  --diff-output <path>      Write diff to file
  --report <path>           Generate HTML report
  --gemini-api-key <key>    Gemini API key (or set GEMINI_API_KEY env var)
  --concurrency <n>         Max concurrent pages (default: 4)
  --timeout <ms>            Page load timeout in ms (default: 15000)
  -h, --help                Show this help message
`);
}
