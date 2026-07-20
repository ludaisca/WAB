import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";

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
    const accessWhere = await chatAccessWhere(session.user.id, session.user.role);

    const chat = await prisma.wAChat.findFirst({
      where: { id: chatId, ...accessWhere },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const before = searchParams.get("before");
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    const where: Record<string, unknown> = { chatId };
    if (before) {
      const beforeDate = new Date(before);
      if (isNaN(beforeDate.getTime())) {
        return NextResponse.json({ error: "Parámetro 'before' inválido" }, { status: 400 });
      }
      where.timestamp = { lt: beforeDate };
    }

    const messages = await prisma.wAMessage.findMany({
      where,
      select: {
        id: true,
        direction: true,
        messageType: true,
        body: true,
        caption: true,
        mediaId: true,
        mediaUrl: true,
        mimeType: true,
        filename: true,
        bytesSize: true,
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
