import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";

export interface Assignee {
  id: string;
  name: string | null;
  email: string;
}

export async function getEligibleAssignees(accountId: string): Promise<Assignee[]> {
  const account = await prisma.wAAccount.findUnique({
    where: { id: accountId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  const shares = await prisma.wAAccountShare.findMany({
    where: { waAccountId: accountId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });

  const assignees: Assignee[] = [];
  if (account?.user) assignees.push(account.user);
  for (const share of shares) {
    if (!assignees.some((a) => a.id === share.user.id)) {
      assignees.push(share.user);
    }
  }
  return assignees;
}

// Asume que el llamador ya validó que chatId/accountId son visibles/accesibles
// para el usuario que hace la petición (chatAccessWhere) — esta función solo
// valida que el nuevo asignado sea elegible para esa cuenta y aplica el cambio.
export async function assignChat(chatId: string, assignedToId: string | null, accountId: string) {
  if (assignedToId !== null) {
    const eligible = await getEligibleAssignees(accountId);
    if (!eligible.some((a) => a.id === assignedToId)) {
      throw new ValidationError("Usuario no válido para esta cuenta");
    }
  }

  return prisma.wAChat.update({
    where: { id: chatId },
    data: { assignedToId },
    select: {
      id: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
}
