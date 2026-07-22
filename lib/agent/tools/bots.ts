import { prisma } from "@/lib/prisma";
import { toggleBot, updateBotSystemPrompt, deleteBot } from "@/lib/whatsapp/bots";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

export const botsList: ToolDefinition<Record<string, never>> = {
  name: "bots.list",
  riskTier: "READ",
  description: "Lista los bots de IA del usuario (nombre, proveedor, modelo, si está activo, a qué cuenta de WhatsApp está asignado).",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => {
    const bots = await prisma.wABot.findMany({
      where: { userId: ctx.userId },
      select: {
        id: true, name: true, provider: true, model: true, isActive: true, status: true,
        waAccountId: true, waAccount: { select: { name: true } },
        _count: { select: { conversations: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return { bots };
  },
};

export const botsGet: ToolDefinition<{ botId: string }> = {
  name: "bots.get",
  riskTier: "READ",
  description: "Obtiene el detalle completo de un bot, incluido su systemPrompt.",
  parameters: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
  handler: async (params, ctx) => {
    const bot = await prisma.wABot.findFirst({ where: { id: params.botId, userId: ctx.userId } });
    if (!bot) return { error: "Bot no encontrado" };
    return bot;
  },
};

export const botsUsage: ToolDefinition<{ botId: string }> = {
  name: "bots.usage",
  riskTier: "READ",
  description: "Suma de tokens y costo estimado de un bot en los últimos 30 días.",
  parameters: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
  handler: async (params, ctx) => {
    const bot = await prisma.wABot.findFirst({ where: { id: params.botId, userId: ctx.userId }, select: { id: true } });
    if (!bot) return { error: "Bot no encontrado" };

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const usage = await prisma.wABotUsage.aggregate({
      where: { botId: params.botId, createdAt: { gte: since } },
      _sum: { totalTokens: true, estimatedCost: true },
      _count: true,
    });
    return {
      last30days: {
        interactions: usage._count,
        totalTokens: usage._sum.totalTokens ?? 0,
        estimatedCost: usage._sum.estimatedCost ?? 0,
      },
    };
  },
};

export const botsToggle: ToolDefinition<{ botId: string }> = {
  name: "bots.toggle",
  riskTier: "CONFIRM",
  description: "Activa o desactiva un bot de IA (invierte su estado actual). Encenderlo hace que empiece a responder mensajes reales de WhatsApp en su cuenta asignada. Requiere confirmación humana.",
  parameters: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
  describeConfirm: async (params, ctx) => {
    const bot = await prisma.wABot.findFirst({ where: { id: params.botId, userId: ctx.userId }, select: { name: true, isActive: true } });
    if (!bot) throw new NotFoundError("Bot no encontrado");
    const action = bot.isActive ? "Desactivar" : "Activar";
    const consequence = bot.isActive ? "dejará de responder mensajes de WhatsApp" : "empezará a responder mensajes reales de WhatsApp en su cuenta asignada";
    return { description: `${action} el bot "${bot.name}" — ${consequence}.`, params };
  },
  executeConfirm: async (params, ctx) => toggleBot(params.botId, ctx.userId),
};

export const botsSystemPromptUpdate: ToolDefinition<{ botId: string; systemPrompt: string }> = {
  name: "bots.systemPrompt.update",
  riskTier: "CONFIRM",
  description: "Reemplaza el systemPrompt de un bot de IA. Cambia cómo responde a partir de este momento a mensajes reales de WhatsApp. Requiere confirmación humana.",
  parameters: {
    type: "object",
    properties: { botId: { type: "string" }, systemPrompt: { type: "string" } },
    required: ["botId", "systemPrompt"],
  },
  describeConfirm: async (params, ctx) => {
    const bot = await prisma.wABot.findFirst({ where: { id: params.botId, userId: ctx.userId }, select: { name: true } });
    if (!bot) throw new NotFoundError("Bot no encontrado");
    return { description: `Reemplazar el systemPrompt del bot "${bot.name}" por el texto propuesto.`, params };
  },
  executeConfirm: async (params, ctx) => updateBotSystemPrompt(params.botId, ctx.userId, params.systemPrompt),
};

export const botsDelete: ToolDefinition<{ botId: string }> = {
  name: "bots.delete",
  riskTier: "CONFIRM",
  description: "Elimina permanentemente un bot de IA y su historial de conversaciones/conocimiento asociado. Requiere confirmación humana.",
  parameters: { type: "object", properties: { botId: { type: "string" } }, required: ["botId"] },
  describeConfirm: async (params, ctx) => {
    const bot = await prisma.wABot.findFirst({
      where: { id: params.botId, userId: ctx.userId },
      select: { name: true, _count: { select: { conversations: true, knowledgeBots: true } } },
    });
    if (!bot) throw new NotFoundError("Bot no encontrado");
    return {
      description: `Eliminar permanentemente el bot "${bot.name}" (${bot._count.conversations} conversaciones, ${bot._count.knowledgeBots} documentos de conocimiento vinculados).`,
      params,
    };
  },
  executeConfirm: async (params, ctx) => {
    await deleteBot(params.botId, ctx.userId);
    return { success: true };
  },
};
