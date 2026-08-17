import { prisma } from "@/lib/prisma";

export interface ContactMatch {
  contactId: string;
  chatId: string | null;
  accountId: string;
}

// Cruce ExternalProspect → Contact/WAChat por teléfono. Extraído de
// app/api/crm-ejecutivos/prospects/route.ts para poder reusarse también
// desde lib/crm-ejecutivos/score-correlation.ts sin duplicar la consulta.
//
// `endsWith` no usa índice (Contact.remoteJid no tiene uno para esto) pero
// el volumen de phoneKeys que se le pasa siempre está acotado por el
// llamador (página actual, o el total de ExternalProspect que es de
// cientos, no de decenas de miles como WAChat) — mismo criterio de
// "acotado por resultado, no por tabla completa" que el resto de rutas
// interactivas de este repo (ver el gotcha de fetchMessagesInRange en
// CLAUDE.md).
export async function matchContactsByPhoneKeys(phoneKeys: string[]): Promise<Map<string, ContactMatch>> {
  if (phoneKeys.length === 0) return new Map();

  const contacts = await prisma.contact.findMany({
    where: { OR: phoneKeys.map((k) => ({ remoteJid: { endsWith: k } })) },
    select: { id: true, remoteJid: true, accountId: true, chat: { select: { id: true } } },
  });

  const map = new Map<string, ContactMatch>();
  for (const c of contacts) {
    const digits = c.remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
    const key = digits.slice(-10);
    // Si dos contactos distintos comparten los últimos 10 dígitos (muy
    // improbable, pero posible entre cuentas), se queda el primero visto —
    // no hay forma de desambiguar mejor sin el código de país exacto.
    if (!map.has(key)) map.set(key, { contactId: c.id, chatId: c.chat?.id ?? null, accountId: c.accountId });
  }
  return map;
}
