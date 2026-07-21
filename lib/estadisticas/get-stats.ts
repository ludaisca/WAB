import { prisma } from "@/lib/prisma";
import { getMonthlyAiCost } from "@/lib/ai/budget";
import { getUserAccountIds } from "@/lib/shared-accounts";
import {
  countActiveBots,
  countBots,
  countCampaigns,
  countChats,
  countCompletedCampaigns,
  countMessages,
} from "@/lib/estadisticas/global-counts";
import { CHAT_ATTRIBUTION_MESSAGE_QUERY, resolveChatAttribution } from "@/lib/whatsapp/chat-attribution";

// Mismo orden que VALID_LABELS en lib/whatsapp/lead-scoring.ts, invertido para
// mostrar primero lo más urgente/accionable.
const LABEL_ORDER = ["prioridad_alta", "oportunidad", "interesado", "frio", "descartado"] as const;

const statsCache = new Map<string, { data: Estadisticas; expiresAt: number }>();
const STATS_TTL_MS = 60_000;

// The app server runs in UTC (containers have no TZ set) but every user-facing
// date in this app renders as es-MX. Bucketing dailyMessages/chartStart/monthStart
// by raw UTC would misfile evening messages under tomorrow's date — up to 6h/day
// of drift. These helpers compute boundaries against Mexico City wall-clock time
// instead, without pulling in a date library for one call site.
const STATS_TZ = "America/Mexico_City";

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const asUTC = Date.UTC(
    Number(get("year")), Number(get("month")) - 1, Number(get("day")),
    Number(get("hour")) % 24, Number(get("minute")), Number(get("second"))
  );
  return (asUTC - date.getTime()) / 60000;
}

function dateKeyInTz(date: Date, timeZone: string = STATS_TZ): string {
  return date.toLocaleDateString("en-CA", { timeZone });
}

// Given a calendar date (year/month/day as seen in timeZone), returns the UTC
// instant that is midnight on that date in timeZone.
function utcInstantForLocalMidnight(year: number, month: number, day: number, timeZone: string = STATS_TZ): Date {
  const naiveUTCMidnight = new Date(Date.UTC(year, month - 1, day));
  return new Date(naiveUTCMidnight.getTime() - tzOffsetMinutes(naiveUTCMidnight, timeZone) * 60000);
}

function startOfDayInTz(date: Date, timeZone: string = STATS_TZ): Date {
  const [y, m, d] = dateKeyInTz(date, timeZone).split("-").map(Number);
  return utcInstantForLocalMidnight(y, m, d, timeZone);
}

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
  botBreakdown: Array<{
    id: string;
    name: string;
    status: string;
    isActive: boolean;
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
  // Estado de entrega de mensajes de campaña, separado por origen — campañas
  // masivas (WACampaign, WACampaignRecipient) vs. automatizaciones de leads de
  // Facebook (LeadSheetSource, LeadSheetImportedRow). Ver lib/whatsapp/export-columns.ts
  // para el mismo concepto de "origin" ya usado en el export a CSV/Sheets.
  campaignMessagesByOrigin: Array<CampaignOriginStats>;
  campaignMessageBreakdown: Array<CampaignBreakdownRow>;
  // Chats con al menos una WALeadScore — deduplicados por chat (se usa la
  // calificación de mayor score cuando hay más de un calificador), a
  // diferencia de la pestaña "Leads calificados"/export que lista cada
  // evaluación por separado. Ver lib/whatsapp/chat-attribution.ts para el
  // origen de campaña de cada chat.
  qualifiedChats: {
    total: number;
    byLabel: Array<{ label: string; count: number }>;
  };
  qualifiedChatsByCampaign: Array<{
    id: string | null;
    name: string;
    origin: "manual" | "automatizacion" | null;
    count: number;
  }>;
}

interface CampaignOriginStats {
  origin: "manual" | "automatizacion";
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  // % sobre mensajes efectivamente enviados (sent+delivered+read+failed) — los
  // "pending"/"skipped" no cuentan como intento, así que quedan fuera del denominador.
  deliveryRate: number | null;
  readRate: number | null;
}

interface CampaignBreakdownRow extends CampaignOriginStats {
  id: string;
  name: string;
}

