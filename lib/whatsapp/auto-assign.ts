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

  const [users, openCounts] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, maxOpenChats: true },
    }),
    prisma.wAChat.groupBy({
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

  await prisma.wAChat.update({
    where: { id: chatId },
    data: { assignedToId: best.id },
  });

  return best.id;
}
