import type { Page } from "playwright";
import type { Violation } from "@recast-a11y/classifier";

/**
 * Custom accessibility checks that axe-core misses.
 * Runs inside the Playwright page context via page.evaluate().
 */
export async function runCustomChecks(
  page: Page,
  pageUrl: string,
): Promise<Violation[]> {
  return page.evaluate((url: string) => {
    const violations: Violation[] = [];

    function addViolation(
      el: Element,
      ruleId: string,
      description: string,
      wcag: string,
      impact: "minor" | "moderate" | "serious" | "critical",
      helpUrl: string,
    ) {
      violations.push({
        ruleId,
        description,
        wcag,
        impact,
        html: el.outerHTML.slice(0, 500),
        target: cssPath(el),
        helpUrl,
        pageUrl: url,
      });
    }

    function cssPath(el: Element): string {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector += `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        const parentEl: Element | null = current.parentElement;
        if (parentEl) {
          const tag = current.tagName;
          const cur = current;
          const siblings: Element[] = [];
          for (let j = 0; j < parentEl.children.length; j++) {
            if (parentEl.children[j].tagName === tag) {
              siblings.push(parentEl.children[j]);
            }
          }
          if (siblings.length > 1) {
            selector += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(selector);
        current = parentEl;
      }
      return parts.join(" > ");
    }

    // ── Check 1: div/span with onClick but no role and no keyboard handler ──
    const clickables = document.querySelectorAll("div[onclick], span[onclick]");
    for (const el of clickables) {
      if (
        !el.getAttribute("role") &&
        !el.getAttribute("onkeydown") &&
        !el.getAttribute("onkeypress") &&
        !el.getAttribute("onkeyup")
      ) {
        addViolation(
          el,
          "click-without-keyboard",
          "Element has onClick handler but no keyboard equivalent or ARIA role",
          "2.1.1 Keyboard",
          "serious",
          "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
        );
      }
    }

    // ── Check 2: Heading hierarchy gaps ──
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    for (let i = 1; i < headings.length; i++) {
      const prevLevel = parseInt(headings[i - 1].tagName[1], 10);
      const currLevel = parseInt(headings[i].tagName[1], 10);
      if (currLevel > prevLevel + 1) {
        addViolation(
          headings[i],
          "heading-order",
          `Heading level skipped: h${prevLevel} → h${currLevel} (missing h${prevLevel + 1})`,
          "1.3.1 Info and Relationships",
          "moderate",
          "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html",
        );
      }
    }

    // ── Check 3: aria-labelledby referencing non-existent IDs ──
    const labelledBy = document.querySelectorAll("[aria-labelledby]");
    for (const el of labelledBy) {
      const ids = el.getAttribute("aria-labelledby")!.split(/\s+/);
      for (const id of ids) {
        if (id && !document.getElementById(id)) {
          addViolation(
            el,
            "aria-labelledby-broken",
            `aria-labelledby references non-existent id="${id}"`,
            "1.3.1 Info and Relationships",
            "critical",
            "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html",
          );
        }
      }
    }

    // ── Check 4: Interactive elements with tabindex="-1" and no other keyboard access ──
    const negativeTabindex = document.querySelectorAll(
      'a[tabindex="-1"], button[tabindex="-1"], input[tabindex="-1"], select[tabindex="-1"], textarea[tabindex="-1"]',
    );
    for (const el of negativeTabindex) {
      // Check if there's an aria-activedescendant pattern or a parent with keyboard management
      if (!el.closest("[aria-activedescendant]")) {
        addViolation(
          el,
          "focusable-negative-tabindex",
          "Interactive element has tabindex=\"-1\" with no alternative keyboard access mechanism",
          "2.1.1 Keyboard",
          "serious",
          "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html",
        );
      }
    }

    // ── Check 5: Button in form without type ──
    const formButtons = document.querySelectorAll("form button:not([type])");
    for (const el of formButtons) {
      addViolation(
        el,
        "button-has-type",
        "Button inside form has no type attribute — defaults to \"submit\"",
        "3.2.2 On Input",
        "moderate",
        "https://www.w3.org/WAI/WCAG22/Understanding/on-input.html",
      );
    }

    return violations;
  }, pageUrl);
}
