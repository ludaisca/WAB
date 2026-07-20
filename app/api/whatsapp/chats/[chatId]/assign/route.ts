import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { getEligibleAssignees } from "@/lib/chat-assignees";

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

    if (assignedToId !== null) {
      const eligible = await getEligibleAssignees(chat.accountId);
      if (!eligible.some((a) => a.id === assignedToId)) {
        return NextResponse.json({ error: "Usuario no válido para esta cuenta" }, { status: 400 });
      }
    }

    const updated = await prisma.wAChat.update({
      where: { id: chatId },
      data: { assignedToId },
      select: {
        id: true,
        assignedToId: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
