import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import type { EnrichedViolation, Fix } from "@recast-a11y/classifier";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
import { parseLlmOutput } from "./parser.js";

export interface GeminiClientOptions {
  apiKey: string;
  /** Model for bulk/mechanical fixes */
  bulkModel?: string;
  /** Model for judgment calls requiring stronger reasoning */
  judgmentModel?: string;
  /** Max concurrent requests */
  concurrency?: number;
}

/** Violation types that need the stronger reasoning model */
const JUDGMENT_RULES = new Set([
  "image-alt",
  "button-name",
  "link-name",
  "label",
  "heading-order",
  "document-title",
]);

export class GeminiClient {
  private bulkModel: GenerativeModel;
  private judgmentModel: GenerativeModel;
  private concurrency: number;

  constructor(opts: GeminiClientOptions) {
    const genAI = new GoogleGenerativeAI(opts.apiKey);
    this.bulkModel = genAI.getGenerativeModel({
      model: opts.bulkModel ?? "gemini-2.5-flash-lite-preview-06-17",
      systemInstruction: SYSTEM_PROMPT,
    });
    this.judgmentModel = genAI.getGenerativeModel({
      model: opts.judgmentModel ?? "gemini-2.5-flash-preview-05-20",
      systemInstruction: SYSTEM_PROMPT,
    });
    this.concurrency = opts.concurrency ?? 5;
  }

  /** Generate a fix for a single enriched violation */
  async generateFix(violation: EnrichedViolation): Promise<Fix> {
    const model = JUDGMENT_RULES.has(violation.ruleId)
      ? this.judgmentModel
      : this.bulkModel;

    const prompt = buildUserPrompt(violation);

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return parseLlmOutput(text);
    } catch (error) {
      return {
        type: "manual-required",
        reasoning: `LLM call failed: ${error instanceof Error ? error.message : "unknown error"}`,
        confidence: 0,
        note: "LLM request failed — manual review needed",
      };
    }
  }

  /**
   * Generate fixes for multiple violations with concurrency control.
   * Returns fixes in the same order as the input violations.
   */
  async generateFixes(
    violations: EnrichedViolation[],
  ): Promise<Fix[]> {
    const results: Fix[] = new Array(violations.length);
    let cursor = 0;

    // Process in batches for concurrency control
    while (cursor < violations.length) {
      const batch = violations.slice(cursor, cursor + this.concurrency);
      const fixes = await Promise.all(
        batch.map((v) => this.generateFix(v)),
      );
      for (let i = 0; i < fixes.length; i++) {
        results[cursor + i] = fixes[i];
      }
      cursor += batch.length;
    }

    return results;
  }
}
