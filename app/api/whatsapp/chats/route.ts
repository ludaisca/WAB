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

    const chats = await prisma.wAChat.findMany({
      where,
      select: {
        id: true,
        accountId: true,
        remoteJid: true,
        name: true,
        isGroup: true,
        lastMessage: true,
        lastMessageAt: true,
        unreadCount: true,
        createdAt: true,
        updatedAt: true,
        account: {
          select: { id: true, name: true, phoneNumber: true },
        },
      },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    });

    return NextResponse.json(chats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
