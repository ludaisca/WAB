import type { getAIProvider } from "@/lib/ai/factory";
import type { AIMessage, AIToolCall, AIToolDefinition, AIToolResult } from "@/lib/ai/types";

export interface BotTool {
  definition: AIToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolLoopResult {
  content: string;
  totalUsage: { promptTokens: number; completionTokens: number } | null;
  // Texto de cada resultado de tool ejecutado en el turno — alimenta el
  // guardrail de links (lib/workers/bot-worker.ts): un link que venga de una
  // tool real cuenta como fundamentado, igual que el contexto RAG.
  toolResultTexts: string[];
  toolCallLog: Array<{ name: string; result: unknown }>;
}

type AIClient = ReturnType<typeof getAIProvider>;

// Mismo patrón que lib/agent/orchestrator.ts (el Asistente IA admin-only):
// loop de tool-calling hasta que el modelo responda sin pedir más tools, con
// una última vuelta forzada a texto para no dejar el turno colgado. Acotado a
// pocas iteraciones a propósito — a diferencia del asistente (una conversación
// de operación, hasta 8 vueltas), esto responde a un lead en vivo y debe ser
// rápido y barato. Subido de 3 a 4 al agregar la tool de sondeo
// (qualified-data.ts): con 2 tools disponibles (precio + sondeo) un turno
// típico ya necesita 2 vueltas de tool-calling antes de la respuesta final, y
// con el cap en 3 la vuelta forzada (forceFinal, sin tools) llegaba demasiado
// seguido a mitad de una decisión del modelo, devolviendo `content: ""`.
const BOT_MAX_TOOL_ITERATIONS = 4;

export async function completeWithBotTools(
  client: AIClient,
  params: { model: string; messages: AIMessage[]; temperature?: number; maxTokens?: number; tools: BotTool[] }
): Promise<ToolLoopResult> {
  const messages = [...params.messages];
  const toolByName = new Map(params.tools.map((t) => [t.definition.name, t]));
  const toolResultTexts: string[] = [];
  const toolCallLog: Array<{ name: string; result: unknown }> = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let hasUsage = false;

  for (let iteration = 1; ; iteration++) {
    const forceFinal = iteration >= BOT_MAX_TOOL_ITERATIONS;
    const useTools = params.tools.length > 0 && !forceFinal;

    const res = await client.complete({
      model: params.model,
      messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      // Sin ninguna tool configurada esto es exactamente la misma llamada que
      // hacía bot-worker.ts antes de este cambio — cero comportamiento nuevo
      // para los bots que no activaron ninguna capacidad de tool-calling.
      tools: useTools ? params.tools.map((t) => t.definition) : undefined,
      toolChoice: useTools ? "auto" : undefined,
    });

    if (res.usage) {
      promptTokens += res.usage.promptTokens;
      completionTokens += res.usage.completionTokens;
      hasUsage = true;
    }

    if (!res.toolCalls?.length) {
      return {
        content: res.content,
        totalUsage: hasUsage ? { promptTokens, completionTokens } : null,
        toolResultTexts,
        toolCallLog,
      };
    }

    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });

    const toolResults: AIToolResult[] = await Promise.all(
      res.toolCalls.map(async (call: AIToolCall) => {
        const tool = toolByName.get(call.name);
        if (!tool) {
          return { toolCallId: call.id, name: call.name, result: { error: "Tool desconocida" }, isError: true };
        }
        try {
          const result = await tool.execute(call.arguments);
          toolCallLog.push({ name: call.name, result });
          toolResultTexts.push(JSON.stringify(result));
          return { toolCallId: call.id, name: call.name, result };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return { toolCallId: call.id, name: call.name, result: { error: errorMessage }, isError: true };
        }
      })
    );

    messages.push({ role: "tool", content: "", toolResults });
  }
}
