import { zonedDateTimeToUtc } from "@/lib/timezone";

// Gotcha: lib/google/dataset-queries.ts:dateRange() (usado por los 4 builders
// reutilizados de esa función) interpreta el string de fecha como medianoche
// UTC (`new Date(dateFrom)` / `new Date(\`${dateTo}T23:59:59.999Z\`)`), no
// CDMX — un desfase de 6h contra lo que el admin realmente eligió. Por eso el
// reporte NO le pasa dateFrom/dateTo a esos builders (trae todo el scope) y en
// su lugar recorta en JS con inRange() contra este rango, calculado con
// zonedDateTimeToUtc (lib/timezone.ts) para que sí respete CDMX.

// dateTo es EXCLUSIVO: medianoche CDMX del día siguiente al último día
// elegido — evita el error de "23:59:59Z" que en CDMX es ~18:00, no medianoche.
export function reportRangeToUtc(dateFrom: string, dateTo: string): { gte: Date; lt: Date } {
  const [y, m, d] = dateTo.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return {
    gte: zonedDateTimeToUtc(dateFrom, "00:00"),
    lt: zonedDateTimeToUtc(nextDay, "00:00"),
  };
}

// Filas con fecha null (ej. WACampaignRecipient de origen "automatizacion"
// con status "skipped" → sentAt null) se excluyen — no hay forma de saber si
// caen dentro del rango.
export function inRange(isoDate: string | null, gte: Date, lt: Date): boolean {
  if (!isoDate) return false;
  const t = new Date(isoDate).getTime();
  return t >= gte.getTime() && t < lt.getTime();
}

// Además del recorte preciso de arriba, acotamos también la QUERY en DB de los
// 4 builders reutilizados de dataset-queries.ts pasándoles un dateFrom/dateTo
// con 1 día de margen a cada lado (su propio dateRange() interno hace
// `new Date(str)` en UTC — el margen cubre de sobra cualquier desfase de zona
// horaria). Sin este acotado, un reporte sin filtro de fecha le pide a
// buildChatRows/buildLeadScoreRows TODO el historial de todas las cuentas —
// con una cuenta longeva y muchos chats esto dispara un segundo error real y
// distinto: el `include` de esos builders trae CHAT_ATTRIBUTION_MESSAGE_QUERY
// (select anidado por chat con filtros de negación `not: null`), y Prisma
// arma esa relación con un `chatId IN (...)` de TODOS los chats devueltos —
// con miles de chats sin acotar, ese IN excede el límite de parámetros de
// Postgres, y la presencia de filtros de negación le impide a Prisma partir
// la query en lotes automáticamente ("Query parameter limit exceeded ... the
// negation filters used prevent the query from being split"). Acotar por
// fecha reduce cuántos chats matchea la query padre, y por lo tanto cuántos
// chatId entran en esa relación — el recorte preciso vía inRange() sigue
// siendo la fuente de verdad del rango exacto, esto solo evita traer de más.
export function widenedDateStrings(gte: Date, lt: Date): { dateFrom: string; dateTo: string } {
  const DAY_MS = 86_400_000;
  return {
    dateFrom: new Date(gte.getTime() - DAY_MS).toISOString().slice(0, 10),
    dateTo: new Date(lt.getTime() + DAY_MS).toISOString().slice(0, 10),
  };
}
