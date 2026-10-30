// Definiciones de columnas exportables, compartidas entre el export CSV en el
// cliente (whatsapp/calificadores/page.tsx) y la sincronización server-side a
// Google Sheets (lib/google/sheets-sync.ts) — separan "qué campo mostrar" de
// "cómo se entrega" para no duplicar la lista de columnas en dos lugares.

import { formatLeadId } from "./lead-id";
// formatDate del módulo de timezone se importa con alias: abajo hay un helper
// local del mismo nombre que formatea una fecha ya con el formato por default.
import { formatDate as formatDateInTz, formatDateTime, formatTime, wallClockInTz } from "@/lib/timezone";

export interface ExportColumnDef<T> {
  key: string;
  label: string;
  // Valor de texto: CSV del navegador, XLSX de reportes y vista previa.
  get: (row: T) => string;
  // Solo lo usa la sync a Google Sheets: cuando existe, la celda se escribe con
  // este número (serial de fecha / fracción de día) en vez del texto de get(),
  // y la columna recibe `sheetFormat` para que Sheets la muestre como fecha u
  // hora real — ordenable, filtrable y con aritmética de fechas — sin pasar por
  // USER_ENTERED, que interpretaría como fórmula cualquier texto del export.
  getSheetValue?: (row: T) => number | null;
  sheetFormat?: { type: "DATE" | "TIME"; pattern: string };
}

// Convención de nombre de campaña/automatización: segmentos separados por "_"
// (ej. "clientes_general_sonoport_210726") — el primer segmento identifica el
// tipo de campaña. También tolera "-" o espacio por si algún nombre no sigue
// el guion bajo al pie de la letra. Sin delimitador, regresa el nombre completo.
export function campaignFirstWord(name: string): string {
  const match = name.match(/^([^_\-\s]+)/);
  return match ? match[1] : name;
}

export interface ScoreDetails {
  tipo_lead: string | null;
  necesidad_principal: string | null;
  contexto_negocio: string | null;
  senales_compra: string[];
  objeciones_dudas: string[];
  nivel_interaccion: string | null;
  tono_interes: string | null;
  proximos_pasos: string[];
  nombre_real: string | null;
  producto_interes: string | null;
  urgencia: string | null;
  presupuesto: string | null;
}

export interface LeadScoreRow {
  id: string;
  score: number;
  // Untyped at the source — scores from before the 5-phase relabel may still
  // carry an old frio/tibio/caliente value.
  label: string;
  summary: string;
  reasons: string;
  details: ScoreDetails | null;
  updatedAt: string;
  scorer: { id: string; name: string };
  // De qué campaña masiva o automatización de leads salió el chat, si alguna
  // — ver lib/whatsapp/chat-attribution.ts. Null si el chat nunca recibió un
  // mensaje saliente atribuido a ninguna de las dos.
  campaign: { id: string; name: string; origin: "manual" | "automatizacion" } | null;
  chat: {
    id: string;
    name: string | null;
    remoteJid: string;
    status: string;
    accountId: string;
    account: { id: string; name: string; origen: string | null; leadIdPrefix: string | null };
    // Nombre aprendido por el calificador durante la conversación — distinto
    // del nombre de envío (chat.name), que viene del CSV/hoja de origen.
    // leadNumber ya viene convertido a string (BigInt no es JSON-serializable),
    // ver dataset-queries.ts / lead-scores/route.ts.
    contact: { realName: string | null; leadNumber: string } | null;
    // URL absoluta a /c/[token] (vista pública de solo lectura del chat, sin
    // login) — resuelta por el caller (API route / dataset-queries.ts) vía
    // ensurePublicChatTokensForChats() ANTES de construir la fila, porque
    // generar el token es una escritura async y esta interfaz debe quedar
    // serializable/pura para el `get` síncrono de abajo.
    publicLink: string;
    // Timestamp del último WAMessage INBOUND de este chat (null si el
    // prospecto nunca escribió) — distinto de `updatedAt` de arriba, que es
    // WALeadScore.updatedAt (última vez que se calificó/recalificó, sin
    // importar quién mandó el último mensaje). Ver fetchLastInboundMessages()
    // en lib/whatsapp/chat-attribution.ts.
    lastInboundAt: string | null;
  };
}

export const LABEL_TEXT: Record<string, string> = {
  descartado: "Descartado",
  frio: "Frío",
  interesado: "Interesado",
  oportunidad: "Oportunidad",
  prioridad_alta: "Prioridad alta",
  tibio: "Tibio",
  caliente: "Caliente",
};

export function labelText(label: string) {
  return LABEL_TEXT[label] ?? label;
}

