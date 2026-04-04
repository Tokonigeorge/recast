import type { Violation, Fix, FixType } from "./types.js";

export interface HighConfidenceRule {
  ruleId: string;
  match(violation: Violation): Fix | null;
}

function makeFix(
  type: FixType,
  reasoning: string,
  confidence: number,
  attrs?: Partial<Fix>,
): Fix {
  return { type, reasoning, confidence, ...attrs };
}

export const HIGH_CONFIDENCE_RULES: HighConfidenceRule[] = [
  {
    ruleId: "html-has-lang",
    match() {
      return makeFix("add-attribute", "HTML element missing lang attribute", 1.0,
        { attribute: "lang", value: "en" });
    },
  },
  {
    ruleId: "aria-valid-attr-value",
    match(v) {
      const attrMatch = v.description.match(/aria-[\w-]+/);
      if (!attrMatch) return null;
      return makeFix("remove-attribute", `Invalid ARIA attribute value — removing ${attrMatch[0]}`, 0.90,
        { attribute: attrMatch[0] });
    },
  },
  {
    ruleId: "aria-valid-attr",
    match(v) {
      const attrMatch = v.description.match(/aria-[\w-]+/);
      if (!attrMatch) return null;
      return makeFix("remove-attribute", `Invalid ARIA attribute — removing ${attrMatch[0]}`, 1.0,
        { attribute: attrMatch[0] });
    },
  },
  {
    ruleId: "duplicate-id",
    match(v) {
      const idMatch = v.html.match(/id=["']([^"']+)["']/);
      if (!idMatch) return null;
      return makeFix("add-attribute", `Duplicate id="${idMatch[1]}" — append unique suffix`, 0.95,
        { attribute: "id", value: `${idMatch[1]}-2` });
    },
  },
  {
    ruleId: "image-alt",
    match(v) {
      if (v.html.includes('role="presentation"') || v.html.includes("role='presentation'")) {
        return makeFix("add-attribute", 'Presentational image missing explicit alt=""', 0.95,
          { attribute: "alt", value: "" });
      }
      if (/src=["']\s*["']/.test(v.html) || /src=["']data:/.test(v.html)) {
        return makeFix("add-attribute", "Data URI / empty src image — marking decorative", 0.90,
          { attribute: "alt", value: "" });
      }
      return null;
    },
  },
  {
    ruleId: "button-name",
    match() { return null; },
  },
  {
    ruleId: "button-has-type",
    match(v) {
      if (/<button\b/i.test(v.html) && !/<button[^>]*\btype\s*=/i.test(v.html)) {
        return makeFix("add-attribute", 'Button in form defaults to type="submit" — adding explicit type="button"', 0.95,
          { attribute: "type", value: "button" });
      }
      return null;
    },
  },
  {
    ruleId: "aria-hidden-focus",
    match(v) {
      const tabMatch = v.html.match(/tabindex=["'](\d+)["']/);
      if (tabMatch && parseInt(tabMatch[1], 10) >= 0) {
        return makeFix("add-attribute", "aria-hidden element is focusable — removing from tab order", 0.85,
          { attribute: "tabindex", value: "-1" });
      }
      if (/^<(a|button|input|select|textarea)\b/i.test(v.html.trim())) {
        return makeFix("add-attribute", 'aria-hidden on focusable element — adding tabindex="-1"', 0.85,
          { attribute: "tabindex", value: "-1" });
      }
      return null;
    },
  },
  { ruleId: "link-name", match() { return null; } },
  { ruleId: "label", match() { return null; } },
  // document-title is in SKIP_RULES — page titles are product decisions
  { ruleId: "heading-order", match() { return null; } },
  { ruleId: "color-contrast", match() { return null; } },
  {
    ruleId: "aria-labelledby-broken",
    match(v) {
      const idMatch = v.description.match(/id="([^"]+)"/);
      if (!idMatch) return null;
      return makeFix("remove-attribute",
        `aria-labelledby references non-existent id="${idMatch[1]}" — removing broken reference`, 1.0,
        { attribute: "aria-labelledby" });
    },
  },
  {
    ruleId: "list",
    match() {
      return makeFix("manual-required", "Non-<li> children inside <ul>/<ol> — requires DOM restructuring", 0,
        { note: "Wrap direct children in <li> elements or change the parent to a <div>" });
    },
  },
  {
    ruleId: "aria-required-children",
    match() {
      return makeFix("manual-required", "Element with ARIA role is missing required child role — requires restructuring", 0,
        { note: "Add child elements with the required ARIA roles or restructure the component" });
    },
  },
  { ruleId: "select-name", match() { return null; } },
];

/** Violations Recast cannot fix — CSS-only, design decisions, runtime behavior. Reported but never sent to LLM. */
export const SKIP_RULES = new Set([
  "target-size", "color-contrast", "color-contrast-enhanced", "link-in-text-block",
  "meta-viewport", "scrollable-region-focusable",
  "audio-caption", "video-caption", "video-description",
  "no-autoplay-audio", "css-orientation-lock",
  "nested-interactive",
  "document-title",
]);

const rulesByRuleId = new Map<string, HighConfidenceRule[]>();
for (const rule of HIGH_CONFIDENCE_RULES) {
  const existing = rulesByRuleId.get(rule.ruleId);
  if (existing) existing.push(rule);
  else rulesByRuleId.set(rule.ruleId, [rule]);
}

/** Try to produce a high-confidence fix. Returns null if LLM needed. */
export function tryHighConfidenceFix(violation: Violation): Fix | null {
  const rules = rulesByRuleId.get(violation.ruleId);
  if (!rules) return null;
  for (const rule of rules) {
    const fix = rule.match(violation);
    if (fix) return fix;
  }
  return null;
}
