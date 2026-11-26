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

  // Candidatos por el último mensaje DEL LEAD, no por lastMessageAt: antes
  // cualquier saliente (una plantilla de campaña, la respuesta del bot) volvía
  // "pendiente" al chat y se recalificaba sin que el lead dijera nada nuevo.
  // Una campaña de reactivación recalificaba así a cientos de leads minutos
  // después del envío, y el modelo leía la plantilla sin respuesta como
  // desinterés (visto en producción en nov-2026). Solo un mensaje nuevo del
  // lead cambia lo que hay que evaluar. Agrupar por chat ya implica al menos un
  // INBOUND, así que un chat de pura campaña sin respuesta nunca entra.
  const latestInbound = await prisma.wAMessage.groupBy({
    by: ["chatId"],
    where: {
      direction: "INBOUND",
      chat: {
        accountId: { in: scopedAccountIds },
        status: { in: ["OPEN", "PENDING"] },
        // Lista negra: los chats con contacto bloqueado no se recalifican.
        OR: [{ contact: null }, { contact: { blockedAt: null } }],
      },
    },
    _max: { timestamp: true },
    orderBy: { _max: { timestamp: "desc" } },
    take: CANDIDATE_POOL,
  });

  const scores = await prisma.wALeadScore.findMany({
    where: { scorerId: scorer.id, chatId: { in: latestInbound.map((c) => c.chatId) } },
    select: { chatId: true, updatedAt: true },
  });
  const scoredAt = new Map(scores.map((s) => [s.chatId, s.updatedAt]));

  const dueChats = latestInbound
    .filter((c) => {
      const lastScore = scoredAt.get(c.chatId);
      const lastInbound = c._max.timestamp;
      return !lastScore || (lastInbound !== null && lastScore < lastInbound);
    })
    .map((c) => ({ id: c.chatId }))
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
    where: {
      accountId: { in: accountIds },
      messages: { some: { direction: "INBOUND" } },
      OR: [{ contact: null }, { contact: { blockedAt: null } }],
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// El SDK de Google adjunta el código HTTP dentro del mensaje del error
// (ej. "[429 Too Many Requests]" o "RESOURCE_EXHAUSTED"); además tolera
// `status`/`statusCode` como propiedad del error por compatibilidad.
function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { status?: number; statusCode?: number })?.statusCode;
  if (status === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /429|too many requests|rate.?limit|resource_exhausted|quota/i.test(message);
}

const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
// Pausa base entre chats para no ráfaguear el proveedor de entrada — casi
// 2000 leads en un solo job secuencial es exactamente el escenario donde un
// modelo con cuota ajustada (ej. tier gratuito o bajo de Gemini) puede
// empezar a devolver 429 si se le pide un lead tras otro sin respiro.
const PACE_DELAY_MS = 1200;

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
    where: {
      accountId: { in: accountIds },
      messages: { some: { direction: "INBOUND" } },
      OR: [{ contact: null }, { contact: { blockedAt: null } }],
    },
    select: { id: true },
    orderBy: { lastMessageAt: "desc" },
  });

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let rateLimited = 0;
  for (const chat of chats) {
    let attempt = 0;
    for (;;) {
      try {
        await scoreChatWithScorer(chat.id, scorer);
        ok++;
        break;
      } catch (err) {
        if (err instanceof LeadScoringError) {
          skipped++;
          break;
        }
        if (isRateLimitError(err) && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
          rateLimited++;
          const delay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
          console.warn(
            `[lead-scoring] Recalificación masiva: rate limit en chat ${chat.id}, reintento ${attempt + 1} en ${delay}ms`
          );
          await sleep(delay);
          attempt++;
          continue;
        }
        failed++;
        console.error(`[lead-scoring] Recalificación masiva: error en chat ${chat.id}:`, err);
        break;
      }
    }
    await sleep(PACE_DELAY_MS);
  }

  await checkBudgetAlert(scorer.userId, new Date());
  await prisma.wALeadScorerBot.update({ where: { id: scorer.id }, data: { lastRunAt: new Date() } });

  console.log(
    `[lead-scoring] Recalificación masiva completa para "${scorer.name}" (${scorer.id}): ` +
      `${ok} calificados, ${skipped} omitidos, ${failed} con error, de ${chats.length} chats totales ` +
      `(${rateLimited} reintentos por rate limit).`
  );
}
