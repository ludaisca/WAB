import { prisma } from "@/lib/prisma";
import { campaignQueue } from "@/lib/queue";
import { getTemplateVariables, renderTemplateText } from "@/lib/whatsapp/template-variables";
import { saveMediaFromMeta, isImageMime, isVideoMime } from "@/lib/whatsapp/media-store";
import { sendTemplateMessage } from "@/lib/whatsapp/send-template";
import { shouldUpdateName } from "@/lib/whatsapp/contact-name";

function mediaMessageTypeFromMime(mimeType: string): string {
  if (isImageMime(mimeType)) return "image";
  if (isVideoMime(mimeType)) return "video";
  return "document";
}

interface CampaignJob {
  campaignId: string;
}

// Campañas creadas con scheduledAt quedan en SCHEDULED; este tick (repetible,
// cada minuto — ver workers/index.ts) las reclama cuando vence su hora y las
// encola como un envío normal. El updateMany condicionado a status SCHEDULED
// evita el doble encolado si dos ticks se solapan.
export async function processScheduledCampaignsTick() {
  const now = new Date();
  const due = await prisma.wACampaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true },
    take: 20,
  });

  for (const { id } of due) {
    const claimed = await prisma.wACampaign.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "SENDING", sentAt: now },
    });
    if (claimed.count === 0) continue;
    await campaignQueue.add("send", { campaignId: id });
  }
}

