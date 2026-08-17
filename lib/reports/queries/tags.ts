import { prisma } from "@/lib/prisma";

export interface TagRow {
  id: string;
  name: string;
  color: string;
  contactCount: number;
  chatCount: number;
}

// groupBy explícito sobre ContactTag/ChatTag en vez de _count.select.<relation>.where
// anidado dos niveles (contact.accountId) — más predecible con tsc y ya es el
// mismo patrón que botBreakdown/accountBreakdown en get-stats.ts.
export async function fetchTagRows(accountIds: string[]): Promise<TagRow[]> {
  const [tags, contactCounts, chatCounts] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    prisma.contactTag.groupBy({
      by: ["tagId"],
      where: { contact: { accountId: { in: accountIds } } },
      _count: { _all: true },
    }),
    prisma.chatTag.groupBy({
      by: ["tagId"],
      where: { chat: { accountId: { in: accountIds } } },
      _count: { _all: true },
    }),
  ]);

  const contactMap = new Map(contactCounts.map((c) => [c.tagId, c._count._all]));
  const chatMap = new Map(chatCounts.map((c) => [c.tagId, c._count._all]));

  return tags.map((t) => ({
    ...t,
    contactCount: contactMap.get(t.id) ?? 0,
    chatCount: chatMap.get(t.id) ?? 0,
  }));
}
