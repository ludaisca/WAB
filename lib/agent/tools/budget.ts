import { prisma } from "@/lib/prisma";
import { getMonthlyAiCost, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import type { ToolDefinition } from "./types";

export const agentBudgetGet: ToolDefinition<Record<string, never>> = {
  name: "agent.budget.get",
  riskTier: "READ",
  description: "Consulta el gasto de IA del mes en curso (bots, calificadores, recuperación de leads y este mismo agente) contra el presupuesto mensual configurado.",
  parameters: { type: "object", properties: {} },
  handler: async (_params, ctx) => {
    const settings = await prisma.appSettings.findUnique({ where: { userId: ctx.userId } });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyCost = await getMonthlyAiCost(ctx.userId, monthStart);
    const exceeded = await isMonthlyBudgetExceeded(ctx.userId, now);
    return {
      monthlyCost,
      monthlyBudgetUsd: settings?.monthlyBudgetUsd ?? null,
      exceeded,
    };
  },
};
