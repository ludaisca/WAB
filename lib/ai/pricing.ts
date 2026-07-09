import { getOpenRouterModelPricing } from "./models";
import type { ModelPricing } from "./models";
import type { AIProvider } from "./types";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash":      { input: 0.15,  output: 0.60 },
  "google/gemini-2.5-pro":        { input: 1.25,  output: 5.00 },
  "openai/gpt-4o":                { input: 2.50,  output: 10.00 },
  "openai/gpt-4o-mini":           { input: 0.15,  output: 0.60 },
  "anthropic/claude-3.5-sonnet":  { input: 3.00,  output: 15.00 },
  "anthropic/claude-3-haiku":     { input: 0.25,  output: 1.25 },
  "gemini-2.5-flash":             { input: 0.15,  output: 0.60 },
  "gemini-2.5-pro":               { input: 1.25,  output: 5.00 },
  "meta-llama/llama-4-maverick":  { input: 0.20,  output: 0.90 },
  "meta-llama/llama-4-scout":     { input: 0.10,  output: 0.45 },
};

export async function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  provider?: AIProvider
): Promise<number> {
  let pricing: ModelPricing | undefined = MODEL_PRICING[model];

  if (!pricing && provider === "openrouter") {
    pricing = (await getOpenRouterModelPricing(model)) ?? undefined;
  }

  if (!pricing) return 0;

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

export function getPricing(model: string) {
  return MODEL_PRICING[model] ?? null;
}
