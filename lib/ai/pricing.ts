import { getOpenRouterModelPricing } from "./models";
import type { ModelPricing } from "./models";
import type { AIProvider } from "./types";

// Google entries reflect the <=200k-context standard tier from
// https://ai.google.dev/gemini-api/docs/pricing — Gemini has no pricing API
// (unlike OpenRouter, see getOpenRouterModelPricing below), so this table has
// to be kept in sync by hand. Verified 2026-07-15.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash":      { input: 0.30,  output: 2.50 },
  "google/gemini-2.5-flash-lite": { input: 0.10,  output: 0.40 },
  "google/gemini-2.5-pro":        { input: 1.25,  output: 10.00 },
  "openai/gpt-4o":                { input: 2.50,  output: 10.00 },
  "openai/gpt-4o-mini":           { input: 0.15,  output: 0.60 },
  "anthropic/claude-3.5-sonnet":  { input: 3.00,  output: 15.00 },
  "anthropic/claude-3-haiku":     { input: 0.25,  output: 1.25 },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50 },
  "gemini-2.5-flash-lite":        { input: 0.10,  output: 0.40 },
  "gemini-2.5-pro":               { input: 1.25,  output: 10.00 },
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

  if (!pricing) {
    // Surface this instead of silently logging $0 forever — a model missing
    // from the static table (or an OpenRouter lookup failure) should be
    // noticeable, not indistinguishable from "this model is actually free."
    console.warn(`[pricing] Sin precio conocido para el modelo "${model}" (provider: ${provider ?? "?"}) — costo registrado como $0`);
    return 0;
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  return Math.round((inputCost + outputCost) * 10000) / 10000;
}

export function getPricing(model: string) {
  return MODEL_PRICING[model] ?? null;
}
