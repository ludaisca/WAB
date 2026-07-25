import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";
import { ensurePublicChatTokensForChats, publicChatUrl } from "@/lib/whatsapp/chat-public-link";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // chatAccessWhere() ya trae accountId + la restricción de
    // hideUnattributedChats — sin esto, "Leads calificados" (abierta a todos
    // los roles) le mostraba a un user/ejecutivo el detalle de chats que su
    // propio inbox les esconde a propósito.
    const scores = await prisma.wALeadScore.findMany({
      where: { chat: await chatAccessWhere(session.user.id, session.user.role) },
      include: {
        scorer: { select: { id: true, name: true } },
        chat: {
          select: {
            id: true,
            name: true,
            remoteJid: true,
            status: true,
            accountId: true,
            account: { select: { id: true, name: true, origen: true } },
            contact: { select: { realName: true } },
            publicShareToken: true,
            messages: CHAT_ATTRIBUTION_MESSAGE_QUERY,
          },
        },
      },
      orderBy: { score: "desc" },
      take: 500,
    });

    // Un token por chat, no por score — un mismo chat puede tener varios
    // WALeadScore (uno por calificador) y todos deben apuntar al mismo link.
    const tokens = await ensurePublicChatTokensForChats(
      scores.map((s) => ({ id: s.chat.id, publicShareToken: s.chat.publicShareToken }))
    );

    const rows = scores.map(({ chat, ...score }) => {
      const { messages, publicShareToken, ...chatRest } = chat;
      return {
        ...score,
        chat: { ...chatRest, publicLink: publicChatUrl(tokens.get(chat.id)!) },
        campaign: resolveChatAttribution(messages),
      };
    });

    return NextResponse.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
