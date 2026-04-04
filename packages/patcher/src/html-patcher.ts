import type { Fix, SourceRef } from "@recast-a11y/classifier";
import { escapeRegex, escapeHtml } from "./shared.js";

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
      return removeAttribute(lines, lineIdx, elementHtml, fix);
    case "change-element":
      return changeElement(lines, lineIdx, elementHtml, fix);
    default:
      return null;
  }
}

/** Find the closing > or /> of an opening tag, scanning across lines. */
function findTagClose(lines: string[], lineIdx: number): { closeLine: number; closeCol: number } | null {
  let inString: string | null = null;

  for (let ln = lineIdx; ln < Math.min(lineIdx + 20, lines.length); ln++) {
    const line = lines[ln];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === inString && line[i - 1] !== "\\") inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === "/" && line[i + 1] === ">") return { closeLine: ln, closeCol: i };
      if (ch === ">" && (i === 0 || line[i - 1] !== "=")) return { closeLine: ln, closeCol: i };
    }
  }
  return null;
}

function addAttribute(
  lines: string[],
  lineIdx: number,
  elementHtml: string,
  fix: Fix,
): string | null {
  if (!fix.attribute || fix.value === undefined) return null;

  const tagMatch = elementHtml.match(/<(\w+)/);
  if (!tagMatch) return null;

  const attrPattern = new RegExp(
    `\\b${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
  );

  const result = [...lines];
  const closeInfo = findTagClose(lines, lineIdx);
  const searchEnd = closeInfo ? closeInfo.closeLine : lineIdx;

  // Replace existing attribute if found on any line of the tag
  for (let ln = lineIdx; ln <= searchEnd; ln++) {
    if (attrPattern.test(result[ln])) {
      result[ln] = result[ln].replace(
        attrPattern,
        `${fix.attribute}="${escapeHtml(fix.value)}"`,
      );
      return result.join("\n");
    }
  }

  // Insert new attribute before closing > or />
  if (!closeInfo) {
    // Fallback: try single-line regex
    const tagName = tagMatch[1];
    const openTagRegex = new RegExp(`(<${tagName}\\b)([^>]*)(>|/>)`, "i");
    const match = result[lineIdx].match(openTagRegex);
    if (!match) return null;
    result[lineIdx] = result[lineIdx].replace(
      openTagRegex,
      `$1$2 ${fix.attribute}="${escapeHtml(fix.value)}"$3`,
    );
    return result.join("\n");
  }

  const { closeLine, closeCol } = closeInfo;
  const line = result[closeLine];
  result[closeLine] = line.slice(0, closeCol) + ` ${fix.attribute}="${escapeHtml(fix.value)}"` + line.slice(closeCol);
  return result.join("\n");
}

function removeAttribute(
  lines: string[],
  lineIdx: number,
  _elementHtml: string,
  fix: Fix,
): string | null {
  if (!fix.attribute) return null;

  const attrPattern = new RegExp(
    `\\s*${escapeRegex(fix.attribute)}\\s*=\\s*["'][^"']*["']`,
    "g",
  );

  const result = [...lines];
  const closeInfo = findTagClose(lines, lineIdx);
  const searchEnd = closeInfo ? closeInfo.closeLine : lineIdx;
  let changed = false;

  for (let ln = lineIdx; ln <= searchEnd; ln++) {
    const newLine = result[ln].replace(attrPattern, "");
    if (newLine !== result[ln]) {
      result[ln] = newLine;
      changed = true;
    }
  }

  return changed ? result.join("\n") : null;
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

  const closingRegex = new RegExp(`</${oldTag}\\s*>`, "i");
  for (let i = lineIdx; i < result.length; i++) {
    if (closingRegex.test(result[i])) {
      result[i] = result[i].replace(closingRegex, `</${newTag}>`);
      break;
    }
  }

  const implicitRoles: Record<string, string> = {
    button: "button", nav: "navigation", main: "main",
    header: "banner", footer: "contentinfo", aside: "complementary",
  };
  const implicitRole = implicitRoles[newTag];
  if (implicitRole) {
    const roleRegex = new RegExp(`\\s*role\\s*=\\s*["']${implicitRole}["']`, "g");
    for (let i = lineIdx; i < Math.min(lineIdx + 5, result.length); i++) {
      result[i] = result[i].replace(roleRegex, "");
    }
  }

  return result.join("\n");
}
