import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { isMonthlyBudgetExceeded, checkBudgetAlert } from "@/lib/ai/budget";
import type { AIMessage, AIProvider, AIToolResult } from "@/lib/ai/types";
import { getTool, listToolDefinitions } from "./tools/registry";
import type { ToolContext } from "./tools/types";
import { validateAgainstJsonSchema } from "./validate";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt";

const MAX_ITERATIONS = 8; // tope duro de tool-calls por turno de usuario
const CONFIRM_STUB =
  'PENDIENTE — no se ha ejecutado todavía. Solo se ejecutará si el humano hace clic en "Confirmar" en la interfaz. No la des por hecha ni la describas como completada.';

async function appendUserMessage(conversationId: string, content: string) {
  await prisma.agentMessage.create({ data: { conversationId, role: "USER", content } });
}

async function appendAssistantMessage(conversationId: string, content: string) {
  await prisma.agentMessage.create({ data: { conversationId, role: "ASSISTANT", content } });
}

function describeMinorAction(toolName: string, params: unknown): string {
  return `Ejecutó "${toolName}" con parámetros: ${JSON.stringify(params)}`;
}

// Reconstruye el historial persistido al shape que espera el provider. Los
// mensajes TOOL individuales que nacen de una acción CONFIRM (toolCallId
// puesto, para que la UI renderice su tarjeta inline) NO se repiten aquí —
// solo el mensaje TOOL agregado de fin de iteración (toolCallId null,
// content = JSON de todo el array de resultados) reconstruye el turno real
// que el modelo necesita para continuar la conversación.
async function buildTranscript(conversationId: string): Promise<AIMessage[]> {
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  const messages: AIMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];

  for (const row of rows) {
    if (row.role === "USER") {
      messages.push({ role: "user", content: row.content });
    } else if (row.role === "ASSISTANT") {
      messages.push({
        role: "assistant",
        content: row.content,
        toolCalls: row.toolCalls ? (row.toolCalls as never) : undefined,
      });
    } else if (row.role === "TOOL" && row.toolCallId === null) {
      messages.push({ role: "tool", content: "", toolResults: JSON.parse(row.content) as AIToolResult[] });
    }
    // role TOOL con toolCallId set: marcador de UI para una acción CONFIRM, se omite del replay.
  }

  return messages;
}

export async function handleUserMessage(conversationId: string, userId: string, userText: string): Promise<string> {
  const now = new Date();
  if (await isMonthlyBudgetExceeded(userId, now)) {
    const msg = "Se alcanzó el presupuesto mensual de IA — no puedo procesar más solicitudes este mes.";
    await appendUserMessage(conversationId, userText);
    await appendAssistantMessage(conversationId, msg);
    return msg;
  }

  const settings = await prisma.appSettings.findUnique({ where: { userId } });
  const provider = (settings?.defaultProvider ?? "openrouter") as AIProvider;
  const model = settings?.defaultModel ?? "google/gemini-2.5-flash";
  const apiKey = await getUserApiKey(userId, provider);
  if (!apiKey) {
    const msg = "Falta configurar la clave del proveedor de IA en Configuración antes de poder usar el asistente.";
    await appendUserMessage(conversationId, userText);
    await appendAssistantMessage(conversationId, msg);
    return msg;
  }
  const client = getAIProvider(provider, apiKey);

  await appendUserMessage(conversationId, userText);
  const messages = await buildTranscript(conversationId);

  for (let iterations = 1; ; iterations++) {
    const forceFinal = iterations >= MAX_ITERATIONS;
    const res = await client.complete({
      model,
      messages,
      tools: forceFinal ? undefined : listToolDefinitions(),
      toolChoice: forceFinal ? "none" : "auto",
      maxTokens: 1024,
    });

    if (res.usage) {
      const cost = await estimateCost(model, res.usage.promptTokens, res.usage.completionTokens, provider);
      await prisma.agentUsage.create({
        data: {
          conversationId,
          model,
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          totalTokens: res.usage.promptTokens + res.usage.completionTokens,
          estimatedCost: cost,
          toolCallCount: res.toolCalls?.length ?? 0,
        },
      });
      await checkBudgetAlert(userId, now);
    }

    if (!res.toolCalls?.length) {
      await appendAssistantMessage(conversationId, res.content);
      return res.content;
    }

    await prisma.agentMessage.create({
      data: { conversationId, role: "ASSISTANT", content: res.content, toolCalls: res.toolCalls as never },
    });
    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });

    const toolResults: AIToolResult[] = [];
    for (const call of res.toolCalls) {
      const tool = getTool(call.name);
      if (!tool) {
        toolResults.push({ toolCallId: call.id, name: call.name, result: { error: "Tool desconocida" }, isError: true });
        continue;
      }
      const parsed = validateAgainstJsonSchema(tool.parameters, call.arguments);
      if (!parsed.ok) {
        toolResults.push({ toolCallId: call.id, name: call.name, result: { error: parsed.error }, isError: true });
        continue;
      }
      const ctx: ToolContext = { userId, conversationId };

      if (tool.riskTier === "CONFIRM") {
        // describeConfirm valida existencia/pertenencia (ej. "bot no encontrado" si
        // el modelo pasa un id inválido) — igual de falible que un handler READ/MINOR,
        // así que un throw aquí se reporta como isError al modelo (que puede corregir
        // el id y reintentar) en vez de tirar toda la petición con un 500.
        try {
          const { description, params } = await tool.describeConfirm!(parsed.data, ctx);
          const action = await prisma.agentAction.create({
            data: {
              conversationId, userId, toolName: tool.name, riskTier: "CONFIRM", description, params: params as never,
              status: "PENDING", expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
            },
          });
          await prisma.agentMessage.create({
            data: {
              conversationId, role: "TOOL", toolCallId: call.id, toolName: tool.name, actionId: action.id,
              content: JSON.stringify({ status: "pending_confirmation", description }),
            },
          });
          toolResults.push({ toolCallId: call.id, name: call.name, result: { status: "pending_confirmation", description, actionId: action.id, note: CONFIRM_STUB } });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          toolResults.push({ toolCallId: call.id, name: call.name, result: { error: errorMessage }, isError: true });
        }
        continue;
      }

      try {
        const result = await tool.handler!(parsed.data, ctx);
        if (tool.riskTier === "MINOR") {
          await prisma.agentAction.create({
            data: {
              conversationId, userId, toolName: tool.name, riskTier: "MINOR",
              description: describeMinorAction(tool.name, parsed.data), params: parsed.data as never,
              status: "EXECUTED", result: result as never, resolvedAt: new Date(),
            },
          });
        }
        toolResults.push({ toolCallId: call.id, name: call.name, result });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        toolResults.push({ toolCallId: call.id, name: call.name, result: { error: errorMessage }, isError: true });
        if (tool.riskTier === "MINOR") {
          await prisma.agentAction.create({
            data: {
              conversationId, userId, toolName: tool.name, riskTier: "MINOR",
              description: describeMinorAction(tool.name, parsed.data), params: parsed.data as never,
              status: "FAILED", errorMessage, resolvedAt: new Date(),
            },
          });
        }
      }
    }

    await prisma.agentMessage.create({ data: { conversationId, role: "TOOL", content: JSON.stringify(toolResults) } });
    messages.push({ role: "tool", content: "", toolResults });
  }
}
