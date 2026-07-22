import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { setSourceEnabled, deleteSource } from "@/lib/whatsapp/lead-sheet-sources";
import { importNewLeadsForSource, LEAD_SHEET_MAX_BACKFILL, type SourceWithRelations } from "@/lib/google/lead-sheet-import";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

const MAX_ROWS = 30;

export const sheetSourcesList: ToolDefinition<Record<string, never>> = {
  name: "sheet-sources.list",
  riskTier: "READ",
  description: "Lista las fuentes de automatización de leads desde Google Sheets (nombre, si está habilitada, última corrida, último error).",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const sources = await prisma.leadSheetSource.findMany({
      where: { waAccountId: { in: accountIds } },
      select: {
        id: true, name: true, enabled: true, lastRunAt: true, lastImportedCount: true, lastError: true,
        waAccount: { select: { name: true } }, waTemplate: { select: { name: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return { sources };
  },
};

export const sheetSourcesGet: ToolDefinition<{ sourceId: string }> = {
  name: "sheet-sources.get",
  riskTier: "READ",
  description: "Detalle completo de una fuente de automatización de Sheets por id.",
  parameters: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"] },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id: params.sourceId, waAccountId: { in: accountIds } },
      include: { waAccount: { select: { name: true } }, waTemplate: { select: { name: true, status: true } } },
    });
    if (!source) return { error: "Fuente no encontrada" };
    return source;
  },
};

export const sheetSourcesRowsList: ToolDefinition<{ sourceId: string; status?: string; limit?: number }> = {
  name: "sheet-sources.rows.list",
  riskTier: "READ",
  description: "Lista filas importadas de una fuente de Sheets (teléfono, status de envío, error), útil para diagnosticar por qué un lead no se envió.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string" },
      status: { type: "string", enum: ["sent", "delivered", "read", "failed", "skipped", "seeded"] },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_ROWS})` },
    },
    required: ["sourceId"],
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id: params.sourceId, waAccountId: { in: accountIds } },
      select: { id: true },
    });
    if (!source) return { error: "Fuente no encontrada" };

    const take = Math.min(params.limit ?? 20, MAX_ROWS);
    const rows = await prisma.leadSheetImportedRow.findMany({
      where: { sourceId: params.sourceId, ...(params.status ? { status: params.status } : {}) },
      select: { phoneNumber: true, contactName: true, status: true, errorMessage: true, importedAt: true },
      orderBy: { importedAt: "desc" },
      take,
    });
    return { rows };
  },
};

export const sheetSourcesEnabledSet: ToolDefinition<{ sourceId: string; enabled: boolean }> = {
  name: "sheet-sources.enabled.set",
  riskTier: "CONFIRM",
  description: "Activa o desactiva una fuente de automatización de leads desde Sheets. Al activarla, el siguiente tick (cada 5 min) empieza a mandar plantillas reales a leads nuevos. Requiere confirmación humana.",
  parameters: {
    type: "object",
    properties: { sourceId: { type: "string" }, enabled: { type: "boolean" } },
    required: ["sourceId", "enabled"],
  },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({ where: { id: params.sourceId, waAccountId: { in: accountIds } }, select: { name: true } });
    if (!source) throw new NotFoundError("Fuente no encontrada");
    const action = params.enabled ? "Activar" : "Desactivar";
    const consequence = params.enabled
      ? "esto hace que el tick automático empiece a mandar la plantilla configurada a leads nuevos de la hoja"
      : "esto detiene el envío automático hasta que se reactive";
    return { description: `${action} la fuente "${source.name}" — ${consequence}.`, params };
  },
  executeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    return setSourceEnabled(params.sourceId, accountIds, params.enabled);
  },
};

export const sheetSourcesDelete: ToolDefinition<{ sourceId: string }> = {
  name: "sheet-sources.delete",
  riskTier: "CONFIRM",
  description: "Elimina permanentemente una fuente de automatización de Sheets y su historial de deduplicación. Requiere confirmación humana.",
  parameters: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"] },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({ where: { id: params.sourceId, waAccountId: { in: accountIds } }, select: { name: true } });
    if (!source) throw new NotFoundError("Fuente no encontrada");
    return { description: `Eliminar permanentemente la fuente "${source.name}".`, params };
  },
  executeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    await deleteSource(params.sourceId, accountIds);
    return { success: true };
  },
};

export const sheetSourcesImportByDate: ToolDefinition<{ sourceId: string; dateFrom?: string; dateTo?: string }> = {
  name: "sheet-sources.importByDate",
  riskTier: "CONFIRM",
  description: `Reimporta y envía la plantilla a leads existentes de la hoja (incluidos los ya vistos/"seeded"), filtrados por rango de fecha de registro (dateColumn). Manda mensajes reales a leads reales — máximo ${LEAD_SHEET_MAX_BACKFILL} por corrida. Requiere confirmación humana.`,
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string" },
      dateFrom: { type: "string", description: "Fecha ISO (YYYY-MM-DD), inclusive" },
      dateTo: { type: "string", description: "Fecha ISO (YYYY-MM-DD), inclusive" },
    },
    required: ["sourceId"],
  },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({ where: { id: params.sourceId, waAccountId: { in: accountIds } }, select: { name: true } });
    if (!source) throw new NotFoundError("Fuente no encontrada");
    const range = params.dateFrom || params.dateTo ? ` entre ${params.dateFrom ?? "el inicio"} y ${params.dateTo ?? "hoy"}` : " (sin filtro de fecha — toda la hoja)";
    return {
      description: `Reimportar y enviar la plantilla de la fuente "${source.name}" a leads con fecha de registro${range}. Esto manda mensajes reales de WhatsApp.`,
      params,
    };
  },
  executeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id: params.sourceId, waAccountId: { in: accountIds } },
      include: { waAccount: true, waTemplate: true },
    });
    if (!source) throw new NotFoundError("Fuente no encontrada");
    if (params.dateFrom && Number.isNaN(Date.parse(params.dateFrom))) throw new ValidationError("dateFrom inválido");
    if (params.dateTo && Number.isNaN(Date.parse(params.dateTo))) throw new ValidationError("dateTo inválido");

    return importNewLeadsForSource(source as SourceWithRelations, {
      includeExisting: true,
      limit: LEAD_SHEET_MAX_BACKFILL,
      dateFrom: params.dateFrom ? new Date(params.dateFrom) : null,
      dateTo: params.dateTo ? new Date(params.dateTo) : null,
    });
  },
};
