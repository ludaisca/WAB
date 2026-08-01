import { prisma } from "@/lib/prisma";
import { runSystemDiagnostics, type DiagnosticIssue } from "@/lib/whatsapp/system-diagnostics";

// Solo los hallazgos "alta" generan Notification — "media" queda disponible
// nada más bajo demanda vía la tool system.diagnostics del agente, para no
// saturar la campanita con cosas que no bloquean nada de forma inmediata.
const NOTIFY_DEDUP_HOURS = 6;

// Un bot en ERROR deja de responder en TODAS sus cuentas vinculadas hasta que
// alguien note la notificación y le dé toggle manualmente — puede ser horas.
// La mayoría de las causas reales (503 transitorio del proveedor, un bloqueo
// de contenido puntual, un rate limit) ya no requieren intervención humana
// para resolverse solas; si el problema es persistente (API key inválida,
// modelo retirado), el bot simplemente volverá a marcarse ERROR con el
// próximo mensaje que falle y se reintentará en el siguiente tick — el costo
// de un intento de más es mínimo comparado con dejar leads reales sin
// respuesta por horas. `updatedAt` como proxy de "tiempo en ERROR" no es
// perfecto (cualquier otro cambio al bot lo resetea), pero evita una
// migración de schema solo para esto.
const BOT_ERROR_AUTO_RECOVERY_COOLDOWN_MINUTES = 30;

async function autoRecoverErroredBots() {
  const cutoff = new Date(Date.now() - BOT_ERROR_AUTO_RECOVERY_COOLDOWN_MINUTES * 60_000);
  // Solo bots que el admin dejó isActive:true — si lo apagó a propósito tras
  // ver el error, no le tocamos el status para no confundir con un "ya se
  // arregló solo" que en realidad fue el admin pausándolo deliberadamente.
  const stuckBots = await prisma.wABot.findMany({
    where: { status: "ERROR", isActive: true, updatedAt: { lt: cutoff } },
    select: { id: true, name: true, userId: true },
  });

  for (const bot of stuckBots) {
    await prisma.wABot.update({ where: { id: bot.id }, data: { status: "ACTIVE" } });
    await prisma.notification.create({
      data: {
        userId: bot.userId,
        type: "SYSTEM_ISSUE",
        title: `[bot] ${bot.name}`,
        body: `Reactivado automáticamente tras ${BOT_ERROR_AUTO_RECOVERY_COOLDOWN_MINUTES} min en estado ERROR — si el problema seguía ahí, volverá a marcarse en error con el próximo mensaje que falle.`,
        link: `/whatsapp/bots/${bot.id}`,
      },
    });
    console.log(`[system-diagnostics] Bot "${bot.name}" (${bot.id}) reactivado automáticamente tras estar en ERROR.`);
  }
}

const LINK_BY_AREA: Record<DiagnosticIssue["area"], (entityId: string) => string> = {
  cuenta: (id) => `/whatsapp/cuentas/${id}`,
  campaña: (id) => `/whatsapp/campanas/${id}`,
  bot: (id) => `/whatsapp/bots/${id}`,
  calificador: () => "/whatsapp/calificadores",
  automatización: (id) => `/whatsapp/campanas/automatizacion/${id}`,
  plantilla: () => "/whatsapp/plantillas",
  media: () => "/whatsapp/chat",
  presupuesto: () => "/configuracion/ia",
};

function titleFor(issue: DiagnosticIssue): string {
  return `[${issue.area}] ${issue.entityName}`;
}

export async function processSystemDiagnosticsTick() {
  await autoRecoverErroredBots();

  const [accountOwners, botOwners, scorerOwners] = await Promise.all([
    prisma.wAAccount.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.wABot.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.wALeadScorerBot.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);
  const userIds = new Set([...accountOwners, ...botOwners, ...scorerOwners].map((r) => r.userId));

  for (const userId of userIds) {
    try {
      await runDiagnosticsForUser(userId);
    } catch (err) {
      console.error(`[system-diagnostics] Error escaneando el usuario ${userId}:`, err instanceof Error ? err.message : err);
    }
  }
}

async function runDiagnosticsForUser(userId: string) {
  const { issues } = await runSystemDiagnostics(userId);
  const highSeverity = issues.filter((i) => i.severity === "alta");
  if (highSeverity.length === 0) return;

  const since = new Date(Date.now() - NOTIFY_DEDUP_HOURS * 3_600_000);

  for (const issue of highSeverity) {
    const title = titleFor(issue);
    const recent = await prisma.notification.findFirst({
      where: { userId, type: "SYSTEM_ISSUE", title, createdAt: { gte: since } },
    });
    if (recent) continue;

    await prisma.notification.create({
      data: {
        userId,
        type: "SYSTEM_ISSUE",
        title,
        body: issue.message,
        link: LINK_BY_AREA[issue.area](issue.entityId),
      },
    });
  }
}
