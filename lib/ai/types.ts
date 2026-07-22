export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  // Gemini-only today (see google.ts toParts) — inlineData is mime-agnostic there,
  // but OpenRouter/OpenAI has no equivalent generic shape, so bot-worker only
  // builds this part when the bot's provider is "google".
  | { type: "audio_url"; audio_url: { url: string } };

// Tool-calling — usado por el agente de IA (lib/agent/), aditivo sobre el
// shape existente: los consumidores actuales (bot-worker, lead-recovery,
// lead-scoring, unassigned-lead-reply) construyen AIMessage sin estos campos
// y siguen compilando igual.
export interface AIToolCall {
  id: string; // OpenRouter: id real del SDK. Google no da id — se sintetiza `${name}_${index}` en el provider.
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIToolResult {
  toolCallId: string;
  name: string; // Gemini indexa functionResponse por name, no por id
  result: unknown;
  isError?: boolean;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema, subset compatible con OpenAI y Gemini
}

export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCalls?: AIToolCall[]; // solo relevante si role === "assistant"
  toolResults?: AIToolResult[]; // solo relevante si role === "tool"
}

export interface AICompletionParams {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: AIToolDefinition[];
  toolChoice?: "auto" | "none"; // v1 nunca fuerza un tool específico
}

export interface AICompletionResponse {
  content: string; // "" si el modelo solo pidió tools
  toolCalls?: AIToolCall[];
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
