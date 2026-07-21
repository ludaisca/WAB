import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { isWithinServiceWindow } from "@/lib/whatsapp/service-window";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { searchKnowledge } from "@/lib/ai/rag";
import { wrapUserPrompt, SCOPE_GUARDRAIL } from "@/lib/ai/prompt-sanitizer";
import type { AIProvider, AIMessage } from "@/lib/ai/types";
import type { WABot, WAAccount } from "@prisma/client";

const CANDIDATE_POOL = 100;
const HISTORY_LIMIT = 20;

export interface UnassignedLeadChat {
  id: string;
  remoteJid: string;
  displayName: string;
  accountId: string;
  accountName: string;
  lastMessageAt: Date;
  preview: string;
  withinServiceWindow: boolean;
}

interface LastMessagePerChatRow {
  id: string;
  remoteJid: string;
  chatName: string | null;
  accountId: string;
  accountName: string;
  contactRealName: string | null;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  caption: string | null;
  messageType: string;
  timestamp: Date;
}

// Cuentas del usuario SIN bot activo × chats de esas cuentas cuyo último
// mensaje es INBOUND (nunca se les contestó, ni bot ni humano). Espejo
// invertido de la query de candidatos de lead-recovery-worker.ts:47-65 (que
// busca el caso contrario: último mensaje OUTBOUND, lead que se quedó
// callado tras nuestra respuesta).
//
// Va por SQL crudo (DISTINCT ON, patrón estándar de Postgres para "última
// fila por grupo") en vez de `wAChat.findMany({ messages: { take: 1 } })` +
// filtrar/limitar en JS — una primera versión hacía justo eso con un
// `take: CANDIDATE_POOL` ordenado por `lastMessageAt desc` ANTES de filtrar
// por dirección, y en una cuenta con muchos chats recientes (todos ya
// contestados por un bot que se acaba de desactivar) el tope descartaba los
// leads viejos sin respuesta antes de que el filtro los viera — exactamente
// los que esta feature existe para encontrar. Acá el filtro por dirección ya
// corre dentro de la query, así que el tope solo acota cuántos se muestran,
// nunca descarta un candidato real.
export async function findUnassignedLeadChats(userId: string, now: Date): Promise<UnassignedLeadChat[]> {
  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) return [];

  const accountsWithoutBot = await prisma.wAAccount.findMany({
    where: {
      id: { in: accountIds },
      bots: { none: { isActive: true, status: "ACTIVE" } },
    },
    select: { id: true },
  });
  if (accountsWithoutBot.length === 0) return [];

  const rows = await prisma.$queryRaw<LastMessagePerChatRow[]>`
    SELECT DISTINCT ON (c.id)
      c.id AS id,
      c."remoteJid" AS "remoteJid",
      c.name AS "chatName",
      c."accountId" AS "accountId",
      a.name AS "accountName",
      ct."realName" AS "contactRealName",
      m.direction::text AS direction,
      m.body AS body,
      m.caption AS caption,
      m."messageType" AS "messageType",
      m.timestamp AS timestamp
    FROM wa_chats c
    JOIN wa_accounts a ON a.id = c."accountId"
    LEFT JOIN contacts ct ON ct.id = c."contactId"
    JOIN wa_messages m ON m."chatId" = c.id
    WHERE c."accountId" IN (${Prisma.join(accountsWithoutBot.map((a) => a.id))})
      AND c.status IN ('OPEN', 'PENDING')
    ORDER BY c.id, m.timestamp DESC
  `;

  return rows
    .filter((r) => r.direction === "INBOUND")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, CANDIDATE_POOL)
    .map((r) => ({
      id: r.id,
      remoteJid: r.remoteJid,
      displayName: r.contactRealName ?? r.chatName ?? r.remoteJid,
      accountId: r.accountId,
      accountName: r.accountName,
      lastMessageAt: r.timestamp,
      preview: r.caption ?? r.body ?? `[${r.messageType}]`,
      withinServiceWindow: isWithinServiceWindow(r.timestamp, now),
    }));
}

export interface ManualReplyChat {
  id: string;
  remoteJid: string;
  account: WAAccount;
}

