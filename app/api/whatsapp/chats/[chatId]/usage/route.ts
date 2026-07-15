import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

// One row here is one AI call — the closest thing to a "per message" cost
// this schema can express: a bot reply is normally one call → one outbound
// WAMessage, but a humanized reply splits into several WAMessage chunks
// from a single call, and a lead-scorer run produces no WAMessage at all.
// So this returns a per-interaction list (source + timestamp + cost) rather
// than trying to force a strict 1:1 link to a WAMessage id.
interface UsageEntry {
  source: "bot" | "scorer";
  name: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string;
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
    const accountIds = await getUserAccountIds(session.user.id);

    const chat = await prisma.wAChat.findFirst({
      where: { id: chatId, accountId: { in: accountIds } },
      select: { id: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat no encontrado" }, { status: 404 });
    }

    const [botUsage, scorerUsage] = await Promise.all([
      prisma.wABotUsage.findMany({
        where: { waChatId: chatId },
        orderBy: { createdAt: "desc" },
        select: {
          model: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
          createdAt: true,
          bot: { select: { name: true } },
        },
      }),
      prisma.wALeadScorerUsage.findMany({
        where: { waChatId: chatId },
        orderBy: { createdAt: "desc" },
        select: {
          model: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
          createdAt: true,
          scorer: { select: { name: true } },
        },
      }),
    ]);

    const entries: UsageEntry[] = [
      ...botUsage.map((u) => ({
        source: "bot" as const,
        name: u.bot.name,
        model: u.model,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        estimatedCost: u.estimatedCost,
        createdAt: u.createdAt.toISOString(),
      })),
      ...scorerUsage.map((u) => ({
        source: "scorer" as const,
        name: u.scorer.name,
        model: u.model,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        estimatedCost: u.estimatedCost,
        createdAt: u.createdAt.toISOString(),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const totalCost = entries.reduce((sum, e) => sum + e.estimatedCost, 0);
    const totalTokens = entries.reduce((sum, e) => sum + e.totalTokens, 0);

    return NextResponse.json({
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalTokens,
      interactions: entries.length,
      entries,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
