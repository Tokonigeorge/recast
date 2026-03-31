import { describe, it, expect } from "vitest";
import { patchHtml } from "../src/html-patcher.js";
import type { Fix, SourceRef } from "@recast-a11y/classifier";

function makeSourceRef(line: number): SourceRef {
  return { file: "test.html", line };
}

describe("patchHtml", () => {
  describe("add-attribute", () => {
    it("adds lang attribute to html element", () => {
      const html = `<!DOCTYPE html>\n<html>\n<head></head>`;
      const fix: Fix = {
        type: "add-attribute",
        attribute: "lang",
        value: "en",
        reasoning: "test",
        confidence: 1.0,
      };

      const result = patchHtml(html, makeSourceRef(2), "<html>", fix);
      expect(result).not.toBeNull();
      expect(result).toContain('<html lang="en">');
    });

    it("adds alt attribute to img", () => {
      const html = `<div>\n  <img src="photo.jpg">\n</div>`;
      const fix: Fix = {
        type: "add-attribute",
        attribute: "alt",
        value: "",
        reasoning: "decorative",
        confidence: 0.9,
      };

      const result = patchHtml(html, makeSourceRef(2), '<img src="photo.jpg">', fix);
      expect(result).toContain('alt=""');
    });

    it("replaces existing attribute value", () => {
      const html = `<html lang="de">\n<head></head>`;
      const fix: Fix = {
        type: "add-attribute",
        attribute: "lang",
        value: "en",
        reasoning: "test",
        confidence: 1.0,
      };

      const result = patchHtml(html, makeSourceRef(1), '<html lang="de">', fix);
      expect(result).toContain('lang="en"');
      expect(result).not.toContain('lang="de"');
    });

    it("adds type to button", () => {
      const html = `<form>\n  <button class="cancel">Cancel</button>\n</form>`;
      const fix: Fix = {
        type: "add-attribute",
        attribute: "type",
        value: "button",
        reasoning: "test",
        confidence: 0.95,
      };

      const result = patchHtml(html, makeSourceRef(2), '<button class="cancel">', fix);
      expect(result).toContain('type="button"');
    });
  });

  describe("remove-attribute", () => {
    it("removes aria-labelledby", () => {
      const html = `<section aria-labelledby="missing">\n  <p>Content</p>\n</section>`;
      const fix: Fix = {
        type: "remove-attribute",
        attribute: "aria-labelledby",
        reasoning: "broken reference",
        confidence: 1.0,
      };

      const result = patchHtml(
        html,
        makeSourceRef(1),
        '<section aria-labelledby="missing">',
        fix,
      );
      expect(result).not.toBeNull();
      expect(result).not.toContain("aria-labelledby");
      expect(result).toContain("<section>");
    });
  });

  describe("change-element", () => {
    it("changes div to button and removes role", () => {
      const html = `<div role="button" class="btn" onclick="go()">\n  Click me\n</div>`;
      const fix: Fix = {
        type: "change-element",
        newElement: "button",
        reasoning: "semantic element",
        confidence: 0.9,
      };

      const result = patchHtml(
        html,
        makeSourceRef(1),
        '<div role="button">',
        fix,
      );
      expect(result).not.toBeNull();
      expect(result).toContain("<button");
      expect(result).toContain("</button>");
      expect(result).not.toContain('role="button"');
    });
  });

  it("returns null for out-of-range line", () => {
    const html = "<div>test</div>";
    const fix: Fix = {
      type: "add-attribute",
      attribute: "lang",
      value: "en",
      reasoning: "test",
      confidence: 1.0,
    };
    expect(patchHtml(html, makeSourceRef(99), "<div>", fix)).toBeNull();
  });
});
