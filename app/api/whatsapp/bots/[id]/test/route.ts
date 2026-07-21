import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { wrapUserPrompt, SCOPE_GUARDRAIL } from "@/lib/ai/prompt-sanitizer";
import { isMonthlyBudgetExceeded, checkBudgetAlert } from "@/lib/ai/budget";
import { estimateCost } from "@/lib/ai/pricing";
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
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
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

    const now = new Date();
    if (await isMonthlyBudgetExceeded(bot.userId, now)) {
      return NextResponse.json(
        { error: "Presupuesto mensual de IA ya superado — no se pudo probar el bot" },
        { status: 400 }
      );
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
      { role: "system" as const, content: wrapUserPrompt(bot.systemPrompt) },
      { role: "system" as const, content: SCOPE_GUARDRAIL },
      { role: "user" as const, content: message },
    ];

    const result = await client.complete({
      model: bot.model,
      messages,
      temperature: bot.temperature,
      maxTokens: bot.maxTokens,
    });

    // Sin esto, probar un bot vía "/test" gastaba dinero real del proveedor sin
    // quedar registrado en WABotUsage — el gasto no contaba para el presupuesto
    // mensual ni para ningún reporte de costo.
    if (result.usage) {
      const promptTokens = result.usage.promptTokens;
      const completionTokens = result.usage.completionTokens;
      const cost = await estimateCost(bot.model, promptTokens, completionTokens, provider);
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
