import type { Fix, SourceRef } from "@recast-a11y/classifier";
import { escapeRegex } from "./shared.js";

/** Apply a fix to a JSX/TSX file. Returns modified contents or null. */
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

function addJsxAttribute(lines: string[], lineIdx: number, fix: Fix): string | null {
  if (!fix.attribute || fix.value === undefined) return null;

  const line = lines[lineIdx];
  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const attrStr = `${jsxAttr}="${fix.value}"`;

  const existingPattern = new RegExp(
    `\\b${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
  );

  let newLine: string;
  if (existingPattern.test(line)) {
    newLine = line.replace(existingPattern, attrStr);
  } else {
    const insertIdx = findTagInsertionPoint(line);
    if (insertIdx === -1) return null;
    newLine = line.slice(0, insertIdx) + ` ${attrStr}` + line.slice(insertIdx);
  }

  const result = [...lines];
  result[lineIdx] = newLine;
  return result.join("\n");
}

function removeJsxAttribute(lines: string[], lineIdx: number, fix: Fix): string | null {
  if (!fix.attribute) return null;

  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const line = lines[lineIdx];
  const attrPattern = new RegExp(
    `\\s*${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
    "g",
  );

  const newLine = line.replace(attrPattern, "");
  if (newLine === line) return null;

  const result = [...lines];
  result[lineIdx] = newLine;
  return result.join("\n");
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

/** Find the position right before > or /> in a JSX opening tag. */
function findTagInsertionPoint(line: string): number {
  let inString: string | null = null;
  let braceDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inString) {
      if (ch === inString && line[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === "{") { braceDepth++; continue; }
    if (ch === "}") { braceDepth--; continue; }

    if (braceDepth === 0) {
      if (ch === "/" && line[i + 1] === ">") return i;
      if (ch === ">" && (i === 0 || line[i - 1] !== "=")) return i;
    }
  }

  return -1;
}
