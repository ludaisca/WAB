import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { chatId } = await params;
    const accountIds = await getUserAccountIds(session.user.id);

    const chat = await prisma.wAChat.findFirst({
      where: {
        id: chatId,
        accountId: { in: accountIds },
      },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const before = searchParams.get("before");
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    const where: Record<string, unknown> = { chatId };
    if (before) {
      where.timestamp = { lt: new Date(before) };
    }

    const messages = await prisma.wAMessage.findMany({
      where,
      select: {
        id: true,
        direction: true,
        messageType: true,
        body: true,
        mediaId: true,
        mediaUrl: true,
        mimeType: true,
        status: true,
        timestamp: true,
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    await prisma.wAChat.update({
      where: { id: chatId },
      data: { unreadCount: 0 },
    });

    return NextResponse.json(messages.reverse());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