// Genera con la config del bot elegido (systemPrompt/model/RAG) pero envía
// por la cuenta REAL del chat (chat.account), no bot.waAccount — a
// diferencia de bot-worker.ts, aquí el bot puede pertenecer a otra cuenta a
// propósito (el usuario lo eligió de un selector "cualquier bot activo
// tuyo"), así que enviar con las credenciales del bot mandaría el mensaje
// desde el número equivocado y violaría la ventana de servicio de Meta (ese
// número nunca recibió el inbound de este lead).
//
// A diferencia de sendRecoveryMessage (lead-recovery.ts), el historial no
// necesita un turno sintético de "sigue tú" — el chat candidato por
// definición termina en un turno del lead, así que el modelo ya queda en la
// posición natural de responder.
export async function sendManualBotReply(chat: ManualReplyChat, bot: WABot, now: Date): Promise<void> {
  const lastInbound = await prisma.wAMessage.findFirst({
    where: { chatId: chat.id, direction: "INBOUND" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, body: true, caption: true },
  });
  if (!lastInbound) {
    throw new Error("Este chat no tiene ningún mensaje entrante");
  }
  if (!isWithinServiceWindow(lastInbound.timestamp, now)) {
    throw new Error("Ventana de 24h de Meta ya cerrada — no se puede mandar texto libre sin una plantilla aprobada");
  }

  const provider = bot.provider as AIProvider;
  const apiKey = await getUserApiKey(bot.userId, provider);
  if (!apiKey) {
    throw new Error(`Bot "${bot.name}" sin API key configurada — no se puede generar la respuesta`);
  }

  const messages: AIMessage[] = [
    { role: "system", content: wrapUserPrompt(bot.systemPrompt) },
    { role: "system", content: SCOPE_GUARDRAIL },
  ];

  if (bot.ragEnabled) {
    const ragQuery = lastInbound.caption ?? lastInbound.body ?? "";
    const knowledge = await searchKnowledge(bot.id, ragQuery, provider, apiKey);
    if (knowledge) {
      messages.push({
        role: "system",
        content: `Información relevante de la base de conocimiento:\n\n${knowledge}`,
      });
    }
  }

  // Igual que bot-worker.ts:176-192 — si el chat arrancó desde una campaña,
  // el bot debe saber a qué mensaje exacto está reaccionando el lead.
  const lastOutbound = await prisma.wAMessage.findFirst({
    where: { chatId: chat.id, direction: "OUTBOUND" },
    orderBy: { timestamp: "desc" },
    select: {
      body: true,
      campaign: { select: { name: true, waTemplate: { select: { name: true } } } },
    },
  });
  if (lastOutbound?.campaign) {
    const exactMessage = lastOutbound.body
      ? `\n\nEl mensaje exacto que recibió el cliente fue:\n"${lastOutbound.body}"`
      : "";
    messages.push({
      role: "system",
      content: `Esta conversación inició a partir de la campaña "${lastOutbound.campaign.name}" usando la plantilla "${lastOutbound.campaign.waTemplate.name}".${exactMessage}\n\nTen este contenido en cuenta al responder — el cliente puede estar reaccionando directamente a este mensaje.`,
    });
  }

  const history = await prisma.wAMessage.findMany({
    where: { chatId: chat.id },
    orderBy: { timestamp: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true, caption: true },
  });

  for (const msg of history.reverse()) {
    const text = msg.caption ?? msg.body;
    if (!text) continue;
    messages.push({ role: msg.direction === "INBOUND" ? "user" : "assistant", content: text });
  }

  const client = getAIProvider(provider, apiKey);
  const result = await client.complete({
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
  });

  const sendResult = await sendWhatsAppMessage(chat.account, {
    to: chat.remoteJid,
    type: "text",
    body: result.content,
  });

  await prisma.wAMessage.create({
    data: {
      wamid: sendResult.wamid ?? undefined,
      chatId: chat.id,
      direction: "OUTBOUND",
      messageType: "text",
      body: result.content,
      status: "sent",
      timestamp: now,
    },
  });

  await prisma.wAChat.update({
    where: { id: chat.id },
    data: { lastMessage: result.content.slice(0, 500), lastMessageAt: now },
  });

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  const cost = result.usage ? await estimateCost(bot.model, promptTokens, completionTokens, provider) : 0;

  await prisma.wABotUsage.create({
    data: {
      botId: bot.id,
      waChatId: chat.id,
      model: bot.model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: cost,
    },
  });
}
