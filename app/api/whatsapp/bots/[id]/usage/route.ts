import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
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

    const [totalUsage, recentUsage] = await Promise.all([
      prisma.wABotUsage.aggregate({
        where: { botId: id },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
        _count: true,
      }),
      prisma.wABotUsage.findMany({
        where: { botId: id },
        orderBy: { createdAt: "desc" },
        take: 7,
        select: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
          createdAt: true,
        },
      }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayUsage = await prisma.wABotUsage.aggregate({
      where: {
        botId: id,
        createdAt: { gte: today },
      },
      _sum: {
        totalTokens: true,
        estimatedCost: true,
      },
    });

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthUsage = await prisma.wABotUsage.aggregate({
      where: {
        botId: id,
        createdAt: { gte: monthStart },
      },
      _sum: {
        totalTokens: true,
        estimatedCost: true,
      },
    });

    return NextResponse.json({
      total: {
        promptTokens: totalUsage._sum.promptTokens ?? 0,
        completionTokens: totalUsage._sum.completionTokens ?? 0,
        totalTokens: totalUsage._sum.totalTokens ?? 0,
        estimatedCost: Math.round((totalUsage._sum.estimatedCost ?? 0) * 10000) / 10000,
        interactions: totalUsage._count,
      },
      today: {
        totalTokens: todayUsage._sum.totalTokens ?? 0,
        estimatedCost: Math.round((todayUsage._sum.estimatedCost ?? 0) * 10000) / 10000,
      },
      month: {
        totalTokens: monthUsage._sum.totalTokens ?? 0,
        estimatedCost: Math.round((monthUsage._sum.estimatedCost ?? 0) * 10000) / 10000,
      },
      recent: recentUsage.reverse().map((u) => ({
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        estimatedCost: Math.round(u.estimatedCost * 10000) / 10000,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
