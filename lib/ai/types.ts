export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionParams {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface AIEmbeddingParams {
  model: string;
  input: string | string[];
}

export interface AIEmbeddingResponse {
  embeddings: number[][];
}

export type AIProvider = "openrouter" | "google";
