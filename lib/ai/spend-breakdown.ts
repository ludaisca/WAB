import { prisma } from "@/lib/prisma";
import { dateKeyInTz, startOfDayInTz, startOfMonthInTz } from "@/lib/timezone";

// Mismas 5 fuentes y los mismos `where` que lib/ai/budget.ts:getMonthlyAiCost()
// — cualquier fuente de gasto de IA nueva debe extender AMBAS funciones o el
// desglose por período y el total mensual del presupuesto vuelven a divergir
// (ver AGENTS.md, ya pasó una vez con AudioTranscriptionUsage en get-stats.ts).
//
// Siempre bucketea por día — los presets son ventanas de tiempo (7/28/90 días,
// este mes, rango libre), no granularidades distintas; no hace falta agrupar
// por semana/mes aparte.

export type SpendPreset = "7d" | "28d" | "90d" | "month" | "custom";

export interface SpendBucket {
  /** "YYYY-MM-DD" en CDMX. */
  key: string;
  cost: number;
}

export interface SpendBreakdown {
  buckets: SpendBucket[];
  totalCost: number;
  rangeStart: string;
  rangeEnd: string;
}

const DAY_MS = 86400000;

function resolveRange(
  preset: SpendPreset,
  customFrom?: Date,
  customTo?: Date
): { rangeStart: Date; rangeEndExclusive: Date } {
  const now = new Date();

  if (preset === "custom") {
    if (!customFrom || !customTo) {
      throw new Error("customFrom y customTo son requeridos cuando preset=custom");
    }
    const rangeStart = startOfDayInTz(customFrom);
    // "hasta" es inclusivo del día completo — el límite exclusivo es la
    // medianoche del día siguiente.
    const rangeEndExclusive = new Date(startOfDayInTz(customTo).getTime() + DAY_MS);
    if (rangeEndExclusive <= rangeStart) {
      throw new Error("El rango de fechas es inválido (desde debe ser antes de hasta)");
    }
    return { rangeStart, rangeEndExclusive };
  }

  if (preset === "month") {
    return { rangeStart: startOfMonthInTz(now), rangeEndExclusive: new Date(now.getTime() + 1) };
  }

  const days = preset === "7d" ? 7 : preset === "28d" ? 28 : 90;
  const rangeStart = new Date(startOfDayInTz(now).getTime() - (days - 1) * DAY_MS);
  return { rangeStart, rangeEndExclusive: new Date(now.getTime() + 1) };
}

export async function getAiSpendBreakdown(
  userId: string,
  preset: SpendPreset,
  customFrom?: Date,
  customTo?: Date
): Promise<SpendBreakdown> {
  const { rangeStart, rangeEndExclusive } = resolveRange(preset, customFrom, customTo);
  const dateFilter = { gte: rangeStart, lt: rangeEndExclusive };

  const [botUsage, scorerUsage, recoveryUsage, agentUsage, transcriptionUsage] = await Promise.all([
    prisma.wABotUsage.findMany({
      where: { bot: { userId }, createdAt: dateFilter },
      select: { createdAt: true, estimatedCost: true },
    }),
    prisma.wALeadScorerUsage.findMany({
      where: { scorer: { userId }, createdAt: dateFilter },
      select: { createdAt: true, estimatedCost: true },
    }),
    prisma.wALeadRecoveryAttempt.findMany({
      where: { chat: { account: { userId } }, createdAt: dateFilter },
      select: { createdAt: true, estimatedCost: true },
    }),
    prisma.agentUsage.findMany({
      where: { conversation: { userId }, createdAt: dateFilter },
      select: { createdAt: true, estimatedCost: true },
    }),
    prisma.audioTranscriptionUsage.findMany({
      where: { userId, createdAt: dateFilter },
      select: { createdAt: true, estimatedCost: true },
    }),
  ]);

  const rows = [...botUsage, ...scorerUsage, ...recoveryUsage, ...agentUsage, ...transcriptionUsage];

  const bucketMap = new Map<string, number>();
  let totalCost = 0;
  for (const row of rows) {
    const key = dateKeyInTz(row.createdAt);
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + row.estimatedCost);
    totalCost += row.estimatedCost;
  }

  const buckets = Array.from(bucketMap.entries())
    .map(([key, cost]) => ({ key, cost: Math.round(cost * 10000) / 10000 }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    buckets,
    totalCost: Math.round(totalCost * 10000) / 10000,
    rangeStart: dateKeyInTz(rangeStart),
    // rangeEndExclusive es el límite exclusivo (ver arriba) — restar 1ms para
    // mostrar el último día realmente incluido, no el siguiente.
    rangeEnd: dateKeyInTz(new Date(rangeEndExclusive.getTime() - 1)),
  };
}
