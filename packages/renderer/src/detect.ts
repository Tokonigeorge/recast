import type { SiteType } from "@recast-a11y/classifier";

/** Detect whether HTML is static, SSR-rendered, or an SPA shell */
export function detectSiteType(html: string): SiteType {
  const isSPAShell =
    /<div\s+id=["'](?:app|root|__next)["']>\s*<\/div>/i.test(html);
  const hasContent = /<(?:h[1-6]|p[^>]*>\w|nav|main|article)\b/i.test(html);

  if (isSPAShell || !hasContent) return "spa";
  if (/_next|__NEXT_DATA__|nuxt|__NUXT__|sveltekit/i.test(html)) return "ssr";
  return "static";
}
