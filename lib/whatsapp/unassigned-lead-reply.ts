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
import { summarizeText } from "@/lib/ai/summarize";
import { splitReply, computeTypingDelay } from "@/lib/whatsapp/humanize";
import { botSendQueue } from "@/lib/queue";
import type { AIMessage } from "@/lib/ai/types";
import type { WABot, WAAccount } from "@prisma/client";

const CANDIDATE_POOL = 100;
// Un chat en una cuenta CON bot activo solo cuenta como "sin respuesta" si el
// mensaje ya lleva más de esto sin contestar — le da tiempo al pipeline
// normal (debounce de ~6s, cola bot-messages) antes de asumir que algo falló.
// Cuentas SIN bot activo no tienen este umbral: nada va a intentar responder
// ahí jamás, así que cualquier mensaje sin contestar ya califica.
const STALE_WITH_BOT_MINUTES = 15;

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

// Chats del usuario cuyo último mensaje es INBOUND (nunca se les contestó, ni
// bot ni humano). Espejo invertido de la query de candidatos de
// lead-recovery-worker.ts:47-65 (que busca el caso contrario: último mensaje
// OUTBOUND, lead que se quedó callado tras nuestra respuesta).
//
// Cubre DOS escenarios, no solo "la cuenta no tiene bot":
// 1. Cuenta sin ningún bot activo — nada va a contestar jamás, así que
//    cualquier chat sin respuesta califica de inmediato.
// 2. Cuenta CON bot activo cuyo mensaje lleva más de STALE_WITH_BOT_MINUTES
//    sin respuesta — el bot "debería" haber contestado pero algo falló
//    (cayó en ERROR, se agotó el presupuesto mensual, un fallo silencioso
//    cualquiera). Antes esta función solo cubría el escenario 1, así que un
//    bot atorado en ERROR dejaba leads reales sin respuesta y sin ninguna
//    forma de detectarlos/responderlos manualmente desde acá.
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

  const accountsWithBot = await prisma.wAAccount.findMany({
    where: {
      id: { in: accountIds },
      bots: { some: { bot: { isActive: true, status: "ACTIVE" } } },
    },
    select: { id: true },
  });
  const accountsWithBotIds = new Set(accountsWithBot.map((a) => a.id));

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
    WHERE c."accountId" IN (${Prisma.join(accountIds)})
      AND c.status IN ('OPEN', 'PENDING')
      AND ct."blockedAt" IS NULL
    ORDER BY c.id, m.timestamp DESC
  `;

  const staleCutoffMs = now.getTime() - STALE_WITH_BOT_MINUTES * 60_000;

  return rows
    .filter((r) => {
      if (r.direction !== "INBOUND") return false;
      if (!accountsWithBotIds.has(r.accountId)) return true;
      return r.timestamp.getTime() < staleCutoffMs;
    })
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
  // Lista negra: un contacto bloqueado no recibe respuestas automáticas, ni
  // siquiera por este flujo manual.
  const blocked = await prisma.wAChat.findUnique({
    where: { id: chat.id },
    select: { contact: { select: { blockedAt: true } } },
  });
  if (blocked?.contact?.blockedAt) {
    throw new Error("El contacto está bloqueado — no se envían respuestas automáticas");
  }

  const lastInbound = await prisma.wAMessage.findFirst({
    where: { chatId: chat.id, direction: "INBOUND" },
    orderBy: { timestamp: "desc" },
    select: { id: true, timestamp: true, body: true, caption: true },
  });
  if (!lastInbound) {
    throw new Error("Este chat no tiene ningún mensaje entrante");
  }
  if (!isWithinServiceWindow(lastInbound.timestamp, now)) {
    throw new Error("Ventana de 24h de Meta ya cerrada — no se puede mandar texto libre sin una plantilla aprobada");
  }

  const apiKey = await getUserApiKey(bot.userId);
  if (!apiKey) {
    throw new Error(`Bot "${bot.name}" sin API key configurada — no se puede generar la respuesta`);
  }

  // Igual que bot-worker.ts: mantiene un hilo de WABotConversation por chat+bot
  // para que memoryType:"SUMMARY" se acumule igual sin importar si la
  // respuesta vino del pipeline automático o de este flujo manual.
  const conversation = await prisma.wABotConversation.upsert({
    where: { botId_waChatId: { botId: bot.id, waChatId: chat.id } },
    create: { botId: bot.id, waChatId: chat.id },
    update: {},
  });

  const messages: AIMessage[] = [
    { role: "system", content: wrapUserPrompt(bot.systemPrompt) },
    { role: "system", content: SCOPE_GUARDRAIL },
  ];

  if (bot.ragEnabled) {
    const ragQuery = lastInbound.caption ?? lastInbound.body ?? "";
    const knowledge = await searchKnowledge(bot.id, ragQuery, apiKey);
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

  // Respeta bot.memoryType igual que bot-worker.ts — antes esto siempre
  // mandaba hasta 20 mensajes crudos sin importar la configuración real del
  // bot elegido (NONE no debía llevar historial en absoluto, SUMMARY debía
  // usar el resumen acumulado en vez de mensajes crudos). El último inbound
  // se excluye del historial y se agrega siempre al final como turno actual,
  // igual que buildUserContent() en bot-worker.ts.
  if (bot.memoryType === "RECENT" && bot.memoryLimit > 0) {
    const history = await prisma.wAMessage.findMany({
      where: { chatId: chat.id, id: { not: lastInbound.id } },
      orderBy: { timestamp: "desc" },
      take: bot.memoryLimit * 2,
      select: { direction: true, body: true, caption: true },
    });
    for (const msg of history.reverse()) {
      const text = msg.caption ?? msg.body;
      if (!text) continue;
      messages.push({ role: msg.direction === "INBOUND" ? "user" : "assistant", content: text });
    }
  }

  if (bot.memoryType === "SUMMARY" && conversation.summary) {
    messages.push({
      role: "system",
      content: `Resumen de la conversación anterior:\n${conversation.summary}`,
    });
  }

  const userText = lastInbound.caption ?? lastInbound.body ?? "";
  messages.push({ role: "user", content: userText || "[mensaje sin texto]" });

  const client = getAIProvider(apiKey);
  const result = await client.complete({
    model: bot.model,
    messages,
    temperature: bot.temperature,
    maxTokens: bot.maxTokens,
  });

  // La llamada a la IA toma varios segundos — revalida justo antes de enviar
  // que nada haya cambiado en el chat desde que se leyó lastInbound (ni un
  // mensaje nuevo del lead, ni una respuesta que ya haya mandado otro admin o
  // esta misma request con un chatId duplicado). Cierra la ventana de doble
  // envío sin necesitar un lock distribuido.
  const newerMessage = await prisma.wAMessage.count({
    where: { chatId: chat.id, timestamp: { gt: lastInbound.timestamp } },
  });
  if (newerMessage > 0) {
    throw new Error("El chat cambió mientras se generaba la respuesta — no se envió nada");
  }

  // Respeta bot.humanizeEnabled igual que bot-worker.ts — antes esto siempre
  // enviaba en un solo mensaje síncrono aunque el bot elegido tuviera
  // humanización activada.
  if (bot.humanizeEnabled) {
    const chunks = splitReply(result.content);
    if (chunks.length === 0) {
      throw new Error("La IA devolvió una respuesta vacía");
    }
    let cumulativeDelay = 0;
    for (const chunk of chunks) {
      cumulativeDelay += computeTypingDelay(chunk);
      await botSendQueue.add(
        "send-chunk",
        { accountId: chat.account.id, waChatId: chat.id, remoteJid: chat.remoteJid, chunk },
        { delay: cumulativeDelay }
      );
    }
  } else {
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
  }

  if (bot.memoryType === "SUMMARY") {
    await prisma.wABotConversation.update({
      where: { id: conversation.id },
      data: {
        summary: summarizeText(`Cliente: ${userText}\nAsistente: ${result.content}`, conversation.summary),
      },
    });
  }

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  const cost = result.usage ? await estimateCost(bot.model, promptTokens, completionTokens) : 0;

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
