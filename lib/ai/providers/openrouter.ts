import OpenAI from "openai";
import type { AICompletionParams, AICompletionResponse, AIEmbeddingParams, AIEmbeddingResponse } from "../types";

const BASE_URL = "https://openrouter.ai/api/v1";

export function createOpenRouterClient(apiKey: string) {
  const client = new OpenAI({ baseURL: BASE_URL, apiKey });

  async function complete(params: AICompletionParams): Promise<AICompletionResponse> {
    const res = await client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1024,
    });

    return {
      content: res.choices[0]?.message?.content ?? "",
      usage: res.usage
        ? { promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens }
        : undefined,
    };
  }

  async function generateEmbeddings(params: AIEmbeddingParams): Promise<AIEmbeddingResponse> {
    const inputs = Array.isArray(params.input) ? params.input : [params.input];
    const res = await client.embeddings.create({
      model: params.model,
      input: inputs,
      dimensions: 768,
    });

    return {
      embeddings: res.data.map((d) => d.embedding),
    };
  }

  return { complete, generateEmbeddings };
}
