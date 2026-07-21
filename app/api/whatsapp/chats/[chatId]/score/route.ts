import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatAccessWhere } from "@/lib/whatsapp/chat-visibility";
import { scoreChatWithScorer, LeadScoringError } from "@/lib/whatsapp/lead-scoring";
import { getAccountUserIds } from "@/lib/shared-accounts";
import { checkBudgetAlert } from "@/lib/ai/budget";

async function getOwnedChat(userId: string, role: string | undefined, chatId: string) {
  return prisma.wAChat.findFirst({
    where: { id: chatId, ...(await chatAccessWhere(userId, role)) },
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
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
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
    const chat = await getOwnedChat(session.user.id, session.user.role, chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const scorerId = typeof body?.scorerId === "string" ? body.scorerId : null;
    if (!scorerId) {
      return NextResponse.json({ error: "scorerId es requerido" }, { status: 400 });
    }

    // Igual criterio que el tick programado (lead-scoring-worker.ts): un
    // calificador es usable en este chat si su dueño tiene acceso a la cuenta
    // (dueño literal o grantee de WAAccountShare), no solo si es el dueño
    // literal — antes esto bloqueaba calificar manualmente con un calificador
    // propio sobre una cuenta compartida, aunque ese mismo calificador sí
    // corriera ahí automáticamente.
    const eligibleUserIds = await getAccountUserIds(chat.accountId);
    const scorer = await prisma.wALeadScorerBot.findFirst({
      where: { id: scorerId, userId: { in: eligibleUserIds } },
    });
    if (!scorer) {
      return NextResponse.json({ error: "Calificador no encontrado" }, { status: 404 });
    }

    try {
      const leadScore = await scoreChatWithScorer(chatId, scorer);
      await checkBudgetAlert(scorer.userId, new Date());
      return NextResponse.json(leadScore);
    } catch (err) {
      if (err instanceof LeadScoringError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
