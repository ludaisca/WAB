import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { assignChat } from "@/lib/chat-assignees";
import { ValidationError } from "@/lib/errors";

export async function PATCH(
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
      select: { accountId: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const assignedToId: string | null = body?.assignedToId ?? null;

    const updated = await assignChat(chatId, assignedToId, chat.accountId);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
