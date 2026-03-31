import { describe, it, expect } from "vitest";
import { detectSiteType } from "../src/detect.js";

describe("detectSiteType", () => {
  it("detects static HTML", () => {
    const html = `<html><head></head><body><h1>Hello</h1><p>World</p><nav></nav></body></html>`;
    expect(detectSiteType(html)).toBe("static");
  });

  it("detects SPA shell with empty app div", () => {
    const html = `<html><head></head><body><div id="app"></div><script src="bundle.js"></script></body></html>`;
    expect(detectSiteType(html)).toBe("spa");
  });

  it("detects SPA shell with empty root div", () => {
    const html = `<html><head></head><body><div id="root"></div></body></html>`;
    expect(detectSiteType(html)).toBe("spa");
  });

  it("detects Next.js SSR", () => {
    const html = `<html><head></head><body><h1>Page</h1><script id="__NEXT_DATA__">{}</script></body></html>`;
    expect(detectSiteType(html)).toBe("ssr");
  });

  it("detects Nuxt SSR", () => {
    const html = `<html><head></head><body><main><h1>Hello</h1></main><script>window.__NUXT__={}</script></body></html>`;
    expect(detectSiteType(html)).toBe("ssr");
  });

  it("detects content-less page as SPA", () => {
    const html = `<html><head></head><body><script>app.init()</script></body></html>`;
    expect(detectSiteType(html)).toBe("spa");
  });
});
