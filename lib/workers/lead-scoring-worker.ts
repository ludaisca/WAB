import { prisma } from "@/lib/prisma";
import { scoreChatWithScorer } from "@/lib/whatsapp/lead-scoring";
import { checkBudgetAlert, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import type { WALeadScorerBot } from "@prisma/client";

// Scheduled runs are unattended, so keep each tick's blast radius bounded:
// only chats still "active" (OPEN/PENDING) and only ones that have new
// messages since this scorer last scored them — otherwise every enabled
// scorer would re-score its entire chat history every tick.
const BATCH_SIZE_PER_SCORER = 15;
const CANDIDATE_POOL = 200;

export async function processLeadScoringTick() {
  const now = new Date();

  const scorers = await prisma.wALeadScorerBot.findMany({
    where: { isActive: true, scheduleEnabled: true, scheduleIntervalMinutes: { not: null } },
  });

  for (const scorer of scorers) {
    const intervalMs = (scorer.scheduleIntervalMinutes ?? 0) * 60_000;
    const due = !scorer.lastRunAt || now.getTime() - scorer.lastRunAt.getTime() >= intervalMs;
    if (!due) continue;

    try {
      await runScheduledScorer(scorer, now);
    } catch (err) {
      console.error(`[lead-scoring] Error ejecutando calificador ${scorer.id}:`, err);
    }
  }
}

async function runScheduledScorer(scorer: WALeadScorerBot, now: Date) {
  if (await isMonthlyBudgetExceeded(scorer.userId, now)) {
    console.log(`[lead-scoring] Presupuesto mensual de IA superado, se omite el calificador ${scorer.id} en este ciclo`);
    return;
  }

  const candidates = await prisma.wAChat.findMany({
    where: {
      account: { userId: scorer.userId },
      status: { in: ["OPEN", "PENDING"] },
      lastMessageAt: { not: null },
    },
    select: {
      id: true,
      lastMessageAt: true,
      leadScores: { where: { scorerId: scorer.id }, select: { updatedAt: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: CANDIDATE_POOL,
  });

  const dueChats = candidates
    .filter((c) => {
      const lastScore = c.leadScores[0];
      return !lastScore || (c.lastMessageAt !== null && lastScore.updatedAt < c.lastMessageAt);
    })
    .slice(0, BATCH_SIZE_PER_SCORER);

  for (const chat of dueChats) {
    try {
      await scoreChatWithScorer(chat.id, scorer);
    } catch (err) {
      console.error(`[lead-scoring] Error calificando chat ${chat.id} con el calificador ${scorer.id}:`, err);
    }
  }

  if (dueChats.length > 0) {
    await checkBudgetAlert(scorer.userId, now);
  }

  await prisma.wALeadScorerBot.update({
    where: { id: scorer.id },
    data: { lastRunAt: now },
  });
}
