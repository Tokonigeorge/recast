import { parse, type HTMLElement } from "node-html-parser";
import type { Fix, SourceRef } from "@recast-a11y/classifier";

/**
 * Apply a fix to an HTML file at a specific source location.
 * Returns the modified file contents, or null if the patch couldn't be applied.
 */
export function patchHtml(
  fileContents: string,
  sourceRef: SourceRef,
  elementHtml: string,
  fix: Fix,
): string | null {
  const lines = fileContents.split("\n");
  const lineIdx = sourceRef.line - 1;

  if (lineIdx < 0 || lineIdx >= lines.length) return null;

  switch (fix.type) {
    case "add-attribute":
      return addAttribute(lines, lineIdx, elementHtml, fix);
    case "remove-attribute":
      return removeAttribute(lines, lineIdx, fix);
    case "change-element":
      return changeElement(lines, lineIdx, elementHtml, fix);
    default:
      return null;
  }
}

function addAttribute(
  lines: string[],
  lineIdx: number,
  elementHtml: string,
  fix: Fix,
): string | null {
  if (!fix.attribute || fix.value === undefined) return null;

  const line = lines[lineIdx];
  // Find the opening tag on this line
  const tagMatch = elementHtml.match(/<(\w+)/);
  if (!tagMatch) return null;

  const tagName = tagMatch[1];
  // Match the opening tag pattern to insert the attribute
  const openTagRegex = new RegExp(`(<${tagName}\\b)([^>]*)(>|/>)`, "i");
  const match = line.match(openTagRegex);

  if (!match) return null;

  // Check if attribute already exists — replace it
  const attrRegex = new RegExp(
    `\\b${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
  );
  let newLine: string;

  if (attrRegex.test(line)) {
    // Replace existing attribute value
    newLine = line.replace(
      attrRegex,
      `${fix.attribute}="${escapeHtml(fix.value)}"`,
    );
  } else {
    // Insert new attribute after the tag name
    newLine = line.replace(
      openTagRegex,
      `$1$2 ${fix.attribute}="${escapeHtml(fix.value)}"$3`,
    );
  }

  const result = [...lines];
  result[lineIdx] = newLine;
  return result.join("\n");
}

function removeAttribute(
  lines: string[],
  lineIdx: number,
  fix: Fix,
): string | null {
  if (!fix.attribute) return null;

  const line = lines[lineIdx];
  const attrRegex = new RegExp(
    `\\s*${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
    "g",
  );

  if (!attrRegex.test(line)) return null;

  const result = [...lines];
  result[lineIdx] = line.replace(attrRegex, "");
  return result.join("\n");
}

function changeElement(
  lines: string[],
  lineIdx: number,
  elementHtml: string,
  fix: Fix,
): string | null {
  if (!fix.newElement) return null;

  const tagMatch = elementHtml.match(/<(\w+)/);
  if (!tagMatch) return null;

  const oldTag = tagMatch[1];
  const newTag = fix.newElement;
  const line = lines[lineIdx];

  // Replace opening tag
  let newLine = line.replace(
    new RegExp(`<${oldTag}\\b`, "i"),
    `<${newTag}`,
  );

  const result = [...lines];
  result[lineIdx] = newLine;

  // Also replace closing tag if on a different line
  const closingRegex = new RegExp(`</${oldTag}\\s*>`, "i");
  for (let i = lineIdx; i < result.length; i++) {
    if (closingRegex.test(result[i])) {
      result[i] = result[i].replace(closingRegex, `</${newTag}>`);
      break;
    }
  }

  // Remove role attribute if the new element has implicit semantics
  const implicitRoles: Record<string, string> = {
    button: "button",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    aside: "complementary",
  };
  const implicitRole = implicitRoles[newTag];
  if (implicitRole) {
    const roleRegex = new RegExp(
      `\\s*role\\s*=\\s*["']${implicitRole}["']`,
      "g",
    );
    for (let i = lineIdx; i < Math.min(lineIdx + 3, result.length); i++) {
      result[i] = result[i].replace(roleRegex, "");
    }
  }

  return result.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
