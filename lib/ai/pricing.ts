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
  // Precio introductorio hasta el 31-dic-2026 (ver PRICE_CHANGES abajo para el
  // estándar). Faltaba en la tabla: el "Agente Calificador" usa este modelo y
  // en nov-2026 registró 800+ calificaciones a $0. Verificado 2026-11-26.
  "google/gemini-3.8-flash":       { input: 0.75,  output: 3.75 },
  "gemini-3.8-flash":              { input: 0.75,  output: 3.75 },
};

// Cambios de precio ya anunciados por Google con fecha. A partir de `from`
// (instante UTC) se usa este precio en lugar del de MODEL_PRICING — así el
// costo cambia solo el día correcto sin depender de un deploy ese día.
const PRICE_CHANGES: Record<string, { from: Date; input: number; output: number }> = {
  // Fin del precio introductorio de Gemini 3.8 Flash.
  "google/gemini-3.8-flash": { from: new Date("2027-01-01T00:00:00Z"), input: 1.50, output: 7.50 },
  "gemini-3.8-flash":        { from: new Date("2027-01-01T00:00:00Z"), input: 1.50, output: 7.50 },
};

export async function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): Promise<number> {
  const change = PRICE_CHANGES[model];
  const pricing: ModelPricing | undefined =
    change && Date.now() >= change.from.getTime() ? change : MODEL_PRICING[model];

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
