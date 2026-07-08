import { prisma } from "@/lib/prisma";

export async function getUserAccountIds(userId: string): Promise<string[]> {
  const [ownAccounts, shared] = await Promise.all([
    prisma.wAAccount.findMany({
      where: { userId },
      select: { id: true },
    }),
    prisma.wAAccountShare.findMany({
      where: { userId },
      select: { waAccountId: true },
    }),
  ]);

  const directIds = ownAccounts.map((a) => a.id);
  const sharedIds = shared.map((s) => s.waAccountId);
  return [...new Set([...directIds, ...sharedIds])];
}
