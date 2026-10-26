import { prisma } from "@/lib/prisma";

// Meta avisa del opt-out DE MARKETING en el detalle del error de envío, no con
// un evento aparte: "Unable to deliver the message. This recipient has chosen
// to stop receiving marketing messages on WhatsApp from your business".
// Antes solo se guardaba el error en el destinatario, así que el contacto
// seguía marcado como apto para futuras campañas (optedOutMarketing = false) y
// se le volvía a escribir. Este patrón distingue ese caso del resto de fallos
// (p. ej. "part of an experiment", que no es una baja).
const OPT_OUT_PATTERN = /chosen to stop receiving|has opted out|stop receiving marketing/i;

export function isMarketingOptOut(detail: string | null | undefined): boolean {
  return Boolean(detail && OPT_OUT_PATTERN.test(detail));
}

// Marca la baja por teléfono + cuenta; el `recipient_id` del webhook es el
// número del destinatario, no hace falta resolver el wamid.
export async function markContactOptedOut(accountId: string, phone: string | undefined): Promise<void> {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return;

  await prisma.contact.updateMany({
    where: { accountId, remoteJid: digits, optedOutMarketing: false },
    data: { optedOutMarketing: true, optedOutAt: new Date() },
  });
}
