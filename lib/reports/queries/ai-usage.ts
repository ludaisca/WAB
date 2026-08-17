import { prisma } from "@/lib/prisma";

export interface BotCostRow {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  interactions: number;
  totalTokens: number;
  totalCost: number;
}

// Mismo patrón que botBreakdown en lib/estadisticas/get-stats.ts, acotado al
// rango del reporte en vez de "todo el histórico".
export async function fetchBotCostRows(userId: string, gte: Date, lt: Date): Promise<BotCostRow[]> {
  const [bots, usageByBot] = await Promise.all([
    prisma.wABot.findMany({ where: { userId }, select: { id: true, name: true, status: true, isActive: true } }),
    prisma.wABotUsage.groupBy({
      by: ["botId"],
      where: { bot: { userId }, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
      _count: { _all: true },
    }),
  ]);

  return bots
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
}

export interface AiUsageDetailRow {
  source: string;
  entity: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string;
}

// Une las 5 fuentes de gasto de IA con el MISMO scoping por userId que
// lib/ai/budget.ts:getMonthlyAiCost (bot:{userId} / scorer:{userId} /
// chat:{account:{userId}} / conversation:{userId} / userId directo) —
// deliberadamente NO por accountIds, para que el total de esta hoja coincida
// con lo que Estadísticas/Presupuesto ya muestran.
export async function fetchAiUsageDetailRows(userId: string, gte: Date, lt: Date): Promise<AiUsageDetailRow[]> {
  const [botUsage, scorerUsage, recoveryUsage, agentUsage, transcriptionUsage] = await Promise.all([
    prisma.wABotUsage.findMany({
      where: { bot: { userId }, createdAt: { gte, lt } },
      include: { bot: { select: { name: true } } },
    }),
    prisma.wALeadScorerUsage.findMany({
      where: { scorer: { userId }, createdAt: { gte, lt } },
      include: { scorer: { select: { name: true } } },
    }),
    prisma.wALeadRecoveryAttempt.findMany({
      where: { chat: { account: { userId } }, createdAt: { gte, lt } },
      include: { chat: { select: { name: true, remoteJid: true } } },
    }),
    prisma.agentUsage.findMany({
      where: { conversation: { userId }, createdAt: { gte, lt } },
      include: { conversation: { select: { title: true } } },
    }),
    prisma.audioTranscriptionUsage.findMany({
      where: { userId, createdAt: { gte, lt } },
    }),
  ]);

  const rows: AiUsageDetailRow[] = [];
  for (const u of botUsage) {
    rows.push({
      source: "Bot", entity: u.bot.name, model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      estimatedCost: u.estimatedCost, createdAt: u.createdAt.toISOString(),
    });
  }
  for (const u of scorerUsage) {
    rows.push({
      source: "Calificador", entity: u.scorer.name, model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      estimatedCost: u.estimatedCost, createdAt: u.createdAt.toISOString(),
    });
  }
  for (const u of recoveryUsage) {
    rows.push({
      source: "Recuperación de lead", entity: u.chat.name ?? u.chat.remoteJid, model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      estimatedCost: u.estimatedCost, createdAt: u.createdAt.toISOString(),
    });
  }
  for (const u of agentUsage) {
    rows.push({
      source: "Asistente IA", entity: u.conversation.title ?? "Conversación sin título", model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      estimatedCost: u.estimatedCost, createdAt: u.createdAt.toISOString(),
    });
  }
  for (const u of transcriptionUsage) {
    // Sin relación Prisma a WAMessage pese al messageId @unique — no hay a qué
    // hacer join para un nombre de entidad más específico.
    rows.push({
      source: "Transcripción de audio", entity: "Transcripción de audio", model: u.model,
      promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens,
      estimatedCost: u.estimatedCost, createdAt: u.createdAt.toISOString(),
    });
  }

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface AiCostSummary {
  totalCost: number;
  totalTokens: number;
}

// Mismo patrón de 5 tablas que lib/ai/budget.ts:getMonthlyAiCost, pero con
// límite superior además del inferior — sirve para un KPI de "costo del
// rango" en vez de "costo del mes en curso". .aggregate({_sum}), no
// .findMany() — no trae filas, solo la suma, para el dashboard en vivo.
export async function fetchAiCostSummary(userId: string, gte: Date, lt: Date): Promise<AiCostSummary> {
  const [bot, scorer, recovery, agent, transcription] = await Promise.all([
    prisma.wABotUsage.aggregate({
      where: { bot: { userId }, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.wALeadScorerUsage.aggregate({
      where: { scorer: { userId }, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.wALeadRecoveryAttempt.aggregate({
      where: { chat: { account: { userId } }, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.agentUsage.aggregate({
      where: { conversation: { userId }, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.audioTranscriptionUsage.aggregate({
      where: { userId, createdAt: { gte, lt } },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
  ]);

  return {
    totalCost:
      Math.round(
        ((bot._sum.estimatedCost ?? 0) +
          (scorer._sum.estimatedCost ?? 0) +
          (recovery._sum.estimatedCost ?? 0) +
          (agent._sum.estimatedCost ?? 0) +
          (transcription._sum.estimatedCost ?? 0)) *
          10000
      ) / 10000,
    totalTokens:
      (bot._sum.totalTokens ?? 0) +
      (scorer._sum.totalTokens ?? 0) +
      (recovery._sum.totalTokens ?? 0) +
      (agent._sum.totalTokens ?? 0) +
      (transcription._sum.totalTokens ?? 0),
  };
}
