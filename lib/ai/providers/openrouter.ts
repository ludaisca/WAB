import OpenAI from "openai";
import type {
  AICompletionParams,
  AICompletionResponse,
  AIMessage,
  AIToolCall,
  AIEmbeddingParams,
  AIEmbeddingResponse,
} from "../types";

const BASE_URL = "https://openrouter.ai/api/v1";

// Un AIMessage `assistant` con toolCalls se mapea a un solo mensaje OpenAI con
// `tool_calls`; un AIMessage `tool` con toolResults se APLANA a N mensajes
// `{role:"tool", tool_call_id, content}` — OpenAI exige un mensaje por
// tool_call_id, no uno agregado (a diferencia de Gemini, ver google.ts).
function toOpenRouterMessages(messages: AIMessage[]) {
  const out: Array<{ role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }> = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
      continue;
    }
    if (m.role === "tool" && m.toolResults?.length) {
      for (const tr of m.toolResults) {
        out.push({ role: "tool", tool_call_id: tr.toolCallId, content: JSON.stringify(tr.result) });
      }
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export function createOpenRouterClient(apiKey: string) {
  const client = new OpenAI({ baseURL: BASE_URL, apiKey });

  async function complete(params: AICompletionParams): Promise<AICompletionResponse> {
    const res = await client.chat.completions.create({
      model: params.model,
      messages: toOpenRouterMessages(params.messages) as never,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1024,
      ...(params.tools?.length
        ? {
            tools: params.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: params.toolChoice ?? "auto",
          }
        : {}),
    });

    const message = res.choices[0]?.message;
    // v1 solo pide tool_choice:"auto"/"none" (nunca fuerza un tool específico), así que
    // solo tratamos con function tool calls — el SDK también tipa "custom" tool calls
    // (sin el campo `function`) que este agente no genera.
    const toolCalls: AIToolCall[] | undefined = message?.tool_calls
      ?.filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      }));

    return {
      content: message?.content ?? "",
      toolCalls,
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
