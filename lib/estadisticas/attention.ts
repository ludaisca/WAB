import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMonthlyAiCost } from "@/lib/ai/budget";
import { startOfMonthInTz } from "@/lib/timezone";

// Operational queries use exactly the inbox visibility, including shared
// accounts. Unread and pending are separate, intentionally overlapping counts.
export async function getAttentionSummary(userId: string, isAdmin: boolean, chatWhere: Prisma.WAChatWhereInput) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [unreadChats, pendingChats, failedSends, botErrors, monthlyCost, settings, lastBackup] = await Promise.all([
    prisma.wAChat.count({ where: { AND: [chatWhere, { unreadCount: { gt: 0 } }] } }),
    prisma.wAChat.count({ where: { AND: [chatWhere, { status: "PENDING" }] } }),
    prisma.wAMessage.count({ where: { chat: chatWhere, direction: "OUTBOUND", status: "FAILED", timestamp: { gte: since } } }),
    isAdmin ? prisma.wABot.count({ where: { userId, isActive: true, status: "ERROR" } }) : Promise.resolve(0),
    isAdmin ? getMonthlyAiCost(userId, startOfMonthInTz(new Date())) : Promise.resolve(0),
    isAdmin ? prisma.appSettings.findUnique({ where: { userId }, select: { monthlyBudgetUsd: true } }) : Promise.resolve(null),
    isAdmin ? prisma.systemBackup.findFirst({ where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }) : Promise.resolve(null),
  ]);
  return { unreadChats, pendingChats, failedSends, botErrors, monthlyCost, budget: settings?.monthlyBudgetUsd ?? null, lastBackup: lastBackup?.completedAt ?? null };
}
