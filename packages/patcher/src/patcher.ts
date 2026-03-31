import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Fix, SourceRef, Patch, Violation } from "@recast-a11y/classifier";
import { patchHtml } from "./html-patcher.js";
import { patchJsx } from "./jsx-patcher.js";

const JSX_EXTENSIONS = new Set([".jsx", ".tsx", ".js", ".ts"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte"]);

/**
 * Apply a single fix to the source file at the given location.
 * Determines the right patching strategy based on file extension.
 * Returns the Patch object if successful, null if patching failed.
 */
export async function applyPatch(
  violation: Violation,
  fix: Fix,
  sourceRef: SourceRef,
): Promise<Patch | null> {
  const ext = extname(sourceRef.file).toLowerCase();
  const fileContents = await readFile(sourceRef.file, "utf-8");

  let patchedContents: string | null = null;

  if (JSX_EXTENSIONS.has(ext)) {
    patchedContents = patchJsx(fileContents, sourceRef, violation.html, fix);
  } else if (HTML_EXTENSIONS.has(ext)) {
    patchedContents = patchHtml(fileContents, sourceRef, violation.html, fix);
  } else {
    // Unknown file type — try HTML patching as fallback
    patchedContents = patchHtml(fileContents, sourceRef, violation.html, fix);
  }

  if (!patchedContents || patchedContents === fileContents) return null;

  // Extract the original and fixed lines for the patch record
  const originalLines = fileContents.split("\n");
  const patchedLines = patchedContents.split("\n");
  const lineIdx = sourceRef.line - 1;

  return {
    sourceRef,
    violation,
    fix,
    originalCode: originalLines[lineIdx] ?? "",
    fixedCode: patchedLines[lineIdx] ?? "",
  };
}

/**
 * Apply a patch by writing the changes to the file.
 * Reads the file again to ensure freshness (another patch may have been applied).
 */
export async function writePatch(
  violation: Violation,
  fix: Fix,
  sourceRef: SourceRef,
): Promise<Patch | null> {
  const ext = extname(sourceRef.file).toLowerCase();
  const fileContents = await readFile(sourceRef.file, "utf-8");

  let patchedContents: string | null = null;

  if (JSX_EXTENSIONS.has(ext)) {
    patchedContents = patchJsx(fileContents, sourceRef, violation.html, fix);
  } else if (HTML_EXTENSIONS.has(ext)) {
    patchedContents = patchHtml(fileContents, sourceRef, violation.html, fix);
  } else {
    patchedContents = patchHtml(fileContents, sourceRef, violation.html, fix);
  }

  if (!patchedContents || patchedContents === fileContents) return null;

  await writeFile(sourceRef.file, patchedContents, "utf-8");

  const originalLines = fileContents.split("\n");
  const patchedLines = patchedContents.split("\n");
  const lineIdx = sourceRef.line - 1;

  return {
    sourceRef,
    violation,
    fix,
    originalCode: originalLines[lineIdx] ?? "",
    fixedCode: patchedLines[lineIdx] ?? "",
  };
}
