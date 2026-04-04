import { describe, it, expect } from "vitest";
import { parseLlmOutput, parseBatchOutput } from "../src/parser.js";

describe("parseLlmOutput", () => {
  it("parses a well-formed add-attribute fix", () => {
    const output = `
This is a close button for an "Edit profile" modal dialog.
The SVG icon has aria-hidden="true" so screen readers see nothing.
The button has no text content and no aria-label.
The fix is adding aria-label="Close dialog".

fix:
  type: add-attribute
  attribute: aria-label
  value: Close dialog
  reasoning: Icon-only button in modal needs explicit label for screen readers
  confidence: 0.95
`;

    const fix = parseLlmOutput(output);
    expect(fix.type).toBe("add-attribute");
    expect(fix.attribute).toBe("aria-label");
    expect(fix.value).toBe("Close dialog");
    expect(fix.reasoning).toBe(
      "Icon-only button in modal needs explicit label for screen readers",
    );
    expect(fix.confidence).toBe(0.95);
  });

  it("parses a change-element fix", () => {
    const output = `
This div has role="button" and both click and keyboard handlers.
It should be a native <button> element.

fix:
  type: change-element
  new_element: button
  reasoning: Native button provides built-in keyboard support
  confidence: 0.90
`;

    const fix = parseLlmOutput(output);
    expect(fix.type).toBe("change-element");
    expect(fix.newElement).toBe("button");
    expect(fix.confidence).toBe(0.9);
  });

  it("parses a manual-required fix", () => {
    const output = `
This requires keyboard handler implementation and state management.

fix:
  type: manual-required
  note: Add onKeyDown handler and aria-expanded state management
  reasoning: Complex interactive pattern needs custom JS
  confidence: 0.40
`;

    const fix = parseLlmOutput(output);
    expect(fix.type).toBe("manual-required");
    expect(fix.note).toContain("onKeyDown");
    expect(fix.confidence).toBe(0.4);
  });

  it("handles missing fix block gracefully", () => {
    const fix = parseLlmOutput("This response has no fix block at all.");
    expect(fix.type).toBe("manual-required");
    expect(fix.confidence).toBe(0);
  });

  it("handles quoted values", () => {
    const output = `fix:
  type: add-attribute
  attribute: "aria-label"
  value: "Submit form"
  reasoning: "Button needs label"
  confidence: 0.85`;

    const fix = parseLlmOutput(output);
    expect(fix.attribute).toBe("aria-label");
    expect(fix.value).toBe("Submit form");
  });
});

describe("parseBatchOutput", () => {
  it("parses multiple fix blocks", () => {
    const output = `
Violation 1: The button needs a label.

fix_1:
  type: add-attribute
  attribute: aria-label
  value: Add to Wishlist
  reasoning: Icon-only button needs label
  confidence: 0.95

Violation 2: The image needs alt text.

fix_2:
  type: add-attribute
  attribute: alt
  value: Product photo
  reasoning: Meaningful image needs description
  confidence: 0.90

Violation 3: Complex widget needs restructuring.

fix_3:
  type: manual-required
  note: Add keyboard navigation
  reasoning: Tree view requires full ARIA pattern
  confidence: 0.40
`;

    const fixes = parseBatchOutput(output, 3);
    expect(fixes).toHaveLength(3);

    expect(fixes[0].type).toBe("add-attribute");
    expect(fixes[0].attribute).toBe("aria-label");
    expect(fixes[0].value).toBe("Add to Wishlist");
    expect(fixes[0].confidence).toBe(0.95);

    expect(fixes[1].type).toBe("add-attribute");
    expect(fixes[1].attribute).toBe("alt");
    expect(fixes[1].confidence).toBe(0.90);

    expect(fixes[2].type).toBe("manual-required");
    expect(fixes[2].note).toBe("Add keyboard navigation");
  });

  it("handles missing blocks gracefully", () => {
    const output = `fix_1:
  type: add-attribute
  attribute: alt
  value: Logo
  reasoning: needs alt
  confidence: 0.9`;

    const fixes = parseBatchOutput(output, 3);
    expect(fixes).toHaveLength(3);
    expect(fixes[0].type).toBe("add-attribute");
    expect(fixes[1].confidence).toBe(0);
    expect(fixes[2].confidence).toBe(0);
  });
});
