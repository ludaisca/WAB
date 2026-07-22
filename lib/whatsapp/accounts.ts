import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

export async function updateAccountOrigen(id: string, userId: string, origen: string | null) {
  const existing = await prisma.wAAccount.findFirst({ where: { id, userId } });
  if (!existing) throw new NotFoundError("Cuenta no encontrada");

  return prisma.wAAccount.update({
    where: { id },
    data: { origen: origen || null },
    select: { id: true, name: true, origen: true },
  });
}

// Cuenta cuántos registros dependientes se llevaría en cascada un borrado —
// usado por el tool CONFIRM del agente (describeConfirm) para que el humano
// no confirme a ciegas, ver plan del agente §3.
export async function countAccountDependents(id: string) {
  const [chats, templates, campaigns, bots, contacts] = await Promise.all([
    prisma.wAChat.count({ where: { accountId: id } }),
    prisma.wATemplate.count({ where: { waAccountId: id } }),
    prisma.wACampaign.count({ where: { waAccountId: id } }),
    prisma.wABot.count({ where: { waAccountId: id } }),
    prisma.contact.count({ where: { accountId: id } }),
  ]);
  return { chats, templates, campaigns, bots, contacts };
}

export async function deleteAccount(id: string, userId: string) {
  const existing = await prisma.wAAccount.findFirst({ where: { id, userId } });
  if (!existing) throw new NotFoundError("Cuenta no encontrada");

  await prisma.wAAccount.delete({ where: { id } });
}
