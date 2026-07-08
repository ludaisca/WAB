import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const userId = session.user.id;

    const [accounts, chats, messages, bots, campaigns, usage] = await Promise.all([
      prisma.wAAccount.count({ where: { userId } }),
      prisma.wAChat.count({
        where: {
          OR: [
            { account: { userId } },
            { account: { sharedWith: { some: { userId } } } },
          ],
        },
      }),
      prisma.wAMessage.count({
        where: {
          OR: [
            { chat: { account: { userId } } },
            { chat: { account: { sharedWith: { some: { userId } } } } },
          ],
        },
      }),
      prisma.wABot.count({ where: { userId } }),
      prisma.wACampaign.count({ where: { userId } }),
      prisma.wABotUsage.aggregate({
        where: { bot: { userId } },
        _sum: { totalTokens: true, estimatedCost: true },
      }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 13);

    const recentMessages = await prisma.wAMessage.findMany({
      where: {
        createdAt: { gte: weekAgo },
        OR: [
          { chat: { account: { userId } } },
          { chat: { account: { sharedWith: { some: { userId } } } } },
        ],
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const dailyMap: Record<string, number> = {};
    for (const m of recentMessages) {
      const date = m.createdAt.toISOString().split("T")[0];
      dailyMap[date] = (dailyMap[date] || 0) + 1;
    }

    const dailyMessages = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const activeBots = await prisma.wABot.count({
      where: { userId, isActive: true },
    });

    const campaignsCompleted = await prisma.wACampaign.count({
      where: { userId, status: "COMPLETED" },
    });

    return NextResponse.json({
      accounts,
      chats,
      messages,
      bots,
      campaigns,
      activeBots,
      campaignsCompleted,
      totalTokens: usage._sum.totalTokens ?? 0,
      totalCost: Math.round((usage._sum.estimatedCost ?? 0) * 10000) / 10000,
      dailyMessages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
