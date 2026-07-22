import { prisma } from "@/lib/prisma";
import { sendRecoveryMessage, isWithinBusinessHours } from "@/lib/whatsapp/lead-recovery";
import { checkBudgetAlert, isMonthlyBudgetExceeded } from "@/lib/ai/budget";
import { getUserAccountIds } from "@/lib/shared-accounts";
import type { AppSettings, WABot, WAAccount } from "@prisma/client";

// Scheduled runs are unattended, so keep each tick's blast radius bounded —
// same reasoning as lead-scoring-worker.ts's CANDIDATE_POOL/BATCH_SIZE.
const CANDIDATE_POOL = 200;
const BATCH_SIZE = 20;
const NOTIFY_DEDUP_HOURS = 6;

export async function processLeadRecoveryTick() {
  const now = new Date();

  const settingsList = await prisma.appSettings.findMany({
    where: { leadRecoveryEnabled: true },
  });

  for (const settings of settingsList) {
    try {
      await runRecoveryForUser(settings, now);
    } catch (err) {
      console.error(`[lead-recovery] Error ejecutando recuperación para usuario ${settings.userId}:`, err);
    }
  }
}

async function runRecoveryForUser(settings: AppSettings, now: Date) {
  if (await isMonthlyBudgetExceeded(settings.userId, now)) {
    console.log(`[lead-recovery] Presupuesto mensual de IA superado, se omite la recuperación para el usuario ${settings.userId} en este ciclo`);
    return;
  }

  if (
    !isWithinBusinessHours(now, {
      timezone: settings.leadRecoveryTimezone,
      startHour: settings.leadRecoveryBusinessHourStart,
      endHour: settings.leadRecoveryBusinessHourEnd,
    })
  ) {
    return; // fuera de horario — se reintenta en el próximo tick
  }

  const accountIds = await getUserAccountIds(settings.userId);
  if (accountIds.length === 0) return;

  const candidates = await prisma.wAChat.findMany({
    where: {
      accountId: { in: accountIds },
      status: { in: ["OPEN", "PENDING"] },
      // Debe haber habido conversación real — un chat que solo recibió una
      // campaña y nunca contestó no es un lead "abandonado", nunca se enganchó.
      messages: { some: { direction: "INBOUND" } },
    },
    select: {
      id: true,
      accountId: true,
      remoteJid: true,
      messages: { orderBy: { timestamp: "desc" }, take: 1, select: { direction: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: CANDIDATE_POOL,
  });

  const silentChats = candidates.filter((c) => c.messages[0]?.direction === "OUTBOUND");

  const botCache = new Map<string, (WABot & { waAccount: WAAccount | null }) | null>();
  let sentCount = 0;
  let sentAny = false;
  let failCount = 0;
  let lastError = "";

  for (const chat of silentChats) {
    if (sentCount >= BATCH_SIZE) break;

    const lastInbound = await prisma.wAMessage.findFirst({
      where: { chatId: chat.id, direction: "INBOUND" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    if (!lastInbound) continue;

    const hoursSilent = (now.getTime() - lastInbound.timestamp.getTime()) / 3_600_000;

    const attemptsSoFar = await prisma.wALeadRecoveryAttempt.count({
      where: { chatId: chat.id, createdAt: { gt: lastInbound.timestamp } },
    });

    let attemptNumber: 1 | 2 | null = null;
    if (attemptsSoFar === 0 && hoursSilent >= settings.leadRecoveryFirstMessageHours) {
      attemptNumber = 1;
    } else if (
      attemptsSoFar === 1 &&
      settings.leadRecoverySecondMessageHours !== null &&
      hoursSilent >= settings.leadRecoverySecondMessageHours
    ) {
      attemptNumber = 2;
    }
    if (attemptNumber === null) continue;

    if (!botCache.has(chat.accountId)) {
      const bot = await prisma.wABot.findFirst({
        where: { waAccountId: chat.accountId, isActive: true, status: "ACTIVE" },
        include: { waAccount: true },
      });
      botCache.set(chat.accountId, bot);
    }
    const bot = botCache.get(chat.accountId);
    if (!bot) continue; // sin bot activo en esa cuenta, no hay con qué generar el mensaje

    try {
      await sendRecoveryMessage(chat, bot, attemptNumber, lastInbound.timestamp, now);
      sentAny = true;
      sentCount++;
    } catch (err) {
      failCount++;
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[lead-recovery] Error enviando reactivación al chat ${chat.id}:`, lastError);
    }
  }

  if (sentAny) {
    await checkBudgetAlert(settings.userId, now);
  }
  if (failCount > 0) {
    await notifyRecoveryFailures(settings.userId, failCount, lastError, now);
  }
}

// Antes un fallo de envío solo quedaba en console.error, invisible para el
// admin fuera de los logs del contenedor — dedupe por usuario (no por chat)
// porque una sola causa raíz (ej. API key inválida) suele fallar varios chats
// en el mismo tick.
async function notifyRecoveryFailures(userId: string, failCount: number, lastError: string, now: Date) {
  const since = new Date(now.getTime() - NOTIFY_DEDUP_HOURS * 3_600_000);
  const recent = await prisma.notification.findFirst({
    where: { userId, type: "SYSTEM_ISSUE", title: "Recuperación de leads con errores", createdAt: { gte: since } },
  });
  if (recent) return;

  await prisma.notification.create({
    data: {
      userId,
      type: "SYSTEM_ISSUE",
      title: "Recuperación de leads con errores",
      body: `${failCount} envío(s) de reactivación fallaron en esta corrida. Último error: ${lastError.slice(0, 300)}`,
      link: "/configuracion/ia",
    },
  });
}