export async function getEstadisticas(userId: string): Promise<Estadisticas> {
  const cached = statsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const accountIds = await getUserAccountIds(userId);

  const now = new Date();
  const today = startOfDayInTz(now);
  const chartStart = new Date(today.getTime() - 13 * 86400000);
  const [todayYear, todayMonth] = dateKeyInTz(now).split("-").map(Number);
  const monthStart = utcInstantForLocalMidnight(todayYear, todayMonth, 1);

  const accountWhere = { id: { in: accountIds } };

  const [
    accounts,
    chats,
    messages,
    bots,
    campaigns,
    usage,
    scorerUsage,
    recoveryUsage,
    recentMessages,
    activeBots,
    campaignsCompleted,
    botsList,
    usageByBot,
    accountsList,
    chatCountsByAccount,
    monthlyCost,
    appSettings,
    assignedChats,
    campaignsForMessageStats,
    leadSheetSources,
    leadSheetStatusGroups,
    leadScores,
  ] = await Promise.all([
    prisma.wAAccount.count({ where: accountWhere }),
    countChats(accountIds),
    countMessages(accountIds),
    countBots(userId),
    countCampaigns(userId),
    prisma.wABotUsage.aggregate({
      where: { bot: { userId } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.wALeadScorerUsage.aggregate({
      where: { scorer: { userId } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.wALeadRecoveryAttempt.aggregate({
      where: { chat: { account: { userId } } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.wAMessage.findMany({
      where: {
        createdAt: { gte: chartStart },
        chat: { accountId: { in: accountIds } },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    countActiveBots(userId),
    countCompletedCampaigns(userId),
    prisma.wABot.findMany({
      where: { userId },
      select: { id: true, name: true, status: true, isActive: true },
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
    // Misma función que usan bot-worker/lead-scoring/lead-recovery para decidir
    // pausar el gasto — así el % de presupuesto mostrado nunca diverge del real.
    getMonthlyAiCost(userId, monthStart),
    prisma.appSettings.findUnique({ where: { userId }, select: { monthlyBudgetUsd: true } }),
    prisma.wAChat.findMany({
      where: {
        assignedToId: { not: null },
        accountId: { in: accountIds },
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
    // Contadores ya vienen agregados en WACampaign (sentCount/deliveredCount/...),
    // actualizados por el webhook de Meta — no hace falta un groupBy sobre
    // WACampaignRecipient. Visibilidad por cuenta, no por creador (mismo criterio
    // que el resto de rutas de campañas, ver AGENTS.md).
    prisma.wACampaign.findMany({
      where: { waAccountId: { in: accountIds } },
      select: { id: true, name: true, sentCount: true, deliveredCount: true, readCount: true, failedCount: true },
    }),
    prisma.leadSheetSource.findMany({
      where: { waAccountId: { in: accountIds } },
      select: { id: true, name: true },
    }),
    // "seeded" nunca se envió (filas ya presentes al conectar la fuente) — no es
    // un resultado de envío, igual que en sheets-sync.ts.
    prisma.leadSheetImportedRow.groupBy({
      by: ["sourceId", "status"],
      where: { source: { waAccountId: { in: accountIds } }, status: { not: "seeded" } },
      _count: { _all: true },
    }),
    prisma.wALeadScore.findMany({
      where: { chat: { accountId: { in: accountIds } } },
      select: {
        chatId: true,
        score: true,
        label: true,
        chat: { select: { messages: CHAT_ATTRIBUTION_MESSAGE_QUERY } },
      },
    }),
  ]);

  const dailyMap: Record<string, number> = {};
  for (const m of recentMessages) {
    const date = dateKeyInTz(m.createdAt);
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
        status: b.status,
        isActive: b.isActive,
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

  function rate(numerator: number, denominator: number): number | null {
    return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
  }

  function toStats(counts: { sent: number; delivered: number; read: number; failed: number }): CampaignOriginStats {
    const total = counts.sent + counts.delivered + counts.read + counts.failed;
    return {
      origin: "manual", // overwritten by callers
      total,
      sent: counts.sent,
      delivered: counts.delivered,
      read: counts.read,
      failed: counts.failed,
      deliveryRate: rate(counts.delivered + counts.read, total),
      readRate: rate(counts.read, total),
    };
  }

  const leadSheetCountsBySource = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
  for (const g of leadSheetStatusGroups) {
    const entry = leadSheetCountsBySource.get(g.sourceId) ?? { sent: 0, delivered: 0, read: 0, failed: 0 };
    const count = g._count._all;
    // "skipped" (contacto opt-out de marketing) se excluye de las tasas — nunca
    // se intentó enviar, no es una entrega/lectura fallida.
    if (g.status === "sent") entry.sent += count;
    else if (g.status === "delivered") entry.delivered += count;
    else if (g.status === "read") entry.read += count;
    else if (g.status === "failed") entry.failed += count;
    leadSheetCountsBySource.set(g.sourceId, entry);
  }

  const manualBreakdown: CampaignBreakdownRow[] = campaignsForMessageStats
    .map((c) => ({
      id: c.id,
      name: c.name,
      ...toStats({ sent: c.sentCount, delivered: c.deliveredCount, read: c.readCount, failed: c.failedCount }),
      origin: "manual" as const,
    }))
    .filter((r) => r.total > 0);

  const automationBreakdown: CampaignBreakdownRow[] = leadSheetSources
    .map((s) => ({
      id: s.id,
      name: s.name,
      ...toStats(leadSheetCountsBySource.get(s.id) ?? { sent: 0, delivered: 0, read: 0, failed: 0 }),
      origin: "automatizacion" as const,
    }))
    .filter((r) => r.total > 0);

  const campaignMessageBreakdown = [...manualBreakdown, ...automationBreakdown].sort((a, b) => b.total - a.total);

  const manualTotals = manualBreakdown.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered, read: acc.read + r.read, failed: acc.failed + r.failed }),
    { sent: 0, delivered: 0, read: 0, failed: 0 }
  );
  const automationTotals = automationBreakdown.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered, read: acc.read + r.read, failed: acc.failed + r.failed }),
    { sent: 0, delivered: 0, read: 0, failed: 0 }
  );

  const campaignMessagesByOrigin: CampaignOriginStats[] = [
    { ...toStats(manualTotals), origin: "manual" },
    { ...toStats(automationTotals), origin: "automatizacion" },
  ];

  const bestScorePerChat = new Map<string, { score: number; label: string; campaign: ReturnType<typeof resolveChatAttribution> }>();
  for (const s of leadScores) {
    const existing = bestScorePerChat.get(s.chatId);
    if (!existing || s.score > existing.score) {
      bestScorePerChat.set(s.chatId, { score: s.score, label: s.label, campaign: resolveChatAttribution(s.chat.messages) });
    }
  }

  const labelCounts = new Map<string, number>();
  const campaignCounts = new Map<string, { id: string | null; name: string; origin: "manual" | "automatizacion" | null; count: number }>();
  for (const { label, campaign } of bestScorePerChat.values()) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

    const key = campaign?.id ?? "__none__";
    const entry = campaignCounts.get(key) ?? { id: campaign?.id ?? null, name: campaign?.name ?? "Sin campaña", origin: campaign?.origin ?? null, count: 0 };
    entry.count++;
    campaignCounts.set(key, entry);
  }

  const qualifiedChats = {
    total: bestScorePerChat.size,
    byLabel: LABEL_ORDER
      .map((label) => ({ label, count: labelCounts.get(label) ?? 0 }))
      .filter((l) => l.count > 0),
  };

  const qualifiedChatsByCampaign = Array.from(campaignCounts.values()).sort((a, b) => b.count - a.count);

  const payload: Estadisticas = {
    accounts,
    chats,
    messages,
    bots,
    campaigns,
    activeBots,
    campaignsCompleted,
    totalTokens:
      (usage._sum.totalTokens ?? 0) +
      (scorerUsage._sum.totalTokens ?? 0) +
      (recoveryUsage._sum.totalTokens ?? 0),
    totalCost:
      Math.round(
        ((usage._sum.estimatedCost ?? 0) +
          (scorerUsage._sum.estimatedCost ?? 0) +
          (recoveryUsage._sum.estimatedCost ?? 0)) *
          10000
      ) / 10000,
    dailyMessages,
    botBreakdown,
    accountBreakdown,
    agentPerformance,
    monthlyCost: Math.round(monthlyCost * 10000) / 10000,
    monthlyBudgetUsd: appSettings?.monthlyBudgetUsd ?? null,
    campaignMessagesByOrigin,
    campaignMessageBreakdown,
    qualifiedChats,
    qualifiedChatsByCampaign,
  };

  statsCache.set(userId, { data: payload, expiresAt: Date.now() + STATS_TTL_MS });

  return payload;
}
