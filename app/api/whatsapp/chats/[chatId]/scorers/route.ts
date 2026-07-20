import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";

async function getOwnedChat(userId: string, role: string | undefined, chatId: string) {
  return prisma.wAChat.findFirst({
    where: { id: chatId, ...(await chatAccessWhere(userId, role)) },
    include: { account: { select: { userId: true } } },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { chatId } = await params;
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const scorers = await prisma.wALeadScorerBot.findMany({
      where: { userId: chat.account.userId, isActive: true },
      select: { id: true, name: true, provider: true, model: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(scorers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
