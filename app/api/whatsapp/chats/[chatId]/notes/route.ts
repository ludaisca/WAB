import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getEligibleAssignees } from "@/lib/chat-assignees";
import { extractMentions } from "@/lib/whatsapp/parse-mentions";
import { noteSchema } from "@/lib/validations";

async function getOwnedChat(userId: string, chatId: string) {
  const accountIds = await getUserAccountIds(userId);
  return prisma.wAChat.findFirst({
    where: { id: chatId, accountId: { in: accountIds } },
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
    const chat = await getOwnedChat(session.user.id, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const notes = await prisma.wAChatNote.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(notes);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    const chat = await getOwnedChat(session.user.id, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const note = await prisma.wAChatNote.create({
      data: {
        chatId,
        authorId: session.user.id,
        body: parsed.data.body,
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    const candidates = await getEligibleAssignees(chat.accountId);
    const mentioned = extractMentions(parsed.data.body, candidates).filter(
      (u) => u.id !== session.user.id
    );

    if (mentioned.length > 0) {
      await prisma.notification.createMany({
        data: mentioned.map((u) => ({
          userId: u.id,
          type: "NOTE_MENTION" as const,
          title: `${note.author.name ?? "Alguien"} te mencionó`,
          body: parsed.data.body.slice(0, 200),
          link: `/whatsapp/chat/${chat.accountId}/${chatId}`,
        })),
      });
    }

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
