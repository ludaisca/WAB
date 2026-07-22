import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { updateAccountOrigen, deleteAccount, countAccountDependents } from "@/lib/whatsapp/accounts";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

// Misma proyección que GET /api/whatsapp/accounts/[id] — nunca expone
// accessToken/appSecret/verifyTokenHash al modelo.
const ACCOUNT_SELECT = {
  id: true, name: true, origen: true, channel: true, phoneNumber: true, phoneNumberId: true,
  wabaId: true, appId: true, status: true, errorMessage: true, lastActivity: true,
  autoAssignEnabled: true, hideUnattributedChats: true, qualityRating: true, messagingTier: true,
  qualityUpdatedAt: true, createdAt: true, updatedAt: true,
  _count: { select: { chats: true, templates: true } },
} as const;

export const accountsList: ToolDefinition<Record<string, never>> = {
  name: "accounts.list",
  riskTier: "READ",
  description: "Lista las cuentas de WhatsApp del usuario (propias y compartidas), sin credenciales.",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const accounts = await prisma.wAAccount.findMany({
      where: { id: { in: accountIds } },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return { accounts };
  },
};

export const accountsGet: ToolDefinition<{ accountId: string }> = {
  name: "accounts.get",
  riskTier: "READ",
  description: "Detalle de una cuenta de WhatsApp por id, sin credenciales.",
  parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    if (!accountIds.includes(params.accountId)) return { error: "Cuenta no encontrada" };
    const account = await prisma.wAAccount.findUnique({ where: { id: params.accountId }, select: ACCOUNT_SELECT });
    if (!account) return { error: "Cuenta no encontrada" };
    return account;
  },
};

export const accountsOrigenSet: ToolDefinition<{ accountId: string; origen: string | null }> = {
  name: "accounts.origen.set",
  riskTier: "MINOR",
  description: "Cambia la etiqueta libre 'origen' de una cuenta de WhatsApp (identificador interno, no lo usa Meta). Solo aplica a cuentas propias del usuario, no a compartidas.",
  parameters: {
    type: "object",
    properties: { accountId: { type: "string" }, origen: { type: "string" } },
    required: ["accountId"],
  },
  handler: async (params, ctx) => updateAccountOrigen(params.accountId, ctx.userId, params.origen ?? null),
};

export const accountsDelete: ToolDefinition<{ accountId: string }> = {
  name: "accounts.delete",
  riskTier: "CONFIRM",
  description: "Elimina permanentemente una cuenta de WhatsApp y TODO lo asociado en cascada (chats, contactos, plantillas, campañas, bots). Requiere confirmación humana explícita. Solo aplica a cuentas propias, no compartidas.",
  parameters: { type: "object", properties: { accountId: { type: "string" } }, required: ["accountId"] },
  describeConfirm: async (params, ctx) => {
    const account = await prisma.wAAccount.findFirst({ where: { id: params.accountId, userId: ctx.userId }, select: { name: true } });
    if (!account) throw new NotFoundError("Cuenta no encontrada");
    const counts = await countAccountDependents(params.accountId);
    return {
      description: `Eliminar permanentemente la cuenta "${account.name}" y todo lo asociado: ${counts.chats} chats, ${counts.contacts} contactos, ${counts.templates} plantillas, ${counts.campaigns} campañas, ${counts.bots} bots. Esta acción no se puede deshacer.`,
      params,
    };
  },
  executeConfirm: async (params, ctx) => {
    await deleteAccount(params.accountId, ctx.userId);
    return { success: true };
  },
};
