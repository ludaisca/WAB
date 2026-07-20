import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

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
    const accountIds = await getUserAccountIds(session.user.id);

    const chat = await prisma.wAChat.findFirst({
      where: { id: chatId, accountId: { in: accountIds } },
      select: { status: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const status = body?.status;

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    }

    const wasResolved = chat.status === "RESOLVED";
    const willBeResolved = status === "RESOLVED";

    const updated = await prisma.wAChat.update({
      where: { id: chatId },
      data: {
        status,
        resolvedAt: willBeResolved ? new Date() : wasResolved && !willBeResolved ? null : undefined,
      },
      select: { id: true, status: true, resolvedAt: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
