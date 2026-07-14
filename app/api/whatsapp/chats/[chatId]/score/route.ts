import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getAIProvider } from "@/lib/ai/factory";
import { getUserApiKey } from "@/lib/ai/settings";
import { wrapUserPrompt } from "@/lib/ai/prompt-sanitizer";
import type { AIProvider } from "@/lib/ai/types";

const VALID_LABELS = ["frio", "tibio", "caliente"] as const;

const JSON_CONTRACT =
  "Responde ÚNICAMENTE con un bloque ```json ... ``` que contenga el objeto, sin texto adicional antes o después, con esta forma exacta: " +
  '{"score": number (0-100), "label": "frio"|"tibio"|"caliente", "summary": string, "reasons": string[]}. ' +
  "summary es un resumen de 1-2 frases de la conversación. reasons son 2-4 motivos breves de la calificación.";

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

    const scores = await prisma.wALeadScore.findMany({
      where: { chatId },
      include: { scorer: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(scores);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
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

    const body = await req.json().catch(() => ({}));
    const scorerId = typeof body?.scorerId === "string" ? body.scorerId : null;
    if (!scorerId) {
      return NextResponse.json({ error: "scorerId es requerido" }, { status: 400 });
    }

    const scorer = await prisma.wALeadScorerBot.findFirst({
      where: { id: scorerId, userId: chat.account.userId },
    });
    if (!scorer) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
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

    const provider = scorer.provider as AIProvider;
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
      model: scorer.model,
      temperature: 0.2,
      maxTokens: 600,
      messages: [
        { role: "system", content: wrapUserPrompt(scorer.systemPrompt) },
        { role: "system", content: JSON_CONTRACT },
        { role: "user", content: transcript.slice(0, 12000) },
      ],
    });

    const parsed = parseScoreResponse(result.content);
    if (!parsed) {
      return NextResponse.json({ error: "La IA no devolvió un resultado válido" }, { status: 502 });
    }

    const leadScore = await prisma.wALeadScore.upsert({
      where: { chatId_scorerId: { chatId, scorerId } },
      create: {
        chatId,
        scorerId,
        score: parsed.score,
        label: parsed.label,
        summary: parsed.summary,
        reasons: JSON.stringify(parsed.reasons),
        model: scorer.model,
      },
      update: {
        score: parsed.score,
        label: parsed.label,
        summary: parsed.summary,
        reasons: JSON.stringify(parsed.reasons),
        model: scorer.model,
      },
      include: { scorer: { select: { id: true, name: true } } },
    });

    return NextResponse.json(leadScore);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseScoreResponse(raw: string): { score: number; label: string; summary: string; reasons: string[] } | null {
  try {
    // Prefer the fenced ```json block we asked for — falls back to a greedy
    // {...} match for models that ignore the fencing instruction.
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/);
    const jsonMatch = fencedMatch ? fencedMatch[1] : raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) return null;
    const data = JSON.parse(jsonMatch);

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
