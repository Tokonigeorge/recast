import type { Fix, FixType } from "@recast-a11y/classifier";

const VALID_FIX_TYPES: Set<string> = new Set([
  "add-attribute",
  "remove-attribute",
  "change-element",
  "add-element",
  "restructure",
  "manual-required",
]);

/** Extract the YAML fix block from the end of LLM free-reasoning output. */
export function parseLlmOutput(text: string): Fix {
  const fixIndex = text.lastIndexOf("fix:");
  if (fixIndex === -1) {
    return {
      type: "manual-required",
      reasoning: "LLM output did not contain a fix block",
      confidence: 0,
      note: "Failed to parse LLM response — manual review needed",
    };
  }

  const yamlBlock = text.slice(fixIndex);
  const lines = yamlBlock.split("\n");

  const fix: Fix = {
    type: "manual-required",
    reasoning: "",
    confidence: 0,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\w[\w_]*):\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, "").trim();

    switch (key) {
      case "type":
        if (VALID_FIX_TYPES.has(value)) {
          fix.type = value as FixType;
        }
        break;
      case "attribute":
        fix.attribute = value;
        break;
      case "value":
        fix.value = value;
        break;
      case "new_element":
        fix.newElement = value;
        break;
      case "new_html":
        fix.newHtml = value;
        break;
      case "note":
        fix.note = value;
        break;
      case "reasoning":
        fix.reasoning = value;
        break;
      case "confidence":
        fix.confidence = parseFloat(value) || 0;
        break;
    }
  }

  // Validate: reject fixes with broken, useless, or instruction-as-value outputs
  if (fix.value && isBrokenValue(fix.value)) {
    return {
      type: "manual-required",
      reasoning: "LLM output was truncated or invalid",
      confidence: 0,
      note: fix.reasoning,
    };
  }

  // For aria-label specifically, reject useless values
  if (fix.attribute === "aria-label" && fix.value && isUselessLabel(fix.value)) {
    return {
      type: "manual-required",
      reasoning: "LLM could not infer a meaningful label — needs human review",
      confidence: 0,
      note: `LLM suggested: "${fix.value}". Please provide a descriptive label manually.`,
    };
  }

  return fix;
}

function isBrokenValue(v: string): boolean {
  if (v.includes("${") && !/\$\{[^}]*\}/.test(v)) return true;
  if (/\bMath\.|\bDate\.|\brandom\(/.test(v)) return true;
  if (/\.toStr$|\.toFi$|\.slic$/.test(v)) return true;
  return false;
}

/** Reject aria-label values that aren't real labels (component names, instructions to the LLM). */
function isUselessLabel(v: string): boolean {
  const lower = v.toLowerCase().trim();

  // Just the component name — "Input", "Select", "Textarea", "Button", etc.
  if (/^(input|select|textarea|button|checkbox|radio|field|form|element)$/i.test(lower)) return true;

  // LLM regurgitated the instruction as the label
  if (/please provide|provide a (descriptive|meaningful|accessible) (label|name)/i.test(lower)) return true;
  if (/based on (context|surrounding|the element)/i.test(lower)) return true;
  if (/^(descriptive|meaningful|accessible) (label|name)/i.test(lower)) return true;
  if (/^(todo|tbd|fixme|xxx|placeholder)/i.test(lower)) return true;

  // Too generic to be useful
  if (/^(text|input field|form field|click here|button|link)$/i.test(lower)) return true;

  return false;
}

/** Parse a batched LLM response containing fix_1, fix_2, ... blocks. */
export function parseBatchOutput(text: string, count: number): Fix[] {
  const fixes: Fix[] = [];

  for (let i = 1; i <= count; i++) {
    const marker = `fix_${i}:`;
    const nextMarker = `fix_${i + 1}:`;
    const startIdx = text.indexOf(marker);

    if (startIdx === -1) {
      fixes.push({
        type: "manual-required",
        reasoning: `Batch response missing fix_${i} block`,
        confidence: 0,
      });
      continue;
    }

    const endIdx = i < count ? text.indexOf(nextMarker) : text.length;
    const block = text.slice(startIdx, endIdx > startIdx ? endIdx : text.length);

    // Parse the block the same way as a single fix, but ignore the fix_N: line itself
    const fix: Fix = { type: "manual-required", reasoning: "", confidence: 0 };
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\w[\w_]*):\s*(.+)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (key.startsWith("fix_")) continue;
      const value = rawValue.replace(/^["']|["']$/g, "").trim();

      switch (key) {
        case "type": if (VALID_FIX_TYPES.has(value)) fix.type = value as FixType; break;
        case "attribute": fix.attribute = value; break;
        case "value": fix.value = value; break;
        case "new_element": fix.newElement = value; break;
        case "new_html": fix.newHtml = value; break;
        case "note": fix.note = value; break;
        case "reasoning": fix.reasoning = value; break;
        case "confidence": fix.confidence = parseFloat(value) || 0; break;
      }
    }

    fixes.push(fix);
  }

  return fixes;
}
