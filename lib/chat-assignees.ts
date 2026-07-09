import { prisma } from "@/lib/prisma";

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
