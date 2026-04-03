import type { Page } from "playwright";

const LANDMARKS = ["main", "nav", "header", "footer", "aside", "section", "article", "form", "dialog"];

export async function captureAriaSnapshot(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot();
}

/** Scoped ARIA snapshot: walks up to nearest landmark or 2 ancestor levels for context. */
export async function captureLocalAriaContext(
  page: Page,
  target: string,
): Promise<string> {
  const contextSelector = await page.evaluate(({ selector, landmarks }) => {
    const el = document.querySelector(selector);
    if (!el) return null;

    let context: Element = el;
    for (let i = 0; i < 3; i++) {
      const parent = context.parentElement;
      if (!parent || parent === document.body) break;
      context = parent;
      const role = context.getAttribute("role") ?? context.tagName.toLowerCase();
      if (landmarks.includes(role)) break;
    }

    return context.tagName.toLowerCase() + (context.id ? `#${context.id}` : "");
  }, { selector: target, landmarks: LANDMARKS });

  if (!contextSelector) return captureAriaSnapshot(page);

  try {
    return await page.locator(contextSelector).first().ariaSnapshot();
  } catch {
    return captureAriaSnapshot(page);
  }
}

export async function getNearestLandmark(
  page: Page,
  target: string,
): Promise<{ section: string; pageTitle: string }> {
  return page.evaluate(({ selector, landmarks }) => {
    const el = document.querySelector(selector);
    const pageTitle = document.title || "Untitled";
    if (!el) return { section: "unknown", pageTitle };

    let current: Element | null = el;
    while (current && current !== document.body) {
      const role = current.getAttribute("role") ?? current.tagName.toLowerCase();
      if (landmarks.includes(role)) {
        const name = current.getAttribute("aria-label") ?? current.getAttribute("aria-labelledby") ?? "";
        return { section: name ? `${role} — "${name}"` : role, pageTitle };
      }
      current = current.parentElement;
    }

    return { section: "page root", pageTitle };
  }, { selector: target, landmarks: LANDMARKS });
}
