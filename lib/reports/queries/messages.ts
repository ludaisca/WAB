import { prisma } from "@/lib/prisma";
import { dateKeyInTz } from "@/lib/timezone";

export interface RawMessageRow {
  createdAt: Date;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
}

export async function fetchMessagesInRange(accountIds: string[], gte: Date, lt: Date): Promise<RawMessageRow[]> {
  return prisma.wAMessage.findMany({
    where: { chat: { accountId: { in: accountIds } }, createdAt: { gte, lt } },
    select: { createdAt: true, direction: true, messageType: true },
  });
}

export interface DailyMessageRow {
  date: string;
  inbound: number;
  outbound: number;
  total: number;
}

export interface MessageCounts {
  total: number;
  inbound: number;
  outbound: number;
}

// Conteo EXACTO agregado en DB (groupBy, nunca hidrata una fila) — usado por
// el KPI del dashboard EN VIVO (GET /api/reportes/dashboard). A diferencia de
// fetchMessagesInRange (trae cada fila, pensado para el job de background que
// arma "Mensajes por tipo" en el .xlsx, sin presión de latencia de request),
// esto es igual de barato con 100 mensajes en el rango que con 100,000.
export async function fetchMessageCounts(accountIds: string[], gte: Date, lt: Date): Promise<MessageCounts> {
  const groups = await prisma.wAMessage.groupBy({
    by: ["direction"],
    where: { chat: { accountId: { in: accountIds } }, createdAt: { gte, lt } },
    _count: { _all: true },
  });
  const inbound = groups.find((g) => g.direction === "INBOUND")?._count._all ?? 0;
  const outbound = groups.find((g) => g.direction === "OUTBOUND")?._count._all ?? 0;
  return { total: inbound + outbound, inbound, outbound };
}

// Tope de la muestra para la gráfica de tendencia del dashboard en vivo —
// mismo criterio que get-stats.ts:dailyMessages (take:5000, más reciente
// primero: la gráfica es direccional, no necesita cada fila exacta). Esto es
// justo lo que fetchMessagesInRange NO tenía pese a alimentar también esta
// misma ruta interactiva — con una cuenta de decenas de miles de mensajes,
// hidratar cada fila en Prisma tomaba 10-20s por request y hacía parecer que
// el dashboard "no actualizaba".
const TREND_SAMPLE_LIMIT = 5000;

export interface DailyMessageTrendResult {
  rows: DailyMessageRow[];
  // true cuando el rango elegido tiene más de TREND_SAMPLE_LIMIT mensajes: la
  // muestra (más reciente primero) se agota antes de cubrir el rango
  // completo, así que la gráfica solo alcanza a mostrar los últimos días con
  // volumen alto aunque el rango pedido sea mucho más amplio. El consumidor
  // (dashboard.ts/_dashboard.tsx) usa esto para avisarlo en vez de dejar la
  // gráfica con pinta de "congelada" sin explicación.
  truncated: boolean;
}

export async function fetchDailyMessageTrend(accountIds: string[], gte: Date, lt: Date): Promise<DailyMessageTrendResult> {
  const rows = await prisma.wAMessage.findMany({
    where: { chat: { accountId: { in: accountIds } }, createdAt: { gte, lt } },
    select: { createdAt: true, direction: true },
    orderBy: { createdAt: "desc" },
    take: TREND_SAMPLE_LIMIT,
  });
  return { rows: bucketDailyMessages(rows), truncated: rows.length === TREND_SAMPLE_LIMIT };
}

// Mismo bucketing por dateKeyInTz() (CDMX) que get-stats.ts:dailyMessages.
// Solo necesita createdAt/direction — RawMessageRow[] (con messageType) sigue
// siendo asignable, así que fetchMessagesInRange (el consumidor de background)
// no necesita cambiar.
export function bucketDailyMessages(rows: Array<Pick<RawMessageRow, "createdAt" | "direction">>): DailyMessageRow[] {
  const map = new Map<string, { inbound: number; outbound: number }>();
  for (const m of rows) {
    const date = dateKeyInTz(m.createdAt);
    const entry = map.get(date) ?? { inbound: 0, outbound: 0 };
    if (m.direction === "INBOUND") entry.inbound++;
    else entry.outbound++;
    map.set(date, entry);
  }
  return Array.from(map.entries())
    .map(([date, { inbound, outbound }]) => ({ date, inbound, outbound, total: inbound + outbound }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  text: "Texto",
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
};

export interface MessageTypeRow {
  type: string;
  inbound: number;
  outbound: number;
  total: number;
}

export function bucketMessageTypes(rows: RawMessageRow[]): MessageTypeRow[] {
  const map = new Map<string, { inbound: number; outbound: number }>();
  for (const m of rows) {
    const entry = map.get(m.messageType) ?? { inbound: 0, outbound: 0 };
    if (m.direction === "INBOUND") entry.inbound++;
    else entry.outbound++;
    map.set(m.messageType, entry);
  }
  return Array.from(map.entries())
    .map(([type, { inbound, outbound }]) => ({
      type: MESSAGE_TYPE_LABEL[type] ?? type,
      inbound,
      outbound,
      total: inbound + outbound,
    }))
    .sort((a, b) => b.total - a.total);
}
