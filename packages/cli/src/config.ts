import { parseArgs } from "node:util";

export interface RecastConfig {
  targets: string[];
  projectRoot?: string;
  autoFixAbove: number;
  provider?: string;
  apiKey?: string;
  model?: string;
  concurrency: number;
  timeout: number;
}

export function parseConfig(args: string[]): RecastConfig {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "auto-fix-above": { type: "string", default: "0.85" },
      provider: { type: "string", short: "p" },
      "api-key": { type: "string", short: "k" },
      model: { type: "string", short: "m" },
      "project-root": { type: "string", short: "r" },
      concurrency: { type: "string", default: "4" },
      timeout: { type: "string", default: "15000" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(values.help ? 0 : 1);
  }

  return {
    targets: positionals,
    projectRoot: values["project-root"] as string | undefined,
    autoFixAbove: parseFloat(values["auto-fix-above"] as string) || 0.85,
    provider: values.provider as string | undefined,
    apiKey: values["api-key"] as string | undefined,
    model: values.model as string | undefined,
    concurrency: parseInt(values.concurrency as string, 10) || 4,
    timeout: parseInt(values.timeout as string, 10) || 30_000,
  };
}

function printHelp(): void {
  console.log(`
recast — Automated Accessibility Rewriter

Usage:
  recast <target>

  Targets:
    .                         Current directory
    ./path/to/project         Local project (auto-starts dev server)
    index.html                Static HTML file
    http://localhost:3000     Running dev server (audit + trace to source)
    https://example.com       Live website (audit only, no patching)
    github:user/repo          Clone, install, scan a public repo

LLM Provider (auto-detected from env, or set explicitly):
  GEMINI_API_KEY      Gemini (default, cheapest)
  OPENAI_API_KEY      OpenAI
  ANTHROPIC_API_KEY   Anthropic

Options:
  -p, --provider <name>   Force provider: gemini, openai, anthropic
  -k, --api-key <key>     API key (or use env vars above)
  -m, --model <model>     Override model name
  -r, --project-root      Project root for source tracing
  --auto-fix-above <n>    Confidence threshold (default: 0.85)
  --concurrency <n>       Max concurrent pages (default: 4)
  --timeout <ms>          Page load timeout (default: 30000)
  -h, --help              Show this help message

Examples:
  recast .
  recast fixtures/react-app
  recast http://localhost:5173
  recast github:vuejs/docs
`);
}
