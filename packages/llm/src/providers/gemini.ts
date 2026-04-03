import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmProvider, LlmResponse } from "../provider.js";

export class GeminiProvider implements LlmProvider {
  name = "gemini";
  model: string;
  private client;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? "gemini-2.5-flash-lite";
    const genAI = new GoogleGenerativeAI(apiKey);
    this.client = genAI.getGenerativeModel({ model: this.model });
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LlmResponse> {
    const result = await this.client.generateContent({
      systemInstruction: systemPrompt,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    });

    const usage = result.response.usageMetadata;
    return {
      text: result.response.text(),
      usage: usage ? {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
      } : undefined,
    };
  }
}
