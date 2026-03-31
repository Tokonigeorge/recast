import type { Page } from "playwright";

/**
 * Capture the ARIA snapshot (accessibility tree as YAML) for the full page
 * and for a specific element's local context.
 */
export async function captureAriaSnapshot(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot();
}

/**
 * Capture a scoped ARIA snapshot around a specific element.
 * Goes up 2 ancestor levels to provide local context for LLM processing.
 */
export async function captureLocalAriaContext(
  page: Page,
  target: string,
): Promise<string> {
  // Try to get the parent landmark or 2 levels up for context
  const contextSnapshot = await page.evaluate(async (selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;

    // Walk up to find the nearest landmark or 2 levels
    let context: Element = el;
    const landmarks = ["main", "nav", "header", "footer", "aside", "section", "article", "form", "dialog"];

    for (let i = 0; i < 3; i++) {
      const parent = context.parentElement;
      if (!parent || parent === document.body) break;
      context = parent;
      const role = context.getAttribute("role") ?? context.tagName.toLowerCase();
      if (landmarks.includes(role)) break;
    }

    return context.tagName.toLowerCase() + (context.id ? `#${context.id}` : "");
  }, target);

  if (!contextSnapshot) {
    // Fall back to full page snapshot
    return captureAriaSnapshot(page);
  }

  try {
    // Get the aria snapshot scoped to the context ancestor
    return await page.locator(contextSnapshot).first().ariaSnapshot();
  } catch {
    // If scoped snapshot fails, fall back to full page
    return captureAriaSnapshot(page);
  }
}

/** Get the nearest landmark info for page_context in the LLM prompt */
export async function getNearestLandmark(
  page: Page,
  target: string,
): Promise<{ section: string; pageTitle: string }> {
  return page.evaluate((selector: string) => {
    const el = document.querySelector(selector);
    const pageTitle = document.title || "Untitled";

    if (!el) return { section: "unknown", pageTitle };

    const landmarks = ["main", "nav", "header", "footer", "aside", "section", "article", "form", "dialog"];
    let current: Element | null = el;

    while (current && current !== document.body) {
      const role = current.getAttribute("role") ?? current.tagName.toLowerCase();
      if (landmarks.includes(role)) {
        const name =
          current.getAttribute("aria-label") ??
          current.getAttribute("aria-labelledby") ??
          "";
        return {
          section: name ? `${role} — "${name}"` : role,
          pageTitle,
        };
      }
      current = current.parentElement;
    }

    return { section: "page root", pageTitle };
  }, target);
}
