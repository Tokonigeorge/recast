import type { Patch } from "@recast-a11y/classifier";

/**
 * Generate a unified diff string from a collection of patches.
 * Groups patches by file for clean output.
 */
export function generateDiff(patches: Patch[]): string {
  // Group patches by file
  const byFile = new Map<string, Patch[]>();
  for (const patch of patches) {
    const file = patch.sourceRef.file;
    const existing = byFile.get(file);
    if (existing) {
      existing.push(patch);
    } else {
      byFile.set(file, [patch]);
    }
  }

  const output: string[] = [];

  for (const [file, filePatches] of byFile) {
    // Sort patches by line number
    filePatches.sort((a, b) => a.sourceRef.line - b.sourceRef.line);

    output.push(`--- a/${file}`);
    output.push(`+++ b/${file}`);

    for (const patch of filePatches) {
      const line = patch.sourceRef.line;
      output.push(`@@ -${line},1 +${line},1 @@`);
      output.push(`-${patch.originalCode}`);
      output.push(`+${patch.fixedCode}`);
    }

    output.push("");
  }

  return output.join("\n");
}
