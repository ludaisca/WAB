import { prisma } from "@/lib/prisma";

export interface AgentPerformanceRow {
  userId: string;
  userName: string | null;
  resolvedCount: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

function avg(values: number[]): number | null {
  return values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// Agregación en JS, no SQL — Prisma no puede AVG() una diferencia de fechas.
// Compartido entre get-stats.ts (sección de Estadísticas) y
// GET /api/usuarios/performance (columna de desempeño en /usuarios) — no
// reimplementar esta agregación en un segundo lugar, o ambas pantallas
// pueden divergir igual que pasó con getMonthlyAiCost/totalCost.
export async function getAgentPerformance(accountIds: string[]): Promise<AgentPerformanceRow[]> {
  const assignedChats = await prisma.wAChat.findMany({
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
  });

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

  return Array.from(agentMap.entries())
    .map(([userId, entry]) => ({
      userId,
      userName: entry.userName,
      resolvedCount: entry.resolvedCount,
      avgFirstResponseMinutes: avg(entry.responseTimes),
      avgResolutionMinutes: avg(entry.resolutionTimes),
    }))
    .sort((a, b) => b.resolvedCount - a.resolvedCount);
}
