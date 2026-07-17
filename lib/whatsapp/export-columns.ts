// Definiciones de columnas exportables, compartidas entre el export CSV en el
// cliente (whatsapp/calificadores/page.tsx) y la sincronización server-side a
// Google Sheets (lib/google/sheets-sync.ts) — separan "qué campo mostrar" de
// "cómo se entrega" para no duplicar la lista de columnas en dos lugares.

export interface ExportColumnDef<T> {
  key: string;
  label: string;
  get: (row: T) => string;
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
  chat: {
    id: string;
    name: string | null;
    remoteJid: string;
    status: string;
    accountId: string;
    account: { id: string; name: string };
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
  { key: "phone", label: "Teléfono", get: (r) => r.chat.remoteJid.split("@")[0] },
  { key: "account", label: "Cuenta", get: (r) => r.chat.account.name },
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

export interface CampaignRecipientRow {
  campaign: { name: string };
  phoneNumber: string;
  contactName: string | null;
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export const RECIPIENT_STATUS_LABEL: Record<CampaignRecipientRow["status"], string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Fallido",
};

function formatDateOrEmpty(value: string | null): string {
  return value ? formatDate(value) : "";
}

export const CAMPAIGN_EXPORT_COLUMNS: ExportColumnDef<CampaignRecipientRow>[] = [
  { key: "campaign", label: "Campaña", get: (r) => r.campaign.name },
  { key: "phone", label: "Teléfono", get: (r) => r.phoneNumber },
  { key: "contact", label: "Contacto", get: (r) => r.contactName ?? "" },
  { key: "status", label: "Estado", get: (r) => RECIPIENT_STATUS_LABEL[r.status] },
  { key: "error", label: "Error", get: (r) => r.errorMessage ?? "" },
  { key: "sentAt", label: "Enviado", get: (r) => formatDateOrEmpty(r.sentAt) },
  { key: "deliveredAt", label: "Entregado", get: (r) => formatDateOrEmpty(r.deliveredAt) },
  { key: "readAt", label: "Leído", get: (r) => formatDateOrEmpty(r.readAt) },
];
