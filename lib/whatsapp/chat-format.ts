// Compartido entre chat-workspace.tsx (bandeja autenticada) y
// public-chat-view.tsx (link público /c/[token]) — antes cada uno tenía su
// propia copia de estas funciones. timeZone explícito (CDMX) en ambas: sin
// esto, public-chat-view.tsx se renderiza en el servidor y luego se hidrata
// en el navegador, y si difieren (servidor en UTC, navegador en otra zona)
// React tira un hydration mismatch — mismo problema que ya se había
// resuelto puntualmente en la Auditoría del asistente IA.
import { formatTime, formatDate, dateKeyInTz, startOfDayInTz } from "@/lib/timezone";

// Los bubbles siempre muestran hora de reloj (a diferencia del preview de la
// barra lateral, que muestra fecha para chats viejos) — el day divider ya
// lleva la fecha, así que un mensaje de la semana pasada no pierde su hora.
export function formatBubbleTime(ts: string): string {
  return formatTime(ts);
}

// Clave de agrupación por día — "a qué día de calendario en CDMX pertenece
// este mensaje", usada para decidir cuándo insertar un divisor entre dos
// mensajes consecutivos. Comparar con Date#toDateString()/startOfDay directo
// agrupa por el día del navegador/servidor, no el de CDMX.
export function chatDayKey(ts: string): string {
  return dateKeyInTz(new Date(ts));
}

export function formatDayDivider(ts: string): string {
  const now = new Date();
  const d = new Date(ts);
  const diffDays = Math.round((startOfDayInTz(now).getTime() - startOfDayInTz(d).getTime()) / 86400000);
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  const sameYear = dateKeyInTz(d).slice(0, 4) === dateKeyInTz(now).slice(0, 4);
  return formatDate(d, { day: "2-digit", month: "long", year: sameYear ? undefined : "numeric" });
}
