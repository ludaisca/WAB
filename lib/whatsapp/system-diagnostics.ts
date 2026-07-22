import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { getMonthlyAiCost, isMonthlyBudgetExceeded } from "@/lib/ai/budget";

// Umbrales de severidad del barrido — ajustables según qué tan sensible se
// quiera el diagnóstico para este negocio en particular.
const CAMPAIGN_FAILURE_RATIO_ALERT = 0.3; // % de destinatarios fallidos en una campaña ya enviada/en curso
const SCHEDULED_CAMPAIGN_STALE_MINUTES = 15; // scheduledAt ya pasó hace más de esto y el tick de campaign-send no la tomó
const SCORER_TICK_STALE_MULTIPLIER = 3; // lastRunAt más viejo que N veces su propio intervalo configurado
const SHEET_SOURCE_STALE_HOURS = 6; // fuente enabled sin correr en más de esto
const MEDIA_STUCK_HOURS = 2; // mediaId sin mediaUrl más viejo que esto — las 5 reintentos de media-download ya agotaron su ventana (backoff exponencial de segundos)
const MEDIA_STUCK_SCAN_LIMIT = 100; // tope de mensajes atascados a inspeccionar por corrida

export interface DiagnosticIssue {
  area: "cuenta" | "campaña" | "bot" | "calificador" | "automatización" | "presupuesto" | "plantilla" | "media";
  severity: "alta" | "media";
  entityId: string;
  entityName: string;
  message: string;
}

export interface DiagnosticsResult {
  scannedAt: string;
  issuesFound: number;
  issues: DiagnosticIssue[];
}

