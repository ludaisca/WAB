import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { handleUserMessage } from "@/lib/agent/orchestrator";

const TITLE_MAX_LEN = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rl = await rateLimit(`agent-message:${session.user.id}`, 20, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiados mensajes en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const { id } = await params;
  const conversation = await prisma.agentConversation.findFirst({ where: { id, userId: session.user.id } });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "El mensaje no puede estar vacío" }, { status: 400 });

  try {
    await handleUserMessage(id, session.user.id, text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Título autogenerado del primer mensaje — solo se pone una vez.
  if (!conversation.title) {
    const title = text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text;
    await prisma.agentConversation.update({ where: { id }, data: { title } });
  }

  const updated = await prisma.agentConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } }, actions: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(updated);
}
