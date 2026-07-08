import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    const where: Record<string, unknown> = {
      account: { userId: session.user.id },
    };
    if (accountId) where.accountId = accountId;

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
