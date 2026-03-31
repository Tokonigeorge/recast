import { describe, it, expect } from "vitest";
import { classify, tryHighConfidenceFix } from "../src/index.js";
import type { Violation } from "../src/types.js";

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    ruleId: "test-rule",
    description: "Test violation",
    wcag: "1.0.0",
    impact: "moderate",
    html: "<div>test</div>",
    target: "div",
    helpUrl: "https://example.com",
    pageUrl: "https://example.com",
    ...overrides,
  };
}

describe("tryHighConfidenceFix", () => {
  it("fixes html-has-lang", () => {
    const v = makeViolation({ ruleId: "html-has-lang", html: "<html>" });
    const fix = tryHighConfidenceFix(v);
    expect(fix).not.toBeNull();
    expect(fix!.type).toBe("add-attribute");
    expect(fix!.attribute).toBe("lang");
    expect(fix!.value).toBe("en");
    expect(fix!.confidence).toBe(1.0);
  });

  it("fixes button-has-type", () => {
    const v = makeViolation({
      ruleId: "button-has-type",
      html: '<button class="cancel">Cancel</button>',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).not.toBeNull();
    expect(fix!.attribute).toBe("type");
    expect(fix!.value).toBe("button");
  });

  it("does not fix button that already has type", () => {
    const v = makeViolation({
      ruleId: "button-has-type",
      html: '<button type="submit">Submit</button>',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).toBeNull();
  });

  it("fixes decorative image with role=presentation", () => {
    const v = makeViolation({
      ruleId: "image-alt",
      html: '<img src="deco.svg" role="presentation">',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).not.toBeNull();
    expect(fix!.attribute).toBe("alt");
    expect(fix!.value).toBe("");
  });

  it("sends meaningful images to LLM (returns null)", () => {
    const v = makeViolation({
      ruleId: "image-alt",
      html: '<img src="photo.jpg">',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).toBeNull();
  });

  it("fixes aria-hidden on focusable element with tabindex", () => {
    const v = makeViolation({
      ruleId: "aria-hidden-focus",
      html: '<button aria-hidden="true" tabindex="0">X</button>',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).not.toBeNull();
    expect(fix!.attribute).toBe("tabindex");
    expect(fix!.value).toBe("-1");
  });

  it("fixes aria-hidden on naturally focusable element", () => {
    const v = makeViolation({
      ruleId: "aria-hidden-focus",
      html: '<a href="/link" aria-hidden="true">Link</a>',
    });
    const fix = tryHighConfidenceFix(v);
    expect(fix).not.toBeNull();
    expect(fix!.attribute).toBe("tabindex");
    expect(fix!.value).toBe("-1");
  });

  it("returns null for unknown rules", () => {
    const v = makeViolation({ ruleId: "unknown-rule" });
    expect(tryHighConfidenceFix(v)).toBeNull();
  });
});

describe("classify", () => {
  it("splits violations into high and low confidence", () => {
    const violations = [
      makeViolation({ ruleId: "html-has-lang", html: "<html>" }),
      makeViolation({ ruleId: "image-alt", html: '<img src="photo.jpg">' }),
      makeViolation({
        ruleId: "button-has-type",
        html: "<button>Cancel</button>",
      }),
    ];

    const result = classify(violations);

    expect(result.high.length).toBe(2); // html-has-lang + button-has-type
    expect(result.low.length).toBe(1); // image-alt (needs LLM)

    expect(result.high[0].fix.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.high[1].fix.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("respects custom threshold", () => {
    const violations = [
      makeViolation({ ruleId: "html-has-lang", html: "<html>" }),
    ];

    // Threshold above 1.0 means nothing is high confidence
    const strict = classify(violations, 1.1);
    expect(strict.high.length).toBe(0);
    expect(strict.low.length).toBe(1);
  });
});
