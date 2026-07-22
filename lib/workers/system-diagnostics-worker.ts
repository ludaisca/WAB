import { prisma } from "@/lib/prisma";
import { runSystemDiagnostics, type DiagnosticIssue } from "@/lib/whatsapp/system-diagnostics";

// Solo los hallazgos "alta" generan Notification — "media" queda disponible
// nada más bajo demanda vía la tool system.diagnostics del agente, para no
// saturar la campanita con cosas que no bloquean nada de forma inmediata.
const NOTIFY_DEDUP_HOURS = 6;

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
