import { prisma } from "@/lib/prisma";

export interface ContactMatchEntry {
  contactId: string;
  chatId: string | null;
  accountId: string;
  accountName: string;
  lastMessageAt: Date | null;
}

export interface ContactMatch {
  // Coincidencia de referencia — la de actividad más reciente
  // (WAChat.lastMessageAt) entre todas las que comparten los mismos últimos
  // 10 dígitos. Es lo que usan por default el link "Ver chat" y la
  // comparación de Precisión IA (que necesita una única clasificación por
  // prospecto). Si ninguna coincidencia tiene chat con mensajes, es
  // simplemente la primera vista — ninguna es "más reciente" que otra.
  primary: ContactMatchEntry;
  // TODAS las coincidencias encontradas (primary incluido), ordenadas por
  // actividad más reciente primero — para que la UI pueda mostrar "este
  // teléfono también aparece en estas otras cuentas" en vez de esconder la
  // ambigüedad detrás de una elección silenciosa.
  all: ContactMatchEntry[];
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
//
// Un mismo número puede tener Contact en más de una WAAccount (le escribió a
// más de una marca/número del negocio) — nada raro en un negocio
// multi-cuenta como este: confirmado contra datos reales, ~1 de cada 3
// phoneKeys con match cae en este caso, no es el edge case improbable que
// una versión anterior de este archivo asumía. En vez de quedarse con "el
// primero que ve" la consulta (que ni siquiera era una elección estable sin
// ORDER BY), se listan TODAS las coincidencias y se marca `primary` la de
// actividad más reciente.
export async function matchContactsByPhoneKeys(phoneKeys: string[]): Promise<Map<string, ContactMatch>> {
  if (phoneKeys.length === 0) return new Map();

  const contacts = await prisma.contact.findMany({
    where: { OR: phoneKeys.map((k) => ({ remoteJid: { endsWith: k } })) },
    select: {
      id: true,
      remoteJid: true,
      accountId: true,
      account: { select: { name: true } },
      chat: { select: { id: true, lastMessageAt: true } },
    },
  });

  const grouped = new Map<string, ContactMatchEntry[]>();
  for (const c of contacts) {
    const digits = c.remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
    const key = digits.slice(-10);
    const entry: ContactMatchEntry = {
      contactId: c.id,
      chatId: c.chat?.id ?? null,
      accountId: c.accountId,
      accountName: c.account.name,
      lastMessageAt: c.chat?.lastMessageAt ?? null,
    };
    const list = grouped.get(key);
    if (list) list.push(entry);
    else grouped.set(key, [entry]);
  }

  const map = new Map<string, ContactMatch>();
  for (const [key, entries] of grouped) {
    const sorted = [...entries].sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return 0;
    });
    map.set(key, { primary: sorted[0], all: sorted });
  }
  return map;
}
