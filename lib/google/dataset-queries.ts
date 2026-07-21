// Construye las filas de cada dataset exportable (ver SheetExport en
// prisma/schema.prisma). LEAD_SCORES/CAMPAIGN_RESULTS son el mismo cuerpo que
// tenía lib/google/sheets-sync.ts antes de generalizarse, ahora parametrizado
// con filtros por exportación. Cada función recibe `accountIds` YA
// intersectado con getUserAccountIds() por el caller (lib/google/sheet-export-runner.ts)
// — ninguna de estas funciones debe volver a ampliar ese scope.

import type { ChatStatus, LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";
import { chatAccessWhere, getChatVisibilityFilter } from "@/lib/whatsapp/chat-visibility";
import {
  type LeadScoreRow,
  type CampaignResultRow,
  type CampaignResultStatus,
  type ChatExportRow,
  type ContactExportRow,
} from "@/lib/whatsapp/export-columns";

export interface LeadScoresFilters {
  accountIds?: string[];
  scorerIds?: string[];
  labels?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface CampaignResultsFilters {
  accountIds?: string[];
  // Ids de WACampaign (origen manual) y/o LeadSheetSource (origen automatización)
  // mezclados en un solo array — cada fila se filtra contra el id de su propio
  // origen, ver el uso de campaignIds abajo.
  campaignIds?: string[];
  origins?: ("manual" | "automatizacion")[];
  statuses?: CampaignResultStatus[];
  dateFrom?: string;
  dateTo?: string;
}

export interface ChatsFilters {
  accountIds?: string[];
  statuses?: ChatStatus[];
  tagIds?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface ContactsFilters {
  accountIds?: string[];
  tagIds?: string[];
  leadStatuses?: LeadStatus[];
  dateFrom?: string;
  dateTo?: string;
}

function dateRange(dateFrom?: string, dateTo?: string): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
  };
}

const LEAD_SHEET_STATUS_MAP: Record<string, CampaignResultStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
  skipped: "SKIPPED",
};

