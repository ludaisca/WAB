import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { indexDocument, getKnowledgeForBot, unlinkKnowledgeFromBot } from "@/lib/ai/rag";
import { getUserApiKey } from "@/lib/ai/settings";
import type { AIProvider } from "@/lib/ai/types";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const bot = await prisma.wABot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    const body = (await req.json()) as {
      content: string;
      title: string;
      botIds?: string[];
    };

    const text = body.content;
    const title = body.title || `Documento-${Date.now()}`;
    const botIds = body.botIds?.length ? body.botIds : [id];

    if (!text?.trim()) {
      return NextResponse.json({ error: "El contenido es requerido" }, { status: 400 });
    }

    const provider = bot.provider as AIProvider;
    const apiKey = await getUserApiKey(bot.userId, provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "No hay API key configurada" },
        { status: 400 }
      );
    }

    await indexDocument(title, text, botIds, provider, apiKey);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const bot = await prisma.wABot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    const links = await getKnowledgeForBot(id);

    const documents = links.map((l) => ({
      id: l.knowledge.id,
      title: l.knowledge.title,
      chunkIndex: l.knowledge.chunkIndex,
      sourceName: l.knowledge.sourceName,
      createdAt: l.knowledge.createdAt,
    }));

    return NextResponse.json(documents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const knowledgeId = searchParams.get("knowledgeId");

    if (!knowledgeId) {
      return NextResponse.json({ error: "knowledgeId requerido" }, { status: 400 });
    }

    const bot = await prisma.wABot.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!bot) {
      return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });
    }

    await unlinkKnowledgeFromBot(knowledgeId, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
