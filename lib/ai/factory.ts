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
      return "text-embedding-004";
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
