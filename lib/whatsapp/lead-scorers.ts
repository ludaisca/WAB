import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

export async function setScorerSchedule(id: string, userId: string, enabled: boolean) {
  const existing = await prisma.wALeadScorerBot.findFirst({ where: { id, userId } });
  if (!existing) throw new NotFoundError("Calificador no encontrado");

  return prisma.wALeadScorerBot.update({
    where: { id },
    // Apagar la corrida programada siempre limpia el intervalo — evita que
    // quede un valor de minutos obsoleto si se reactiva después sin elegir
    // uno explícitamente (misma regla que ya aplicaba el PATCH general).
    data: { scheduleEnabled: enabled, ...(enabled ? {} : { scheduleIntervalMinutes: null }) },
    select: { id: true, name: true, scheduleEnabled: true, scheduleIntervalMinutes: true },
  });
}

export async function deleteScorer(id: string, userId: string) {
  const existing = await prisma.wALeadScorerBot.findFirst({ where: { id, userId } });
  if (!existing) throw new NotFoundError("Calificador no encontrado");

  await prisma.wALeadScorerBot.delete({ where: { id } });
}
