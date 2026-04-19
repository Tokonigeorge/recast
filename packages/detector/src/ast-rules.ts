import type { Violation } from "@recast-a11y/classifier";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
  VALID_ARIA_ATTRS, VALID_ROLES, ARIA_ENUM_VALUES, ROLE_REQUIRED_ATTRS, isValidLang,
} from "./aria-schema.js";

export interface AstContext {
  filePath: string;
  sourceLines: string[];
  allIds: Set<string>;
  duplicateIds: Map<string, number>;
  headingStack: Array<{ level: number; line: number }>;
  labelFors: Set<string>;
}

export interface AstRule {
  id: string;
  description: string;
  wcag: string;
  impact: "minor" | "moderate" | "serious" | "critical";
  /** Called for each JSX opening element */
  jsxElement?(path: NodePath<t.JSXOpeningElement>, ctx: AstContext): Violation | Violation[] | null;
}

/**
 * Get the element name as a string.
 * Handles JSXIdentifier (e.g., div), JSXMemberExpression (e.g., Foo.Bar),
 * and JSXNamespacedName (e.g., svg:svg).
 */
export function getElementName(node: t.JSXOpeningElement): string {
  const name = node.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const parts: string[] = [];
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(current)) {
      parts.unshift(t.isJSXIdentifier(current.property) ? current.property.name : "?");
      current = current.object as t.JSXMemberExpression | t.JSXIdentifier;
    }
    if (t.isJSXIdentifier(current)) parts.unshift(current.name);
    return parts.join(".");
  }
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return "unknown";
}

/** Get a JSX attribute by name. Returns null if not present. */
export function getAttribute(node: t.JSXOpeningElement, name: string): t.JSXAttribute | null {
  for (const attr of node.attributes) {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name) {
      return attr;
    }
  }
  return null;
}

/** Get a string literal value of an attribute, if it has one. */
export function getAttributeStringValue(attr: t.JSXAttribute | null): string | null {
  if (!attr) return null;
  if (!attr.value) return ""; // boolean attribute
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (t.isJSXExpressionContainer(attr.value)) {
    const expr = attr.value.expression;
    if (t.isStringLiteral(expr)) return expr.value;
    if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) {
      return expr.quasis[0]?.value.cooked ?? null;
    }
  }
  return null;
}

/** Check if element has any of the given attributes (including spread). */
export function hasAttribute(node: t.JSXOpeningElement, ...names: string[]): boolean {
  for (const attr of node.attributes) {
    if (t.isJSXSpreadAttribute(attr)) return true; // conservative: spread might contain anything
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && names.includes(attr.name.name)) {
      return true;
    }
  }
  return false;
}

/** Does this element contain any text content (string literal or expression)? */
export function hasTextContent(path: NodePath<t.JSXOpeningElement>): boolean {
  const parent = path.parent;
  if (!t.isJSXElement(parent)) return false;

  for (const child of parent.children) {
    if (t.isJSXText(child) && child.value.trim().length > 0) return true;
    if (t.isJSXExpressionContainer(child)) {
      const expr = child.expression;
      if (t.isStringLiteral(expr) && expr.value.trim().length > 0) return true;
      // Any other expression might produce text — conservative
      if (!t.isJSXEmptyExpression(expr)) return true;
    }
  }
  return false;
}

/** Does this element have only icon/svg children (no discernible text)? */
export function isIconOnly(path: NodePath<t.JSXOpeningElement>): boolean {
  const parent = path.parent;
  if (!t.isJSXElement(parent)) return false;

  let hasVisibleChild = false;
  for (const child of parent.children) {
    if (t.isJSXText(child) && child.value.trim().length > 0) return false;
    if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        // Could be text — we can't tell
        return false;
      }
    }
    if (t.isJSXElement(child)) {
      const childName = getElementName(child.openingElement);
      // SVG, icons (starting with capital and ending with Icon), or decorative
      if (/^svg$/i.test(childName) || /Icon$/.test(childName) || childName === "i") {
        hasVisibleChild = true;
      } else {
        // Unknown element — conservative, assume it might have text
        return false;
      }
    }
  }
  return hasVisibleChild;
}

