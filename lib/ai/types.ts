export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  // Gemini-only (see google.ts toParts) — inlineData is mime-agnostic there.
  | { type: "audio_url"; audio_url: { url: string } };

// Tool-calling — usado por el agente de IA (lib/agent/), aditivo sobre el
// shape existente: los consumidores actuales (bot-worker, lead-recovery,
// lead-scoring, unassigned-lead-reply) construyen AIMessage sin estos campos
// y siguen compilando igual.
export interface AIToolCall {
  id: string; // Google no da id real — se sintetiza `${name}_${index}` en el provider.
  name: string;
  arguments: Record<string, unknown>;
  // Solo Gemini 3+ (google.ts): firma opaca que la API adjunta a cada parte
  // functionCall de su respuesta. Si un turno assistant con toolCalls se
  // vuelve a mandar como historial en la MISMA llamada (el loop de tools de
  // run-tool-loop.ts), Gemini 3 exige que esa firma viaje de vuelta tal cual
  // en esa parte — sin ella responde 400 ("Function call is missing a
  // thought_signature"). Ver https://ai.google.dev/gemini-api/docs/thought-signatures.
  // undefined para Gemini 2.x (no lo requieren).
  thoughtSignature?: string;
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
  parameters: Record<string, unknown>; // JSON Schema, subset compatible con Gemini
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
  toolChoice?: "auto" | "none"; // nunca se fuerza un tool específico
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