// Antes vivía duplicado en calificadores/page.tsx y lead-score-badge.tsx —
// un solo lugar para que el color de cada label de calificación no diverja
// entre las 3 pantallas que lo muestran (esas dos + el panel de contacto).
export const LABEL_TONE: Record<string, "neutral" | "info" | "warning" | "accent" | "danger"> = {
  descartado: "neutral",
  frio: "info",
  interesado: "warning",
  oportunidad: "accent",
  prioridad_alta: "danger",
  // Legacy 3-tier labels, kept until every existing score gets re-run.
  tibio: "warning",
  caliente: "danger",
};

export function labelTone(label: string) {
  return LABEL_TONE[label] ?? "neutral";
}

export function reasonsList(reasons: string): string[] {
  try {
    return JSON.parse(reasons);
  } catch {
    return [];
  }
}

// timeZone explícito (CDMX) — esta columna alimenta tanto el CSV manual
// (navegador) como la sincronización desatendida a Google Sheets
// (lib/google/sheet-export-runner.ts, corre en el worker sin navegador de
// por medio), así que no puede depender de la zona de quien la ejecuta.
function formatDate(value: string): string {
  return formatDateTime(value);
}

// "Última respuesta del prospecto" se exporta partida en dos columnas desde
// 2026-08: antes era una sola ("21/07/26, 8:53 a.m.") y el operador la
// necesita separada para poder ordenar/filtrar por fecha. dd/mm/aa y 24h,
// ambas en CDMX.
function formatLastInboundDate(value: string | null): string {
  return value ? formatDateInTz(value, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
}

function formatLastInboundTime(value: string | null): string {
  // hourCycle h23 explícito: el default de es-MX es 12h ("08:53 a.m.") y esta
  // columna es 24h por spec.
  return value ? formatTime(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
}

// Serial de fecha de Google Sheets: días transcurridos desde 1899-12-30 (epoch
// de la hoja de cálculo). Se calcula sobre la fecha de reloj de pared en CDMX,
// no sobre la medianoche UTC del instante — en CDMX esa medianoche cae el día
// anterior y la fecha se correría un día.
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function sheetsDateSerial(iso: string): number {
  const { year, month, day } = wallClockInTz(new Date(iso));
  return Math.round((Date.UTC(year, month - 1, day) - SHEETS_EPOCH_MS) / MS_PER_DAY);
}

// Fracción del día (0 = 00:00, 0.5 = 12:00) — con formato TIME, Sheets la
// muestra y opera como hora real.
function sheetsTimeFraction(iso: string): number {
  const { hour, minute } = wallClockInTz(new Date(iso));
  return (hour * 60 + minute) / 1440;
}

export const EXPORT_COLUMNS: ExportColumnDef<LeadScoreRow>[] = [
  {
    key: "leadId",
    label: "ID de lead",
    get: (r) => formatLeadId(r.chat.account.leadIdPrefix, r.chat.account.name, r.chat.contact?.leadNumber ?? null),
  },
  { key: "lead", label: "Lead", get: (r) => r.chat.name || r.chat.remoteJid.split("@")[0] },
  { key: "realName", label: "Nombre real", get: (r) => r.chat.contact?.realName ?? "" },
  { key: "phone", label: "Teléfono", get: (r) => r.chat.remoteJid.split("@")[0] },
  { key: "account", label: "Cuenta", get: (r) => r.chat.account.name },
  { key: "accountOrigen", label: "Origen de cuenta", get: (r) => r.chat.account.origen ?? "" },
  { key: "campaign", label: "Campaña", get: (r) => r.campaign?.name ?? "" },
  { key: "campaignType", label: "Tipo", get: (r) => (r.campaign ? campaignFirstWord(r.campaign.name) : "") },
  { key: "origin", label: "Origen", get: (r) => (r.campaign ? CAMPAIGN_ORIGIN_LABEL[r.campaign.origin] : "") },
  { key: "label", label: "Calificación", get: (r) => labelText(r.label) },
  { key: "score", label: "Score", get: (r) => String(r.score) },
  { key: "scorer", label: "Calificador", get: (r) => r.scorer.name },
  { key: "summary", label: "Resumen", get: (r) => r.summary },
  { key: "reasons", label: "Motivos", get: (r) => reasonsList(r.reasons).join(" | ") },
  { key: "producto_interes", label: "Producto de interés", get: (r) => r.details?.producto_interes ?? "" },
  { key: "urgencia", label: "Urgencia", get: (r) => r.details?.urgencia ?? "" },
  { key: "presupuesto", label: "Presupuesto", get: (r) => r.details?.presupuesto ?? "" },
  { key: "necesidad_principal", label: "Necesidad principal", get: (r) => r.details?.necesidad_principal ?? "" },
  { key: "contexto_negocio", label: "Contexto de negocio", get: (r) => r.details?.contexto_negocio ?? "" },
  { key: "senales_compra", label: "Señales de compra", get: (r) => (r.details?.senales_compra ?? []).join(" | ") },
  { key: "objeciones_dudas", label: "Objeciones / dudas", get: (r) => (r.details?.objeciones_dudas ?? []).join(" | ") },
  { key: "proximos_pasos", label: "Próximos pasos", get: (r) => (r.details?.proximos_pasos ?? []).join(" | ") },
  { key: "nombre_real", label: "Nombre real (IA)", get: (r) => r.details?.nombre_real ?? "" },
  { key: "tono_interes", label: "Tono de interés", get: (r) => r.details?.tono_interes ?? "" },
  { key: "nivel_interaccion", label: "Nivel de interacción", get: (r) => r.details?.nivel_interaccion ?? "" },
  { key: "updatedAt", label: "Actualizado", get: (r) => formatDate(r.updatedAt) },
  {
    key: "lastInboundDate",
    label: "Fecha",
    get: (r) => formatLastInboundDate(r.chat.lastInboundAt),
    getSheetValue: (r) => (r.chat.lastInboundAt ? sheetsDateSerial(r.chat.lastInboundAt) : null),
    sheetFormat: { type: "DATE", pattern: "dd/mm/yy" },
  },
  {
    key: "lastInboundTime",
    label: "Hora",
    get: (r) => formatLastInboundTime(r.chat.lastInboundAt),
    getSheetValue: (r) => (r.chat.lastInboundAt ? sheetsTimeFraction(r.chat.lastInboundAt) : null),
    sheetFormat: { type: "TIME", pattern: "hh:mm" },
  },
  { key: "publicLink", label: "Link público del chat", get: (r) => r.chat.publicLink },
];

// Fila unificada de "Resultados de campaña" — cubre tanto envíos de campañas
// masivas (WACampaignRecipient) como los disparados por una fuente de leads
// automática (LeadSheetImportedRow). `origin` es lo que permite distinguirlas
// en una sola pestaña sin depender de convenciones de nombres.
export type CampaignResultOrigin = "manual" | "automatizacion";

export type CampaignResultStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED";

export interface CampaignResultRow {
  origin: CampaignResultOrigin;
  campaignName: string;
  templateName: string;
  accountOrigen: string | null;
  phoneNumber: string;
  contactName: string | null;
  status: CampaignResultStatus;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export const CAMPAIGN_ORIGIN_LABEL: Record<CampaignResultOrigin, string> = {
  manual: "Campaña masiva",
  automatizacion: "Automatización",
};

export const CAMPAIGN_RESULT_STATUS_LABEL: Record<CampaignResultStatus, string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Fallido",
  SKIPPED: "Omitido",
};

function formatDateOrEmpty(value: string | null): string {
  return value ? formatDate(value) : "";
}

export const CAMPAIGN_EXPORT_COLUMNS: ExportColumnDef<CampaignResultRow>[] = [
  { key: "origin", label: "Origen", get: (r) => CAMPAIGN_ORIGIN_LABEL[r.origin] },
  { key: "accountOrigen", label: "Origen de cuenta", get: (r) => r.accountOrigen ?? "" },
  { key: "campaign", label: "Campaña", get: (r) => r.campaignName },
  { key: "campaignType", label: "Tipo", get: (r) => campaignFirstWord(r.campaignName) },
  { key: "template", label: "Plantilla", get: (r) => r.templateName },
  { key: "phone", label: "Teléfono", get: (r) => r.phoneNumber },
  { key: "contact", label: "Contacto", get: (r) => r.contactName ?? "" },
  { key: "status", label: "Estado", get: (r) => CAMPAIGN_RESULT_STATUS_LABEL[r.status] },
  { key: "error", label: "Error", get: (r) => r.errorMessage ?? "" },
  { key: "sentAt", label: "Enviado", get: (r) => formatDateOrEmpty(r.sentAt) },
  { key: "deliveredAt", label: "Entregado", get: (r) => formatDateOrEmpty(r.deliveredAt) },
  { key: "readAt", label: "Leído", get: (r) => formatDateOrEmpty(r.readAt) },
];

// Datasets nuevos de la exportación configurable a Sheets (ver SheetExport en
// prisma/schema.prisma) — mismo contrato ExportColumnDef que los 2 de arriba.

export const CHAT_STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierto",
  PENDING: "Pendiente",
  RESOLVED: "Resuelto",
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Calificado",
  CUSTOMER: "Cliente",
  LOST: "Perdido",
};

export interface ChatExportRow {
  id: string;
  name: string | null;
  remoteJid: string;
  status: string;
  createdAt: string;
  lastMessageAt: string | null;
  account: { id: string; name: string; origen: string | null };
  assignedTo: { name: string | null } | null;
  contact: { realName: string | null } | null;
  tags: string[];
  campaign: { id: string; name: string; origin: "manual" | "automatizacion" } | null;
}

export const CHATS_EXPORT_COLUMNS: ExportColumnDef<ChatExportRow>[] = [
  { key: "lead", label: "Lead", get: (r) => r.name || r.remoteJid.split("@")[0] },
  { key: "realName", label: "Nombre real", get: (r) => r.contact?.realName ?? "" },
  { key: "phone", label: "Teléfono", get: (r) => r.remoteJid.split("@")[0] },
  { key: "account", label: "Cuenta", get: (r) => r.account.name },
  { key: "accountOrigen", label: "Origen de cuenta", get: (r) => r.account.origen ?? "" },
  { key: "status", label: "Estado", get: (r) => CHAT_STATUS_LABEL[r.status] ?? r.status },
  { key: "assignedTo", label: "Asignado a", get: (r) => r.assignedTo?.name ?? "" },
  { key: "tags", label: "Etiquetas", get: (r) => r.tags.join(" | ") },
  { key: "campaign", label: "Campaña", get: (r) => r.campaign?.name ?? "" },
  { key: "campaignType", label: "Tipo", get: (r) => (r.campaign ? campaignFirstWord(r.campaign.name) : "") },
  { key: "origin", label: "Origen", get: (r) => (r.campaign ? CAMPAIGN_ORIGIN_LABEL[r.campaign.origin] : "") },
  { key: "createdAt", label: "Registrado", get: (r) => formatDate(r.createdAt) },
  { key: "lastMessageAt", label: "Último mensaje", get: (r) => formatDateOrEmpty(r.lastMessageAt) },
];

export interface ContactExportRow {
  id: string;
  name: string | null;
  realName: string | null;
  remoteJid: string;
  leadStatus: string;
  optedOutMarketing: boolean;
  createdAt: string;
  account: { id: string; name: string; origen: string | null };
  tags: string[];
}

export const CONTACTS_EXPORT_COLUMNS: ExportColumnDef<ContactExportRow>[] = [
  { key: "name", label: "Nombre", get: (r) => r.name ?? "" },
  { key: "realName", label: "Nombre real", get: (r) => r.realName ?? "" },
  { key: "phone", label: "Teléfono", get: (r) => r.remoteJid.split("@")[0] },
  { key: "account", label: "Cuenta", get: (r) => r.account.name },
  { key: "accountOrigen", label: "Origen de cuenta", get: (r) => r.account.origen ?? "" },
  { key: "leadStatus", label: "Estado de lead", get: (r) => LEAD_STATUS_LABEL[r.leadStatus] ?? r.leadStatus },
  { key: "tags", label: "Etiquetas", get: (r) => r.tags.join(" | ") },
  { key: "optedOut", label: "Baja de marketing", get: (r) => (r.optedOutMarketing ? "Sí" : "No") },
  { key: "createdAt", label: "Registrado", get: (r) => formatDate(r.createdAt) },
];

export type SheetExportDataset = "LEAD_SCORES" | "CAMPAIGN_RESULTS" | "CHATS" | "CONTACTS";

// Compat de configuración ya guardada: antes del split la columna se llamaba
// `lastInboundAt`, y así quedó en SheetExport.columns de los exports
// existentes. Se expande al leer (runner y PATCH) para que esas filas sigan
// sincronizando sin que nadie tenga que volver a editar la exportación.
const LEGACY_COLUMN_KEYS: Record<string, string[]> = {
  lastInboundAt: ["lastInboundDate", "lastInboundTime"],
};

export function expandLegacyColumnKeys(keys: string[]): string[] {
  const expanded = new Set<string>();
  for (const key of keys) {
    const replacements = LEGACY_COLUMN_KEYS[key];
    if (replacements) replacements.forEach((k) => expanded.add(k));
    else expanded.add(key);
  }
  return Array.from(expanded);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 4 formas de fila distintas, unificadas solo para poder indexar por dataset
export const EXPORT_COLUMNS_BY_DATASET: Record<SheetExportDataset, ExportColumnDef<any>[]> = {
  LEAD_SCORES: EXPORT_COLUMNS,
  CAMPAIGN_RESULTS: CAMPAIGN_EXPORT_COLUMNS,
  CHATS: CHATS_EXPORT_COLUMNS,
  CONTACTS: CONTACTS_EXPORT_COLUMNS,
};
