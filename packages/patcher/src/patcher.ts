import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Fix, SourceRef, Patch, Violation } from "@recast-a11y/classifier";
import { patchHtml } from "./html-patcher.js";
import { patchJsx } from "./jsx-patcher.js";

const JSX_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".ts"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte"]);

function computePatch(
  fileContents: string,
  sourceRef: SourceRef,
  violation: Violation,
  fix: Fix,
): { patchedContents: string; patch: Patch } | null {
  const ext = extname(sourceRef.file).toLowerCase();

  const patchFn = JSX_EXTENSIONS.has(ext) ? patchJsx
    : HTML_EXTENSIONS.has(ext) ? patchHtml
    : patchHtml; // fallback

  const patchedContents = patchFn(fileContents, sourceRef, violation.html, fix);
  if (!patchedContents || patchedContents === fileContents) return null;

  const originalLines = fileContents.split("\n");
  const patchedLines = patchedContents.split("\n");
  const lineIdx = sourceRef.line - 1;

  return {
    patchedContents,
    patch: {
      sourceRef,
      violation,
      fix,
      originalCode: originalLines[lineIdx] ?? "",
      fixedCode: patchedLines[lineIdx] ?? "",
    },
  };
}

/** Compute a patch without writing to disk. */
export async function applyPatch(
  violation: Violation,
  fix: Fix,
  sourceRef: SourceRef,
): Promise<Patch | null> {
  const fileContents = await readFile(sourceRef.file, "utf-8");
  return computePatch(fileContents, sourceRef, violation, fix)?.patch ?? null;
}

/** Compute and write a patch to disk. */
export async function writePatch(
  violation: Violation,
  fix: Fix,
  sourceRef: SourceRef,
): Promise<Patch | null> {
  const fileContents = await readFile(sourceRef.file, "utf-8");
  const result = computePatch(fileContents, sourceRef, violation, fix);
  if (!result) return null;

  await writeFile(sourceRef.file, result.patchedContents, "utf-8");
  return result.patch;
}
