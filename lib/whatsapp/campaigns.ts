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

// Fallos que reintentar no arregla: el destinatario se dio de baja, está
// bloqueado, su número no recibe WhatsApp o Meta lo excluyó de mensajes de
// marketing (experimento). Todo lo demás (límites de envío, nombre visible sin
// aprobar, método de pago, errores temporales de Meta) sí puede salir en un
// reintento una vez resuelta la causa.
const NON_RETRYABLE_ERRORS = [
  /optó por no recibir/i,
  /stop receiving marketing/i,
  /bloqueado/i,
  /undeliverable/i,
  /part of an experiment/i,
];

export function isRetryableFailure(errorMessage: string | null): boolean {
  return !NON_RETRYABLE_ERRORS.some((re) => re.test(errorMessage ?? ""));
}

async function retryableRecipientIds(campaignId: string): Promise<string[]> {
  const failed = await prisma.wACampaignRecipient.findMany({
    where: { campaignId, status: "FAILED" },
    select: { id: true, errorMessage: true },
  });
  return failed.filter((r) => isRetryableFailure(r.errorMessage)).map((r) => r.id);
}

// Estado del job de envío en la cola: "waiting" = formada detrás de otra
// campaña (la cola envía de una en una), "active" = enviándose ahora. null si
// no hay job vivo. Solo para mostrar avance en la UI; nunca falla la página.
export async function getCampaignSendState(campaignId: string): Promise<"waiting" | "active" | null> {
  try {
    const job = await campaignQueue.getJob(`campaign-send-${campaignId}`);
    if (!job) return null;
    const state = await job.getState();
    if (state === "active") return "active";
    if (state === "waiting" || state === "delayed" || state === "prioritized" || state === "waiting-children") return "waiting";
    return null;
  } catch {
    return null;
  }
}

export async function countRetryableRecipients(campaignId: string): Promise<number> {
  return (await retryableRecipientIds(campaignId)).length;
}

// Retoma una campaña terminada reenviando solo sus destinatarios fallidos
// reintentables, dentro de la MISMA campaña (mismo nombre, etiqueta y
// estadísticas). Los que ya recibieron el mensaje no se tocan: el worker solo
// procesa los PENDING. Mismo claim atómico que sendCampaign() contra el doble
// clic.
export async function retryFailedRecipients(id: string, userId: string): Promise<{ retried: number }> {
  const accountIds = await getUserAccountIds(userId);
  const campaign = await prisma.wACampaign.findFirst({
    where: { id, waAccountId: { in: accountIds } },
    include: { waTemplate: { select: { status: true } } },
  });
  if (!campaign) throw new NotFoundError("Campaña no encontrada");

  if (campaign.status !== "COMPLETED" && campaign.status !== "FAILED") {
    throw new ValidationError("Solo se pueden reintentar campañas que ya terminaron de enviarse");
  }
  if (campaign.waTemplate.status !== "APPROVED") {
    throw new ValidationError("La plantilla ya no está aprobada — sincroniza plantillas y vuelve a intentar");
  }

  const ids = await retryableRecipientIds(id);
  if (ids.length === 0) {
    throw new ValidationError("No hay destinatarios fallidos que se puedan reintentar");
  }

  const retried = await prisma.$transaction(async (tx) => {
    const claimed = await tx.wACampaign.updateMany({
      where: { id, status: { in: ["COMPLETED", "FAILED"] } },
      data: { status: "SENDING", completedAt: null },
    });
    if (claimed.count === 0) {
      throw new ValidationError("La campaña ya está en envío");
    }
    const reset = await tx.wACampaignRecipient.updateMany({
      where: { id: { in: ids }, status: "FAILED" },
      data: { status: "PENDING", errorMessage: null },
    });
    return reset.count;
  });

  // El job del envío original puede seguir guardado como "completed" (BullMQ
  // conserva los últimos 100): con el mismo jobId, add() lo daría por duplicado
  // y no enviaría nada. Se borra ese registro terminado y se encola con el
  // jobId de siempre, para que processStuckCampaignsTick() siga deduplicando
  // contra este mismo job mientras corre.
  const jobId = `campaign-send-${id}`;
  const previous = await campaignQueue.getJob(jobId);
  if (previous) {
    const state = await previous.getState();
    if (state === "completed" || state === "failed") await previous.remove();
  }
  await campaignQueue.add("send", { campaignId: id }, { jobId });

  return { retried };
}
