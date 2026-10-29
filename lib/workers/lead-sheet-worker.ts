import { prisma } from "@/lib/prisma";
import { isWithinBusinessHours } from "@/lib/whatsapp/lead-recovery";
import { isRevokedGrantError, isPermissionDeniedError } from "@/lib/google/errors";
import { importNewLeadsForSource, type SourceWithRelations } from "@/lib/google/lead-sheet-import";
import { MEXICO_CITY_TZ } from "@/lib/timezone";
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
  const defaultBusinessHours = { timezone: MEXICO_CITY_TZ, startHour: 8, endHour: 20 };

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

  // Permiso retirado o hoja no compartida: es permanente, así que se desactiva
  // la fuente. Antes quedaba habilitada y reintentaba cada 5 minutos para
  // siempre (403 "The caller does not have permission" + stack completo en el
  // log), sin que nadie se enterara de que esos leads no estaban entrando.
  if (isPermissionDeniedError(err)) {
    const reason =
      "La cuenta de Google conectada no tiene permiso para leer esta hoja. La fuente quedó desactivada: comparte la hoja con esa cuenta (o vuelve a conectar Google) y actívala de nuevo.";
    await prisma.leadSheetSource.update({
      where: { id: source.id },
      data: { enabled: false, lastRunAt: new Date(), lastError: reason },
    });
    await prisma.notification.create({
      data: {
        userId: source.userId,
        type: "BOT_ERROR",
        title: "Se desactivó una fuente de leads",
        body: `La fuente "${source.name}" no pudo leer su hoja de Google: la cuenta conectada no tiene permiso. Los leads de esa hoja dejaron de importarse hasta que se comparta con la cuenta correcta.`,
        link: "/whatsapp/campanas/automatizacion",
      },
    });
    return;
  }

  await prisma.leadSheetSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastError: message.slice(0, 500) },
  });
}
