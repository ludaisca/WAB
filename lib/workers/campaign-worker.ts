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

  let successCount = 0;
  let failCount = 0;

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

      const res = await fetch(
        `https://graph.facebook.com/v21.0/${campaign.waAccount.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (res.ok) {
        const responseData = (await res.json()) as {
          messages?: Array<{ id: string }>;
        };
        const wamid = responseData?.messages?.[0]?.id;

        await prisma.wACampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "SENT", sentAt: new Date(), wamid: wamid ?? null },
        });
        successCount++;
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
        failCount++;
      }
    } catch (err) {
      await prisma.wACampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "Error desconocido",
        },
      });
      failCount++;
    }

    await prisma.wACampaign.update({
      where: { id: campaignId },
      data: {
        sentCount: { increment: successCount },
        failedCount: { increment: failCount },
      },
    });
    successCount = 0;
    failCount = 0;

    await new Promise((r) => setTimeout(r, 100));
  }

  const finalStatus =
    campaign.recipients.filter((r) => r.status === "PENDING").length === 0
      ? "COMPLETED"
      : "COMPLETED";

  await prisma.wACampaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      completedAt: new Date(),
    },
  });
}
