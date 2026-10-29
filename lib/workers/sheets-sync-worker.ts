import { prisma } from "@/lib/prisma";
import { migrateLegacySyncIfNeeded, syncSingleExport } from "@/lib/google/sheet-export-runner";
import { isRevokedGrantError } from "@/lib/google/errors";
import { sheetsSyncQueue } from "@/lib/queue";
import type { GoogleAccount } from "@prisma/client";

// Tope de jobs pendientes de exportación. Con ~7 exports por cuenta y jobs de
// segundos, 50 es holgadísimo; si se supera es que algo está tardando de más.
const MAX_QUEUED_EXPORT_JOBS = 50;

// El tick ya NO sincroniza: encola un job por exportación. Antes corría las 7
// exportaciones de la cuenta dentro del mismo job (~5 min), que es más que el
// lock de BullMQ — al vencer, el job se marcaba stalled y se re-entrega, y como
// el fallo ocurría en moveToFinished/moveToDelayed (MISSING_LOCK) nunca llegaba
// a `failed`: quedó en un ciclo infinito que re-sincronizaba todo cada ~3
// minutos desde el 2026-10-23 y bloqueaba el event loop del proceso web.
// Con un job por exportación cada unidad de trabajo dura segundos y el lock
// (10 min, ver LONG_JOB_OPTIONS) no se acerca al límite.
export async function processSheetsSyncTick() {
  const accounts = await prisma.googleAccount.findMany({ where: { enabled: true } });

  for (const account of accounts) {
    try {
      await enqueueExportsForAccount(account);
    } catch (err) {
      await handleSyncError(account, err);
    }
  }
}

async function enqueueExportsForAccount(account: GoogleAccount): Promise<void> {
  await migrateLegacySyncIfNeeded(account);

  const exports = await prisma.sheetExport.findMany({
    where: { userId: account.userId, enabled: true },
    select: { id: true },
  });
  if (exports.length === 0) return;

  // Freno de mano: si el backlog crece (Google lento, un export gigante), no se
  // siguen apilando jobs cada 15 minutos. Es el mismo tipo de bucle que dejó el
  // worker atorado 6 días; mejor un tick que se salta a una cola que crece sin
  // control.
  const pending = await sheetsSyncQueue.getJobCountByTypes("wait", "active", "delayed");
  if (pending > MAX_QUEUED_EXPORT_JOBS) {
    console.warn(
      `[sheets-sync] Se omite el tick: ya hay ${pending} jobs pendientes en la cola (máx ${MAX_QUEUED_EXPORT_JOBS})`
    );
    return;
  }

  // Sin jobId fijo a propósito: BullMQ ignora un add si ya existe un job con
  // ese id — incluso uno que quedó en `failed` —, así que un id fijo dejaría
  // una exportación sin reintentar nunca tras el primer fallo.
  await sheetsSyncQueue.addBulk(
    exports.map((row) => ({
      name: "sync-export",
      data: { userId: account.userId, exportId: row.id },
      opts: {
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    }))
  );
}

export async function processSheetsExportJob(data: { userId: string; exportId: string }) {
  try {
    await syncSingleExport(data.userId, data.exportId);
  } catch (err) {
    const account = await prisma.googleAccount.findUnique({ where: { userId: data.userId } });
    if (!account) {
      console.error(`[sheets-sync] Error sincronizando export ${data.exportId} del usuario ${data.userId}:`, err);
      return;
    }
    // syncSingleExport ya dejó lastSyncError en la fila del export; esto además
    // deshabilita la cuenta entera si el grant fue revocado.
    await handleSyncError(account, err);
  }
}

async function handleSyncError(account: GoogleAccount, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[sheets-sync] Error sincronizando cuenta de Google del usuario ${account.userId}:`, err);

  if (isRevokedGrantError(err)) {
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        enabled: false,
        lastSyncError: "El acceso a Google fue revocado. Vuelve a conectar tu cuenta en Configuración.",
      },
    });
    await prisma.notification.create({
      data: {
        userId: account.userId,
        type: "BOT_ERROR",
        title: "Se desconectó la sincronización con Google Sheets",
        body: "Detectamos que el acceso fue revocado desde tu cuenta de Google. Vuelve a conectar en Configuración para reanudar la sincronización.",
        link: "/configuracion",
      },
    });
    return;
  }

  await prisma.googleAccount.update({
    where: { id: account.id },
    data: { lastSyncError: message.slice(0, 500) },
  });
}
