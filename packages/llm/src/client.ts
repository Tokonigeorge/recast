import type { EnrichedViolation, Fix } from "@recast-a11y/classifier";
import type { LlmProvider, ProviderName } from "./provider.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { SYSTEM_PROMPT, BATCH_SYSTEM_PROMPT, buildUserPrompt, buildBatchPrompt } from "./prompts.js";
import { parseLlmOutput, parseBatchOutput } from "./parser.js";
import { CostTracker, type SessionCostSummary } from "./cost-tracker.js";

export interface LlmClientOptions {
  provider: ProviderName;
  apiKey: string;
  model?: string;
  concurrency?: number;
}

export class LlmClient {
  private provider: LlmProvider;
  private concurrency: number;
  readonly costTracker: CostTracker;

  constructor(opts: LlmClientOptions) {
    this.provider = createProvider(opts.provider, opts.apiKey, opts.model);
    this.concurrency = opts.concurrency ?? 5;
    this.costTracker = new CostTracker();
  }

  get providerName(): string { return this.provider.name; }
  get modelName(): string { return this.provider.model; }

  async generateFix(violation: EnrichedViolation): Promise<Fix> {
    const prompt = buildUserPrompt(violation);
    const start = performance.now();

    try {
      const result = await this.provider.generate(SYSTEM_PROMPT, prompt);
      const durationMs = performance.now() - start;

      if (result.usage) {
        this.costTracker.record(
          this.provider.model,
          violation.ruleId,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.cachedTokens,
          durationMs,
        );
      }

      return parseLlmOutput(result.text);
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
   * Generate fixes for multiple violations.
   * Uses batched prompts (multiple violations per API call) when batch size > 1.
   * Falls back to individual calls for single violations or on batch parse failure.
   */
  async generateFixes(violations: EnrichedViolation[], batchSize = 5): Promise<Fix[]> {
    if (violations.length === 0) return [];
    if (violations.length === 1 || batchSize <= 1) {
      return this.generateFixesSequential(violations);
    }

    const results: Fix[] = new Array(violations.length);
    let cursor = 0;

    while (cursor < violations.length) {
      const batch = violations.slice(cursor, Math.min(cursor + batchSize, violations.length));

      if (batch.length === 1) {
        results[cursor] = await this.generateFix(batch[0]);
        cursor++;
        continue;
      }

      const fixes = await this.generateBatch(batch);
      for (let i = 0; i < fixes.length; i++) {
        results[cursor + i] = fixes[i];
      }
      cursor += batch.length;
    }

    return results;
  }

  private async generateBatch(violations: EnrichedViolation[]): Promise<Fix[]> {
    const prompt = buildBatchPrompt(violations);
    const start = performance.now();

    try {
      const result = await this.provider.generate(BATCH_SYSTEM_PROMPT, prompt);
      const durationMs = performance.now() - start;

      if (result.usage) {
        // Attribute cost evenly across the batch
        const perViolation = {
          input: Math.round(result.usage.inputTokens / violations.length),
          output: Math.round(result.usage.outputTokens / violations.length),
          cached: Math.round(result.usage.cachedTokens / violations.length),
          duration: Math.round(durationMs / violations.length),
        };
        for (const v of violations) {
          this.costTracker.record(
            this.provider.model, v.ruleId,
            perViolation.input, perViolation.output, perViolation.cached, perViolation.duration,
          );
        }
      }

      const fixes = parseBatchOutput(result.text, violations.length);

      // If batch parsing failed for too many, fall back to individual calls
      const failCount = fixes.filter((f) => f.confidence === 0 && f.reasoning.includes("missing fix_")).length;
      if (failCount > violations.length / 2) {
        return this.generateFixesSequential(violations);
      }

      return fixes;
    } catch {
      return this.generateFixesSequential(violations);
    }
  }

  private async generateFixesSequential(violations: EnrichedViolation[]): Promise<Fix[]> {
    const results: Fix[] = [];
    for (const v of violations) {
      results.push(await this.generateFix(v));
    }
    return results;
  }

  getCostSummary(): SessionCostSummary {
    return this.costTracker.getSummary();
  }
}

function createProvider(name: ProviderName, apiKey: string, model?: string): LlmProvider {
  switch (name) {
    case "gemini": return new GeminiProvider(apiKey, model);
    case "openai": return new OpenAIProvider(apiKey, model);
    case "anthropic": return new AnthropicProvider(apiKey, model);
  }
}
