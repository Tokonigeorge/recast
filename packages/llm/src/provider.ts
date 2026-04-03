import type { EnrichedViolation, Fix } from "@recast-a11y/classifier";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface LlmResponse {
  text: string;
  usage?: TokenUsage;
}

export interface LlmProvider {
  name: string;
  model: string;
  generate(systemPrompt: string, userPrompt: string): Promise<LlmResponse>;
}

export type ProviderName = "gemini" | "openai" | "anthropic";

export interface ResolvedKey {
  provider: ProviderName;
  apiKey: string;
}

/** Auto-detect provider from environment variables. First match wins. */
export function detectProvider(explicit?: { provider?: string; apiKey?: string }): ResolvedKey | null {
  if (explicit?.apiKey && explicit?.provider) {
    return { provider: explicit.provider as ProviderName, apiKey: explicit.apiKey };
  }

  if (explicit?.apiKey) {
    // Guess provider from key format
    if (explicit.apiKey.startsWith("sk-")) return { provider: "openai", apiKey: explicit.apiKey };
    if (explicit.apiKey.startsWith("sk-ant-")) return { provider: "anthropic", apiKey: explicit.apiKey };
    return { provider: "gemini", apiKey: explicit.apiKey };
  }

  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) return { provider: "gemini", apiKey: gemini };

  const openai = process.env.OPENAI_API_KEY;
  if (openai) return { provider: "openai", apiKey: openai };

  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) return { provider: "anthropic", apiKey: anthropic };

  return null;
}
