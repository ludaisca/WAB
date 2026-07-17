import { prisma } from "@/lib/prisma";
import { isWithinBusinessHours } from "@/lib/whatsapp/lead-recovery";
import { isRevokedGrantError } from "@/lib/google/errors";
import { importNewLeadsForSource, type SourceWithRelations } from "@/lib/google/lead-sheet-import";
import type { AppSettings } from "@prisma/client";

export async function processLeadSheetImportTick() {
  const now = new Date();

  const sources = await prisma.leadSheetSource.findMany({
    where: { enabled: true },
    include: { waAccount: true, waTemplate: true },
  });
  if (sources.length === 0) return;

  const userIds = [...new Set(sources.map((s) => s.userId))];
  const settingsList = await prisma.appSettings.findMany({ where: { userId: { in: userIds } } });
  const settingsByUser = new Map(settingsList.map((s) => [s.userId, s]));

  // Reutiliza el mismo horario laboral configurado para recuperación de leads —
  // un lead de Facebook Ads espera respuesta rápida, pero fuera del horario del
  // negocio se prefiere esperar al siguiente tick dentro de horario en vez de
  // mandar una plantilla a medianoche.
  const defaultBusinessHours = { timezone: "America/Mexico_City", startHour: 8, endHour: 20 };

  for (const source of sources as SourceWithRelations[]) {
    const settings = settingsByUser.get(source.userId);
    const hours: Pick<AppSettings, "leadRecoveryTimezone" | "leadRecoveryBusinessHourStart" | "leadRecoveryBusinessHourEnd"> =
      settings ?? {
        leadRecoveryTimezone: defaultBusinessHours.timezone,
        leadRecoveryBusinessHourStart: defaultBusinessHours.startHour,
        leadRecoveryBusinessHourEnd: defaultBusinessHours.endHour,
      };

    if (
      !isWithinBusinessHours(now, {
        timezone: hours.leadRecoveryTimezone,
        startHour: hours.leadRecoveryBusinessHourStart,
        endHour: hours.leadRecoveryBusinessHourEnd,
      })
    ) {
      continue; // fuera de horario — se reintenta en el próximo tick
    }

    try {
      await importNewLeadsForSource(source);
    } catch (err) {
      await handleImportError(source, err);
    }
  }
}

async function handleImportError(source: SourceWithRelations, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[lead-sheet-import] Error en la fuente ${source.id} (usuario ${source.userId}):`, err);

  if (isRevokedGrantError(err)) {
    await prisma.googleAccount.update({
      where: { userId: source.userId },
      data: {
        enabled: false,
        lastSyncError: "El acceso a Google fue revocado. Vuelve a conectar tu cuenta en Configuración.",
      },
    });
    await prisma.leadSheetSource.update({
      where: { id: source.id },
      data: { lastError: "El acceso a Google fue revocado. Vuelve a conectar tu cuenta en Configuración." },
    });
    await prisma.notification.create({
      data: {
        userId: source.userId,
        type: "BOT_ERROR",
        title: "Se desconectó la automatización de leads desde Sheets",
        body: `Detectamos que el acceso a Google fue revocado. La fuente "${source.name}" (y cualquier otra) dejó de sincronizarse hasta que vuelvas a conectar tu cuenta en Configuración.`,
        link: "/configuracion",
      },
    });
    return;
  }

  await prisma.leadSheetSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastError: message.slice(0, 500) },
  });
}
