import type { EnrichedViolation, Fix } from "@recast-a11y/classifier";
import type { LlmProvider, ProviderName } from "./provider.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
import { parseLlmOutput } from "./parser.js";
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

  async generateFixes(violations: EnrichedViolation[]): Promise<Fix[]> {
    const results: Fix[] = new Array(violations.length);
    let cursor = 0;

    while (cursor < violations.length) {
      const batch = violations.slice(cursor, cursor + this.concurrency);
      const fixes = await Promise.all(batch.map((v) => this.generateFix(v)));
      for (let i = 0; i < fixes.length; i++) {
        results[cursor + i] = fixes[i];
      }
      cursor += batch.length;
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
