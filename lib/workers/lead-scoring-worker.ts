import { prisma } from "@/lib/prisma";
import { scoreChatWithScorer, LeadScoringError } from "@/lib/whatsapp/lead-scoring";
import { checkBudgetAlert, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import { getUserAccountIds } from "@/lib/shared-accounts";
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

  // Mirrors what manual scoring already allows (own + shared accounts, via
  // getUserAccountIds), further narrowed by the scorer's own account scope
  // (scheduleAccountIds) when one is configured — empty means "all of them".
  const eligibleAccountIds = await getUserAccountIds(scorer.userId);
  const scopedAccountIds = scorer.scheduleAccountIds.length > 0
    ? eligibleAccountIds.filter((id) => scorer.scheduleAccountIds.includes(id))
    : eligibleAccountIds;

  if (scopedAccountIds.length === 0) {
    await prisma.wALeadScorerBot.update({ where: { id: scorer.id }, data: { lastRunAt: now } });
    return;
  }

  const candidates = await prisma.wAChat.findMany({
    where: {
      accountId: { in: scopedAccountIds },
      status: { in: ["OPEN", "PENDING"] },
      lastMessageAt: { not: null },
      // Otherwise a campaign-only chat the lead never replied to would be reselected as
      // "due" on every single tick forever (scoreChatWithScorer throws before creating a
      // score, so it never satisfies the `!lastScore` exemption below) — crowding out
      // real candidates from the batch. scoreChatWithScorer enforces this same rule for
      // the manual "Calificar" button; this mirrors it here purely for efficiency.
      messages: { some: { direction: "INBOUND" } },
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

  let anySuccess = false;
  let anyFailure = false;
  for (const chat of dueChats) {
    try {
      await scoreChatWithScorer(chat.id, scorer);
      anySuccess = true;
    } catch (err) {
      anyFailure = true;
      console.error(`[lead-scoring] Error calificando chat ${chat.id} con el calificador ${scorer.id}:`, err);
    }
  }

  if (dueChats.length > 0) {
    await checkBudgetAlert(scorer.userId, now);
  }

  // A diferencia de bot-worker.ts, WALeadScorerBot no tiene un campo `status`
  // que marcar — sin esto, una API key revocada o un modelo retirado hace que
  // el calificador falle en silencio para siempre (ver console.error arriba,
  // que nadie del equipo llega a ver). Solo se notifica cuando NINGÚN chat del
  // lote tuvo éxito (todo el ciclo falló, no un error puntual de un chat), y
  // se evita re-notificar dentro de las mismas 6 horas para no saturar al
  // usuario cada 5 minutos mientras el problema sigue sin resolverse.
  if (anyFailure && !anySuccess) {
    const title = `Calificador "${scorer.name}" con errores`;
    const recent = await prisma.notification.findFirst({
      where: {
        userId: scorer.userId,
        type: "SCORER_ERROR",
        title,
        createdAt: { gte: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
      },
    });
    if (!recent) {
      await prisma.notification.create({
        data: {
          userId: scorer.userId,
          type: "SCORER_ERROR",
          title,
          body: "No pudo evaluar ningún chat en su última corrida — revisa la clave de API y el modelo configurados en Calificadores.",
          link: "/whatsapp/calificadores",
        },
      });
    }
  }

  await prisma.wALeadScorerBot.update({
    where: { id: scorer.id },
    data: { lastRunAt: now },
  });
}

// Chats elegibles para una recalificación masiva: mismo criterio base que
// scoreChatWithScorer exige (al menos un mensaje INBOUND), pero sin el filtro
// de status OPEN/PENDING ni el CANDIDATE_POOL del tick programado — un
// "recalificar todos" disparado a propósito por el admin (ej. tras cambiar el
// prompt) debe cubrir el historial completo, no solo los chats activos recientes.
export async function countBulkRescoreEligibleChats(scorer: WALeadScorerBot): Promise<number> {
  const accountIds = await getUserAccountIds(scorer.userId);
  if (accountIds.length === 0) return 0;
  return prisma.wAChat.count({
    where: { accountId: { in: accountIds }, messages: { some: { direction: "INBOUND" } } },
  });
}

// Job disparado manualmente desde /whatsapp/calificadores ("Recalificar todos
// los leads") — a diferencia del tick automático, no respeta scheduleAccountIds
// (ese alcance es solo para las corridas desatendidas) ni el presupuesto
// mensual: es una acción explícita de un admin, igual que el botón individual
// "Calificar" tampoco lo respeta.
export async function processBulkRescoreJob(scorerId: string) {
  const scorer = await prisma.wALeadScorerBot.findUnique({ where: { id: scorerId } });
  if (!scorer) {
    console.error(`[lead-scoring] Recalificación masiva: calificador ${scorerId} no existe`);
    return;
  }

  const accountIds = await getUserAccountIds(scorer.userId);
  if (accountIds.length === 0) return;

  const chats = await prisma.wAChat.findMany({
    where: { accountId: { in: accountIds }, messages: { some: { direction: "INBOUND" } } },
    select: { id: true },
    orderBy: { lastMessageAt: "desc" },
  });

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const chat of chats) {
    try {
      await scoreChatWithScorer(chat.id, scorer);
      ok++;
    } catch (err) {
      if (err instanceof LeadScoringError) {
        skipped++;
      } else {
        failed++;
        console.error(`[lead-scoring] Recalificación masiva: error en chat ${chat.id}:`, err);
      }
    }
  }

  await checkBudgetAlert(scorer.userId, new Date());
  await prisma.wALeadScorerBot.update({ where: { id: scorer.id }, data: { lastRunAt: new Date() } });

  console.log(
    `[lead-scoring] Recalificación masiva completa para "${scorer.name}" (${scorer.id}): ` +
      `${ok} calificados, ${skipped} omitidos, ${failed} con error, de ${chats.length} chats totales.`
  );
}
