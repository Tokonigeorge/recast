import { describe, it, expect } from "vitest";
import { patchJsx } from "../src/jsx-patcher.js";
import type { Fix, SourceRef } from "@recast-a11y/classifier";

function makeSourceRef(line: number): SourceRef {
  return { file: "test.tsx", line };
}

describe("patchJsx", () => {
  it("adds aria-label to JSX button", () => {
    const jsx = `function Modal() {\n  return (\n    <button className="icon-btn">\n      <CloseIcon />\n    </button>\n  );\n}`;
    const fix: Fix = {
      type: "add-attribute",
      attribute: "aria-label",
      value: "Close dialog",
      reasoning: "icon-only button",
      confidence: 0.95,
    };

    const result = patchJsx(
      jsx,
      makeSourceRef(3),
      '<button class="icon-btn">',
      fix,
    );
    expect(result).not.toBeNull();
    expect(result).toContain('aria-label="Close dialog"');
  });

  it("adds alt attribute to JSX img", () => {
    const jsx = `<div>\n  <img src="photo.jpg" />\n</div>`;
    const fix: Fix = {
      type: "add-attribute",
      attribute: "alt",
      value: "",
      reasoning: "decorative",
      confidence: 0.9,
    };

    const result = patchJsx(
      jsx,
      makeSourceRef(2),
      '<img src="photo.jpg">',
      fix,
    );
    expect(result).toContain('alt=""');
  });

  it("converts tabindex to tabIndex in JSX", () => {
    const jsx = `<a href="/link" aria-hidden="true">\n  Hidden link\n</a>`;
    const fix: Fix = {
      type: "add-attribute",
      attribute: "tabindex",
      value: "-1",
      reasoning: "remove from tab order",
      confidence: 0.85,
    };

    const result = patchJsx(
      jsx,
      makeSourceRef(1),
      '<a href="/link">',
      fix,
    );
    expect(result).toContain('tabIndex="-1"');
  });

  it("changes div to button in JSX", () => {
    const jsx = `<div className="card" onClick={handleClick}>\n  Content\n</div>`;
    const fix: Fix = {
      type: "change-element",
      newElement: "button",
      reasoning: "semantic button",
      confidence: 0.9,
    };

    const result = patchJsx(
      jsx,
      makeSourceRef(1),
      '<div class="card">',
      fix,
    );
    expect(result).toContain("<button");
    expect(result).toContain("</button>");
  });

  it("removes attribute from JSX element", () => {
    const jsx = `<section aria-labelledby="gone">\n  <p>Content</p>\n</section>`;
    const fix: Fix = {
      type: "remove-attribute",
      attribute: "aria-labelledby",
      reasoning: "broken ref",
      confidence: 1.0,
    };

    const result = patchJsx(
      jsx,
      makeSourceRef(1),
      '<section aria-labelledby="gone">',
      fix,
    );
    expect(result).not.toContain("aria-labelledby");
  });
});
