import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import type { AIProvider } from "@/lib/ai/types";

const VALID_LABELS = ["frio", "tibio", "caliente"] as const;

async function getOwnedChat(userId: string, chatId: string) {
  const accountIds = await getUserAccountIds(userId);
  return prisma.wAChat.findFirst({
    where: { id: chatId, accountId: { in: accountIds } },
    include: { account: { select: { userId: true } } },
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

    const score = await prisma.wALeadScore.findUnique({ where: { chatId } });
    return NextResponse.json(score);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
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

    const messages = await prisma.wAMessage.findMany({
      where: { chatId },
      orderBy: { timestamp: "asc" },
      take: 200,
      select: { direction: true, body: true, caption: true, messageType: true },
    });

    if (messages.length === 0) {
      return NextResponse.json({ error: "La conversación no tiene mensajes" }, { status: 400 });
    }

    const settings = await prisma.appSettings.findUnique({ where: { userId: chat.account.userId } });
    if (!settings) {
      return NextResponse.json({ error: "El dueño de la cuenta no tiene configuración de IA" }, { status: 400 });
    }

    const provider = settings.defaultProvider as AIProvider;
    const apiKey = await getUserApiKey(chat.account.userId, provider);
    if (!apiKey) {
      return NextResponse.json({ error: "Falta configurar la clave del proveedor de IA" }, { status: 400 });
    }

    const transcript = messages
      .map((m) => {
        const text = m.caption ?? m.body ?? `[${m.messageType}]`;
        return `${m.direction === "INBOUND" ? "Lead" : "Agente"}: ${text}`;
      })
      .join("\n");

    const client = getAIProvider(provider, apiKey);
    const result = await client.complete({
      model: settings.defaultModel,
      temperature: 0.2,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content:
            "Eres un analista de ventas que califica conversaciones de WhatsApp entre un lead y un bot/agente. " +
            "Responde ÚNICAMENTE con JSON válido, sin markdown, con esta forma exacta: " +
            '{"score": number (0-100), "label": "frio"|"tibio"|"caliente", "summary": string, "reasons": string[]}. ' +
            "score y label deben reflejar qué tan calificado está el lead para comprar (interés, presupuesto, urgencia, datos de contacto). " +
            "summary es un resumen de 1-2 frases de la conversación. reasons son 2-4 motivos breves de la calificación.",
        },
        { role: "user", content: transcript.slice(0, 12000) },
      ],
    });

    const parsed = parseScoreResponse(result.content);
    if (!parsed) {
      return NextResponse.json({ error: "La IA no devolvió un resultado válido" }, { status: 502 });
    }

    const leadScore = await prisma.wALeadScore.upsert({
      where: { chatId },
      create: {
        chatId,
        score: parsed.score,
        label: parsed.label,
        summary: parsed.summary,
        reasons: JSON.stringify(parsed.reasons),
        model: settings.defaultModel,
      },
      update: {
        score: parsed.score,
        label: parsed.label,
        summary: parsed.summary,
        reasons: JSON.stringify(parsed.reasons),
        model: settings.defaultModel,
      },
    });

    return NextResponse.json(leadScore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseScoreResponse(raw: string): { score: number; label: string; summary: string; reasons: string[] } | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const data = JSON.parse(jsonMatch[0]);

    const score = Math.max(0, Math.min(100, Math.round(Number(data.score))));
    const label = VALID_LABELS.includes(data.label) ? data.label : score >= 66 ? "caliente" : score >= 33 ? "tibio" : "frio";
    const summary = typeof data.summary === "string" ? data.summary : "";
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((r: unknown) => typeof r === "string") : [];

    if (Number.isNaN(score) || !summary) return null;

    return { score, label, summary, reasons };
  } catch {
    return null;
  }
}
