import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { setChatStatus } from "@/lib/whatsapp/chat-status";

const VALID_STATUSES = ["OPEN", "PENDING", "RESOLVED"] as const;

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
      select: { id: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const status = body?.status;

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    }

    const updated = await setChatStatus(chatId, status);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
