import { prisma } from "@/lib/prisma";

// Combines WABotUsage (chat-reply bots) and WALeadScorerUsage (lead scorer
// runs, including scheduled ones) so the monthly budget reflects total AI
// spend for the user, not just one of the two bot types.
export async function getMonthlyAiCost(userId: string, monthStart: Date): Promise<number> {
  const [botUsage, scorerUsage] = await Promise.all([
    prisma.wABotUsage.aggregate({
      where: { bot: { userId }, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    }),
    prisma.wALeadScorerUsage.aggregate({
      where: { scorer: { userId }, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    }),
  ]);

  return (botUsage._sum.estimatedCost ?? 0) + (scorerUsage._sum.estimatedCost ?? 0);
}

export async function isMonthlyBudgetExceeded(userId: string, now: Date): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { userId } });
  if (!settings?.monthlyBudgetUsd) return false;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyCost = await getMonthlyAiCost(userId, monthStart);
  return monthlyCost >= settings.monthlyBudgetUsd;
}

export async function checkBudgetAlert(userId: string, now: Date) {
  const settings = await prisma.appSettings.findUnique({ where: { userId } });
  if (!settings?.monthlyBudgetUsd) return;

  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (settings.budgetAlertMonth === monthKey) return;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyCost = await getMonthlyAiCost(userId, monthStart);

  if (monthlyCost < settings.monthlyBudgetUsd) return;

  await prisma.appSettings.update({
    where: { userId },
    data: { budgetAlertMonth: monthKey },
  });

  await prisma.notification.create({
    data: {
      userId,
      type: "BUDGET_EXCEEDED",
      title: "Presupuesto mensual de IA superado",
      body: `Costo estimado este mes: $${monthlyCost.toFixed(2)} (límite: $${settings.monthlyBudgetUsd.toFixed(2)})`,
      link: "/configuracion/ia",
    },
  });
}
