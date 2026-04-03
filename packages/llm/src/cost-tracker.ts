/** Per-model pricing in USD per 1M tokens */
interface ModelPricing {
  input: number;
  cachedInput: number;
  output: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-lite": { input: 0.10, cachedInput: 0.025, output: 0.40 },
  "gemini-2.5-flash": { input: 0.15, cachedInput: 0.0375, output: 0.60 },
  // Fallback pricing for unknown models
  default: { input: 0.30, cachedInput: 0.075, output: 2.50 },
};

export interface CallMetrics {
  model: string;
  ruleId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  durationMs: number;
}

export interface SessionCostSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  byRule: Record<string, { calls: number; tokens: number; cost: number }>;
  calls: CallMetrics[];
}

export class CostTracker {
  private calls: CallMetrics[] = [];

  record(
    model: string,
    ruleId: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    durationMs: number,
  ): CallMetrics {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["default"];
    const uncachedInput = inputTokens - cachedTokens;
    const inputCost =
      (uncachedInput / 1_000_000) * pricing.input +
      (cachedTokens / 1_000_000) * pricing.cachedInput;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    const metrics: CallMetrics = {
      model,
      ruleId,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      durationMs,
    };

    this.calls.push(metrics);
    return metrics;
  }

  getSummary(): SessionCostSummary {
    const byModel: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byRule: Record<string, { calls: number; tokens: number; cost: number }> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalCost = 0;

    for (const call of this.calls) {
      totalInputTokens += call.inputTokens;
      totalOutputTokens += call.outputTokens;
      totalCachedTokens += call.cachedTokens;
      totalCost += call.totalCost;

      // By model
      const m = byModel[call.model] ??= { calls: 0, tokens: 0, cost: 0 };
      m.calls++;
      m.tokens += call.totalTokens;
      m.cost += call.totalCost;

      // By rule
      const r = byRule[call.ruleId] ??= { calls: 0, tokens: 0, cost: 0 };
      r.calls++;
      r.tokens += call.totalTokens;
      r.cost += call.totalCost;
    }

    return {
      totalCalls: this.calls.length,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost,
      byModel,
      byRule,
      calls: [...this.calls],
    };
  }

  reset(): void {
    this.calls = [];
  }
}
