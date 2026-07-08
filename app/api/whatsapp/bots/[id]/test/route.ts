import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
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

    const { message } = (await req.json()) as { message: string };

    if (!message?.trim()) {
      return NextResponse.json({ error: "El mensaje es requerido" }, { status: 400 });
    }

    const provider = bot.provider as AIProvider;
    const apiKey = await getUserApiKey(bot.userId, provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "No hay API key configurada. Configúrala en Ajustes > IA." },
        { status: 400 }
      );
    }

    const client = getAIProvider(provider, apiKey);

    const messages = [
      { role: "system" as const, content: bot.systemPrompt },
      { role: "user" as const, content: message },
    ];

    const result = await client.complete({
      model: bot.model,
      messages,
      temperature: bot.temperature,
      maxTokens: bot.maxTokens,
    });

    return NextResponse.json({
      response: result.content,
      usage: result.usage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
