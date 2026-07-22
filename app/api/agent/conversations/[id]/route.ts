import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const conversation = await prisma.agentConversation.findFirst({
    where: { id, userId: session.user.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      actions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  return NextResponse.json(conversation);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const conversation = await prisma.agentConversation.findFirst({ where: { id, userId: session.user.id } });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  await prisma.agentConversation.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
