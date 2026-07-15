import { GoogleGenerativeAI } from "@google/generative-ai";
import type { EmbedContentRequest } from "@google/generative-ai";
import type {
  AICompletionParams,
  AICompletionResponse,
  AIEmbeddingParams,
  AIEmbeddingResponse,
  AIMessage,
  ContentPart,
} from "../types";

// gemini-embedding-2 defaults to 3072 dims; outputDimensionality truncates it
// (Matryoshka Representation Learning — the API re-normalizes automatically)
// down to the 768 this project's pgvector column expects. The installed SDK
// version's EmbedContentRequest type predates this field, but the REST API
// accepts it — verified directly against the live embedContent endpoint.
const EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
type EmbedContentRequestWithDimensionality = EmbedContentRequest & {
  outputDimensionality?: number;
};

type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GoogleRole = "user" | "model";

function toParts(content: AIMessage["content"]): GooglePart[] {
  if (typeof content === "string") return [{ text: content }];

  return (content as ContentPart[]).map((p) => {
    if (p.type === "text") return { text: p.text };
    // data URI scheme: data:<mime>;base64,<data> — inlineData itself is mime-agnostic,
    // it works the same for an image_url or audio_url part.
    const url = p.type === "image_url" ? p.image_url.url : p.audio_url.url;
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { inlineData: { mimeType: match[1], data: match[2] } };
    }
    // Plain URL isn't supported by inlineData (which expects raw bytes); skip silently.
    return { text: "[contenido no embebido]" };
  });
}

export function createGoogleClient(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);

  async function complete(params: AICompletionParams): Promise<AICompletionResponse> {
    // Callers (bot-worker's RAG/campaign-context/summary injections, the lead
    // scorer's business-prompt + JSON-contract pair) may push several
    // system-role messages. Concatenate all of them — picking only the first
    // silently dropped the rest, which is how the lead scorer's JSON-format
    // instruction went missing and Gemini's replies failed to parse.
    const systemTexts = params.messages
      .filter((m) => m.role === "system" && typeof m.content === "string")
      .map((m) => m.content as string);
    const systemText = systemTexts.length > 0 ? systemTexts.join("\n\n") : undefined;

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

    // Gemini requires the first entry of `history` to have role "user" — it rejects the
    // call outright otherwise ("First content should be with role 'user', got model").
    // bot-worker's RECENT-memory window just takes the N most recent messages regardless
    // of pairing, so the oldest kept message can legitimately be the bot's own outbound
    // message (a campaign send, or a human agent reply before the bot took over — the
    // window starts mid-exchange). Dropping those leading turns silently threw away real
    // content the bot needs (e.g. what a campaign actually said) — instead, prepend one
    // synthetic user turn so the real history survives intact and Gemini's constraint is
    // still satisfied.
    const priorHistory = history.slice(0, -1);
    const needsLeadingUser = priorHistory.length > 0 && priorHistory[0].role === "model";
    const trimmedHistory = needsLeadingUser
      ? [{ role: "user" as GoogleRole, parts: [{ text: "(inicio de la conversación)" }] }, ...priorHistory]
      : priorHistory;

    const chat = model.startChat({
      history: trimmedHistory,
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
      const request: EmbedContentRequestWithDimensionality = {
        content: { role: "user", parts: [{ text: input }] },
        outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONALITY,
      };
      const result = await model.embedContent(request);
      embeddings.push(result.embedding.values ?? []);
    }

    return { embeddings };
  }

  return { complete, generateEmbeddings };
}