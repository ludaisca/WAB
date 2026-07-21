// Definiciones de columnas exportables, compartidas entre el export CSV en el
// cliente (whatsapp/calificadores/page.tsx) y la sincronización server-side a
// Google Sheets (lib/google/sheets-sync.ts) — separan "qué campo mostrar" de
// "cómo se entrega" para no duplicar la lista de columnas en dos lugares.

export interface ExportColumnDef<T> {
  key: string;
  label: string;
  get: (row: T) => string;
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
    account: { id: string; name: string; origen: string | null };
    // Nombre aprendido por el calificador durante la conversación — distinto
    // del nombre de envío (chat.name), que viene del CSV/hoja de origen.
    contact: { realName: string | null } | null;
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

export function reasonsList(reasons: string): string[] {
  try {
    return JSON.parse(reasons);
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export const EXPORT_COLUMNS: ExportColumnDef<LeadScoreRow>[] = [
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
  { key: "nombre_real", label: "Nombre real", get: (r) => r.details?.nombre_real ?? "" },
  { key: "tono_interes", label: "Tono de interés", get: (r) => r.details?.tono_interes ?? "" },
  { key: "nivel_interaccion", label: "Nivel de interacción", get: (r) => r.details?.nivel_interaccion ?? "" },
  { key: "updatedAt", label: "Actualizado", get: (r) => formatDate(r.updatedAt) },
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
  { key: "createdAt", label: "Creado", get: (r) => formatDate(r.createdAt) },
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
  { key: "createdAt", label: "Creado", get: (r) => formatDate(r.createdAt) },
];

export type SheetExportDataset = "LEAD_SCORES" | "CAMPAIGN_RESULTS" | "CHATS" | "CONTACTS";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 4 formas de fila distintas, unificadas solo para poder indexar por dataset
export const EXPORT_COLUMNS_BY_DATASET: Record<SheetExportDataset, ExportColumnDef<any>[]> = {
  LEAD_SCORES: EXPORT_COLUMNS,
  CAMPAIGN_RESULTS: CAMPAIGN_EXPORT_COLUMNS,
  CHATS: CHATS_EXPORT_COLUMNS,
  CONTACTS: CONTACTS_EXPORT_COLUMNS,
};
