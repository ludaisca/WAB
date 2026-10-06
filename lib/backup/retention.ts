import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { deleteBackupFromS3 } from "./s3-storage";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";
// Una sola copia por defecto: cada respaldo pesa ~1.7 GB (97 % multimedia) y
// 7 copias diarias ocupaban ~11 GB. La purga corre DESPUÉS de que el respaldo
// nuevo quedó COMPLETED y verificado (ver create-backup.ts), así que nunca hay
// un momento sin ninguna copia válida. BACKUP_RETENTION_COUNT sigue siendo
// override explícito si algún día se quiere más historial.
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT) || 1;
// Respaldos de seguridad previos a una restauración: solo el más reciente.
const PRE_RESTORE_RETENTION_COUNT = 1;
const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Pool compartido MANUAL+SCHEDULED: se conservan los N más recientes (por
// completedAt) y se purgan archivo+fila del resto. Los PRE_RESTORE (red de
// seguridad automática antes de una restauración) tienen su propio pool: se
// conserva solo el más reciente — antes nunca se purgaban y cada restauración
// dejaba un respaldo completo para siempre.
export async function purgeOldBackups(): Promise<void> {
  const [regular, preRestore] = await Promise.all([
    prisma.systemBackup.findMany({
      where: { type: { in: ["MANUAL", "SCHEDULED"] }, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { id: true, filename: true, s3Key: true },
      skip: RETENTION_COUNT,
    }),
    prisma.systemBackup.findMany({
      where: { type: "PRE_RESTORE", status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { id: true, filename: true, s3Key: true },
      skip: PRE_RESTORE_RETENTION_COUNT,
    }),
  ]);
  const toPurge = [...regular, ...preRestore];

  if (toPurge.length > 0) {
    for (const backup of toPurge) {
      if (backup.filename) {
        await fs.rm(path.join(BACKUP_ROOT, backup.filename), { force: true }).catch(() => {});
      }
      if (backup.s3Key) {
        await deleteBackupFromS3(backup.s3Key);
      }
    }
    await prisma.systemBackup.deleteMany({ where: { id: { in: toPurge.map((b) => b.id) } } });
  }

  await purgeStaleUploads();
  await purgeOrphanedBackupFiles();
}

// Después de CUALQUIER restauración, system_backups queda con solo 2 filas
// (el backup de seguridad + el propio restoreLog re-insertados — ver
// dropTablesNotInDump() en restore-backup.ts) aunque el resto del historial
// previo siga viviendo como archivos .tar sueltos en BACKUP_ROOT, ahora sin
// ninguna fila que los referencie ni que la rotación de arriba pueda purgar.
// Se reconcilia disco↔DB aquí: cualquier .tar en la raíz de BACKUP_ROOT
// (nunca dentro de tmp/ o uploads/, que tienen su propia limpieza) sin
// SystemBackup.filename correspondiente se borra. Se llama tanto al final de
// cada backup exitoso como al final del pipeline de restauración.
export async function purgeOrphanedBackupFiles(): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(BACKUP_ROOT, { withFileTypes: true });
  } catch {
    return;
  }

  const knownFilenames = new Set(
    (await prisma.systemBackup.findMany({ where: { filename: { not: null } }, select: { filename: true } })).map(
      (b) => b.filename
    )
  );

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tar")) continue;
    if (knownFilenames.has(entry.name)) continue;
    await fs.rm(path.join(BACKUP_ROOT, entry.name), { force: true }).catch(() => {});
  }
}

// Archivos subidos para un preview de restauración (BACKUP_ROOT/uploads/) que
// nunca se disparan (el admin abandonó el flujo) quedarían huérfanos para
// siempre — se barren junto con la rotación normal, que ya corre al menos una
// vez al día vía el tick programado.
async function purgeStaleUploads(): Promise<void> {
  const uploadsDir = path.join(BACKUP_ROOT, "uploads");
  let entries;
  try {
    entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  } catch {
    return;
  }

  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(uploadsDir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs > STALE_UPLOAD_MAX_AGE_MS) {
        await fs.rm(full, { force: true });
      }
    } catch {
      // ignore — el archivo pudo borrarse concurrentemente
    }
  }
}
