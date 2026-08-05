import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserApiKey } from "@/lib/ai/settings";
import { estimateCost } from "@/lib/ai/pricing";
import { isMonthlyBudgetExceeded, checkBudgetAlert } from "@/lib/ai/budget";
import { generateBotReply } from "@/lib/whatsapp/bot-tools/generate-reply";
import type { AIMessage } from "@/lib/ai/types";

const TITLE_MAX_LEN = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; convId: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rl = await rateLimit(`bot-test-message:${session.user.id}`, 20, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Demasiados mensajes en poco tiempo — intenta de nuevo en un minuto" }, { status: 429 });
  }

  const { id, convId } = await params;
  const bot = await prisma.wABot.findFirst({ where: { id, userId: session.user.id } });
  if (!bot) return NextResponse.json({ error: "Bot no encontrado" }, { status: 404 });

  const conversation = await prisma.wABotTestConversation.findFirst({ where: { id: convId, botId: id } });
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "El mensaje no puede estar vacío" }, { status: 400 });

  const now = new Date();
  if (await isMonthlyBudgetExceeded(bot.userId, now)) {
    return NextResponse.json(
      { error: "Presupuesto mensual de IA ya superado — no se pudo probar el bot" },
      { status: 400 }
    );
  }

  const apiKey = await getUserApiKey(bot.userId);
  if (!apiKey) {
    return NextResponse.json(
      { error: "No hay API key configurada. Configúrala en Ajustes > IA." },
      { status: 400 }
    );
  }

  try {
    // Historial previo de ESTA conversación de prueba (sin el turno nuevo,
    // que se agrega como userContent) — se manda completo cada vez, sin
    // replicar el windowing RECENT/SUMMARY de producción: más simple y evita
    // que el bot "olvide" algo a mitad de una prueba larga.
    const priorMessages = await prisma.wABotTestMessage.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "asc" },
    });
    const history: AIMessage[] = priorMessages.map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    await prisma.wABotTestMessage.create({
      data: { conversationId: convId, role: "USER", content: text },
    });

    const replyResult = await generateBotReply({
      bot,
      apiKey,
      ragQuery: text,
      history,
      userContent: text,
      qualifiedData: (conversation.qualifiedData as Record<string, string> | null) ?? undefined,
    });

    await prisma.wABotTestMessage.create({
      data: { conversationId: convId, role: "ASSISTANT", content: replyResult.content },
    });

    if (replyResult.usage) {
      const { promptTokens, completionTokens } = replyResult.usage;
      const cost = await estimateCost(bot.model, promptTokens, completionTokens);
      await prisma.wABotUsage.create({
        data: {
          botId: bot.id,
          model: bot.model,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimatedCost: cost,
        },
      });
      await checkBudgetAlert(bot.userId, now);
    }

    // Título autogenerado del primer mensaje (solo una vez) — el update en sí
    // (con o sin título nuevo) toca @updatedAt para que el sidebar ordene por
    // conversación más reciente. qualifiedData se persiste siempre, igual que
    // en producción (lib/workers/bot-worker.ts).
    await prisma.wABotTestConversation.update({
      where: { id: convId },
      data: {
        qualifiedData: replyResult.qualifiedData,
        ...(conversation.title ? {} : { title: text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const updated = await prisma.wABotTestConversation.findUnique({
    where: { id: convId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(updated);
}
