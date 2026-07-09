import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMessageSchema } from "@/lib/validations";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getUserAccountIds } from "@/lib/shared-accounts";

export async function POST(
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
      include: { account: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const isFirstResponse = chat.firstResponseAt === null;

    const body = await req.json();
    const parsed = sendMessageSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0].message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { type, body: textBody, mediaId, caption, mimeType } = parsed.data;

    const result = await sendWhatsAppMessage(chat.account, {
      to: chat.remoteJid,
      type,
      body: textBody,
      mediaId,
      caption,
      mimeType,
    });

    const wamid = result.wamid ?? undefined;
    const now = new Date();

    const newMessage = await prisma.wAMessage.create({
      data: {
        wamid,
        chatId: chat.id,
        direction: "OUTBOUND",
        messageType: type,
        body: textBody ?? null,
        mediaId,
        mimeType,
        status: "sent",
        senderId: session.user.id,
        timestamp: now,
      },
    });

    await prisma.wAChat.update({
      where: { id: chat.id },
      data: {
        lastMessage: textBody ?? caption ?? `[${type}]`,
        lastMessageAt: now,
        ...(isFirstResponse ? { firstResponseAt: now } : {}),
      },
    });

    await prisma.wAAccount.update({
      where: { id: chat.account.id },
      data: { lastActivity: now },
    });

    return NextResponse.json(newMessage);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
