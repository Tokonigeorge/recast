# Recast

**Automated accessibility rewriter for web projects.**

Point Recast at a React, Next.js, Vue, or static HTML project. It detects WCAG violations, generates fixes, and rewrites your source code. High-confidence fixes are applied automatically. Judgment calls are flagged for review with a suggested fix attached.

```bash
recast ./my-react-app
```

Recast starts your dev server, scans the rendered page with Playwright + axe-core, traces violations back to JSX/HTML source files via React fiber stack traces, and patches the code.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/recast.git
cd recast
pnpm install

# Scan a project (auto-starts dev server)
pnpm recast ./path/to/project

# Scan a running dev server
pnpm recast http://localhost:3000

# Scan a static HTML file
pnpm recast index.html
```

### LLM Setup

Recast uses an LLM for violations that need semantic judgment (alt text, button labels, heading structure). Set one of these environment variables:

```bash
# Gemini (cheapest, default)
GEMINI_API_KEY=your-key

# OpenAI
OPENAI_API_KEY=your-key

# Anthropic
ANTHROPIC_API_KEY=your-key
```

Without an API key, Recast still detects all violations and auto-fixes the mechanical ones (missing `lang`, broken ARIA refs, button types).

## How It Works

```
Your project
    |
    v
1. RENDER     Playwright launches Chromium, loads the page
2. DETECT     axe-core + custom checks find WCAG violations
3. SNAPSHOT   ariaSnapshot() captures what screen readers see
4. CLASSIFY   Rule engine splits: auto-fixable / needs LLM / skip (CSS-only)
5. FIX        Rule-based patcher or LLM generates the fix
6. TRACE      React fiber stack traces map violations to source files
7. PATCH      Rewrites JSX/TSX/HTML at the correct line
8. REVIEW     Shows diffs, you confirm, files are updated
```

## What It Fixes

**Auto-fixed (no LLM):**
- Missing `lang` attribute on `<html>`
- Broken `aria-labelledby` references
- Buttons in forms without `type` attribute
- `aria-hidden` on focusable elements
- Decorative images missing `alt=""`

**LLM-assisted (Gemini/OpenAI/Anthropic):**
- Alt text for meaningful images (from surrounding context)
- Accessible names for icon-only buttons
- Link labels for icon-only links
- Heading hierarchy corrections

**Skipped (reported, not patched):**
- Color contrast (CSS fix)
- Touch target size (CSS fix)
- Video captions (needs human)
- Page title (product decision)

## Supported Frameworks

| Framework | Auto-detected | Source tracing |
|---|---|---|
| Vite + React | Yes | React fiber `_debugStack` |
| Next.js | Yes | React fiber `_debugStack` |
| Nuxt / Vue | Yes | `__vue__` internals |
| SvelteKit | Yes | Planned |
| Astro | Yes | Planned |
| Create React App | Yes | React fiber |
| Static HTML | Yes | Pattern matching |

## CLI Options

```
recast <files, urls, or dirs...>

Options:
  -p, --provider <name>   Force LLM provider: gemini, openai, anthropic
  -k, --api-key <key>     API key (or use env vars)
  -m, --model <model>     Override model name
  --auto-fix-above <n>    Confidence threshold (default: 0.85)
  --project-root <path>   Project root for source tracing
  --concurrency <n>       Max concurrent pages (default: 4)
  --timeout <ms>          Page load timeout (default: 30000)
  -h, --help              Show help
```

## Development

```bash
pnpm install
pnpm test              # 40 unit + integration tests
pnpm run test:real     # Real-world test against public repos
pnpm recast fixtures/test-page.html   # Test against fixture
pnpm recast fixtures/react-app        # Test against React app
```

## License

MIT
