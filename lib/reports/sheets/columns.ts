import { formatDateTime } from "@/lib/timezone";
import { INT_FMT, MONEY_FMT, type ReportColumnDef } from "../report-columns";
import type { DailyMessageRow, MessageTypeRow } from "../queries/messages";
import type { BotCostRow, AiUsageDetailRow } from "../queries/ai-usage";
import type { TemplateRow } from "../queries/templates";
import type { AccountRow } from "../queries/accounts";
import type { TagRow } from "../queries/tags";
import type { AgentPerformanceRow } from "@/lib/estadisticas/agent-performance";
import type { DiagnosticIssue } from "@/lib/whatsapp/system-diagnostics";

export const DAILY_MESSAGE_COLUMNS: ReportColumnDef<DailyMessageRow>[] = [
  { key: "date", label: "Fecha", get: (r) => r.date },
  { key: "inbound", label: "Entrantes", numFmt: INT_FMT, get: (r) => r.inbound },
  { key: "outbound", label: "Salientes", numFmt: INT_FMT, get: (r) => r.outbound },
  { key: "total", label: "Total", numFmt: INT_FMT, get: (r) => r.total },
];

export const MESSAGE_TYPE_COLUMNS: ReportColumnDef<MessageTypeRow>[] = [
  { key: "type", label: "Tipo", get: (r) => r.type },
  { key: "inbound", label: "Entrantes", numFmt: INT_FMT, get: (r) => r.inbound },
  { key: "outbound", label: "Salientes", numFmt: INT_FMT, get: (r) => r.outbound },
  { key: "total", label: "Total", numFmt: INT_FMT, get: (r) => r.total },
];

const BOT_STATUS_LABEL: Record<string, string> = { ACTIVE: "Activo", ERROR: "Error" };

export const BOT_COST_COLUMNS: ReportColumnDef<BotCostRow>[] = [
  { key: "name", label: "Bot", get: (r) => r.name },
  { key: "status", label: "Estado", get: (r) => BOT_STATUS_LABEL[r.status] ?? r.status },
  { key: "isActive", label: "Activo", get: (r) => (r.isActive ? "Sí" : "No") },
  { key: "interactions", label: "Interacciones", numFmt: INT_FMT, get: (r) => r.interactions },
  { key: "totalTokens", label: "Tokens", numFmt: INT_FMT, get: (r) => r.totalTokens },
  { key: "totalCost", label: "Costo (USD)", numFmt: MONEY_FMT, get: (r) => r.totalCost },
];

export const AI_USAGE_DETAIL_COLUMNS: ReportColumnDef<AiUsageDetailRow>[] = [
  { key: "source", label: "Fuente", get: (r) => r.source },
  { key: "entity", label: "Entidad", get: (r) => r.entity },
  { key: "model", label: "Modelo", get: (r) => r.model },
  { key: "promptTokens", label: "Tokens prompt", numFmt: INT_FMT, get: (r) => r.promptTokens },
  { key: "completionTokens", label: "Tokens completion", numFmt: INT_FMT, get: (r) => r.completionTokens },
  { key: "totalTokens", label: "Tokens totales", numFmt: INT_FMT, get: (r) => r.totalTokens },
  { key: "estimatedCost", label: "Costo (USD)", numFmt: MONEY_FMT, get: (r) => r.estimatedCost },
  { key: "createdAt", label: "Fecha", get: (r) => formatDateTime(r.createdAt) },
];

export const TEMPLATE_COLUMNS: ReportColumnDef<TemplateRow>[] = [
  { key: "name", label: "Plantilla", get: (r) => r.name },
  { key: "category", label: "Categoría", get: (r) => r.category },
  { key: "language", label: "Idioma", get: (r) => r.language },
  { key: "status", label: "Estado", get: (r) => r.status },
  { key: "accountName", label: "Cuenta", get: (r) => r.accountName },
  { key: "syncedAt", label: "Sincronizada", get: (r) => formatDateTime(r.syncedAt.toISOString()) },
];

export const AGENT_PERFORMANCE_COLUMNS: ReportColumnDef<AgentPerformanceRow>[] = [
  { key: "userName", label: "Agente", get: (r) => r.userName ?? "—" },
  { key: "resolvedCount", label: "Chats resueltos", numFmt: INT_FMT, get: (r) => r.resolvedCount },
  {
    key: "avgFirstResponseMinutes",
    label: "Tiempo prom. 1ª respuesta (min)",
    numFmt: "#,##0.0",
    get: (r) => r.avgFirstResponseMinutes,
  },
  {
    key: "avgResolutionMinutes",
    label: "Tiempo prom. resolución (min)",
    numFmt: "#,##0.0",
    get: (r) => r.avgResolutionMinutes,
  },
];

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONNECTED: "Conectada",
  ERROR: "Error",
  DISCONNECTED: "Desconectada",
};

export const ACCOUNT_COLUMNS: ReportColumnDef<AccountRow>[] = [
  { key: "name", label: "Cuenta", get: (r) => r.name },
  { key: "phoneNumber", label: "Teléfono", get: (r) => r.phoneNumber ?? "" },
  { key: "origen", label: "Origen", get: (r) => r.origen ?? "" },
  { key: "status", label: "Estado", get: (r) => ACCOUNT_STATUS_LABEL[r.status] ?? r.status },
  { key: "qualityRating", label: "Calidad", get: (r) => r.qualityRating ?? "" },
  { key: "messagingTier", label: "Límite de envío", get: (r) => r.messagingTier ?? "" },
  {
    key: "qualityUpdatedAt",
    label: "Actualizado",
    get: (r) => (r.qualityUpdatedAt ? formatDateTime(r.qualityUpdatedAt.toISOString()) : ""),
  },
];

export const TAG_COLUMNS: ReportColumnDef<TagRow>[] = [
  { key: "name", label: "Etiqueta", get: (r) => r.name },
  { key: "color", label: "Color", get: (r) => r.color },
  { key: "contactCount", label: "# Contactos", numFmt: INT_FMT, get: (r) => r.contactCount },
  { key: "chatCount", label: "# Chats", numFmt: INT_FMT, get: (r) => r.chatCount },
];

export const DIAGNOSTIC_COLUMNS: ReportColumnDef<DiagnosticIssue>[] = [
  { key: "area", label: "Área", get: (r) => r.area },
  { key: "severity", label: "Severidad", get: (r) => r.severity },
  { key: "entityName", label: "Entidad", get: (r) => r.entityName },
  { key: "message", label: "Mensaje", width: 60, get: (r) => r.message },
];
