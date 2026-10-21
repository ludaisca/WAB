import { prisma } from "@/lib/prisma";
import { runBackupPipeline } from "@/lib/backup/create-backup";
import { purgeOldBackups } from "@/lib/backup/retention";
import { dateKeyInTz } from "@/lib/timezone";

interface AttemptInfo {
  attemptsMade: number;
  maxAttempts: number;
}

function formatBytes(bytes: bigint | null): string {
  if (!bytes) return "tamaño desconocido";
  const mb = Number(bytes) / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

async function notifyBackupResult(backupId: string): Promise<void> {
  const backup = await prisma.systemBackup.findUnique({ where: { id: backupId } });
  if (!backup) return;

  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const isCompleted = backup.status === "COMPLETED";
  const title = isCompleted ? "Backup completado" : "Backup fallido";
  const body = isCompleted
    ? `Respaldo ${backup.type === "SCHEDULED" ? "automático" : "manual"} generado correctamente (${formatBytes(backup.sizeBytes)}).`
    : backup.errorMessage?.slice(0, 500) ?? "Error desconocido al generar el respaldo.";

  await Promise.all(
    admins.map((a) =>
      prisma.notification.create({
        data: {
          userId: a.id,
          type: isCompleted ? "BACKUP_COMPLETED" : "BACKUP_FAILED",
          title,
          body,
          link: "/configuracion/backups",
        },
      })
    )
  );
}

// data.backupId ya existe con status PENDING (creado por la API para MANUAL o
// por processScheduledBackupTick para SCHEDULED).
export async function processBackupJob(
  data: { backupId: string },
  attemptInfo: AttemptInfo = { attemptsMade: 0, maxAttempts: 1 }
): Promise<void> {
  try {
    await runBackupPipeline(data.backupId);
    await notifyBackupResult(data.backupId);
  } catch (err) {
    const isLastAttempt = attemptInfo.attemptsMade + 1 >= attemptInfo.maxAttempts;
    if (!isLastAttempt) {
      // Un dump que falla por un error transitorio (red, disco momentáneamente
      // lleno) puede reintentarse sin riesgo — no toca datos existentes. Solo
      // se notifica en el último intento para no saturar la campanita.
      throw err;
    }
    await notifyBackupResult(data.backupId);
  }
}

// Un respaldo automático por día (calendario CDMX). El cron ya es diario
// (2:00 am), pero BullMQ puede re-ejecutar el tick al perder el lock (visto en
// producción el 18 y 19 de octubre: dos corridas el mismo día, +2.5 GB de
// disco cada una). Se compara por día y no por ventana de 24h a propósito: una
// corrida que termina a las 2:03 am bloquearía la del día siguiente a las 2:00.
export async function processScheduledBackupTick(): Promise<void> {
  const existing = await prisma.systemBackup.findFirst({
    where: { type: "SCHEDULED" },
    orderBy: { startedAt: "desc" },
  });

  // Ya hay uno corriendo → no hacer nada.
  if (existing && (existing.status === "PENDING" || existing.status === "RUNNING")) return;
  // Ya se generó hoy (mismo día en CDMX) → no hacer nada.
  if (existing?.status === "COMPLETED" && dateKeyInTz(existing.startedAt) === dateKeyInTz(new Date())) return;

  // Purga preventiva: libera las copias programadas heredadas del esquema
  // anterior (una por día, ~2.5 GB cada una) antes de necesitar el espacio
  // para la nueva. Nunca borra la más reciente, así que siempre queda una
  // copia válida en disco.
  await purgeOldBackups();

  // Una sola fila para el programado: se reutiliza y se actualiza en vez de
  // acumular una fila por día. El archivo también es uno solo (nombre fijo).
  const backup = existing
    ? await prisma.systemBackup.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
          s3UploadError: null,
        },
      })
    : await prisma.systemBackup.create({ data: { type: "SCHEDULED", status: "PENDING" } });

  await processBackupJob({ backupId: backup.id });
}
