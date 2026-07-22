import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import type { ChatStatus } from "@prisma/client";

// Asume que el llamador ya validó que el chatId es visible/accesible para el
// usuario (chatAccessWhere) — esta función solo aplica la transición de
// estado y la regla de resolvedAt.
export async function setChatStatus(chatId: string, status: ChatStatus) {
  const chat = await prisma.wAChat.findUnique({ where: { id: chatId }, select: { status: true } });
  if (!chat) throw new NotFoundError("Chat no encontrado");

  const wasResolved = chat.status === "RESOLVED";
  const willBeResolved = status === "RESOLVED";

  return prisma.wAChat.update({
    where: { id: chatId },
    data: {
      status,
      resolvedAt: willBeResolved ? new Date() : wasResolved && !willBeResolved ? null : undefined,
    },
    select: { id: true, status: true, resolvedAt: true },
  });
}
