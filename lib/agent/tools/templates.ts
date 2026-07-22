import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { syncAccountTemplates } from "@/lib/whatsapp/template-sync";
import { deleteTemplateFully } from "@/lib/whatsapp/templates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

const MAX_LIST = 40;

export const templatesList: ToolDefinition<{ status?: string; limit?: number }> = {
  name: "templates.list",
  riskTier: "READ",
  description: "Lista plantillas de WhatsApp (nombre, idioma, categoría, status de aprobación de Meta).",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", description: "Ej. APPROVED, PENDING, REJECTED (status literal de Meta)" },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_LIST})` },
    },
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const take = Math.min(params.limit ?? 20, MAX_LIST);
    const templates = await prisma.wATemplate.findMany({
      where: { waAccountId: { in: accountIds }, ...(params.status ? { status: params.status } : {}) },
      select: { id: true, name: true, language: true, category: true, status: true, waAccount: { select: { name: true } } },
      orderBy: { syncedAt: "desc" },
      take,
    });
    return { templates };
  },
};

export const templatesGet: ToolDefinition<{ templateId: string }> = {
  name: "templates.get",
  riskTier: "READ",
  description: "Detalle completo de una plantilla, incluyendo sus componentes (header/body/footer/botones).",
  parameters: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const template = await prisma.wATemplate.findFirst({
      where: { id: params.templateId, waAccountId: { in: accountIds } },
      include: { waAccount: { select: { name: true } } },
    });
    if (!template) return { error: "Plantilla no encontrada" };
    return template;
  },
};

export const templatesSync: ToolDefinition<{ accountId: string }> = {
  name: "templates.sync",
  riskTier: "MINOR",
  description: "Sincroniza las plantillas de una cuenta con Meta (trae lo nuevo/actualizado, borra localmente lo que ya no exista allá). Requiere que la cuenta sea Meta Cloud API con WABA ID configurado.",
  parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    if (!accountIds.includes(params.accountId)) throw new NotFoundError("Cuenta no encontrada");

    const account = await prisma.wAAccount.findFirst({ where: { id: params.accountId } });
    if (!account) throw new NotFoundError("Cuenta no encontrada");
    if (account.channel !== "META_CLOUD" || !account.wabaId || !account.accessToken) {
      throw new ValidationError("Sincronizar plantillas solo aplica a cuentas de Meta Cloud API con WABA ID configurado");
    }

    const count = await syncAccountTemplates({ id: account.id, wabaId: account.wabaId, accessToken: account.accessToken });
    return { syncedCount: count };
  },
};

export const templatesDelete: ToolDefinition<{ templateId: string }> = {
  name: "templates.delete",
  riskTier: "CONFIRM",
  description: "Elimina una plantilla permanentemente, tanto en Meta (si la cuenta tiene credenciales) como localmente. Requiere confirmación humana.",
  parameters: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const template = await prisma.wATemplate.findFirst({
      where: { id: params.templateId, waAccountId: { in: accountIds } },
      select: { name: true, language: true },
    });
    if (!template) throw new NotFoundError("Plantilla no encontrada");
    return { description: `Eliminar permanentemente la plantilla "${template.name}" (${template.language}), en Meta y localmente.`, params };
  },
  executeConfirm: async (params, ctx) => {
    await deleteTemplateFully(params.templateId, ctx.userId);
    return { success: true };
  },
};
