import { prisma } from "@/lib/prisma";
import { getEligibleAssignees } from "@/lib/chat-assignees";

/**
 * Auto-asigna un chat sin asignar al agente elegible con menor carga actual
 * (chats OPEN/PENDING), respetando `User.maxOpenChats` (null = sin límite).
 * No hace nada si la cuenta no tiene `autoAssignEnabled`. Devuelve el id del
 * usuario asignado, o null si no aplica o no hay candidatos disponibles.
 */
export async function autoAssignChat(accountId: string, chatId: string): Promise<string | null> {
  const account = await prisma.wAAccount.findUnique({
    where: { id: accountId },
    select: { autoAssignEnabled: true },
  });
  if (!account?.autoAssignEnabled) return null;

  const candidates = await getEligibleAssignees(accountId);
  if (candidates.length === 0) return null;

  const candidateIds = candidates.map((c) => c.id);

  // El webhook procesa mensajes de remitentes distintos de la misma cuenta en
  // paralelo (Promise.all) — sin este lock, dos autoAssignChat concurrentes
  // pueden leer la misma carga "antes de escribir" y elegir ambos al mismo
  // agente, saltándose maxOpenChats. pg_advisory_xact_lock serializa las
  // llamadas por cuenta (se libera solo al terminar la transacción) sin
  // necesitar un SELECT ... FOR UPDATE sobre una fila que no existe todavía.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;

    const [users, openCounts] = await Promise.all([
      tx.user.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, maxOpenChats: true },
      }),
      tx.wAChat.groupBy({
        by: ["assignedToId"],
        where: { accountId, assignedToId: { in: candidateIds }, status: { in: ["OPEN", "PENDING"] } },
        _count: { _all: true },
      }),
    ]);

    const maxByUser = new Map(users.map((u) => [u.id, u.maxOpenChats]));
    const loadByUser = new Map(openCounts.map((c) => [c.assignedToId as string, c._count._all]));

    let best: { id: string; load: number } | null = null;
    for (const candidateId of candidateIds) {
      const max = maxByUser.get(candidateId) ?? null;
      const load = loadByUser.get(candidateId) ?? 0;
      if (max !== null && load >= max) continue;
      if (!best || load < best.load) best = { id: candidateId, load };
    }

    if (!best) return null;

    await tx.wAChat.update({
      where: { id: chatId },
      data: { assignedToId: best.id },
    });

    return best.id;
  });
}
