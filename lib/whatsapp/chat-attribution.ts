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
