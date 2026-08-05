import type { ModelPricing } from "./models";

// Google entries reflect the <=200k-context standard tier (text) from
// https://ai.google.dev/gemini-api/docs/pricing — Gemini has no pricing API,
// so this table has to be kept in sync by hand. Verified 2026-08-05.
//
// gemini-3.1-flash-lite was MISSING until now — production had already
// switched bots/calificadores to it (evidence: 5327 WABotUsage/
// WALeadScorerUsage rows since mid-July, ~17M tokens combined, every one
// logged at estimatedCost = 0 per the fallback below) while this table still
// only listed 2.5-series models. Silently undercounted the monthly budget
// and every cost KPI in /estadisticas the whole time. Check this table
// against the pricing page whenever a bot/calificador starts using a model
// not listed here — the console.warn below is the only signal, easy to miss.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash":       { input: 0.30,  output: 2.50 },
  "google/gemini-2.5-flash-lite":  { input: 0.10,  output: 0.40 },
  "google/gemini-2.5-pro":         { input: 1.25,  output: 10.00 },
  "gemini-2.5-flash":              { input: 0.30,  output: 2.50 },
  "gemini-2.5-flash-lite":         { input: 0.10,  output: 0.40 },
  "gemini-2.5-pro":                { input: 1.25,  output: 10.00 },
  "google/gemini-3.1-flash-lite":  { input: 0.25,  output: 1.50 },
  "google/gemini-3.1-pro-preview": { input: 2.00,  output: 12.00 },
  "gemini-3.1-flash-lite":         { input: 0.25,  output: 1.50 },
  "gemini-3.1-pro-preview":        { input: 2.00,  output: 12.00 },
};

export async function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): Promise<number> {
  const pricing: ModelPricing | undefined = MODEL_PRICING[model];

  if (!pricing) {
    // Surface this instead of silently logging $0 forever — a model missing
    // from the static table should be noticeable, not indistinguishable from
    // "this model is actually free."
    console.warn(`[pricing] Sin precio conocido para el modelo "${model}" — costo registrado como $0`);
    return 0;
  }

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  return Math.round((inputCost + outputCost) * 10000) / 10000;
}
