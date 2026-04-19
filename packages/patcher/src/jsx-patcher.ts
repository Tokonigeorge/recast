import type { Fix, SourceRef } from "@recast-a11y/classifier";
import { escapeRegex } from "./shared.js";

export function patchJsx(
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
      return addJsxAttribute(lines, lineIdx, fix);
    case "remove-attribute":
      return removeJsxAttribute(lines, lineIdx, fix);
    case "change-element":
      return changeJsxElement(lines, lineIdx, elementHtml, fix);
    default:
      return null;
  }
}

const HTML_TO_JSX_ATTRS: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex",
  readonly: "readOnly", maxlength: "maxLength",
};

function htmlAttrToJsx(attr: string): string {
  return HTML_TO_JSX_ATTRS[attr] ?? attr;
}

/**
 * Find the line that closes the opening JSX tag starting at lineIdx.
 * Refuses to match closing tags (</foo>) — those are not opening tags.
 */
function findTagCloseInfo(lines: string[], lineIdx: number): { closeLine: number; closeCol: number } | null {
  let inString: string | null = null;
  let braceDepth = 0;
  let foundOpenTag = false;

  for (let ln = lineIdx; ln < Math.min(lineIdx + 20, lines.length); ln++) {
    const line = lines[ln];

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inString) {
        if (ch === inString && line[i - 1] !== "\\") inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === "`") { inString = ch; continue; }
      if (ch === "{") { braceDepth++; continue; }
      if (ch === "}") { braceDepth--; continue; }

      // Detect `<Identifier` (opening tag) — reject `</` (closing) and `<>` (fragment)
      if (ch === "<" && !foundOpenTag) {
        const next = line[i + 1];
        if (next === "/") continue; // closing tag — skip
        if (next === ">" || next === "<") continue; // fragment or invalid
        if (next && /[a-zA-Z]/.test(next)) {
          foundOpenTag = true;
          continue;
        }
        continue;
      }

      if (braceDepth === 0 && foundOpenTag) {
        if (ch === "/" && line[i + 1] === ">") return { closeLine: ln, closeCol: i };
        if (ch === ">" && (i === 0 || line[i - 1] !== "=")) return { closeLine: ln, closeCol: i };
      }
    }
  }

  return null;
}

function addJsxAttribute(lines: string[], lineIdx: number, fix: Fix): string | null {
  if (!fix.attribute || fix.value === undefined) return null;

  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const attrStr = `${jsxAttr}="${fix.value}"`;

  // Check if attribute already exists on any line of the opening tag
  const existingPattern = new RegExp(
    `\\b${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
  );

  const result = [...lines];

  // Search across the tag span for existing attribute
  const closeInfo = findTagCloseInfo(lines, lineIdx);
  const searchEnd = closeInfo ? closeInfo.closeLine : lineIdx;

  for (let ln = lineIdx; ln <= searchEnd; ln++) {
    if (existingPattern.test(result[ln])) {
      result[ln] = result[ln].replace(existingPattern, attrStr);
      return result.join("\n");
    }
  }

  // Attribute doesn't exist — insert before the closing > or />
  if (!closeInfo) return null;

  const { closeLine, closeCol } = closeInfo;
  const line = result[closeLine];
  result[closeLine] = line.slice(0, closeCol) + ` ${attrStr}` + line.slice(closeCol);
  return result.join("\n");
}

function removeJsxAttribute(lines: string[], lineIdx: number, fix: Fix): string | null {
  if (!fix.attribute) return null;

  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const attrPattern = new RegExp(
    `\\s*${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
    "g",
  );

  const result = [...lines];
  const closeInfo = findTagCloseInfo(lines, lineIdx);
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

function changeJsxElement(
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

  return result.join("\n");
}
