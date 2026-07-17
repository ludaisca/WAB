import type { sheets_v4 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getGoogleSheetsClientForUser } from "@/lib/google/sheets-client";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";
import {
  EXPORT_COLUMNS,
  CAMPAIGN_EXPORT_COLUMNS,
  type ExportColumnDef,
  type LeadScoreRow,
  type CampaignResultRow,
  type CampaignResultStatus,
} from "@/lib/whatsapp/export-columns";

const LEADS_TAB = "Leads calificados";
const CAMPAIGNS_TAB = "Resultados de campaña";

// LeadSheetImportedRow usa strings en minúscula (sent/delivered/read/failed/
// skipped/seeded); el tipo unificado usa el mismo enum que WACampaignRecipient
// (mayúsculas) para que ambos orígenes compartan una sola columna de estado.
const LEAD_SHEET_STATUS_MAP: Record<string, CampaignResultStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  skipped: "SKIPPED",
};

export async function syncGoogleSheetsForUser(userId: string): Promise<void> {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account?.enabled || !account.spreadsheetId) return;

  const sheets = await getGoogleSheetsClientForUser(userId);
  if (!sheets) return;

  const accountIds = await getUserAccountIds(userId);

  const scores = await prisma.wALeadScore.findMany({
    where: { chat: { accountId: { in: accountIds } } },
    include: {
      scorer: { select: { id: true, name: true } },
      chat: {
        select: {
          id: true,
          name: true,
          remoteJid: true,
          status: true,
          accountId: true,
          account: { select: { id: true, name: true } },
          contact: { select: { realName: true } },
          messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
        },
      },
    },
    orderBy: { score: "desc" },
  });

  const leadRows: LeadScoreRow[] = scores.map((s) => {
    const { messages, ...chatRest } = s.chat;
    return {
      id: s.id,
      score: s.score,
      label: s.label,
      summary: s.summary,
      reasons: s.reasons,
      details: s.details as LeadScoreRow["details"],
      updatedAt: s.updatedAt.toISOString(),
      scorer: s.scorer,
      campaign: resolveChatAttribution(messages),
      chat: chatRest,
    };
  });

  await writeSheetTab(sheets, account.spreadsheetId, LEADS_TAB, EXPORT_COLUMNS, leadRows);

  // Visibilidad por cuenta, no por creador (mismo criterio que el resto de rutas
  // de campañas) — un WAAccountShare da acceso a las campañas de esa cuenta
  // aunque el usuario no sea quien las creó. Filtrar por WACampaign.userId
  // excluiría indebidamente esas campañas compartidas.
  const recipients = await prisma.wACampaignRecipient.findMany({
    where: { campaign: { waAccountId: { in: accountIds } } },
    include: { campaign: { select: { name: true, waTemplate: { select: { name: true } } } } },
    orderBy: { sentAt: "desc" },
  });

  const manualRows: CampaignResultRow[] = recipients.map((r) => ({
    origin: "manual",
    campaignName: r.campaign.name,
    templateName: r.campaign.waTemplate.name,
    phoneNumber: r.phoneNumber,
    contactName: r.contactName,
    status: r.status,
    errorMessage: r.errorMessage,
    sentAt: r.sentAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    readAt: r.readAt?.toISOString() ?? null,
  }));

  // "seeded" nunca se envió (son las filas que ya existían al conectar la
  // fuente) — no es un resultado de envío, se excluye del export.
  const importedLeadRows = await prisma.leadSheetImportedRow.findMany({
    where: { source: { waAccountId: { in: accountIds } }, status: { not: "seeded" } },
    include: { source: { select: { name: true, waTemplate: { select: { name: true } } } } },
    orderBy: { importedAt: "desc" },
  });

  const automationRows: CampaignResultRow[] = importedLeadRows.map((r) => ({
    origin: "automatizacion",
    campaignName: r.source.name,
    templateName: r.source.waTemplate.name,
    phoneNumber: r.phoneNumber,
    contactName: r.contactName,
    status: LEAD_SHEET_STATUS_MAP[r.status] ?? "FAILED",
    errorMessage: r.errorMessage,
    sentAt: r.status === "skipped" ? null : r.importedAt.toISOString(),
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    readAt: r.readAt?.toISOString() ?? null,
  }));

  await writeSheetTab(sheets, account.spreadsheetId, CAMPAIGNS_TAB, CAMPAIGN_EXPORT_COLUMNS, [
    ...manualRows,
    ...automationRows,
  ]);

  await prisma.googleAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });
}

async function writeSheetTab<T>(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  columns: ExportColumnDef<T>[],
  rows: T[]
): Promise<void> {
  const values = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.get(r)))];

  // Rango fijo y generoso: se limpia primero para no dejar "filas fantasma"
  // si el dataset actual es más corto que el de la sincronización anterior
  // (ej. se borraron leads), luego se escribe todo de nuevo en una sola llamada.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tabTitle}'!A1:Z100000`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabTitle}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
