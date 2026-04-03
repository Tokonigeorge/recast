import { createInterface } from "node:readline";

const B = "\x1b[1m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const RED = "\x1b[31m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const D = "\x1b[2m";

const IMPACT_COLOR: Record<string, string> = {
  critical: RED, serious: Y, moderate: C, minor: D,
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(message: string): { stop: (final?: string) => void } {
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${D}${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}${R}`);
  }, 80);

  return {
    stop(final?: string) {
      clearInterval(timer);
      process.stdout.write(`\r${" ".repeat(message.length + 4)}\r`);
      if (final) console.log(final);
    },
  };
}

export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`${message} ${D}${hint}${R} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

export async function choose(message: string, options: string[]): Promise<number> {
  console.log(`\n${message}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${D}${i + 1})${R} ${options[i]}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n${D}Enter choice (1-${options.length}):${R} `, (answer) => {
      rl.close();
      const n = parseInt(answer.trim(), 10);
      resolve(n >= 1 && n <= options.length ? n - 1 : 0);
    });
  });
}

export interface ViolationRow {
  ruleId: string;
  impact: string;
  target: string;
  confidence: "high" | "low" | "skip";
  fix: string;
}

export function printViolationTable(rows: ViolationRow[], file?: string): void {
  if (file) console.log(`\n  ${B}${file}${R}`);

  const maxRule = Math.max(12, ...rows.map((r) => r.ruleId.length));
  const maxTarget = Math.min(50, Math.max(10, ...rows.map((r) => r.target.length)));

  console.log(
    `  ${D}${"#".padEnd(4)}${"Rule".padEnd(maxRule + 2)}${"Impact".padEnd(10)}${"Fix".padEnd(8)}${"Element".padEnd(maxTarget)}${R}`,
  );
  console.log(`  ${D}${"─".repeat(maxRule + maxTarget + 26)}${R}`);

  rows.forEach((row, i) => {
    const impColor = IMPACT_COLOR[row.impact] ?? D;
    const confLabel = row.confidence === "high" ? `${G}auto${R}`
      : row.confidence === "skip" ? `${D}skip${R}`
      : `${Y}LLM${R}`;
    const target = row.target.length > maxTarget
      ? row.target.slice(0, maxTarget - 3) + "..."
      : row.target;

    console.log(
      `  ${D}${String(i + 1).padEnd(4)}${R}${row.ruleId.padEnd(maxRule + 2)}${impColor}${row.impact.padEnd(10)}${R}${confLabel.padEnd(8 + 9)}${D}${target}${R}`,
    );
  });
}

export function printDiffBlock(original: string, fixed: string, file: string, line: number): void {
  console.log(`  ${D}${file}:${line}${R}`);
  console.log(`  ${RED}- ${original.trim()}${R}`);
  console.log(`  ${G}+ ${fixed.trim()}${R}`);
  console.log();
}

export function printHeader(): void {
  console.log(`\n${B}recast${R} ${D}— Automated Accessibility Rewriter${R}\n`);
}