// Scan compartido por la tool system.diagnostics del agente IA (bajo demanda,
// dentro de la conversación) y por system-diagnostics-worker.ts (tick
// desatendido cada hora que convierte los hallazgos "alta" en Notification) —
// ver lib/agent/tools/diagnostics.ts y lib/workers/system-diagnostics-worker.ts.
// No dupliques esta lógica en ninguno de los dos consumidores.
export async function runSystemDiagnostics(userId: string): Promise<DiagnosticsResult> {
  const accountIds = await getUserAccountIds(userId);
  const issues: DiagnosticIssue[] = [];
  const now = new Date();

  const accounts = await prisma.wAAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true, status: true, errorMessage: true, qualityRating: true },
  });
  for (const acc of accounts) {
    if (acc.status === "ERROR" || acc.status === "DISCONNECTED") {
      issues.push({
        area: "cuenta",
        severity: "alta",
        entityId: acc.id,
        entityName: acc.name,
        message: `Cuenta en estado ${acc.status}${acc.errorMessage ? `: ${acc.errorMessage}` : ""}.`,
      });
    }
    if (acc.qualityRating && /flag|downgrade|red|yellow/i.test(acc.qualityRating)) {
      issues.push({
        area: "cuenta",
        severity: "media",
        entityId: acc.id,
        entityName: acc.name,
        message: `Señal de calidad negativa reportada por Meta: "${acc.qualityRating}".`,
      });
    }
  }

  const campaigns = await prisma.wACampaign.findMany({
    where: { waAccountId: { in: accountIds }, status: { in: ["FAILED", "SCHEDULED", "SENDING", "COMPLETED"] } },
    select: { id: true, name: true, status: true, scheduledAt: true, recipientCount: true, failedCount: true },
  });
  for (const c of campaigns) {
    if (c.status === "FAILED") {
      issues.push({ area: "campaña", severity: "alta", entityId: c.id, entityName: c.name, message: "La campaña terminó en estado FAILED." });
    }
    if (c.status === "SCHEDULED" && c.scheduledAt && c.scheduledAt.getTime() < now.getTime() - SCHEDULED_CAMPAIGN_STALE_MINUTES * 60_000) {
      issues.push({
        area: "campaña",
        severity: "alta",
        entityId: c.id,
        entityName: c.name,
        message: `Programada para ${c.scheduledAt.toISOString()} y sigue en SCHEDULED — el tick de envío programado no la ha tomado todavía.`,
      });
    }
    if (c.recipientCount > 0 && (c.status === "SENDING" || c.status === "COMPLETED")) {
      const ratio = c.failedCount / c.recipientCount;
      if (ratio >= CAMPAIGN_FAILURE_RATIO_ALERT) {
        issues.push({
          area: "campaña",
          severity: "media",
          entityId: c.id,
          entityName: c.name,
          message: `${c.failedCount}/${c.recipientCount} destinatarios fallidos (${Math.round(ratio * 100)}%).`,
        });
      }
    }
  }

  const bots = await prisma.wABot.findMany({
    where: { userId, status: "ERROR" },
    select: { id: true, name: true, isActive: true },
  });
  for (const b of bots) {
    issues.push({
      area: "bot",
      severity: "alta",
      entityId: b.id,
      entityName: b.name,
      message: `Bot en estado ERROR${b.isActive ? " (aparece activo en la UI pero no está respondiendo)" : ""} — hay que reactivarlo con el toggle para que retome.`,
    });
  }

  const scorers = await prisma.wALeadScorerBot.findMany({
    where: { userId, scheduleEnabled: true },
    select: { id: true, name: true, scheduleIntervalMinutes: true, lastRunAt: true },
  });
  for (const s of scorers) {
    if (!s.scheduleIntervalMinutes) continue;
    const staleMs = s.scheduleIntervalMinutes * SCORER_TICK_STALE_MULTIPLIER * 60_000;
    if (!s.lastRunAt || now.getTime() - s.lastRunAt.getTime() > staleMs) {
      issues.push({
        area: "calificador",
        severity: "media",
        entityId: s.id,
        entityName: s.name,
        message: `Programado cada ${s.scheduleIntervalMinutes} min pero ${s.lastRunAt ? `no corre desde ${s.lastRunAt.toISOString()}` : "nunca ha corrido"}.`,
      });
    }
  }

  const sources = await prisma.leadSheetSource.findMany({
    where: { waAccountId: { in: accountIds }, enabled: true },
    select: { id: true, name: true, lastRunAt: true, lastError: true },
  });
  for (const src of sources) {
    if (src.lastError) {
      issues.push({ area: "automatización", severity: "alta", entityId: src.id, entityName: src.name, message: `Último error: ${src.lastError}` });
    } else if (!src.lastRunAt || now.getTime() - src.lastRunAt.getTime() > SHEET_SOURCE_STALE_HOURS * 3600_000) {
      issues.push({
        area: "automatización",
        severity: "media",
        entityId: src.id,
        entityName: src.name,
        message: `Habilitada pero ${src.lastRunAt ? `sin correr desde ${src.lastRunAt.toISOString()}` : "nunca ha corrido"}.`,
      });
    }
  }

  const rejectedTemplates = await prisma.wATemplate.findMany({
    where: { waAccountId: { in: accountIds }, status: "REJECTED" },
    select: { id: true, name: true },
  });
  for (const t of rejectedTemplates) {
    issues.push({
      area: "plantilla",
      severity: "alta",
      entityId: t.id,
      entityName: t.name,
      message: "Meta rechazó esta plantilla — no se puede usar en campañas ni automatizaciones de Sheets hasta corregirla y volver a enviarla a revisión.",
    });
  }

  // mediaId sin mediaUrl tras MEDIA_STUCK_HOURS: la descarga nunca terminó
  // (5 reintentos ya agotados) y nada más lo hace visible — el chat solo
  // muestra el placeholder "[imagen recibida]" indefinidamente.
  const stuckMedia = await prisma.wAMessage.findMany({
    where: {
      direction: "INBOUND",
      mediaId: { not: null },
      mediaUrl: null,
      createdAt: { lt: new Date(now.getTime() - MEDIA_STUCK_HOURS * 3600_000) },
      chat: { accountId: { in: accountIds } },
    },
    select: { chatId: true, messageType: true, chat: { select: { name: true, remoteJid: true } } },
    orderBy: { createdAt: "desc" },
    take: MEDIA_STUCK_SCAN_LIMIT,
  });
  const stuckByChat = new Map<string, { name: string; count: number; type: string }>();
  for (const m of stuckMedia) {
    const existing = stuckByChat.get(m.chatId);
    if (existing) existing.count++;
    else stuckByChat.set(m.chatId, { name: m.chat.name ?? m.chat.remoteJid, count: 1, type: m.messageType });
  }
  for (const [chatId, info] of stuckByChat) {
    issues.push({
      area: "media",
      severity: "media",
      entityId: chatId,
      entityName: info.name,
      message: `${info.count} mensaje(s) multimedia (ej. ${info.type}) recibidos hace más de ${MEDIA_STUCK_HOURS}h que nunca terminaron de descargarse — revisa el worker media-download o la conexión con Meta.`,
    });
  }

  const exceeded = await isMonthlyBudgetExceeded(userId, now);
  if (exceeded) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyCost = await getMonthlyAiCost(userId, monthStart);
    issues.push({
      area: "presupuesto",
      severity: "alta",
      entityId: "budget",
      entityName: "Presupuesto mensual de IA",
      message: `Excedido (gasto del mes: $${monthlyCost.toFixed(2)}) — bots, calificadores y recuperación de leads están pausando sus respuestas.`,
    });
  }

  return { scannedAt: now.toISOString(), issuesFound: issues.length, issues };
}
