import type { Fix, SourceRef } from "@recast-a11y/classifier";

/**
 * Apply a fix to a JSX/TSX file.
 *
 * For Phase 1, uses string-based patching (same approach as HTML patcher)
 * scoped to the target line. jscodeshift AST transforms are planned for
 * Phase 2 when we need more complex restructuring.
 *
 * The string approach works well for attribute additions/removals and simple
 * element swaps. It preserves formatting perfectly for untouched lines.
 */
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

function addJsxAttribute(
  lines: string[],
  lineIdx: number,
  fix: Fix,
): string | null {
  if (!fix.attribute || fix.value === undefined) return null;

  const line = lines[lineIdx];

  // JSX uses camelCase for some attributes
  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const attrStr = `${jsxAttr}="${fix.value}"`;

  // Check if attribute exists — replace it
  const existingRegex = new RegExp(
    `\\b${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
  );

  let newLine: string;
  if (existingRegex.test(line)) {
    newLine = line.replace(existingRegex, attrStr);
  } else {
    // Insert before the closing > or />
    // Find the opening tag on this line
    const tagCloseIdx = findTagInsertionPoint(line);
    if (tagCloseIdx === -1) return null;
    newLine =
      line.slice(0, tagCloseIdx) + ` ${attrStr}` + line.slice(tagCloseIdx);
  }

  const result = [...lines];
  result[lineIdx] = newLine;
  return result.join("\n");
}

function removeJsxAttribute(
  lines: string[],
  lineIdx: number,
  fix: Fix,
): string | null {
  if (!fix.attribute) return null;

  const jsxAttr = htmlAttrToJsx(fix.attribute);
  const line = lines[lineIdx];

  // Match attribute with various value forms: "...", '...', {...}
  const attrRegex = new RegExp(
    `\\s*${escapeRegex(jsxAttr)}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`,
    "g",
  );

  if (!attrRegex.test(line)) return null;

  const result = [...lines];
  result[lineIdx] = line.replace(attrRegex, "");
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

  // Replace opening tag
  result[lineIdx] = result[lineIdx].replace(
    new RegExp(`<${oldTag}\\b`, "i"),
    `<${newTag}`,
  );

  // Find and replace closing tag
  const closingRegex = new RegExp(`</${oldTag}\\s*>`, "i");
  for (let i = lineIdx; i < result.length; i++) {
    if (closingRegex.test(result[i])) {
      result[i] = result[i].replace(closingRegex, `</${newTag}>`);
      break;
    }
  }

  return result.join("\n");
}

/** Convert HTML attribute names to JSX equivalents */
function htmlAttrToJsx(attr: string): string {
  const map: Record<string, string> = {
    class: "className",
    for: "htmlFor",
    tabindex: "tabIndex",
    readonly: "readOnly",
    maxlength: "maxLength",
    // aria-* and data-* attributes stay as-is in JSX
  };
  return map[attr] ?? attr;
}

/** Find the position right before > or /> in a JSX opening tag */
function findTagInsertionPoint(line: string): number {
  // Look for /> or > that closes an opening tag
  // Skip past attribute values to find the actual close
  let inString: string | null = null;
  let braceDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inString) {
      if (ch === inString && line[i - 1] !== "\\") inString = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      continue;
    }

    if (braceDepth === 0) {
      if (ch === "/" && line[i + 1] === ">") return i;
      if (ch === ">" && (i === 0 || line[i - 1] !== "=")) return i;
    }
  }

  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
