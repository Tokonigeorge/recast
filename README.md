# Recast — Handoff Documentation

**Automated Accessibility Rewriter**

Recast crawls a web project, detects accessibility violations, and rewrites source code to fix them. It outputs a git diff. Developers review and merge. High-confidence fixes are applied automatically. Judgment-call fixes are flagged for human review with a suggested fix attached.

---

## Document Index

| File | Contents |
|---|---|
| [`01-what-and-why.md`](./01-what-and-why.md) | Problem, gap in the market, why now, legal framing |
| [`02-research.md`](./02-research.md) | All key research findings — Playwright, LLM formats, rendering, source tracing |
| [`03-cost-model.md`](./03-cost-model.md) | Pricing comparison, real cost per page, business model options |
| [`04-architecture.md`](./04-architecture.md) | Full system design, all 8 stages, diagrams |
| [`05-prompt-design.md`](./05-prompt-design.md) | LLM prompt templates, high-confidence rules, two-step pattern |
| [`06-build-plan.md`](./06-build-plan.md) | Phased build plan, repo structure, tech stack, where to start |
| [`07-constraints.md`](./07-constraints.md) | Known edge cases, what Recast cannot fix, fallback strategies |

---

## The One-Line Summary

> Subfont subsets fonts to only what a page actually uses and rewrites your HTML.
> Recast does the same for accessibility — detects what's actually broken, fixes what it can with certainty, flags the rest, and rewrites your source.

---

## Status

Ready to build. Architecture is finalised. Start with [`06-build-plan.md`](./06-build-plan.md).
