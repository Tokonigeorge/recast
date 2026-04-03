import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import type { EnrichedViolation, Fix } from "@recast-a11y/classifier";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
import { parseLlmOutput } from "./parser.js";
import { CostTracker, type SessionCostSummary } from "./cost-tracker.js";

export interface GeminiClientOptions {
  apiKey: string;
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
  private bulkModelName: string;
  private judgmentModelName: string;
  private concurrency: number;
  readonly costTracker: CostTracker;

  constructor(opts: GeminiClientOptions) {
    const genAI = new GoogleGenerativeAI(opts.apiKey);
    this.bulkModelName = opts.bulkModel ?? "gemini-2.5-flash-lite";
    this.judgmentModelName = opts.judgmentModel ?? "gemini-2.5-flash";
    this.bulkModel = genAI.getGenerativeModel({
      model: this.bulkModelName,
      systemInstruction: SYSTEM_PROMPT,
    });
    this.judgmentModel = genAI.getGenerativeModel({
      model: this.judgmentModelName,
      systemInstruction: SYSTEM_PROMPT,
    });
    this.concurrency = opts.concurrency ?? 5;
    this.costTracker = new CostTracker();
  }

  /** Generate a fix for a single enriched violation */
  async generateFix(violation: EnrichedViolation): Promise<Fix> {
    const isJudgment = JUDGMENT_RULES.has(violation.ruleId);
    const model = isJudgment ? this.judgmentModel : this.bulkModel;
    const modelName = isJudgment ? this.judgmentModelName : this.bulkModelName;

    const prompt = buildUserPrompt(violation);
    const start = performance.now();

    try {
      const result = await model.generateContent(prompt);
      const durationMs = performance.now() - start;
      const text = result.response.text();

      // Track cost
      const usage = result.response.usageMetadata;
      if (usage) {
        this.costTracker.record(
          modelName,
          violation.ruleId,
          usage.promptTokenCount,
          usage.candidatesTokenCount,
          usage.cachedContentTokenCount ?? 0,
          durationMs,
        );
      }

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

  /** Get cost summary for the current session */
  getCostSummary(): SessionCostSummary {
    return this.costTracker.getSummary();
  }
}
