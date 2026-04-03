import type { Fix, SourceRef } from "@recast-a11y/classifier";
import { escapeRegex, escapeHtml } from "./shared.js";

/** Apply a fix to an HTML file at a specific source location. Returns modified contents or null. */
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
  const tagMatch = elementHtml.match(/<(\w+)/);
  if (!tagMatch) return null;

  const tagName = tagMatch[1];
  const openTagRegex = new RegExp(`(<${tagName}\\b)([^>]*)(>|/>)`, "i");
  const match = line.match(openTagRegex);
  if (!match) return null;

  const attrPattern = new RegExp(
    `\\b${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
  );

  let newLine: string;
  if (attrPattern.test(line)) {
    newLine = line.replace(
      attrPattern,
      `${fix.attribute}="${escapeHtml(fix.value)}"`,
    );
  } else {
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
  const attrPattern = new RegExp(
    `\\s*${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
    "g",
  );

  const newLine = line.replace(attrPattern, "");
  if (newLine === line) return null;

  const result = [...lines];
  result[lineIdx] = newLine;
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
  const result = [...lines];

  result[lineIdx] = result[lineIdx].replace(
    new RegExp(`<${oldTag}\\b`, "i"),
    `<${newTag}`,
  );

  // Replace closing tag (may be on a different line)
  const closingRegex = new RegExp(`</${oldTag}\\s*>`, "i");
  for (let i = lineIdx; i < result.length; i++) {
    if (closingRegex.test(result[i])) {
      result[i] = result[i].replace(closingRegex, `</${newTag}>`);
      break;
    }
  }

  // Remove redundant role if new element has implicit semantics
  const implicitRoles: Record<string, string> = {
    button: "button", nav: "navigation", main: "main",
    header: "banner", footer: "contentinfo", aside: "complementary",
  };
  const implicitRole = implicitRoles[newTag];
  if (implicitRole) {
    const roleRegex = new RegExp(`\\s*role\\s*=\\s*["']${implicitRole}["']`, "g");
    for (let i = lineIdx; i < Math.min(lineIdx + 3, result.length); i++) {
      result[i] = result[i].replace(roleRegex, "");
    }
  }

  return result.join("\n");
}