export async function buildLeadScoreRows(
  userId: string,
  role: string | undefined,
  accountIds: string[],
  filters: LeadScoresFilters
): Promise<LeadScoreRow[]> {
  const updatedAt = dateRange(filters.dateFrom, filters.dateTo);
  // Igual que en GET /api/whatsapp/lead-scores: sin esto, un export configurado
  // por un user/ejecutivo con hideUnattributedChats activo filtraría por cuenta
  // pero no por visibilidad, exportando a Sheets chats que su propio inbox esconde.
  const visibility = await getChatVisibilityFilter(userId, role, accountIds);

  const scores = await prisma.wALeadScore.findMany({
    where: {
      chat: { accountId: { in: accountIds }, ...(visibility ? { AND: [visibility] } : {}) },
      ...(filters.scorerIds?.length ? { scorerId: { in: filters.scorerIds } } : {}),
      ...(filters.labels?.length ? { label: { in: filters.labels } } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
    include: {
      scorer: { select: { id: true, name: true } },
      chat: {
        select: {
          id: true,
          name: true,
          remoteJid: true,
          status: true,
          accountId: true,
          account: { select: { id: true, name: true, origen: true } },
          contact: { select: { realName: true } },
          messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
        },
      },
    },
    orderBy: { score: "desc" },
  });

  return scores.map((s) => {
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
}

export async function buildCampaignResultRows(
  accountIds: string[],
  filters: CampaignResultsFilters
): Promise<CampaignResultRow[]> {
  const includeManual = !filters.origins?.length || filters.origins.includes("manual");
  const includeAutomation = !filters.origins?.length || filters.origins.includes("automatizacion");

  // RecipientStatus (WACampaignRecipient) no tiene "SKIPPED" — ese estado solo
  // existe para LeadSheetImportedRow. Si el usuario filtró exclusivamente por
  // "SKIPPED", el resultado correcto es CERO filas manuales, no "sin filtro"
  // (un `in: []` en Prisma no matchea nada, a propósito).
  const recipientStatuses = filters.statuses?.filter((s): s is Exclude<CampaignResultStatus, "SKIPPED"> => s !== "SKIPPED");

  const manualRows: CampaignResultRow[] = includeManual
    ? (
        await prisma.wACampaignRecipient.findMany({
          where: {
            campaign: { waAccountId: { in: accountIds } },
            ...(filters.campaignIds?.length ? { campaignId: { in: filters.campaignIds } } : {}),
            ...(filters.statuses?.length ? { status: { in: recipientStatuses ?? [] } } : {}),
            ...(dateRange(filters.dateFrom, filters.dateTo) ? { sentAt: dateRange(filters.dateFrom, filters.dateTo) } : {}),
          },
          include: {
            campaign: {
              select: { name: true, waTemplate: { select: { name: true } }, waAccount: { select: { origen: true } } },
            },
          },
          orderBy: { sentAt: "desc" },
        })
      ).map((r) => ({
        origin: "manual" as const,
        campaignName: r.campaign.name,
        templateName: r.campaign.waTemplate.name,
        accountOrigen: r.campaign.waAccount.origen,
        phoneNumber: r.phoneNumber,
        contactName: r.contactName,
        status: r.status,
        errorMessage: r.errorMessage,
        sentAt: r.sentAt?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        readAt: r.readAt?.toISOString() ?? null,
      }))
    : [];

  // "seeded" nunca se envió — no es un resultado de envío, se excluye siempre.
  const statusFilter = filters.statuses?.length
    ? { status: { in: filters.statuses.map((s) => s.toLowerCase()).filter((s) => s !== "seeded") } }
    : { status: { not: "seeded" } };

  const automationRows: CampaignResultRow[] = includeAutomation
    ? (
        await prisma.leadSheetImportedRow.findMany({
          where: {
            source: { waAccountId: { in: accountIds } },
            ...(filters.campaignIds?.length ? { sourceId: { in: filters.campaignIds } } : {}),
            ...statusFilter,
            ...(dateRange(filters.dateFrom, filters.dateTo) ? { importedAt: dateRange(filters.dateFrom, filters.dateTo) } : {}),
          },
          include: {
            source: {
              select: { name: true, waTemplate: { select: { name: true } }, waAccount: { select: { origen: true } } },
            },
          },
          orderBy: { importedAt: "desc" },
        })
      ).map((r) => ({
        origin: "automatizacion" as const,
        campaignName: r.source.name,
        templateName: r.source.waTemplate.name,
        accountOrigen: r.source.waAccount.origen,
        phoneNumber: r.phoneNumber,
        contactName: r.contactName,
        status: LEAD_SHEET_STATUS_MAP[r.status] ?? "FAILED",
        errorMessage: r.errorMessage,
        sentAt: r.status === "skipped" ? null : r.importedAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        readAt: r.readAt?.toISOString() ?? null,
      }))
    : [];

  return [...manualRows, ...automationRows];
}

// Único dataset que necesita `role` — pasa por chatAccessWhere() para respetar
// WAAccount.hideUnattributedChats igual que el resto de rutas por-chat de la app.
export async function buildChatRows(
  userId: string,
  role: string | undefined,
  accountIds: string[],
  filters: ChatsFilters
): Promise<ChatExportRow[]> {
  const base = await chatAccessWhere(userId, role);
  const lastMessageAt = dateRange(filters.dateFrom, filters.dateTo);

  const chats = await prisma.wAChat.findMany({
    // `base` ya trae su propio `accountId` (recién recalculado por
    // chatAccessWhere) — anidarlo dentro de AND en vez de spread evita que la
    // key `accountId` de abajo lo pise silenciosamente y descarte la
    // revalidación de cuentas compartidas revocadas.
    where: {
      AND: [
        base,
        { accountId: { in: accountIds } },
        ...(filters.statuses?.length ? [{ status: { in: filters.statuses } }] : []),
        ...(filters.tagIds?.length ? [{ chatTags: { some: { tagId: { in: filters.tagIds } } } }] : []),
        ...(lastMessageAt ? [{ lastMessageAt }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      remoteJid: true,
      status: true,
      createdAt: true,
      lastMessageAt: true,
      account: { select: { id: true, name: true, origen: true } },
      assignedTo: { select: { name: true } },
      contact: { select: { realName: true } },
      chatTags: { select: { tag: { select: { name: true } } } },
      messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return chats.map((c) => ({
    id: c.id,
    name: c.name,
    remoteJid: c.remoteJid,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    account: c.account,
    assignedTo: c.assignedTo,
    contact: c.contact,
    tags: c.chatTags.map((ct) => ct.tag.name),
    campaign: resolveChatAttribution(c.messages),
  }));
}

export async function buildContactRows(accountIds: string[], filters: ContactsFilters): Promise<ContactExportRow[]> {
  const createdAt = dateRange(filters.dateFrom, filters.dateTo);

  const contacts = await prisma.contact.findMany({
    where: {
      accountId: { in: accountIds },
      ...(filters.leadStatuses?.length ? { leadStatus: { in: filters.leadStatuses } } : {}),
      ...(filters.tagIds?.length ? { tags: { some: { tagId: { in: filters.tagIds } } } } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    select: {
      id: true,
      name: true,
      realName: true,
      remoteJid: true,
      leadStatus: true,
      optedOutMarketing: true,
      createdAt: true,
      account: { select: { id: true, name: true, origen: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    realName: c.realName,
    remoteJid: c.remoteJid,
    leadStatus: c.leadStatus,
    optedOutMarketing: c.optedOutMarketing,
    createdAt: c.createdAt.toISOString(),
    account: c.account,
    tags: c.tags.map((t) => t.tag.name),
  }));
}
