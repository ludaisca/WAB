import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; convId: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id, convId } = await params;
  const bot = await prisma.wABot.findFirst({ where: { id, userId: session.user.id } });
  if (!bot) return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });

  const conversation = await prisma.wABotTestConversation.findFirst({
    where: { id: convId, botId: id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  return NextResponse.json(conversation);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; convId: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id, convId } = await params;
  const bot = await prisma.wABot.findFirst({ where: { id, userId: session.user.id } });
  if (!bot) return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });

  const conversation = await prisma.wABotTestConversation.findFirst({ where: { id: convId, botId: id } });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  await prisma.wABotTestConversation.delete({ where: { id: convId } });
  return NextResponse.json({ success: true });
}
