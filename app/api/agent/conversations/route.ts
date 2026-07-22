import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const conversations = await prisma.agentConversation.findMany({
    where: { userId: session.user.id },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(conversations);
}

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rl = await rateLimit(`agent-conv-create:${session.user.id}`, 20, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiadas conversaciones nuevas en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const conversation = await prisma.agentConversation.create({ data: { userId: session.user.id } });
  return NextResponse.json(conversation, { status: 201 });
}
