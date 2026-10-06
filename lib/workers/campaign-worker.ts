import { prisma } from "@/lib/prisma";
import { campaignQueue } from "@/lib/queue";
import { getTemplateVariables, renderTemplateText } from "@/lib/whatsapp/template-variables";
import { isImageMime, isVideoMime } from "@/lib/whatsapp/media-store";
import { getOrSaveHeaderMedia } from "@/lib/whatsapp/header-media-cache";
import { sendTemplateMessage } from "@/lib/whatsapp/send-template";
import { shouldUpdateName } from "@/lib/whatsapp/contact-name";
import { estimateMessageCostUsd } from "@/lib/whatsapp/campaign-pricing";

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
    await campaignQueue.add("send", { campaignId: id }, { jobId: `campaign-send-${id}` });
  }
}

const CAMPAIGN_STUCK_MINUTES = 20; // margen generoso sobre lo que tarda normalmente una campaña grande (~10 min para 100+ destinatarios)

// sendCampaign() marca la campaña SENDING + sentAt en la DB *antes* de encolar
// el job real (ver el comentario en lib/whatsapp/campaigns.ts) — si el proceso
// muere justo en esa ventana, o el job arranca y el proceso muere a mitad del
// loop de destinatarios, la campaña queda marcada como "en envío" para
// siempre sin que nada la retome. Pasó en producción: clientes_general_sla90_310726
// quedó en SENDING con sus 72 destinatarios en PENDING y 0 mensajes enviados.
// processCampaignJob() ya es idempotente (relee los PENDING actuales y
// recalcula contadores desde los estados reales en vez de acumular en
// memoria), así que reencolar una campaña atorada resume exactamente donde se
// quedó — sea 0% o 90% procesada — sin duplicar envíos.
export async function processStuckCampaignsTick() {
  const threshold = new Date(Date.now() - CAMPAIGN_STUCK_MINUTES * 60_000);
  const stuck = await prisma.wACampaign.findMany({
    where: {
      status: "SENDING",
      sentAt: { lt: threshold },
      recipients: { some: { status: "PENDING" } },
    },
    select: { id: true },
    take: 20,
  });

  for (const { id } of stuck) {
    await campaignQueue.add("send", { campaignId: id }, { jobId: `campaign-send-${id}` });
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

  // Revalida el status de la plantilla justo antes de enviar de verdad — pudo
  // estar APPROVED al crear/lanzar la campaña y ser rechazada/pausada por Meta
  // mientras esperaba en cola (SCHEDULED) o entre reintentos de BullMQ.
  if (campaign.waTemplate.status !== "APPROVED") {
    await prisma.wACampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED", completedAt: new Date() },
    });
    await prisma.notification.create({
      data: {
        userId: campaign.userId,
        type: "CAMPAIGN_FAILED",
        title: `Campaña "${campaign.name}"`,
        body: "La plantilla ya no está aprobada — no se envió ningún mensaje. Sincroniza plantillas y vuelve a intentar.",
        link: `/whatsapp/campanas/${campaignId}`,
      },
    });
    return;
  }

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
      headerMedia = await getOrSaveHeaderMedia(
        campaign.waAccountId,
        campaign.headerParam,
        campaign.waAccount.accessToken!
      );
    } catch {
      headerMedia = null;
    }
  }

  // Contactos excluidos de envíos de campaña: los que se dieron de baja de
  // mensajes de marketing vía el mecanismo nativo de WhatsApp (webhook
  // user_preferences) y los bloqueados (lista negra, Contact.blockedAt).
  // Ambos se comparan por dígitos del teléfono: el remoteJid de un contacto
  // creado por el webhook trae sufijo "@s.whatsapp.net" mientras que el
  // recipient llega como número pelón — antes este Set se comparaba crudo y
  // el opt-out nunca matcheaba a esos contactos.
  const excludedContacts = await prisma.contact.findMany({
    where: {
      accountId: campaign.waAccountId,
      OR: [{ optedOutMarketing: true }, { blockedAt: { not: null } }],
    },
    select: { remoteJid: true, optedOutMarketing: true },
  });
  const normalizePhone = (p: string) => p.replace(/@.*$/, "").replace(/\D/g, "");
  const optedOutPhones = new Set(
    excludedContacts.filter((c) => c.optedOutMarketing).map((c) => normalizePhone(c.remoteJid))
  );
  const blockedPhones = new Set(
    excludedContacts.filter((c) => !c.optedOutMarketing).map((c) => normalizePhone(c.remoteJid))
  );

  for (const recipient of campaign.recipients) {
    const phoneKey = normalizePhone(recipient.phoneNumber);
    if (optedOutPhones.has(phoneKey) || blockedPhones.has(phoneKey)) {
      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          errorMessage: optedOutPhones.has(phoneKey)
            ? "El contacto optó por no recibir mensajes de marketing"
            : "El contacto está bloqueado",
        },
      });
      continue;
    }
    try {
      const bodyParams = recipient.parameters
        ? Object.values(recipient.parameters as Record<string, string>)
        : [];

      const { wamid, waId } = await sendTemplateMessage(campaign.waAccount, {
        to: recipient.phoneNumber,
        templateName,
        language,
        bodyParams,
        bodyParamNames: templateVars.bodyParamNames,
        headerFormat: templateVars.header.format,
        headerParam: campaign.headerParam,
        buttonIndex: templateVars.buttonUrl?.index ?? null,
        buttonParam: campaign.buttonParam,
      });

      const sentAt = new Date();
      const costUsd = estimateMessageCostUsd(recipient.phoneNumber, campaign.waTemplate.category);

      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", sentAt, wamid: wamid ?? null, costUsd },
      });

      // Only attribute Contact/WAChat/WAMessage on an actual successful
      // send — a recipient that never got a message shouldn't leave a
      // phantom contact behind.
      //
      // wa_id canónico de Meta, no recipient.phoneNumber tal cual — evita
      // crear un chat "gemelo" del que recibirá la respuesta real del lead
      // (ver el comentario en sendTemplateMessage sobre el quirk de números
      // mexicanos). Fallback al número original solo si Meta no lo devuelve.
      const remoteJid = waId ?? recipient.phoneNumber;
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

  const costAgg = await prisma.wACampaignRecipient.aggregate({
    where: { campaignId },
    _sum: { costUsd: true },
  });

  const finalStatus = pendingCount === 0 ? "COMPLETED" : "FAILED";

  await prisma.wACampaign.update({
    where: { id: campaignId },
    data: {
      sentCount: sentTotal,
      failedCount: failedTotal,
      totalCostUsd: costAgg._sum.costUsd ?? 0,
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
