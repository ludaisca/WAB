import ExcelJS from "exceljs";
import { addColumnarSheet } from "./report-columns";
import { inRange, widenedDateStrings } from "./date-range";
import {
  EXPORT_COLUMNS,
  CAMPAIGN_EXPORT_COLUMNS,
  CHATS_EXPORT_COLUMNS,
  CONTACTS_EXPORT_COLUMNS,
} from "@/lib/whatsapp/export-columns";
import {
  buildLeadScoreRows,
  buildCampaignResultRows,
  buildChatRows,
  buildContactRows,
} from "@/lib/google/dataset-queries";
import { getAgentPerformance } from "@/lib/estadisticas/agent-performance";
import { runSystemDiagnostics } from "@/lib/whatsapp/system-diagnostics";
import { fetchMessagesInRange, bucketDailyMessages, bucketMessageTypes } from "./queries/messages";
import { fetchBotCostRows, fetchAiUsageDetailRows } from "./queries/ai-usage";
import { fetchAccountRows } from "./queries/accounts";
import { fetchTagRows } from "./queries/tags";
import { fetchTemplateRows } from "./queries/templates";
import { buildResumenRows } from "./sheets/resumen";
import {
  DAILY_MESSAGE_COLUMNS,
  MESSAGE_TYPE_COLUMNS,
  BOT_COST_COLUMNS,
  AI_USAGE_DETAIL_COLUMNS,
  TEMPLATE_COLUMNS,
  AGENT_PERFORMANCE_COLUMNS,
  ACCOUNT_COLUMNS,
  TAG_COLUMNS,
  DIAGNOSTIC_COLUMNS,
} from "./sheets/columns";
import { RESUMEN_COLUMNS } from "./sheets/resumen";

export interface ReportContext {
  accountIds: string[];
  userId: string;
  // "admin" — el módulo Reportes es admin-only, pasado tal cual a
  // buildChatRows/buildLeadScoreRows para que apliquen chatAccessWhere() con
  // el mismo rol que ya tiene el generador.
  role: string;
  gte: Date;
  lt: Date;
  generatedByLabel: string;
}

export async function buildReportWorkbook(ctx: ReportContext): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAB — Reportes";
  workbook.created = new Date();

  // dateFrom/dateTo con margen de 1 día para acotar la QUERY de los 4
  // builders reutilizados (evita traer TODO el historial — ver comentario en
  // date-range.ts:widenedDateStrings). El recorte exacto sigue siendo
  // inRange() más abajo, no este acotado aproximado.
  const { dateFrom: dbDateFrom, dateTo: dbDateTo } = widenedDateStrings(ctx.gte, ctx.lt);

  // Fetch de todos los datasets primero — "Resumen" se deriva de estos
  // arrays en memoria sin queries extra.
  const [messagesRaw, botCostRows, aiUsageRows, campaignRowsAll, templateRows] = await Promise.all([
    fetchMessagesInRange(ctx.accountIds, ctx.gte, ctx.lt),
    fetchBotCostRows(ctx.userId, ctx.gte, ctx.lt),
    fetchAiUsageDetailRows(ctx.userId, ctx.gte, ctx.lt),
    buildCampaignResultRows(ctx.accountIds, { dateFrom: dbDateFrom, dateTo: dbDateTo }),
    fetchTemplateRows(ctx.accountIds),
  ]);
  const [leadRowsAll, chatRowsAll, contactRowsAll] = await Promise.all([
    buildLeadScoreRows(ctx.userId, ctx.role, ctx.accountIds, { dateFrom: dbDateFrom, dateTo: dbDateTo }),
    buildChatRows(ctx.userId, ctx.role, ctx.accountIds, { dateFrom: dbDateFrom, dateTo: dbDateTo }),
    buildContactRows(ctx.accountIds, { dateFrom: dbDateFrom, dateTo: dbDateTo }),
  ]);
  const [agentRows, accountRows, tagRows, diagnostics] = await Promise.all([
    getAgentPerformance(ctx.accountIds),
    fetchAccountRows(ctx.accountIds),
    fetchTagRows(ctx.accountIds),
    runSystemDiagnostics(ctx.userId),
  ]);

  // Recorte de rango en JS (CDMX, ver date-range.ts) — los 4 builders de
  // dataset-queries.ts NO reciben dateFrom/dateTo: su dateRange() interno
  // interpreta el string como medianoche UTC, no CDMX.
  const campaignRows = campaignRowsAll.filter((r) => inRange(r.sentAt, ctx.gte, ctx.lt));
  const leadRows = leadRowsAll.filter((r) => inRange(r.updatedAt, ctx.gte, ctx.lt));
  const chatRows = chatRowsAll.filter((r) => inRange(r.lastMessageAt, ctx.gte, ctx.lt));
  const contactRows = contactRowsAll.filter((r) => inRange(r.createdAt, ctx.gte, ctx.lt));

  const resumenRows = buildResumenRows(ctx, {
    messagesRaw,
    aiUsageRows,
    campaignRows,
    leadRows,
    chatRows,
    contactRows,
    agentRows,
    diagnostics,
  });

  addColumnarSheet(workbook, "Resumen", RESUMEN_COLUMNS, resumenRows);
  addColumnarSheet(workbook, "Mensajes diarios", DAILY_MESSAGE_COLUMNS, bucketDailyMessages(messagesRaw));
  addColumnarSheet(workbook, "Mensajes por tipo", MESSAGE_TYPE_COLUMNS, bucketMessageTypes(messagesRaw));
  addColumnarSheet(workbook, "Bots y costo IA", BOT_COST_COLUMNS, botCostRows);
  addColumnarSheet(workbook, "Costos IA detallado", AI_USAGE_DETAIL_COLUMNS, aiUsageRows);
  addColumnarSheet(workbook, "Campañas", CAMPAIGN_EXPORT_COLUMNS, campaignRows);
  addColumnarSheet(workbook, "Plantillas", TEMPLATE_COLUMNS, templateRows);
  addColumnarSheet(workbook, "Leads calificados", EXPORT_COLUMNS, leadRows);
  addColumnarSheet(workbook, "Chats", CHATS_EXPORT_COLUMNS, chatRows);
  addColumnarSheet(workbook, "Contactos", CONTACTS_EXPORT_COLUMNS, contactRows);
  addColumnarSheet(workbook, "Rendimiento agentes", AGENT_PERFORMANCE_COLUMNS, agentRows);
  addColumnarSheet(workbook, "Cuentas", ACCOUNT_COLUMNS, accountRows);
  addColumnarSheet(workbook, "Etiquetas", TAG_COLUMNS, tagRows);
  addColumnarSheet(workbook, "Diagnóstico", DIAGNOSTIC_COLUMNS, diagnostics.issues);

  return workbook;
}
