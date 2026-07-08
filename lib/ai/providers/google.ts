import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIMessage, AICompletionParams, AICompletionResponse, AIEmbeddingParams, AIEmbeddingResponse } from "../types";

export function createGoogleClient(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);

  async function complete(params: AICompletionParams): Promise<AICompletionResponse> {
    const model = genAI.getGenerativeModel({ model: params.model });

    const systemMsg = params.messages.find((m) => m.role === "system");
    const history = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: m.content }],
      }));

    const chat = model.startChat({
      systemInstruction: systemMsg?.content,
      history: history.slice(0, -1),
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1024,
      },
    });

    const lastMsg = history[history.length - 1];
    const result = await chat.sendMessage(lastMsg?.parts?.[0]?.text ?? "");
    const text = result.response.text();

    return {
      content: text,
    };
  }

  async function generateEmbeddings(params: AIEmbeddingParams): Promise<AIEmbeddingResponse> {
    const inputs = Array.isArray(params.input) ? params.input : [params.input];
    const model = genAI.getGenerativeModel({ model: params.model });

    const embeddings: number[][] = [];

    for (const input of inputs) {
      const result = await model.embedContent(input);
      embeddings.push(result.embedding.values ?? []);
    }

    return { embeddings };
  }

  return { complete, generateEmbeddings };
}
