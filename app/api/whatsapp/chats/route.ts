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

    if (accountId && !accountIds.includes(accountId)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const where: Record<string, unknown> = {
      accountId: accountId ? accountId : { in: accountIds },
    };

    const statusParam = searchParams.get("status");
    if (statusParam) {
      const statuses = statusParam.split(",").filter((s) => ["OPEN", "PENDING", "RESOLVED"].includes(s));
      if (statuses.length > 0) where.status = { in: statuses };
    }

    // Paginación opt-in: sin `page`/`pageSize` en la query se preserva el
    // comportamiento legado (array plano completo) para los consumidores
    // que aún no la usan (dashboard/page.tsx, whatsapp/page.tsx).
    const pageParam = searchParams.get("page");
    const paginate = pageParam !== null;
    const page = Math.max(1, Number(pageParam) || 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize")) || 30, 1), 100);

    const select = {
      id: true,
      accountId: true,
      remoteJid: true,
      name: true,
      isGroup: true,
      lastMessage: true,
      lastMessageAt: true,
      unreadCount: true,
      contactId: true,
      status: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
      account: {
        select: { id: true, name: true, phoneNumber: true },
      },
    } as const;

    const [chats, total] = await Promise.all([
      prisma.wAChat.findMany({
        where,
        select,
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        ...(paginate ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      paginate ? prisma.wAChat.count({ where }) : Promise.resolve(null),
    ]);

    if (paginate) {
      return NextResponse.json({ items: chats, total, page, pageSize });
    }
    return NextResponse.json(chats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
