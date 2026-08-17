import { formatDate, formatDateTime } from "@/lib/timezone";
import type { ReportColumnDef } from "../report-columns";
import { labelText } from "@/lib/whatsapp/export-columns";
import type { CampaignResultRow, LeadScoreRow, ChatExportRow, ContactExportRow } from "@/lib/whatsapp/export-columns";
import type { RawMessageRow } from "../queries/messages";
import type { AiUsageDetailRow } from "../queries/ai-usage";
import type { AgentPerformanceRow } from "@/lib/estadisticas/agent-performance";
import type { DiagnosticsResult } from "@/lib/whatsapp/system-diagnostics";
import type { ReportContext } from "../build-workbook";

export interface ResumenRow {
  metric: string;
  value: string;
}

export const RESUMEN_COLUMNS: ReportColumnDef<ResumenRow>[] = [
  { key: "metric", label: "Métrica", width: 42, get: (r) => r.metric },
  { key: "value", label: "Valor", width: 30, get: (r) => r.value },
];

export interface ResumenInput {
  messagesRaw: RawMessageRow[];
  aiUsageRows: AiUsageDetailRow[];
  campaignRows: CampaignResultRow[];
  leadRows: LeadScoreRow[];
  chatRows: ChatExportRow[];
  contactRows: ContactExportRow[];
  agentRows: AgentPerformanceRow[];
  diagnostics: DiagnosticsResult;
}

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  SENT: "Mensajes de campaña — Enviados",
  DELIVERED: "Mensajes de campaña — Entregados",
  READ: "Mensajes de campaña — Leídos",
  FAILED: "Mensajes de campaña — Fallidos",
};

export function buildResumenRows(ctx: ReportContext, data: ResumenInput): ResumenRow[] {
  const rows: ResumenRow[] = [];
  const push = (metric: string, value: string | number) => rows.push({ metric, value: String(value) });

  const lastDay = new Date(ctx.lt.getTime() - 1);
  push("Rango del reporte", `${formatDate(ctx.gte)} – ${formatDate(lastDay)}`);
  push("Generado el", formatDateTime(new Date()));
  push("Generado por", ctx.generatedByLabel);
  push("Cuentas incluidas", ctx.accountIds.length);

  push("Chats con actividad en el rango", data.chatRows.length);
  push("Contactos nuevos en el rango", data.contactRows.length);

  const inbound = data.messagesRaw.filter((m) => m.direction === "INBOUND").length;
  const outbound = data.messagesRaw.length - inbound;
  push("Mensajes entrantes", inbound);
  push("Mensajes salientes", outbound);
  push("Mensajes totales", data.messagesRaw.length);

  push("Leads calificados en el rango", data.leadRows.length);
  const labelCounts = new Map<string, number>();
  for (const l of data.leadRows) labelCounts.set(l.label, (labelCounts.get(l.label) ?? 0) + 1);
  for (const [label, count] of labelCounts) {
    push(`Leads calificados — ${labelText(label)}`, count);
  }
  // Mismos 2 cálculos que muestra el dashboard en pantalla (getReportDashboard,
  // lib/reports/queries/dashboard.ts) — el .xlsx no debe quedar por detrás de
  // lo que ya se ve en /reportes.
  if (data.leadRows.length > 0) {
    const avgScore = data.leadRows.reduce((sum, l) => sum + l.score, 0) / data.leadRows.length;
    push("Leads calificados — Score promedio", avgScore.toFixed(1));
    const descartados = labelCounts.get("descartado") ?? 0;
    const oportunidadOMas = (labelCounts.get("oportunidad") ?? 0) + (labelCounts.get("prioridad_alta") ?? 0);
    const realLeads = data.leadRows.length - descartados;
    if (realLeads > 0) {
      push("Leads calificados — % que llegan a oportunidad o más", `${Math.round((oportunidadOMas / realLeads) * 1000) / 10}%`);
    }
  }

  const campaignNames = new Set(data.campaignRows.map((c) => c.campaignName));
  push("Campañas con envíos en el rango", campaignNames.size);
  const byStatus: Record<string, number> = { SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 };
  for (const c of data.campaignRows) {
    if (c.status in byStatus) byStatus[c.status]++;
  }
  for (const [status, label] of Object.entries(CAMPAIGN_STATUS_LABEL)) {
    push(label, byStatus[status]);
  }

  const totalCost = data.aiUsageRows.reduce((sum, r) => sum + r.estimatedCost, 0);
  const totalTokens = data.aiUsageRows.reduce((sum, r) => sum + r.totalTokens, 0);
  push("Costo total de IA en el rango (USD)", totalCost.toFixed(4));
  push("Tokens totales de IA en el rango", totalTokens);

  const resolvedTotal = data.agentRows.reduce((sum, r) => sum + r.resolvedCount, 0);
  push("Chats resueltos (acumulado histórico, no acotado al rango)", resolvedTotal);

  const highSeverity = data.diagnostics.issues.filter((i) => i.severity === "alta").length;
  const mediumSeverity = data.diagnostics.issues.filter((i) => i.severity === "media").length;
  push("Hallazgos de diagnóstico — Alta", highSeverity);
  push("Hallazgos de diagnóstico — Media", mediumSeverity);

  return rows;
}
