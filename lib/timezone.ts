// El servidor corre en UTC (los contenedores no tienen TZ configurado), pero
// todo el negocio (horario de atención, cortes de mes de presupuesto, envíos
// programados, lo que ve el usuario) es CDMX. Estos helpers convierten entre
// un instante UTC (el único tipo de Date que existe internamente) y la hora
// de pared en America/Mexico_City, sin depender de una librería de fechas.
// No usar métodos locales de Date (getHours/getMonth/toLocaleString sin
// timeZone) para nada que el usuario vea o que dependa del "día"/"mes" — esos
// métodos usan la zona del proceso (UTC en el servidor) o la del navegador,
// nunca CDMX de forma confiable. Seguro de usar tanto en Server Components,
// Client Components y workers — no depende de `fs` ni de nada server-only.
export const MEXICO_CITY_TZ = "America/Mexico_City";

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const asUTC = Date.UTC(
    Number(get("year")), Number(get("month")) - 1, Number(get("day")),
    Number(get("hour")) % 24, Number(get("minute")), Number(get("second"))
  );
  return (asUTC - date.getTime()) / 60000;
}

/** "YYYY-MM-DD" tal como se ve ese instante en timeZone. */
export function dateKeyInTz(date: Date, timeZone: string = MEXICO_CITY_TZ): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

/** Hora de reloj de pared (0-23) en timeZone para ese instante. */
export function localHourInTz(date: Date, timeZone: string = MEXICO_CITY_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
}

/** Instante UTC que corresponde a la medianoche de year/month/day vistos en timeZone. */
function utcInstantForLocalMidnight(year: number, month: number, day: number, timeZone: string = MEXICO_CITY_TZ): Date {
  const naiveUTCMidnight = new Date(Date.UTC(year, month - 1, day));
  return new Date(naiveUTCMidnight.getTime() - tzOffsetMinutes(naiveUTCMidnight, timeZone) * 60000);
}

/** Instante UTC de la medianoche (en timeZone) del día que contiene `date`. */
export function startOfDayInTz(date: Date, timeZone: string = MEXICO_CITY_TZ): Date {
  const [y, m, d] = dateKeyInTz(date, timeZone).split("-").map(Number);
  return utcInstantForLocalMidnight(y, m, d, timeZone);
}

/** Instante UTC del día 1 a medianoche (en timeZone) del mes que contiene `date`. */
export function startOfMonthInTz(date: Date, timeZone: string = MEXICO_CITY_TZ): Date {
  const [y, m] = dateKeyInTz(date, timeZone).split("-").map(Number);
  return utcInstantForLocalMidnight(y, m, 1, timeZone);
}

/** "YYYY-MM" (clave de mes) tal como se ve ese instante en timeZone. */
export function monthKeyInTz(date: Date, timeZone: string = MEXICO_CITY_TZ): string {
  return dateKeyInTz(date, timeZone).slice(0, 7);
}

/**
 * Convierte una fecha+hora elegidas como reloj de pared en timeZone
 * ("YYYY-MM-DD", "HH:mm") al instante UTC correspondiente — para capturar
 * "el admin eligió las 3:00pm hora CDMX" sin importar en qué zona corre el
 * navegador o el servidor. Usar para cualquier programación (campañas, etc.)
 * donde el usuario elige fecha Y hora, no solo fecha.
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string = MEXICO_CITY_TZ): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const naiveUTC = new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0));
  return new Date(naiveUTC.getTime() - tzOffsetMinutes(naiveUTC, timeZone) * 60000);
}

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
const DEFAULT_TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const DEFAULT_DATETIME_OPTS: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

/** Formatea solo la fecha (es-MX), explícitamente en timeZone (CDMX por default). */
export function formatDate(value: Date | string, opts: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS, timeZone: string = MEXICO_CITY_TZ): string {
  return toDate(value).toLocaleDateString("es-MX", { ...opts, timeZone });
}

/** Formatea solo la hora (es-MX), explícitamente en timeZone (CDMX por default). */
export function formatTime(value: Date | string, opts: Intl.DateTimeFormatOptions = DEFAULT_TIME_OPTS, timeZone: string = MEXICO_CITY_TZ): string {
  return toDate(value).toLocaleTimeString("es-MX", { ...opts, timeZone });
}

/** Formatea fecha+hora (es-MX), explícitamente en timeZone (CDMX por default). */
export function formatDateTime(value: Date | string, opts: Intl.DateTimeFormatOptions = DEFAULT_DATETIME_OPTS, timeZone: string = MEXICO_CITY_TZ): string {
  return toDate(value).toLocaleString("es-MX", { ...opts, timeZone });
}
