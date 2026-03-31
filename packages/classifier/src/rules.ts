import type { Violation, Fix, FixType } from "./types.js";

/** A rule that can produce a high-confidence fix without LLM involvement */
export interface HighConfidenceRule {
  /** axe-core rule ID this handles */
  ruleId: string;
  /** Additional condition beyond rule match. Return null to skip. */
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

/**
 * All high-confidence rules that can be applied without LLM.
 * Order doesn't matter — each violation is matched by ruleId.
 */
export const HIGH_CONFIDENCE_RULES: HighConfidenceRule[] = [
  // ── html-has-lang ──────────────────────────────────────────────
  {
    ruleId: "html-has-lang",
    match() {
      return makeFix(
        "add-attribute",
        "HTML element missing lang attribute",
        1.0,
        { attribute: "lang", value: "en" },
      );
    },
  },

  // ── aria-allowed-attr / aria-valid-attr-value ──────────────────
  {
    ruleId: "aria-valid-attr-value",
    match(v) {
      // Remove the broken attribute rather than guessing the correct value
      const attrMatch = v.description.match(/aria-[\w-]+/);
      if (!attrMatch) return null;
      return makeFix(
        "remove-attribute",
        `Invalid ARIA attribute value — removing ${attrMatch[0]}`,
        0.90,
        { attribute: attrMatch[0] },
      );
    },
  },

  // ── aria-labelledby references non-existent ID ─────────────────
  {
    ruleId: "aria-valid-attr",
    match(v) {
      const attrMatch = v.description.match(/aria-[\w-]+/);
      if (!attrMatch) return null;
      return makeFix(
        "remove-attribute",
        `Invalid ARIA attribute — removing ${attrMatch[0]}`,
        1.0,
        { attribute: attrMatch[0] },
      );
    },
  },

  // ── duplicate-id ───────────────────────────────────────────────
  {
    ruleId: "duplicate-id",
    match(v) {
      const idMatch = v.html.match(/id=["']([^"']+)["']/);
      if (!idMatch) return null;
      return makeFix(
        "add-attribute",
        `Duplicate id="${idMatch[1]}" — append unique suffix`,
        0.95,
        { attribute: "id", value: `${idMatch[1]}-2` },
      );
    },
  },

  // ── image-alt: decorative image inside link with text ──────────
  {
    ruleId: "image-alt",
    match(v) {
      // Only auto-fix clearly decorative images
      if (v.html.includes('role="presentation"') || v.html.includes("role='presentation'")) {
        return makeFix(
          "add-attribute",
          "Presentational image missing explicit alt=\"\"",
          0.95,
          { attribute: "alt", value: "" },
        );
      }
      // Images with empty/data URIs are decorative
      if (/src=["']\s*["']/.test(v.html) || /src=["']data:/.test(v.html)) {
        return makeFix(
          "add-attribute",
          "Data URI / empty src image — marking decorative",
          0.90,
          { attribute: "alt", value: "" },
        );
      }
      // Otherwise, needs LLM to determine alt text
      return null;
    },
  },

  // ── button-name: icon-only buttons ─────────────────────────────
  // Only the simplest case is high-confidence (most need LLM for label text)
  {
    ruleId: "button-name",
    match() {
      // Labeling an icon button requires context — always send to LLM
      return null;
    },
  },

  // ── button in form without type ────────────────────────────────
  {
    ruleId: "button-has-type",
    match(v) {
      if (/<button\b/i.test(v.html) && !/<button[^>]*\btype\s*=/i.test(v.html)) {
        return makeFix(
          "add-attribute",
          "Button in form defaults to type=\"submit\" — adding explicit type=\"button\"",
          0.95,
          { attribute: "type", value: "button" },
        );
      }
      return null;
    },
  },

  // ── aria-hidden on focusable element ───────────────────────────
  {
    ruleId: "aria-hidden-focus",
    match(v) {
      // If it has tabindex >= 0, set to -1
      const tabMatch = v.html.match(/tabindex=["'](\d+)["']/);
      if (tabMatch && parseInt(tabMatch[1], 10) >= 0) {
        return makeFix(
          "add-attribute",
          "aria-hidden element is focusable — removing from tab order",
          0.85,
          { attribute: "tabindex", value: "-1" },
        );
      }
      // Naturally focusable elements (a, button, input, etc.)
      if (/^<(a|button|input|select|textarea)\b/i.test(v.html.trim())) {
        return makeFix(
          "add-attribute",
          "aria-hidden on focusable element — adding tabindex=\"-1\"",
          0.85,
          { attribute: "tabindex", value: "-1" },
        );
      }
      return null;
    },
  },

  // ── link-name: link wrapping only an image ─────────────────────
  {
    ruleId: "link-name",
    match(v) {
      // If link contains an img, it's a common pattern — but we need LLM for the label
      return null;
    },
  },

  // ── label: form input missing label ────────────────────────────
  {
    ruleId: "label",
    match() {
      // Needs LLM to determine correct label text
      return null;
    },
  },

  // ── document-title ─────────────────────────────────────────────
  {
    ruleId: "document-title",
    match() {
      // We can add a <title> but don't know the right text
      return null;
    },
  },

  // ── heading-order (skip levels) ────────────────────────────────
  {
    ruleId: "heading-order",
    match() {
      // Heading restructuring needs page-level context
      return null;
    },
  },

  // ── color-contrast ─────────────────────────────────────────────
  {
    ruleId: "color-contrast",
    match() {
      // CSS/design change — always manual
      return null;
    },
  },
];

/** Map of ruleId → rule for O(1) lookup */
const rulesByRuleId = new Map<string, HighConfidenceRule[]>();

for (const rule of HIGH_CONFIDENCE_RULES) {
  const existing = rulesByRuleId.get(rule.ruleId);
  if (existing) {
    existing.push(rule);
  } else {
    rulesByRuleId.set(rule.ruleId, [rule]);
  }
}

/** Try to produce a high-confidence fix for a violation. Returns null if LLM needed. */
export function tryHighConfidenceFix(violation: Violation): Fix | null {
  const rules = rulesByRuleId.get(violation.ruleId);
  if (!rules) return null;

  for (const rule of rules) {
    const fix = rule.match(violation);
    if (fix) return fix;
  }

  return null;
}
