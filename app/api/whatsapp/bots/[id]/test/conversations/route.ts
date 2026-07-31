import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const bot = await prisma.wABot.findFirst({ where: { id, userId: session.user.id } });
  if (!bot) return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });

  const conversations = await prisma.wABotTestConversation.findMany({
    where: { botId: id },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(conversations);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const bot = await prisma.wABot.findFirst({ where: { id, userId: session.user.id } });
  if (!bot) return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });

  const rl = await rateLimit(`bot-test-conv-create:${session.user.id}`, 20, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas conversaciones nuevas en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const conversation = await prisma.wABotTestConversation.create({ data: { botId: id } });
  return NextResponse.json(conversation, { status: 201 });
}
