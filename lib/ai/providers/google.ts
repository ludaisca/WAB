import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  AICompletionParams,
  AICompletionResponse,
  AIEmbeddingParams,
  AIEmbeddingResponse,
  AIMessage,
  ContentPart,
} from "../types";

type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GoogleRole = "user" | "model";

function toParts(content: AIMessage["content"]): GooglePart[] {
  if (typeof content === "string") return [{ text: content }];

  return (content as ContentPart[]).map((p) => {
    if (p.type === "text") return { text: p.text };
    // data URI scheme: data:<mime>;base64,<data>
    const match = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { inlineData: { mimeType: match[1], data: match[2] } };
    }
    // Plain URL isn't supported by inlineData (which expects raw bytes); skip silently.
    return { text: "[imagen no embebida]" };
  });
}

export function createGoogleClient(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);

  async function complete(params: AICompletionParams): Promise<AICompletionResponse> {
    const systemMsg = params.messages.find((m) => m.role === "system");
    const systemText =
      typeof systemMsg?.content === "string" ? systemMsg.content : undefined;

    // systemInstruction must be set here, on getGenerativeModel(). The SDK only
    // runs its string->Content formatting on this value; if passed to
    // startChat() instead it silently overrides the formatted value with the
    // raw, unformatted one and the REST API rejects it.
    const model = genAI.getGenerativeModel({
      model: params.model,
      systemInstruction: systemText,
    });

    const nonSystem = params.messages.filter((m) => m.role !== "system");

    const history = nonSystem.map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as GoogleRole,
      parts: toParts(m.content),
    }));

    const chat = model.startChat({
      history: history.slice(0, -1),
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1024,
      },
    });

    const lastMsg = history[history.length - 1];
    const result = await chat.sendMessage(lastMsg?.parts ?? [{ text: "" }]);
    const text = result.response.text();

    return {
      content: text,
      usage: result.response.usageMetadata
        ? {
            promptTokens: result.response.usageMetadata.promptTokenCount,
            completionTokens:
              result.response.usageMetadata.candidatesTokenCount ??
              result.response.usageMetadata.totalTokenCount -
                result.response.usageMetadata.promptTokenCount,
          }
        : undefined,
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