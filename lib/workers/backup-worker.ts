import { prisma } from "@/lib/prisma";
import { runBackupPipeline } from "@/lib/backup/create-backup";

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

export async function processScheduledBackupTick(): Promise<void> {
  const backup = await prisma.systemBackup.create({ data: { type: "SCHEDULED", status: "PENDING" } });
  await processBackupJob({ backupId: backup.id });
}
