import { prisma } from "@/lib/prisma";
import { type ExportEntityKey } from "./export-entities-shared";

export {
  EXPORT_ENTITIES,
  EXPORT_ENTITY_LABELS,
  isExportEntityKey,
  type ExportEntityKey,
} from "./export-entities-shared";

export interface ExportRange {
  from?: Date;
  to?: Date;
}

export interface ExportResult {
  headers: string[];
  rows: string[][];
  jsonRows: Record<string, unknown>[];
}

function toRange(range: ExportRange, field: string) {
  if (!range.from && !range.to) return {};
  const filter: { gte?: Date; lte?: Date } = {};
  if (range.from) filter.gte = range.from;
  if (range.to) filter.lte = range.to;
  return { [field]: filter };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "sí" : "no";
  return String(value);
}

function buildResult(headers: string[], jsonRows: Record<string, unknown>[]): ExportResult {
  const rows = jsonRows.map((r) => headers.map((h) => cell(r[h])));
  return { headers, rows, jsonRows };
}

async function exportContacts(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.contact.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { account: { select: { name: true } }, tags: { include: { tag: { select: { name: true } } } } },
  });
  const headers = ["id", "telefono", "nombre", "nombreReal", "cuenta", "estado", "optedOutMarketing", "tags", "createdAt"];
  const jsonRows = rows.map((c) => ({
    id: c.id,
    telefono: c.remoteJid,
    nombre: c.name,
    nombreReal: c.realName,
    cuenta: c.account.name,
    estado: c.leadStatus,
    optedOutMarketing: c.optedOutMarketing,
    tags: c.tags.map((t) => t.tag.name).join("; "),
    createdAt: c.createdAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportChats(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wAChat.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { account: { select: { name: true } }, assignedTo: { select: { name: true, email: true } } },
  });
  const headers = ["id", "cuenta", "telefono", "nombre", "esGrupo", "estado", "asignadoA", "ultimoMensajeEn", "createdAt"];
  const jsonRows = rows.map((c) => ({
    id: c.id,
    cuenta: c.account.name,
    telefono: c.remoteJid,
    nombre: c.name,
    esGrupo: c.isGroup,
    estado: c.status,
    asignadoA: c.assignedTo?.name ?? c.assignedTo?.email ?? "",
    ultimoMensajeEn: c.lastMessageAt,
    createdAt: c.createdAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportMessages(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wAMessage.findMany({
    where: toRange(range, "timestamp"),
    orderBy: { timestamp: "desc" },
    take: 50_000,
    include: { chat: { select: { remoteJid: true, account: { select: { name: true } } } } },
  });
  const headers = ["id", "cuenta", "chatTelefono", "direccion", "tipo", "cuerpo", "timestamp"];
  const jsonRows = rows.map((m) => ({
    id: m.id,
    cuenta: m.chat.account.name,
    chatTelefono: m.chat.remoteJid,
    direccion: m.direction,
    tipo: m.messageType,
    cuerpo: m.body ?? m.caption ?? "",
    timestamp: m.timestamp,
  }));
  return buildResult(headers, jsonRows);
}

async function exportCampaigns(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wACampaign.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { waAccount: { select: { name: true } }, waTemplate: { select: { name: true } } },
  });
  const headers = [
    "id", "nombre", "cuenta", "plantilla", "estado", "programadaEn", "enviadaEn", "completadaEn",
    "destinatarios", "enviados", "entregados", "leidos", "fallidos",
  ];
  const jsonRows = rows.map((c) => ({
    id: c.id,
    nombre: c.name,
    cuenta: c.waAccount.name,
    plantilla: c.waTemplate.name,
    estado: c.status,
    programadaEn: c.scheduledAt,
    enviadaEn: c.sentAt,
    completadaEn: c.completedAt,
    destinatarios: c.recipientCount,
    enviados: c.sentCount,
    entregados: c.deliveredCount,
    leidos: c.readCount,
    fallidos: c.failedCount,
  }));
  return buildResult(headers, jsonRows);
}

async function exportCampaignRecipients(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wACampaignRecipient.findMany({
    where: toRange(range, "sentAt"),
    orderBy: { id: "desc" },
    take: 50_000,
    include: { campaign: { select: { name: true } } },
  });
  const headers = ["id", "campaña", "telefono", "nombreContacto", "estado", "enviadoEn", "entregadoEn", "leidoEn", "error"];
  const jsonRows = rows.map((r) => ({
    id: r.id,
    campaña: r.campaign.name,
    telefono: r.phoneNumber,
    nombreContacto: r.contactName,
    estado: r.status,
    enviadoEn: r.sentAt,
    entregadoEn: r.deliveredAt,
    leidoEn: r.readAt,
    error: r.errorMessage,
  }));
  return buildResult(headers, jsonRows);
}

async function exportTemplates(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wATemplate.findMany({
    where: toRange(range, "syncedAt"),
    orderBy: { syncedAt: "desc" },
    include: { waAccount: { select: { name: true } } },
  });
  const headers = ["id", "cuenta", "nombre", "idioma", "categoria", "estado", "sincronizadoEn"];
  const jsonRows = rows.map((t) => ({
    id: t.id,
    cuenta: t.waAccount.name,
    nombre: t.name,
    idioma: t.language,
    categoria: t.category,
    estado: t.status,
    sincronizadoEn: t.syncedAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportLeadScores(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wALeadScore.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { chat: { select: { remoteJid: true, account: { select: { name: true } } } }, scorer: { select: { name: true } } },
  });
  const headers = ["id", "cuenta", "chatTelefono", "calificador", "score", "label", "resumen", "modelo", "createdAt"];
  const jsonRows = rows.map((s) => ({
    id: s.id,
    cuenta: s.chat.account.name,
    chatTelefono: s.chat.remoteJid,
    calificador: s.scorer.name,
    score: s.score,
    label: s.label,
    resumen: s.summary,
    modelo: s.model,
    createdAt: s.createdAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportLeadSheetSources(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.leadSheetSource.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { waAccount: { select: { name: true } } },
  });
  const headers = ["id", "nombre", "cuenta", "spreadsheetId", "sheetName", "habilitado", "ultimaEjecucion", "ultimoImportado", "ultimoError"];
  const jsonRows = rows.map((s) => ({
    id: s.id,
    nombre: s.name,
    cuenta: s.waAccount.name,
    spreadsheetId: s.spreadsheetId,
    sheetName: s.sheetName,
    habilitado: s.enabled,
    ultimaEjecucion: s.lastRunAt,
    ultimoImportado: s.lastImportedCount,
    ultimoError: s.lastError,
  }));
  return buildResult(headers, jsonRows);
}

async function exportLeadSheetImportedRows(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.leadSheetImportedRow.findMany({
    where: toRange(range, "importedAt"),
    orderBy: { importedAt: "desc" },
    take: 50_000,
    include: { source: { select: { name: true } } },
  });
  const headers = ["id", "fuente", "telefono", "nombreContacto", "estado", "importadoEn"];
  const jsonRows = rows.map((r) => ({
    id: r.id,
    fuente: r.source.name,
    telefono: r.phoneNumber,
    nombreContacto: r.contactName,
    estado: r.status,
    importadoEn: r.importedAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportNotes(range: ExportRange): Promise<ExportResult> {
  const rows = await prisma.wANote.findMany({
    where: toRange(range, "createdAt"),
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { name: true, remoteJid: true } }, author: { select: { name: true, email: true } } },
  });
  const headers = ["id", "contacto", "telefono", "autor", "cuerpo", "createdAt"];
  const jsonRows = rows.map((n) => ({
    id: n.id,
    contacto: n.contact.name,
    telefono: n.contact.remoteJid,
    autor: n.author.name ?? n.author.email,
    cuerpo: n.body,
    createdAt: n.createdAt,
  }));
  return buildResult(headers, jsonRows);
}

async function exportAiUsage(range: ExportRange): Promise<ExportResult> {
  const [botUsage, scorerUsage, agentUsage, recoveryAttempts] = await Promise.all([
    prisma.wABotUsage.findMany({ where: toRange(range, "createdAt"), include: { bot: { select: { name: true } } } }),
    prisma.wALeadScorerUsage.findMany({ where: toRange(range, "createdAt"), include: { scorer: { select: { name: true } } } }),
    prisma.agentUsage.findMany({ where: toRange(range, "createdAt") }),
    prisma.wALeadRecoveryAttempt.findMany({ where: toRange(range, "createdAt") }),
  ]);

  const jsonRows = [
    ...botUsage.map((u) => ({
      id: u.id, tipo: "Bot IA", origen: u.bot.name, modelo: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      costoUsd: u.estimatedCost, createdAt: u.createdAt,
    })),
    ...scorerUsage.map((u) => ({
      id: u.id, tipo: "Calificador", origen: u.scorer.name, modelo: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      costoUsd: u.estimatedCost, createdAt: u.createdAt,
    })),
    ...agentUsage.map((u) => ({
      id: u.id, tipo: "Asistente IA", origen: "", modelo: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      costoUsd: u.estimatedCost, createdAt: u.createdAt,
    })),
    ...recoveryAttempts.map((u) => ({
      id: u.id, tipo: "Recuperación de leads", origen: "", modelo: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      costoUsd: u.estimatedCost, createdAt: u.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const headers = ["id", "tipo", "origen", "modelo", "promptTokens", "completionTokens", "totalTokens", "costoUsd", "createdAt"];
  return buildResult(headers, jsonRows);
}

const EXPORTERS: Record<ExportEntityKey, (range: ExportRange) => Promise<ExportResult>> = {
  contacts: exportContacts,
  chats: exportChats,
  messages: exportMessages,
  campaigns: exportCampaigns,
  campaignRecipients: exportCampaignRecipients,
  templates: exportTemplates,
  leadScores: exportLeadScores,
  leadSheetSources: exportLeadSheetSources,
  leadSheetImportedRows: exportLeadSheetImportedRows,
  notes: exportNotes,
  aiUsage: exportAiUsage,
};

export async function exportEntity(key: ExportEntityKey, range: ExportRange): Promise<ExportResult> {
  return EXPORTERS[key](range);
}
