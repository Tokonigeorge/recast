export { LlmClient, type LlmClientOptions } from "./client.js";
export { detectProvider, type ProviderName, type ResolvedKey, type LlmProvider, type LlmResponse, type TokenUsage } from "./provider.js";
export { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
export { parseLlmOutput } from "./parser.js";
export { CostTracker, type CallMetrics, type SessionCostSummary } from "./cost-tracker.js";

// Legacy export for backward compat with tests
export { GeminiClient, type GeminiClientOptions } from "./gemini.js";