export async function processCampaignJob(job: CampaignJob) {
  const { campaignId } = job;

  const campaign = await prisma.wACampaign.findUnique({
    where: { id: campaignId },
    include: {
      waAccount: true,
      waTemplate: true,
      recipients: { where: { status: "PENDING" } },
    },
  });

  if (!campaign || campaign.status !== "SENDING") return;

  if (
    campaign.waAccount.channel !== "META_CLOUD" ||
    !campaign.waAccount.accessToken ||
    !campaign.waAccount.phoneNumberId
  ) {
    await prisma.wACampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED", completedAt: new Date() },
    });
    return;
  }

  const templateName = campaign.waTemplate.name;
  const language = campaign.waTemplate.language;
  const templateVars = getTemplateVariables(campaign.waTemplate.components);

  // Attribution tag applied to every Contact/WAChat this campaign actually
  // reaches, so agents can tell which campaign brought a lead in.
  const campaignTag = await prisma.tag.upsert({
    where: { name: `Campaña: ${campaign.name}` },
    create: { name: `Campaña: ${campaign.name}` },
    update: {},
  });

  // Header media is identical for every recipient, so it's downloaded once here
  // (not per-recipient inside the loop below) and reused for every WAMessage CRM
  // record created — avoids hammering Meta's API and duplicating the same file
  // on disk hundreds of times. Non-fatal on failure: the campaign still sends,
  // it just won't show the header image in the chat CRM view.
  let headerMedia: { relativePath: string; mimeType: string; bytesSize: number } | null = null;
  if (campaign.headerParam && templateVars.header.format && templateVars.header.format !== "TEXT") {
    try {
      const stored = await saveMediaFromMeta(
        campaign.waAccountId,
        campaign.headerParam,
        campaign.waAccount.accessToken!
      );
      headerMedia = { relativePath: stored.relativePath, mimeType: stored.remoteMimeType, bytesSize: stored.bytesSize };
    } catch {
      headerMedia = null;
    }
  }

  // Contactos que se dieron de baja de mensajes de marketing vía el mecanismo
  // nativo de WhatsApp (webhook user_preferences) — se excluyen de esta y toda
  // campaña futura, sin importar que el CSV/lista manual los incluya.
  const optedOutContacts = await prisma.contact.findMany({
    where: { accountId: campaign.waAccountId, optedOutMarketing: true },
    select: { remoteJid: true },
  });
  const optedOutSet = new Set(optedOutContacts.map((c) => c.remoteJid));

  for (const recipient of campaign.recipients) {
    if (optedOutSet.has(recipient.phoneNumber)) {
      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", errorMessage: "El contacto optó por no recibir mensajes de marketing" },
      });
      continue;
    }
    try {
      const bodyParams = recipient.parameters
        ? Object.values(recipient.parameters as Record<string, string>)
        : [];

      const { wamid } = await sendTemplateMessage(campaign.waAccount, {
        to: recipient.phoneNumber,
        templateName,
        language,
        bodyParams,
        headerFormat: templateVars.header.format,
        headerParam: campaign.headerParam,
        buttonIndex: templateVars.buttonUrl?.index ?? null,
        buttonParam: campaign.buttonParam,
      });

      const sentAt = new Date();

      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", sentAt, wamid: wamid ?? null },
      });

      // Only attribute Contact/WAChat/WAMessage on an actual successful
      // send — a recipient that never got a message shouldn't leave a
      // phantom contact behind.
      const remoteJid = recipient.phoneNumber;
      const contactName = recipient.contactName ?? recipient.phoneNumber;
      const messageBody = renderTemplateText(campaign.waTemplate.components, {
        bodyParams,
        headerParam: campaign.headerParam,
      }) || `Plantilla: ${templateName}`;

      const [existingContact, existingChat] = await Promise.all([
        prisma.contact.findUnique({
          where: { accountId_remoteJid: { accountId: campaign.waAccountId, remoteJid } },
          select: { name: true },
        }),
        prisma.wAChat.findUnique({
          where: { accountId_remoteJid: { accountId: campaign.waAccountId, remoteJid } },
          select: { name: true },
        }),
      ]);
      const contactNameShouldUpdate = shouldUpdateName(contactName, existingContact?.name, remoteJid);
      const chatNameShouldUpdate = shouldUpdateName(contactName, existingChat?.name, remoteJid);

      const contact = await prisma.contact.upsert({
        where: { accountId_remoteJid: { accountId: campaign.waAccountId, remoteJid } },
        create: { accountId: campaign.waAccountId, remoteJid, name: contactName },
        update: contactNameShouldUpdate ? { name: contactName } : {},
      });

      const chat = await prisma.wAChat.upsert({
        where: { accountId_remoteJid: { accountId: campaign.waAccountId, remoteJid } },
        create: {
          accountId: campaign.waAccountId,
          remoteJid,
          name: contactName,
          contactId: contact.id,
          lastMessage: messageBody.slice(0, 500),
          lastMessageAt: sentAt,
        },
        update: {
          ...(chatNameShouldUpdate ? { name: contactName } : {}),
          lastMessage: messageBody.slice(0, 500),
          lastMessageAt: sentAt,
        },
      });

      await prisma.wAMessage.create({
        data: {
          wamid: wamid ?? null,
          chatId: chat.id,
          direction: "OUTBOUND",
          messageType: headerMedia ? mediaMessageTypeFromMime(headerMedia.mimeType) : "template",
          body: messageBody,
          mediaId: headerMedia ? campaign.headerParam : null,
          mediaUrl: headerMedia ? headerMedia.relativePath : null,
          mimeType: headerMedia ? headerMedia.mimeType : null,
          bytesSize: headerMedia ? headerMedia.bytesSize : null,
          status: "sent",
          timestamp: sentAt,
          campaignId: campaign.id,
        },
      });

      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId: contact.id, tagId: campaignTag.id } },
        create: { contactId: contact.id, tagId: campaignTag.id },
        update: {},
      });
      await prisma.chatTag.upsert({
        where: { chatId_tagId: { chatId: chat.id, tagId: campaignTag.id } },
        create: { chatId: chat.id, tagId: campaignTag.id },
        update: {},
      });
    } catch (err) {
      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Error desconocido",
        },
      });
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  // Recontado desde los estados reales de los destinatarios (no acumulado en
  // memoria) para que un reintento de BullMQ a mitad de campaña no sobrescriba
  // los totales con el parcial de la corrida actual — mismo criterio que
  // syncCampaignCounts() en el webhook.
  const counts = await prisma.wACampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const pendingCount = countOf("PENDING");
  const sentTotal = countOf("SENT") + countOf("DELIVERED") + countOf("READ");
  const failedTotal = countOf("FAILED");

  const finalStatus = pendingCount === 0 ? "COMPLETED" : "FAILED";

  await prisma.wACampaign.update({
    where: { id: campaignId },
    data: {
      sentCount: sentTotal,
      failedCount: failedTotal,
      status: finalStatus,
      completedAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      userId: campaign.userId,
      type: finalStatus === "COMPLETED" ? "CAMPAIGN_COMPLETED" : "CAMPAIGN_FAILED",
      title: `Campaña "${campaign.name}"`,
      body: `${sentTotal} enviados, ${failedTotal} fallidos`,
      link: `/whatsapp/campanas/${campaignId}`,
    },
  });
}
