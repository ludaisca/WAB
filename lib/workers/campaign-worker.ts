import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

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

  const accessToken = decrypt(campaign.waAccount.accessToken);
  const templateName = campaign.waTemplate.name;
  const language = campaign.waTemplate.language;
  const phoneNumberId = campaign.waAccount.phoneNumberId;

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

      if (recipient.parameters) {
        const params = recipient.parameters as Record<string, string>;
        (body.template as Record<string, unknown>).components = [
          {
            type: "body",
            parameters: Object.entries(params).map(([, value]) => ({
              type: "text",
              text: value,
            })),
          },
        ];
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

        await prisma.wACampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "SENT", sentAt: new Date(), wamid: wamid ?? null },
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
