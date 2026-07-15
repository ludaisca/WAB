import type { AIProvider } from "./types";
import { createOpenRouterClient } from "./providers/openrouter";
import { createGoogleClient } from "./providers/google";

export function getAIProvider(provider: AIProvider, apiKey: string) {
  switch (provider) {
    case "openrouter":
      return createOpenRouterClient(apiKey);
    case "google":
      return createGoogleClient(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

export function getEmbeddingModel(provider: AIProvider): string {
  switch (provider) {
    case "openrouter":
      return "openai/text-embedding-3-small";
    case "google":
      // "text-embedding-004" was retired — gemini-embedding-2 is the current
      // model (see lib/ai/providers/google.ts for the 768-dim truncation via
      // outputDimensionality, needed since this defaults to 3072).
      return "gemini-embedding-2";
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
