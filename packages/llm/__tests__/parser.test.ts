import { describe, it, expect } from "vitest";
import { parseLlmOutput } from "../src/parser.js";

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
