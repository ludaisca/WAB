import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

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

    const chatTags = await prisma.chatTag.findMany({
      where: { chatId },
      select: { tag: { select: { id: true, name: true, color: true } } },
    });

    return NextResponse.json(chatTags.map((ct) => ct.tag));
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
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
    const tagId = body?.tagId;
    if (!tagId || typeof tagId !== "string") {
      return NextResponse.json({ error: "tagId es requerido" }, { status: 400 });
    }

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) {
      return NextResponse.json({ error: "Etiqueta no encontrada" }, { status: 404 });
    }

    await prisma.chatTag.upsert({
      where: { chatId_tagId: { chatId, tagId } },
      create: { chatId, tagId },
      update: {},
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
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

    const { searchParams } = new URL(req.url);
    const tagId = searchParams.get("tagId");
    if (!tagId) {
      return NextResponse.json({ error: "tagId es requerido" }, { status: 400 });
    }

    await prisma.chatTag.deleteMany({ where: { chatId, tagId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api] Error interno:", error);
    const message = "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
