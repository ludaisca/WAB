import { createGoogleClient } from "./providers/google";

// Desde 2026-08 solo existe un proveedor (Google/Gemini); OpenRouter fue
// eliminado. El API key se resuelve por usuario en lib/ai/settings.ts.
export function getAIProvider(apiKey: string) {
  return createGoogleClient(apiKey);
}

// Modelo de embeddings fijo: gemini-embedding-2, truncado a 768 dims vía
// outputDimensionality (ver lib/ai/providers/google.ts).
export const EMBEDDING_MODEL = "gemini-embedding-2";
