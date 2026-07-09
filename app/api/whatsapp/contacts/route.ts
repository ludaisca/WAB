import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const accountIds = await getUserAccountIds(session.user.id);

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");
    const leadStatus = searchParams.get("leadStatus");
    const tagId = searchParams.get("tagId");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = {
      accountId: accountId ? accountId : { in: accountIds },
    };
    if (accountId && !accountIds.includes(accountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }
    if (leadStatus) where.leadStatus = leadStatus;
    if (tagId) where.tags = { some: { tagId } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { remoteJid: { contains: search, mode: "insensitive" } },
      ];
    }

    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize")) || 25, 1), 100);

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: {
          id: true,
          accountId: true,
          remoteJid: true,
          name: true,
          leadStatus: true,
          createdAt: true,
          updatedAt: true,
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          chat: { select: { id: true, unreadCount: true, lastMessageAt: true } },
          _count: { select: { notes: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contact.count({ where }),
    ]);

    return NextResponse.json({ items: contacts, total, page, pageSize });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
