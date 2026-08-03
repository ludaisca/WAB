import { prisma } from "@/lib/prisma";
import { campaignQueue } from "@/lib/queue";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { NotFoundError, ValidationError } from "@/lib/errors";

export async function deleteCampaign(id: string, userId: string) {
  const accountIds = await getUserAccountIds(userId);
  const campaign = await prisma.wACampaign.findFirst({ where: { id, waAccountId: { in: accountIds } } });
  if (!campaign) throw new NotFoundError("Campaña no encontrada");

  if (campaign.status !== "DRAFT") {
    throw new ValidationError("Solo se pueden eliminar campañas en borrador");
  }

  await prisma.wACampaign.delete({ where: { id } });
}

// El claim atómico (updateMany condicionado al status) es lo único que evita
// un doble-envío si dos clics/peticiones concurrentes llegan a la vez —
// duplicar esta lógica en un segundo sitio (ej. un tool de agente aparte)
// reintroduciría exactamente ese bug.
export async function sendCampaign(id: string, userId: string) {
  const accountIds = await getUserAccountIds(userId);
  const campaign = await prisma.wACampaign.findFirst({
    where: { id, waAccountId: { in: accountIds } },
    include: { waTemplate: { select: { status: true } } },
  });
  if (!campaign) throw new NotFoundError("Campaña no encontrada");

  if (campaign.status === "SENDING" || campaign.status === "COMPLETED") {
    throw new ValidationError("La campaña ya está en envío o completada");
  }

  // Revalida el status actual de la plantilla — pudo aprobarse al crear la
  // campaña y ser rechazada/pausada por Meta después, antes de este envío.
  if (campaign.waTemplate.status !== "APPROVED") {
    throw new ValidationError("La plantilla ya no está aprobada — sincroniza plantillas y vuelve a intentar");
  }

  const claimed = await prisma.wACampaign.updateMany({
    where: { id, status: { notIn: ["SENDING", "COMPLETED"] } },
    data: { status: "SENDING", sentAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new ValidationError("La campaña ya está en envío o completada");
  }

  // jobId determinístico: si el proceso muere entre el updateMany de arriba y
  // este add() (la ventana que dejó campañas reales atoradas en SENDING sin
  // que ningún job llegara a correr), processStuckCampaignsTick() en
  // campaign-worker.ts reencola con el mismo jobId — BullMQ lo dedupea si por
  // alguna otra vía ya quedó un job vivo con este id.
  await campaignQueue.add("send", { campaignId: id }, { jobId: `campaign-send-${id}` });
}
