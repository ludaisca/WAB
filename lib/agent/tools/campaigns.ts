import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { deleteCampaign, sendCampaign } from "@/lib/whatsapp/campaigns";
import { NotFoundError } from "@/lib/errors";
import type { ToolDefinition } from "./types";

const MAX_LIST = 30;
const MAX_RECIPIENTS = 30;

export const campaignsList: ToolDefinition<{ status?: string; limit?: number }> = {
  name: "campaigns.list",
  riskTier: "READ",
  description: "Lista campañas masivas (nombre, status, cuenta, contadores de envío).",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["DRAFT", "SCHEDULED", "SENDING", "COMPLETED", "FAILED"] },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_LIST})` },
    },
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const take = Math.min(params.limit ?? 20, MAX_LIST);
    const campaigns = await prisma.wACampaign.findMany({
      where: { waAccountId: { in: accountIds }, ...(params.status ? { status: params.status as never } : {}) },
      select: {
        id: true, name: true, status: true, waAccount: { select: { name: true } },
        waTemplate: { select: { name: true } }, recipientCount: true, sentCount: true,
        deliveredCount: true, readCount: true, failedCount: true, scheduledAt: true, sentAt: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    return { campaigns };
  },
};

export const campaignsGet: ToolDefinition<{ campaignId: string }> = {
  name: "campaigns.get",
  riskTier: "READ",
  description: "Detalle completo de una campaña por id.",
  parameters: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"] },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const campaign = await prisma.wACampaign.findFirst({
      where: { id: params.campaignId, waAccountId: { in: accountIds } },
      include: { waAccount: { select: { name: true } }, waTemplate: { select: { name: true, status: true } } },
    });
    if (!campaign) return { error: "Campaña no encontrada" };
    return campaign;
  },
};

export const campaignsRecipientsList: ToolDefinition<{ campaignId: string; status?: string; limit?: number }> = {
  name: "campaigns.recipients.list",
  riskTier: "READ",
  description: "Lista destinatarios de una campaña, opcionalmente filtrados por status de envío.",
  parameters: {
    type: "object",
    properties: {
      campaignId: { type: "string" },
      status: { type: "string", enum: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] },
      limit: { type: "number", description: `Máximo de resultados (tope ${MAX_RECIPIENTS})` },
    },
    required: ["campaignId"],
  },
  handler: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const campaign = await prisma.wACampaign.findFirst({
      where: { id: params.campaignId, waAccountId: { in: accountIds } },
      select: { id: true },
    });
    if (!campaign) return { error: "Campaña no encontrada" };

    const take = Math.min(params.limit ?? 20, MAX_RECIPIENTS);
    const recipients = await prisma.wACampaignRecipient.findMany({
      where: { campaignId: params.campaignId, ...(params.status ? { status: params.status as never } : {}) },
      select: { phoneNumber: true, contactName: true, status: true, errorMessage: true, sentAt: true },
      take,
    });
    return { recipients };
  },
};

export const campaignsDelete: ToolDefinition<{ campaignId: string }> = {
  name: "campaigns.delete",
  riskTier: "CONFIRM",
  description: "Elimina permanentemente una campaña en borrador (DRAFT). No aplica a campañas ya enviadas o en envío. Requiere confirmación humana.",
  parameters: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"] },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const campaign = await prisma.wACampaign.findFirst({ where: { id: params.campaignId, waAccountId: { in: accountIds } }, select: { name: true, status: true } });
    if (!campaign) throw new NotFoundError("Campaña no encontrada");
    return { description: `Eliminar permanentemente la campaña "${campaign.name}" (status actual: ${campaign.status}).`, params };
  },
  executeConfirm: async (params, ctx) => {
    await deleteCampaign(params.campaignId, ctx.userId);
    return { success: true };
  },
};

export const campaignsSend: ToolDefinition<{ campaignId: string }> = {
  name: "campaigns.send",
  riskTier: "CONFIRM",
  description: "Encola el envío masivo de una campaña — manda la plantilla configurada a todos sus destinatarios reales de WhatsApp. Acción irreversible una vez iniciada. Requiere confirmación humana.",
  parameters: { type: "object", properties: { campaignId: { type: "string" } }, required: ["campaignId"] },
  describeConfirm: async (params, ctx) => {
    const accountIds = await getUserAccountIds(ctx.userId);
    const campaign = await prisma.wACampaign.findFirst({
      where: { id: params.campaignId, waAccountId: { in: accountIds } },
      select: { name: true, status: true, recipientCount: true },
    });
    if (!campaign) throw new NotFoundError("Campaña no encontrada");
    return {
      description: `Enviar la campaña "${campaign.name}" a sus ${campaign.recipientCount} destinatarios reales de WhatsApp (status actual: ${campaign.status}).`,
      params,
    };
  },
  executeConfirm: async (params, ctx) => {
    await sendCampaign(params.campaignId, ctx.userId);
    return { success: true };
  },
};
