import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";

const statsCache = new Map<string, { data: Estadisticas; expiresAt: number }>();
const STATS_TTL_MS = 60_000;

export interface Estadisticas {
  accounts: number;
  chats: number;
  messages: number;
  bots: number;
  campaigns: number;
  activeBots: number;
  campaignsCompleted: number;
  totalTokens: number;
  totalCost: number;
  dailyMessages: Array<{ date: string; count: number }>;
  chatStatusCounts: Array<{ status: string; count: number }>;
  botBreakdown: Array<{
    id: string;
    name: string;
    isActive: boolean;
    status: string;
    interactions: number;
    totalTokens: number;
    totalCost: number;
  }>;
  accountBreakdown: Array<{
    id: string;
    name: string;
    phoneNumber: string | null;
    chats: number;
  }>;
  agentPerformance: Array<{
    userId: string;
    userName: string | null;
    resolvedCount: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  }>;
  monthlyCost: number;
  monthlyBudgetUsd: number | null;
}

export async function getEstadisticas(userId: string): Promise<Estadisticas> {
  const cached = statsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const accountIds = await getUserAccountIds(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const chartStart = new Date(today);
  chartStart.setDate(chartStart.getDate() - 13);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const accountWhere = { id: { in: accountIds } };
  const chatWhere = {
    OR: [
      { account: { userId } },
      { account: { sharedWith: { some: { userId } } } },
    ],
  };

  const [
    accounts,
    chats,
    messages,
    bots,
    campaigns,
    usage,
    recentMessages,
    activeBots,
    campaignsCompleted,
    botsList,
    usageByBot,
    accountsList,
    chatCountsByAccount,
    monthlyUsage,
    appSettings,
    assignedChats,
    chatStatusCounts,
  ] = await Promise.all([
    prisma.wAAccount.count({ where: accountWhere }),
    prisma.wAChat.count({ where: chatWhere }),
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
    prisma.wAMessage.findMany({
      where: {
        createdAt: { gte: chartStart },
        OR: [
          { chat: { account: { userId } } },
          { chat: { account: { sharedWith: { some: { userId } } } } },
        ],
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.wABot.count({ where: { userId, isActive: true } }),
    prisma.wACampaign.count({ where: { userId, status: "COMPLETED" } }),
    prisma.wABot.findMany({
      where: { userId },
      select: { id: true, name: true, isActive: true, status: true },
    }),
    prisma.wABotUsage.groupBy({
      by: ["botId"],
      where: { bot: { userId } },
      _sum: { totalTokens: true, estimatedCost: true },
      _count: { _all: true },
    }),
    prisma.wAAccount.findMany({
      where: accountWhere,
      select: { id: true, name: true, phoneNumber: true },
    }),
    prisma.wAChat.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accountIds } },
      _count: { _all: true },
    }),
    prisma.wABotUsage.aggregate({
      where: { bot: { userId }, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    }),
    prisma.appSettings.findUnique({ where: { userId }, select: { monthlyBudgetUsd: true } }),
    prisma.wAChat.findMany({
      where: {
        assignedToId: { not: null },
        OR: [
          { account: { userId } },
          { account: { sharedWith: { some: { userId } } } },
        ],
      },
      select: {
        assignedToId: true,
        assignedTo: { select: { name: true } },
        status: true,
        createdAt: true,
        firstResponseAt: true,
        resolvedAt: true,
      },
    }),
    prisma.wAChat.groupBy({
      by: ["status"],
      where: chatWhere,
      _count: { _all: true },
    }),
  ]);

  const dailyMap: Record<string, number> = {};
  for (const m of recentMessages) {
    const date = m.createdAt.toISOString().split("T")[0];
    dailyMap[date] = (dailyMap[date] || 0) + 1;
  }

  const dailyMessages = Object.entries(dailyMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const botBreakdown = botsList
    .map((b) => {
      const u = usageByBot.find((x) => x.botId === b.id);
      return {
        id: b.id,
        name: b.name,
        isActive: b.isActive,
        status: b.status,
        interactions: u?._count._all ?? 0,
        totalTokens: u?._sum.totalTokens ?? 0,
        totalCost: Math.round((u?._sum.estimatedCost ?? 0) * 10000) / 10000,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const accountBreakdown = accountsList
    .map((a) => ({
      id: a.id,
      name: a.name,
      phoneNumber: a.phoneNumber,
      chats: chatCountsByAccount.find((c) => c.accountId === a.id)?._count._all ?? 0,
    }))
    .sort((a, b) => b.chats - a.chats);

  const agentMap = new Map<string, {
    userName: string | null;
    resolvedCount: number;
    responseTimes: number[];
    resolutionTimes: number[];
  }>();
  for (const c of assignedChats) {
    const id = c.assignedToId!;
    if (!agentMap.has(id)) {
      agentMap.set(id, { userName: c.assignedTo?.name ?? null, resolvedCount: 0, responseTimes: [], resolutionTimes: [] });
    }
    const entry = agentMap.get(id)!;
    if (c.status === "RESOLVED") entry.resolvedCount++;
    if (c.firstResponseAt) entry.responseTimes.push((c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60000);
    if (c.resolvedAt) entry.resolutionTimes.push((c.resolvedAt.getTime() - c.createdAt.getTime()) / 60000);
  }

  const avg = (values: number[]): number | null =>
    values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  const agentPerformance = Array.from(agentMap.entries())
    .map(([userId, entry]) => ({
      userId,
      userName: entry.userName,
      resolvedCount: entry.resolvedCount,
      avgFirstResponseMinutes: avg(entry.responseTimes),
      avgResolutionMinutes: avg(entry.resolutionTimes),
    }))
    .sort((a, b) => b.resolvedCount - a.resolvedCount);

  const payload: Estadisticas = {
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
    chatStatusCounts: chatStatusCounts.map((c) => ({ status: c.status, count: c._count._all })),
    botBreakdown,
    accountBreakdown,
    agentPerformance,
    monthlyCost: Math.round((monthlyUsage._sum.estimatedCost ?? 0) * 10000) / 10000,
    monthlyBudgetUsd: appSettings?.monthlyBudgetUsd ?? null,
  };

  statsCache.set(userId, { data: payload, expiresAt: Date.now() + STATS_TTL_MS });

  return payload;
}