/** Make a Violation from a path. */
export function makeViolation(
  rule: AstRule,
  path: NodePath<t.JSXOpeningElement>,
  ctx: AstContext,
  override: Partial<Violation> = {},
): Violation {
  const lineNum = path.node.loc?.start.line ?? 1;
  const lineContent = ctx.sourceLines[lineNum - 1] ?? "";
  const elementName = getElementName(path.node);

  return {
    ruleId: rule.id,
    description: rule.description,
    wcag: rule.wcag,
    impact: rule.impact,
    html: lineContent.trim().slice(0, 300),
    target: elementName,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${rule.id}`,
    pageUrl: ctx.filePath,
    line: lineNum,
    ...override,
  };
}

/** All AST rules. Executed against every JSX opening element. */
export const AST_RULES: AstRule[] = [
  // ── img without alt ──
  {
    id: "image-alt",
    description: "Images must have alternate text",
    wcag: "1.1.1",
    impact: "critical",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      if (name !== "img") return null;
      if (hasAttribute(path.node, "alt", "aria-label", "aria-labelledby", "role")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── html without lang ──
  {
    id: "html-has-lang",
    description: "html element must have a lang attribute",
    wcag: "3.1.1",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "html") return null;
      if (hasAttribute(path.node, "lang")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── button without accessible name (icon-only) ──
  {
    id: "button-name",
    description: "Buttons must have discernible text",
    wcag: "4.1.2",
    impact: "critical",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      if (name !== "button") return null;
      if (hasAttribute(path.node, "aria-label", "aria-labelledby", "title")) return null;
      if (hasTextContent(path)) return null;
      if (isIconOnly(path)) return makeViolation(this, path, ctx);
      return null;
    },
  },

  // ── link without accessible name ──
  {
    id: "link-name",
    description: "Links must have discernible text",
    wcag: "2.4.4",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "a") return null;
      if (hasAttribute(path.node, "aria-label", "aria-labelledby", "title")) return null;
      if (hasTextContent(path)) return null;
      if (isIconOnly(path)) return makeViolation(this, path, ctx);
      // Link wrapping img without alt
      const parent = path.parent;
      if (t.isJSXElement(parent)) {
        for (const child of parent.children) {
          if (t.isJSXElement(child) && getElementName(child.openingElement).toLowerCase() === "img") {
            if (!hasAttribute(child.openingElement, "alt", "aria-label")) {
              return makeViolation(this, path, ctx);
            }
          }
        }
      }
      return null;
    },
  },

  // ── form input without label ──
  {
    id: "label",
    description: "Form elements must have labels",
    wcag: "1.3.1",
    impact: "critical",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      const namedElements = ["input", "textarea", "select"];
      const componentPatterns = /^(Input|TextArea|Textarea|Select|TextField|FormField|Field)$/;
      const isNativeForm = namedElements.includes(name);
      const isFormComponent = componentPatterns.test(getElementName(path.node));
      if (!isNativeForm && !isFormComponent) return null;

      // Skip hidden inputs and buttons
      const typeAttr = getAttributeStringValue(getAttribute(path.node, "type"));
      if (isNativeForm && name === "input" && (typeAttr === "hidden" || typeAttr === "submit" || typeAttr === "button" || typeAttr === "reset")) {
        return null;
      }

      if (hasAttribute(path.node, "aria-label", "aria-labelledby", "title")) return null;

      // Check if id has matching <label htmlFor>
      const idAttr = getAttributeStringValue(getAttribute(path.node, "id"));
      if (idAttr && ctx.labelFors.has(idAttr)) return null;

      return makeViolation(this, path, ctx);
    },
  },

  // ── button in form without type ──
  {
    id: "button-has-type",
    description: "Buttons in forms should have an explicit type attribute",
    wcag: "3.2.2",
    impact: "moderate",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "button") return null;
      if (hasAttribute(path.node, "type")) return null;

      // Check if ancestor is a form
      let parent: NodePath | null = path.parentPath;
      while (parent) {
        if (t.isJSXElement(parent.node)) {
          const parentName = getElementName(parent.node.openingElement).toLowerCase();
          if (parentName === "form") return makeViolation(this, path, ctx);
          if (parentName === "body" || parentName === "html") break;
        }
        parent = parent.parentPath;
      }
      return null;
    },
  },

  // ── aria-hidden on focusable element ──
  {
    id: "aria-hidden-focus",
    description: "aria-hidden should not be on focusable elements",
    wcag: "4.1.2",
    impact: "serious",
    jsxElement(path, ctx) {
      const ariaHidden = getAttributeStringValue(getAttribute(path.node, "aria-hidden"));
      if (ariaHidden !== "true") return null;

      const name = getElementName(path.node).toLowerCase();
      const focusable = ["a", "button", "input", "select", "textarea"];
      if (!focusable.includes(name)) return null;

      const tabIndex = getAttributeStringValue(getAttribute(path.node, "tabIndex") ?? getAttribute(path.node, "tabindex"));
      if (tabIndex === "-1") return null;

      return makeViolation(this, path, ctx);
    },
  },

  // ── div/span with onClick but no keyboard handler ──
  {
    id: "click-without-keyboard",
    description: "Clickable elements must be keyboard accessible",
    wcag: "2.1.1",
    impact: "serious",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      if (name !== "div" && name !== "span") return null;
      if (!hasAttribute(path.node, "onClick")) return null;
      if (hasAttribute(path.node, "role", "onKeyDown", "onKeyPress", "onKeyUp", "tabIndex")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── aria-labelledby references non-existent id ──
  {
    id: "aria-labelledby-broken",
    description: "aria-labelledby must reference an existing element id",
    wcag: "1.3.1",
    impact: "critical",
    jsxElement(path, ctx) {
      const labelledBy = getAttributeStringValue(getAttribute(path.node, "aria-labelledby"));
      if (!labelledBy) return null;

      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const missing = ids.filter((id) => !ctx.allIds.has(id));
      if (missing.length === 0) return null;

      return makeViolation(this, path, ctx, {
        description: `aria-labelledby references non-existent id="${missing[0]}"`,
        target: `[aria-labelledby="${labelledBy}"]`,
      });
    },
  },

  // ── duplicate id ──
  {
    id: "duplicate-id",
    description: "Elements must have unique id attributes",
    wcag: "4.1.1",
    impact: "moderate",
    jsxElement(path, ctx) {
      const id = getAttributeStringValue(getAttribute(path.node, "id"));
      if (!id) return null;
      if ((ctx.duplicateIds.get(id) ?? 0) <= 1) return null;
      return makeViolation(this, path, ctx, {
        description: `id="${id}" is used on multiple elements`,
      });
    },
  },

  // ── link with target="_blank" without rel="noopener" ──
  {
    id: "link-target-blank",
    description: "Links opening in new window should have rel=\"noopener\"",
    wcag: "2.5.3",
    impact: "moderate",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "a") return null;
      const target = getAttributeStringValue(getAttribute(path.node, "target"));
      if (target !== "_blank") return null;
      const rel = getAttributeStringValue(getAttribute(path.node, "rel"));
      if (rel && (rel.includes("noopener") || rel.includes("noreferrer"))) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── video without captions track ──
  {
    id: "video-caption",
    description: "Video elements should include captions via <track kind=\"captions\">",
    wcag: "1.2.2",
    impact: "critical",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "video") return null;
      const parent = path.parent;
      if (!t.isJSXElement(parent)) return null;

      for (const child of parent.children) {
        if (t.isJSXElement(child) && getElementName(child.openingElement).toLowerCase() === "track") {
          const kind = getAttributeStringValue(getAttribute(child.openingElement, "kind"));
          if (kind === "captions" || kind === "subtitles") return null;
        }
      }
      return makeViolation(this, path, ctx);
    },
  },

  // ── iframe without title ──
  {
    id: "frame-title",
    description: "iframe elements must have a title attribute",
    wcag: "4.1.2",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "iframe") return null;
      if (hasAttribute(path.node, "title", "aria-label", "aria-labelledby")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── input type="image" without alt ──
  {
    id: "input-image-alt",
    description: "input[type=\"image\"] must have alt text",
    wcag: "1.1.1",
    impact: "critical",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "input") return null;
      const type = getAttributeStringValue(getAttribute(path.node, "type"));
      if (type !== "image") return null;
      if (hasAttribute(path.node, "alt", "aria-label", "aria-labelledby")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── autofocus on elements (discouraged for a11y) ──
  {
    id: "no-autofocus",
    description: "Avoid autofocus — disorients screen reader users",
    wcag: "3.2.1",
    impact: "moderate",
    jsxElement(path, ctx) {
      if (!hasAttribute(path.node, "autoFocus", "autofocus")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── role on element with conflicting implicit role ──
  {
    id: "no-redundant-role",
    description: "Avoid role on elements with an equivalent implicit role",
    wcag: "4.1.2",
    impact: "minor",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      const role = getAttributeStringValue(getAttribute(path.node, "role"));
      if (!role) return null;

      const implicit: Record<string, string> = {
        button: "button", a: "link", nav: "navigation", main: "main",
        header: "banner", footer: "contentinfo", aside: "complementary",
        article: "article", section: "region", form: "form",
        ul: "list", ol: "list", li: "listitem",
      };
      if (implicit[name] === role) return makeViolation(this, path, ctx);
      return null;
    },
  },

  // ── positive tabindex (> 0) ──
  {
    id: "no-positive-tabindex",
    description: "Avoid positive tabindex — disrupts natural tab order",
    wcag: "2.4.3",
    impact: "serious",
    jsxElement(path, ctx) {
      const ti = getAttributeStringValue(getAttribute(path.node, "tabIndex") ?? getAttribute(path.node, "tabindex"));
      if (!ti) return null;
      const num = parseInt(ti, 10);
      if (isNaN(num) || num <= 0) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── <a> without href ──
  {
    id: "anchor-has-href",
    description: "Anchor elements should have an href attribute",
    wcag: "4.1.2",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "a") return null;
      if (hasAttribute(path.node, "href")) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── invalid aria-* attribute name ──
  {
    id: "aria-valid-attr",
    description: "ARIA attributes must use valid names",
    wcag: "4.1.2",
    impact: "critical",
    jsxElement(path, ctx) {
      const violations: Violation[] = [];
      for (const attr of path.node.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        const name = attr.name.name;
        if (!name.startsWith("aria-")) continue;
        if (!VALID_ARIA_ATTRS.has(name)) {
          violations.push(makeViolation(this, path, ctx, {
            description: `Unknown ARIA attribute: ${name}`,
            target: `[${name}]`,
          }));
        }
      }
      return violations.length > 0 ? violations : null;
    },
  },

  // ── invalid role value ──
  {
    id: "aria-roles",
    description: "ARIA roles must be valid",
    wcag: "4.1.2",
    impact: "serious",
    jsxElement(path, ctx) {
      const role = getAttributeStringValue(getAttribute(path.node, "role"));
      if (!role) return null;
      // Handle space-separated list (fallback roles)
      const roles = role.split(/\s+/).filter(Boolean);
      for (const r of roles) {
        if (!VALID_ROLES.has(r)) {
          return makeViolation(this, path, ctx, {
            description: `Invalid ARIA role: "${r}"`,
          });
        }
      }
      return null;
    },
  },

  // ── invalid enumerated aria value ──
  {
    id: "aria-valid-attr-value",
    description: "ARIA attribute values must be valid",
    wcag: "4.1.2",
    impact: "serious",
    jsxElement(path, ctx) {
      const violations: Violation[] = [];
      for (const attr of path.node.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        const name = attr.name.name;
        const enumValues = ARIA_ENUM_VALUES[name];
        if (!enumValues) continue;
        const value = getAttributeStringValue(attr);
        if (value === null) continue; // dynamic — can't check
        if (!enumValues.has(value)) {
          violations.push(makeViolation(this, path, ctx, {
            description: `Invalid value "${value}" for ${name}`,
            target: `[${name}="${value}"]`,
          }));
        }
      }
      return violations.length > 0 ? violations : null;
    },
  },

  // ── required aria attrs for role ──
  {
    id: "aria-required-attr",
    description: "Required ARIA attributes are missing for the role",
    wcag: "4.1.2",
    impact: "critical",
    jsxElement(path, ctx) {
      const role = getAttributeStringValue(getAttribute(path.node, "role"));
      if (!role) return null;
      const required = ROLE_REQUIRED_ATTRS[role];
      if (!required || required.length === 0) return null;

      const missing = required.filter((a) => !hasAttribute(path.node, a));
      if (missing.length === 0) return null;

      return makeViolation(this, path, ctx, {
        description: `role="${role}" is missing required ${missing.join(", ")}`,
      });
    },
  },

  // ── missing <title> in <head> ──
  {
    id: "document-title",
    description: "<head> must contain a <title> element",
    wcag: "2.4.2",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "head") return null;
      const parent = path.parent;
      if (!t.isJSXElement(parent)) return null;
      let hasTitle = false;
      for (const child of parent.children) {
        if (t.isJSXElement(child) && getElementName(child.openingElement).toLowerCase() === "title") {
          hasTitle = true;
          break;
        }
      }
      if (hasTitle) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── meta viewport disabling zoom ──
  {
    id: "meta-viewport",
    description: "Do not disable zoom in viewport meta tag",
    wcag: "1.4.4",
    impact: "critical",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "meta") return null;
      const name = getAttributeStringValue(getAttribute(path.node, "name"));
      if (name !== "viewport") return null;
      const content = getAttributeStringValue(getAttribute(path.node, "content"));
      if (!content) return null;
      if (/user-scalable\s*=\s*no/i.test(content) || /maximum-scale\s*=\s*1(?:\.0)?\b/i.test(content)) {
        return makeViolation(this, path, ctx);
      }
      return null;
    },
  },

  // ── meta refresh with timeout ──
  {
    id: "meta-refresh",
    description: "Avoid <meta http-equiv=\"refresh\"> — disorients screen readers",
    wcag: "2.2.1",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "meta") return null;
      const httpEquiv = getAttributeStringValue(getAttribute(path.node, "http-equiv") ?? getAttribute(path.node, "httpEquiv"));
      if (httpEquiv !== "refresh") return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── empty heading ──
  {
    id: "empty-heading",
    description: "Headings must have content",
    wcag: "1.3.1",
    impact: "moderate",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      if (!/^h[1-6]$/.test(name)) return null;
      if (hasAttribute(path.node, "aria-label", "aria-labelledby")) return null;
      if (hasTextContent(path)) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── svg with role="img" must have accessible name ──
  {
    id: "svg-img-alt",
    description: "SVG with role=\"img\" requires an accessible name",
    wcag: "1.1.1",
    impact: "serious",
    jsxElement(path, ctx) {
      const name = getElementName(path.node).toLowerCase();
      const role = getAttributeStringValue(getAttribute(path.node, "role"));
      const isImgSvg = (name === "svg" && role === "img") || role === "img";
      if (!isImgSvg) return null;
      if (hasAttribute(path.node, "aria-label", "aria-labelledby", "title")) return null;

      // Check if it has a <title> child
      const parent = path.parent;
      if (t.isJSXElement(parent)) {
        for (const child of parent.children) {
          if (t.isJSXElement(child) && getElementName(child.openingElement).toLowerCase() === "title") {
            return null;
          }
        }
      }
      return makeViolation(this, path, ctx);
    },
  },

  // ── object without fallback ──
  {
    id: "object-alt",
    description: "<object> elements need fallback content",
    wcag: "1.1.1",
    impact: "serious",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "object") return null;
      if (hasAttribute(path.node, "aria-label", "aria-labelledby", "title")) return null;
      if (hasTextContent(path)) return null;
      return makeViolation(this, path, ctx);
    },
  },

  // ── invalid lang value ──
  {
    id: "html-lang-valid",
    description: "lang attribute must have a valid BCP-47 value",
    wcag: "3.1.1",
    impact: "serious",
    jsxElement(path, ctx) {
      const lang = getAttributeStringValue(getAttribute(path.node, "lang"));
      if (lang === null) return null;
      if (lang === "") {
        return makeViolation(this, path, ctx, {
          description: "lang attribute is empty",
        });
      }
      if (!isValidLang(lang)) {
        return makeViolation(this, path, ctx, {
          description: `Invalid lang value: "${lang}"`,
        });
      }
      return null;
    },
  },

  // ── area element without alt ──
  {
    id: "area-alt",
    description: "<area> elements must have alt text",
    wcag: "1.1.1",
    impact: "critical",
    jsxElement(path, ctx) {
      if (getElementName(path.node).toLowerCase() !== "area") return null;
      if (!hasAttribute(path.node, "href")) return null;
      if (hasAttribute(path.node, "alt", "aria-label", "aria-labelledby")) return null;
      return makeViolation(this, path, ctx);
    },
  },
];
