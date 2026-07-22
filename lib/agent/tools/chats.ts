import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { wrapUserPrompt } from "@/lib/ai/prompt-sanitizer";
import { setChatStatus } from "@/lib/whatsapp/chat-status";
import { assignChat, getEligibleAssignees } from "@/lib/chat-assignees";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

async function getOwnedChat(userId: string, chatId: string) {
  const accessWhere = await chatAccessWhere(userId, "admin");
  return prisma.wAChat.findFirst({ where: { id: chatId, ...accessWhere }, select: { id: true, accountId: true } });
}

const MAX_LIST = 30;
const MAX_MESSAGES = 50;

export const chatsList: ToolDefinition<{ status?: string; search?: string; limit?: number }> = {
  name: "chats.list",
  riskTier: "READ",
  description: "Lista chats de WhatsApp, opcionalmente filtrados por status (OPEN, PENDING, RESOLVED) o por nombre/teléfono del contacto.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["OPEN", "PENDING", "RESOLVED"] },
      search: { type: "string", description: "Nombre o número del contacto" },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_LIST})` },
    },
  },
  handler: async (params, ctx) => {
    const accessWhere = await chatAccessWhere(ctx.userId, "admin");
    const take = Math.min(params.limit ?? 20, MAX_LIST);
    const chats = await prisma.wAChat.findMany({
      where: {
        ...accessWhere,
        ...(params.status ? { status: params.status as never } : {}),
        ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
      },
      select: {
        id: true, name: true, remoteJid: true, status: true, lastMessage: true,
        lastMessageAt: true, unreadCount: true, accountId: true, assignedTo: { select: { name: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take,
    });
    return { chats, count: chats.length };
  },
};

export const chatsGet: ToolDefinition<{ chatId: string }> = {
  name: "chats.get",
  riskTier: "READ",
  description: "Obtiene el detalle de un chat por id: status, asignación, tags, y datos del contacto.",
  parameters: { type: "object", properties: { chatId: { type: "string" } }, required: ["chatId"] },
  handler: async (params, ctx) => {
    const accessWhere = await chatAccessWhere(ctx.userId, "admin");
    const chat = await prisma.wAChat.findFirst({
      where: { id: params.chatId, ...accessWhere },
      include: {
        assignedTo: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, realName: true, leadStatus: true } },
        chatTags: { include: { tag: { select: { name: true } } } },
      },
    });
    if (!chat) return { error: "Chat no encontrado" };
    return { ...chat, tags: chat.chatTags.map((t) => t.tag.name) };
  },
};

export const chatsMessagesList: ToolDefinition<{ chatId: string; limit?: number }> = {
  name: "chats.messages.list",
  riskTier: "READ",
  description: "Lee los últimos mensajes de un chat (transcripción). Úsalo antes de responder preguntas sobre el contenido de una conversación específica.",
  parameters: {
    type: "object",
    properties: { chatId: { type: "string" }, limit: { type: "number", description: `Máximo de mensajes (tope ${MAX_MESSAGES})` } },
    required: ["chatId"],
  },
  handler: async (params, ctx) => {
    const accessWhere = await chatAccessWhere(ctx.userId, "admin");
    const chat = await prisma.wAChat.findFirst({ where: { id: params.chatId, ...accessWhere }, select: { id: true } });
    if (!chat) return { error: "Chat no encontrado" };

    const take = Math.min(params.limit ?? 30, MAX_MESSAGES);
    const messages = (
      await prisma.wAMessage.findMany({
        where: { chatId: params.chatId },
        orderBy: { timestamp: "desc" },
        take,
        select: { direction: true, body: true, caption: true, messageType: true, timestamp: true },
      })
    ).reverse();

    const transcript = messages
      .map((m) => `${m.direction === "INBOUND" ? "Lead" : "Agente"} (${m.timestamp.toISOString()}): ${m.caption ?? m.body ?? `[${m.messageType}]`}`)
      .join("\n");

    // El contenido del lead es texto externo no confiable — se envuelve igual
    // que en bot-worker/lead-scoring antes de que el modelo lo vea como dato.
    return { transcript: wrapUserPrompt(transcript, 8000), messageCount: messages.length };
  },
};

export const chatsTagsAdd: ToolDefinition<{ chatId: string; tagId: string }> = {
  name: "chats.tags.add",
  riskTier: "MINOR",
  description: "Agrega una etiqueta existente a un chat. El tagId debe venir de tags.list — este tool no crea etiquetas nuevas.",
  parameters: {
    type: "object",
    properties: { chatId: { type: "string" }, tagId: { type: "string" } },
    required: ["chatId", "tagId"],
  },
  handler: async (params, ctx) => {
    const chat = await getOwnedChat(ctx.userId, params.chatId);
    if (!chat) throw new NotFoundError("Chat no encontrado");
    const tag = await prisma.tag.findUnique({ where: { id: params.tagId } });
    if (!tag) throw new NotFoundError("Etiqueta no encontrada");

    await prisma.chatTag.upsert({
      where: { chatId_tagId: { chatId: params.chatId, tagId: params.tagId } },
      create: { chatId: params.chatId, tagId: params.tagId },
      update: {},
    });
    return { success: true };
  },
};

export const chatsTagsRemove: ToolDefinition<{ chatId: string; tagId: string }> = {
  name: "chats.tags.remove",
  riskTier: "MINOR",
  description: "Quita una etiqueta de un chat.",
  parameters: {
    type: "object",
    properties: { chatId: { type: "string" }, tagId: { type: "string" } },
    required: ["chatId", "tagId"],
  },
  handler: async (params, ctx) => {
    const chat = await getOwnedChat(ctx.userId, params.chatId);
    if (!chat) throw new NotFoundError("Chat no encontrado");
    await prisma.chatTag.deleteMany({ where: { chatId: params.chatId, tagId: params.tagId } });
    return { success: true };
  },
};

export const chatsStatusSet: ToolDefinition<{ chatId: string; status: "OPEN" | "PENDING" | "RESOLVED" }> = {
  name: "chats.status.set",
  riskTier: "MINOR",
  description: "Cambia el status de un chat (OPEN, PENDING, RESOLVED).",
  parameters: {
    type: "object",
    properties: { chatId: { type: "string" }, status: { type: "string", enum: ["OPEN", "PENDING", "RESOLVED"] } },
    required: ["chatId", "status"],
  },
  handler: async (params, ctx) => {
    const chat = await getOwnedChat(ctx.userId, params.chatId);
    if (!chat) throw new NotFoundError("Chat no encontrado");
    return setChatStatus(params.chatId, params.status);
  },
};

export const chatsAssign: ToolDefinition<{ chatId: string; assignedToId: string | null }> = {
  name: "chats.assign",
  riskTier: "MINOR",
  description: "Asigna (o desasigna con assignedToId=null) un chat a un usuario elegible para esa cuenta.",
  parameters: {
    type: "object",
    properties: { chatId: { type: "string" }, assignedToId: { type: "string" } },
    required: ["chatId"],
  },
  handler: async (params, ctx) => {
    const chat = await getOwnedChat(ctx.userId, params.chatId);
    if (!chat) throw new NotFoundError("Chat no encontrado");
    return assignChat(params.chatId, params.assignedToId ?? null, chat.accountId);
  },
};

export const chatsAssigneesList: ToolDefinition<{ chatId: string }> = {
  name: "chats.assignees.list",
  riskTier: "READ",
  description: "Lista los usuarios elegibles para asignar un chat (dueño de la cuenta + con quien esté compartida).",
  parameters: { type: "object", properties: { chatId: { type: "string" } }, required: ["chatId"] },
  handler: async (params, ctx) => {
    const chat = await getOwnedChat(ctx.userId, params.chatId);
    if (!chat) return { error: "Chat no encontrado" };
    const assignees = await getEligibleAssignees(chat.accountId);
    return { assignees };
  },
};
