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

/**
 * Inverso de `getUserAccountIds`: dado un accountId, qué usuarios lo tienen
 * dentro de su propio `getUserAccountIds()` (el dueño + cada grantee de
 * `WAAccountShare`). Úsalo cuando necesites saber "quién puede tocar esta
 * cuenta", no "qué cuentas puede tocar este usuario".
 */
export async function getAccountUserIds(accountId: string): Promise<string[]> {
  const [account, shares] = await Promise.all([
    prisma.wAAccount.findUnique({ where: { id: accountId }, select: { userId: true } }),
    prisma.wAAccountShare.findMany({ where: { waAccountId: accountId }, select: { userId: true } }),
  ]);

  const ownerId = account ? [account.userId] : [];
  const shareUserIds = shares.map((s) => s.userId);
  return [...new Set([...ownerId, ...shareUserIds])];
}
