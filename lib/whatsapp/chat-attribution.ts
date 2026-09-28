import { prisma } from "@/lib/prisma";

// "De qué campaña o automatización salió este chat" — se deriva del WAMessage
// saliente más reciente que tenga campaignId (campaña masiva) o
// leadSheetSourceId (automatización vía Google Sheets). Nunca ambos a la vez.
// Compartido por el badge de campaña del chat list, el export de "Leads
// calificados" y la sincronización a Google Sheets, para que los tres
// consumidores calculen "la" campaña de un chat de la misma forma.

export const CHAT_ATTRIBUTION_MESSAGE_QUERY = {
  where: { OR: [{ campaignId: { not: null } }, { leadSheetSourceId: { not: null } }] },
  orderBy: { timestamp: "desc" as const },
  take: 1,
  select: {
    campaign: { select: { id: true, name: true } },
    leadSheetSource: { select: { id: true, name: true } },
  },
};

export interface ChatAttribution {
  id: string;
  name: string;
  origin: "manual" | "automatizacion";
}

interface AttributionMessage {
  campaign: { id: string; name: string } | null;
  leadSheetSource: { id: string; name: string } | null;
}

export function resolveChatAttribution(messages: AttributionMessage[]): ChatAttribution | null {
  const m = messages[0];
  if (!m) return null;
  if (m.campaign) return { id: m.campaign.id, name: m.campaign.name, origin: "manual" };
  if (m.leadSheetSource) return { id: m.leadSheetSource.id, name: m.leadSheetSource.name, origin: "automatizacion" };
  return null;
}

// Máximo de chatIds por lote — muy por debajo del límite de parámetros de
// Postgres (65535) incluso sumando el resto de la query. No hay una razón
// de performance para acercarse más: cada lote es una query aparte y barata.
const ATTRIBUTION_BATCH_SIZE = 2000;

// Igual criterio que CHAT_ATTRIBUTION_MESSAGE_QUERY (mensaje saliente más
// reciente con campaignId o leadSheetSourceId), pero como QUERY DE NIVEL
// SUPERIOR contra WAMessage en vez de un `select.messages` anidado dentro de
// un findMany de WAChat/WALeadScore. Ese patrón anidado + los filtros de
// negación (`not: null`) le impiden a Prisma partir automáticamente la
// sub-query batched por chatId cuando el padre devuelve muchas filas —
// revienta con "Query parameter limit exceeded ... negation filters used
// prevent the query from being split" apenas el dataset crece (visto en
// buildChatRows con decenas de miles de chats). Este helper hace el batching
// A MANO en lotes de ATTRIBUTION_BATCH_SIZE, así que nunca dispara ese
// camino frágil de Prisma sin importar cuántos chats se pidan. `distinct:
// ["chatId"]` + orderBy compuesto es el patrón estándar de Prisma para
// "1 fila más reciente por grupo" sin sub-queries.
export async function fetchChatAttributions(chatIds: string[]): Promise<Map<string, ChatAttribution | null>> {
  const result = new Map<string, ChatAttribution | null>();
  const uniqueIds = Array.from(new Set(chatIds));

  for (let i = 0; i < uniqueIds.length; i += ATTRIBUTION_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + ATTRIBUTION_BATCH_SIZE);
    const rows = await prisma.wAMessage.findMany({
      where: {
        chatId: { in: batch },
        OR: [{ campaignId: { not: null } }, { leadSheetSourceId: { not: null } }],
      },
      orderBy: [{ chatId: "asc" }, { timestamp: "desc" }],
      distinct: ["chatId"],
      select: {
        chatId: true,
        campaign: { select: { id: true, name: true } },
        leadSheetSource: { select: { id: true, name: true } },
      },
    });
    for (const r of rows) {
      result.set(r.chatId, resolveChatAttribution([r]));
    }
  }

  return result;
}

// "Última respuesta del prospecto" — a diferencia de WAChat.lastMessageAt
// (cualquier mensaje, incluidos los que enviamos nosotros), esto es el
// timestamp del último WAMessage con direction INBOUND. Mismo patrón de
// batching que fetchChatAttributions de arriba (distinct chatId + orderBy
// compuesto, en vez de N findFirst por chat) y por la misma razón: usado
// sobre datasets que pueden crecer a miles de chats (export de Leads
// calificados / sync a Sheets).
export async function fetchLastInboundMessages(chatIds: string[]): Promise<Map<string, Date | null>> {
  const result = new Map<string, Date | null>();
  const uniqueIds = Array.from(new Set(chatIds));

  for (let i = 0; i < uniqueIds.length; i += ATTRIBUTION_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + ATTRIBUTION_BATCH_SIZE);
    const rows = await prisma.wAMessage.findMany({
      where: { chatId: { in: batch }, direction: "INBOUND" },
      orderBy: [{ chatId: "asc" }, { timestamp: "desc" }],
      distinct: ["chatId"],
      select: { chatId: true, timestamp: true },
    });
    for (const r of rows) {
      result.set(r.chatId, r.timestamp);
    }
  }

  return result;
}
