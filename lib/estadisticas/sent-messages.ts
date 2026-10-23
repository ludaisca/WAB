import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface SentMessagesCampaignBreakdownRow {
  campaignId: string | null;
  campaignName: string;
  count: number;
}

export interface SentMessagesStats {
  messagesSent: number;
  conversations: number;
  campaignBreakdown: SentMessagesCampaignBreakdownRow[];
}

function sentMessagesWhere(accountIds: string[], range?: { gte: Date; lt: Date } | null, visibility?: Prisma.WAChatWhereInput | null) {
  return {
    chat: { accountId: { in: accountIds }, ...(visibility ? { AND: [visibility] } : {}) },
    direction: "OUTBOUND" as const,
    ...(range ? { createdAt: { gte: range.gte, lt: range.lt } } : {}),
  };
}

// Desglose de a qué WACampaign pertenece cada mensaje saliente del rango —
// mismo `where` que getSentMessagesStats, así que la suma de `count` siempre
// coincide exactamente con `messagesSent`. `campaignId: null` (la mayoría:
// respuestas de bot, manuales, etc. nunca llevan campaña) se agrupa bajo
// "Sin campaña" en vez de descartarse, para que el desglose sea reconciliable
// con el total mostrado en la card.
async function getSentMessagesCampaignBreakdown(
  accountIds: string[],
  range?: { gte: Date; lt: Date } | null,
  visibility?: Prisma.WAChatWhereInput | null
): Promise<SentMessagesCampaignBreakdownRow[]> {
  const where = sentMessagesWhere(accountIds, range, visibility);
  const groups = await prisma.wAMessage.groupBy({
    by: ["campaignId"],
    where,
    _count: { _all: true },
  });

  const campaignIds = groups
    .map((g) => g.campaignId)
    .filter((id): id is string => id !== null);
  const campaigns = campaignIds.length
    ? await prisma.wACampaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

  return groups
    .map((g) => ({
      campaignId: g.campaignId,
      campaignName: g.campaignId ? nameById.get(g.campaignId) ?? "Campaña eliminada" : "Sin campaña",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

// Conteo acotable por cuenta + rango de fechas para la card "Mensajes
// enviados" del Panel — mismo criterio de fetchMessageCounts()
// (lib/reports/queries/messages.ts): agregación exacta en DB, nunca hidrata
// filas, así que es igual de barato con miles de mensajes que con millones.
// `conversations` es el número de chats distintos con al menos un mensaje
// saliente en el rango (no el total de chats de la cuenta).
export async function getSentMessagesStats(
  accountIds: string[],
  range?: { gte: Date; lt: Date } | null,
  visibility?: Prisma.WAChatWhereInput | null
): Promise<SentMessagesStats> {
  const where = sentMessagesWhere(accountIds, range, visibility);

  const [messagesSent, distinctChats, campaignBreakdown] = await Promise.all([
    prisma.wAMessage.count({ where }),
    prisma.wAMessage.groupBy({ by: ["chatId"], where }),
    getSentMessagesCampaignBreakdown(accountIds, range, visibility),
  ]);

  return { messagesSent, conversations: distinctChats.length, campaignBreakdown };
}
