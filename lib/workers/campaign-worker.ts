import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { getTemplateVariables } from "@/lib/whatsapp/template-variables";

interface CampaignJob {
  campaignId: string;
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

  const accessToken = decrypt(campaign.waAccount.accessToken);
  const templateName = campaign.waTemplate.name;
  const language = campaign.waTemplate.language;
  const phoneNumberId = campaign.waAccount.phoneNumberId;
  const templateVars = getTemplateVariables(campaign.waTemplate.components);

  // Attribution tag applied to every Contact/WAChat this campaign actually
  // reaches, so agents can tell which campaign brought a lead in.
  const campaignTag = await prisma.tag.upsert({
    where: { name: `Campaña: ${campaign.name}` },
    create: { name: `Campaña: ${campaign.name}` },
    update: {},
  });

  let totalSuccess = 0;
  let totalFailed = 0;

  for (const recipient of campaign.recipients) {
    try {
      const body: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient.phoneNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
        },
      };

      const templateComponents: Record<string, unknown>[] = [];

      if (recipient.parameters) {
        const params = recipient.parameters as Record<string, string>;
        templateComponents.push({
          type: "body",
          parameters: Object.entries(params).map(([, value]) => ({
            type: "text",
            text: value,
          })),
        });
      }

      if (campaign.headerParam && templateVars.header.format) {
        if (templateVars.header.format === "TEXT") {
          templateComponents.push({
            type: "header",
            parameters: [{ type: "text", text: campaign.headerParam }],
          });
        } else {
          // headerParam holds a Meta media ID (uploaded via /api/whatsapp/media at
          // campaign creation), not a public URL — templates require binary media.
          const mediaType = templateVars.header.format.toLowerCase();
          templateComponents.push({
            type: "header",
            parameters: [{ type: mediaType, [mediaType]: { id: campaign.headerParam } }],
          });
        }
      }

      if (campaign.buttonParam && templateVars.buttonUrl) {
        templateComponents.push({
          type: "button",
          sub_type: "url",
          index: String(templateVars.buttonUrl.index),
          parameters: [{ type: "text", text: campaign.buttonParam }],
        });
      }

      if (templateComponents.length > 0) {
        (body.template as Record<string, unknown>).components = templateComponents;
      }

      let res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") || "5");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }
        );
      }

      if (res.ok) {
        const responseData = (await res.json()) as {
          messages?: Array<{ id: string }>;
        };
        const wamid = responseData?.messages?.[0]?.id;
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
        const messageBody = recipient.parameters
          ? `Plantilla: ${templateName} — ${Object.values(recipient.parameters as Record<string, string>).join(", ")}`
          : `Plantilla: ${templateName}`;

        const contact = await prisma.contact.upsert({
          where: { accountId_remoteJid: { accountId: campaign.waAccountId, remoteJid } },
          create: { accountId: campaign.waAccountId, remoteJid, name: contactName },
          update: {},
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
            lastMessage: messageBody.slice(0, 500),
            lastMessageAt: sentAt,
          },
        });

        await prisma.wAMessage.create({
          data: {
            wamid: wamid ?? null,
            chatId: chat.id,
            direction: "OUTBOUND",
            messageType: "template",
            body: messageBody,
            status: "sent",
            timestamp: sentAt,
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

        totalSuccess++;
      } else {
        const errorBody = await res.json().catch(() => ({}));
        await prisma.wACampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "FAILED",
            errorMessage:
              (errorBody as { error?: { message?: string } })?.error
                ?.message ?? `Error HTTP ${res.status}`,
          },
        });
        totalFailed++;
      }
    } catch (err) {
      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Error desconocido",
        },
      });
      totalFailed++;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const pendingCount = await prisma.wACampaignRecipient.count({
    where: { campaignId, status: "PENDING" },
  });

  const finalStatus = pendingCount === 0 ? "COMPLETED" : "FAILED";

  await prisma.wACampaign.update({
    where: { id: campaignId },
    data: {
      sentCount: totalSuccess,
      failedCount: totalFailed,
      status: finalStatus,
      completedAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      userId: campaign.userId,
      type: finalStatus === "COMPLETED" ? "CAMPAIGN_COMPLETED" : "CAMPAIGN_FAILED",
      title: `Campaña "${campaign.name}"`,
      body: `${totalSuccess} enviados, ${totalFailed} fallidos`,
      link: `/whatsapp/campanas/${campaignId}`,
    },
  });
}
