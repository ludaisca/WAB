import { promises as fs } from "fs";
import { statfs } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Prisma, SystemBackup } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { parseDatabaseUrl } from "./pg-connection";
import { extractMediaArchive, countExtractedFiles } from "./media-archive";
import { sha256File } from "./checksum";
import { getTableCounts } from "./table-counts";
import { validateManifest, encryptionKeyFingerprint, type BackupManifest } from "./manifest";
import { runBackupPipeline } from "./create-backup";
import { purgeOrphanedBackupFiles } from "./retention";
import { ensureLocalBackupFile } from "./s3-storage";
import { enterMaintenanceMode, exitMaintenanceMode } from "@/lib/system-maintenance";

const execFileAsync = promisify(execFile);

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";
const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";
const BACKUP_TIMEOUT_MS = Number(process.env.BACKUP_TIMEOUT_MS) || 30 * 60 * 1000;

export interface RestorePreview {
  manifest: BackupManifest;
  encryptionKeyMismatch: boolean;
  tableCountDiffs: Array<{ table: string; current: number; backup: number }>;
}

// Extrae solo manifest.json + re-verifica los checksums de db.dump/media.tar.gz
// contra lo declarado en el manifest, SIN restaurar nada — usado tanto por el
// endpoint de preview como por el propio pipeline de restauración (defensa en
// profundidad: el archivo pudo cambiar entre el preview y el trigger).
export async function validateBackupFile(tarPath: string): Promise<{ manifest: BackupManifest; encryptionKeyMismatch: boolean }> {
  const tmpDir = path.join(BACKUP_ROOT, "tmp", `validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    await execFileAsync("tar", ["xf", tarPath, "-C", tmpDir, "manifest.json", "db.dump", "media.tar.gz"], {
      maxBuffer: 10 * 1024 * 1024,
    });

    const raw = await fs.readFile(path.join(tmpDir, "manifest.json"), "utf8");
    let manifest: BackupManifest;
    try {
      manifest = validateManifest(JSON.parse(raw));
    } catch {
      throw new Error("manifest.json inválido o de una versión incompatible — el archivo no parece ser un backup válido de este sistema");
    }

    const [dbSha, mediaSha] = await Promise.all([
      sha256File(path.join(tmpDir, "db.dump")),
      sha256File(path.join(tmpDir, "media.tar.gz")),
    ]);
    if (dbSha !== manifest.dbDumpSha256) {
      throw new Error("El checksum de db.dump no coincide con el manifest — el archivo puede estar corrupto o incompleto");
    }
    if (mediaSha !== manifest.mediaArchiveSha256) {
      throw new Error("El checksum de media.tar.gz no coincide con el manifest — el archivo puede estar corrupto o incompleto");
    }

    return { manifest, encryptionKeyMismatch: manifest.encryptionKeyFingerprint !== encryptionKeyFingerprint() };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function buildRestorePreview(tarPath: string): Promise<RestorePreview> {
  const { manifest, encryptionKeyMismatch } = await validateBackupFile(tarPath);
  const currentCounts = await getTableCounts();
  const tableCountDiffs = Object.entries(manifest.tableCounts)
    .filter(([table, backupCount]) => (currentCounts[table] ?? 0) !== backupCount)
    .map(([table, backupCount]) => ({ table, current: currentCounts[table] ?? 0, backup: backupCount }));

  return { manifest, encryptionKeyMismatch, tableCountDiffs };
}

async function assertDiskSpace(dir: string, requiredBytes: number, label: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const stats = await statfs(dir);
  const availableBytes = stats.bavail * stats.bsize;
  if (availableBytes < requiredBytes) {
    const requiredGb = (requiredBytes / 1e9).toFixed(1);
    const availableGb = (availableBytes / 1e9).toFixed(1);
    throw new Error(`Espacio insuficiente en ${label}: se requieren ~${requiredGb}GB, hay ~${availableGb}GB disponibles`);
  }
}

// `pg_restore --clean --if-exists` solo sabe generar DROP para lo que el
// propio dump declara — un objeto vivo en la BD destino que el dump desconoce
// (una tabla añadida al schema DESPUÉS de que se tomó este backup, ej.
// audio_transcription_usage) puede dejar una FK colgando hacia algo que sí
// está en el dump (ej. users_pkey) y tronar el --clean con "cannot drop
// constraint ... because other objects depend on it". Antes esto solo se
// resolvía a mano para system_backups/system_restore_logs (metadata operativa
// de ESTA instancia — qué archivos existen en BACKUP_ROOT de este servidor —
// deliberadamente excluida del dump, ver create-backup.ts:runPgDump); se
// generaliza aquí comparando las tablas que el dump SÍ trae (`pg_restore -l`)
// contra las que la BD actual tiene, y soltando (CASCADE) solo las que sobran
// — cubre esas dos tablas de siempre y cualquier tabla nueva del schema
// actual que un backup más viejo no conozca. `prisma db push --accept-data-loss`
// (paso 6, o el catch en un fallo) las recrea vacías después.
async function dropTablesNotInDump(dumpPath: string): Promise<void> {
  const { stdout } = await execFileAsync("pg_restore", ["-l", dumpPath], { maxBuffer: 10 * 1024 * 1024 });
  const dumpedTables = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\d+;\s+\d+\s+\d+\s+TABLE\s+public\s+(\S+)\s/);
    if (match) dumpedTables.add(match[1]);
  }

  const currentTables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const extraTables = currentTables.map((t) => t.tablename).filter((t) => !dumpedTables.has(t));
  if (extraTables.length === 0) return;

  const identifiers = extraTables.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${identifiers} CASCADE`);
}

// Reinserta la fila del backup de seguridad (PRE_RESTORE) tras el
// DROP TABLE ... CASCADE de dropTablesNotInDump(), que se la lleva junto con
// el resto del schema. Necesario tanto si la restauración termina bien (paso
// 6) como si falla DESPUÉS de ese drop (catch de runRestorePipeline) —
// SystemRestoreLog.safetyBackupId es una FK hacia esta fila, así que sin
// reinsertarla antes, el propio upsert que registra el fallo también truena
// (antes esto quedaba silenciado dentro de un `.catch(() => {})`, dejando la
// restauración fallida sin NINGÚN rastro en `/configuracion/backups` pese a
// que el .tar de seguridad sí sigue en disco).
async function reinsertSafetyBackup(final: SystemBackup): Promise<void> {
  await prisma.systemBackup.create({
    data: {
      id: final.id,
      type: final.type,
      status: final.status,
      filename: final.filename,
      sizeBytes: final.sizeBytes,
      manifest: (final.manifest ?? undefined) as Prisma.InputJsonValue | undefined,
      errorMessage: final.errorMessage,
      startedAt: final.startedAt,
      completedAt: final.completedAt,
    },
  });
}

async function runPgRestore(dumpPath: string): Promise<void> {
  const conn = parseDatabaseUrl();
  // --single-transaction: si cualquier statement falla, Postgres hace ROLLBACK
  // completo automático — la DB queda exactamente como estaba, nunca a medias.
  // Incompatible con restore paralelo (-j); se acepta el trade-off de
  // velocidad por atomicidad garantizada.
  await execFileAsync(
    "pg_restore",
    [
      "-h", conn.host,
      "-p", conn.port,
      "-U", conn.user,
      "-d", conn.database,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      dumpPath,
    ],
    { env: { ...process.env, PGPASSWORD: conn.password }, timeout: BACKUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
  );
}

interface EncryptionWarnings {
  waAccounts: string[];
  appSettingsUserIds: string[];
  googleAccounts: string[];
}

// Intenta decrypt() sobre CADA fila con campos cifrados (no solo una muestra —
// son pocas decenas de filas típicamente, es barato) y devuelve una lista
// concreta de qué quedó indescifrable, en vez de una advertencia genérica.
async function checkEncryptionWarnings(): Promise<EncryptionWarnings> {
  const warnings: EncryptionWarnings = { waAccounts: [], appSettingsUserIds: [], googleAccounts: [] };

  function isBroken(value: string | null): boolean {
    if (!value) return false;
    try {
      decrypt(value);
      return false;
    } catch {
      return true;
    }
  }

  const accounts = await prisma.wAAccount.findMany({
    where: { OR: [{ accessToken: { not: null } }, { appSecret: { not: null } }] },
    select: { id: true, name: true, accessToken: true, appSecret: true },
  });
  for (const acc of accounts) {
    if (isBroken(acc.accessToken) || isBroken(acc.appSecret)) {
      warnings.waAccounts.push(`${acc.name} (${acc.id})`);
    }
  }

  const settings = await prisma.appSettings.findMany({
    where: { OR: [{ googleApiKey: { not: null } }] },
    select: { userId: true, googleApiKey: true },
  });
  for (const s of settings) {
    if (isBroken(s.googleApiKey)) {
      warnings.appSettingsUserIds.push(s.userId);
    }
  }

  const googleAccounts = await prisma.googleAccount.findMany({
    select: { id: true, googleEmail: true, accessToken: true, refreshToken: true },
  });
  for (const g of googleAccounts) {
    if (isBroken(g.accessToken) || isBroken(g.refreshToken)) {
      warnings.googleAccounts.push(`${g.googleEmail} (${g.id})`);
    }
  }

  return warnings;
}

async function notifyAdmins(type: "RESTORE_COMPLETED" | "RESTORE_FAILED", title: string, body: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      prisma.notification.create({
        data: { userId: a.id, type, title, body, link: "/configuracion/backups" },
      })
    )
  );
}

// Flujo completo de una restauración — la fila SystemRestoreLog ya existe con
// status PENDING (la crea la API al disparar). Ver el detalle paso a paso en
// el plan; resumen: validar → mantenimiento → backup de seguridad → pg_restore
// atómico → reconciliar esquema → swap de medios → validación post-restore →
// salir de mantenimiento → notificar.
export async function runRestorePipeline(restoreLogId: string): Promise<void> {
  const restoreLog = await prisma.systemRestoreLog.update({
    where: { id: restoreLogId },
    data: { status: "RUNNING" },
  });

  // El job de BullMQ puede correr minutos/horas después del pre-check en la
  // ruta API — si el volumen local se perdió mientras tanto, HISTORY es la
  // única fuente que puede recuperarse de S3 (UPLOADED nunca tiene s3Key).
  const tarPath =
    restoreLog.sourceType === "HISTORY" && restoreLog.sourceBackupId
      ? await ensureLocalBackupFile(await prisma.systemBackup.findUniqueOrThrow({ where: { id: restoreLog.sourceBackupId } }))
      : path.join(BACKUP_ROOT, restoreLog.sourcePath);
  const workDir = path.join(BACKUP_ROOT, "tmp", `restore-${restoreLogId}`);
  const stagingDir = path.join(MEDIA_ROOT, `.restore-staging-${restoreLogId}`);
  const oldDir = path.join(MEDIA_ROOT, `.restore-old-${restoreLogId}`);

  let enteredMaintenance = false;
  let safetyBackupId: string | null = null;
  let safetyBackupFinal: SystemBackup | null = null;

  try {
    // 1. Validar sin tocar nada.
    const { manifest, encryptionKeyMismatch } = await validateBackupFile(tarPath);
    const tarStat = await fs.stat(tarPath);
    await assertDiskSpace(BACKUP_ROOT, tarStat.size, "el volumen de backups");
    // El swap de medios en staging requiere temporalmente hasta ~2x el tamaño
    // actual de medios en el mismo volumen.
    await assertDiskSpace(MEDIA_ROOT, manifest.mediaTotalBytes * 2, "el volumen de medios");

    // 2. Guard de concurrencia — defensa en profundidad además del 409 a nivel API.
    const concurrent = await prisma.systemRestoreLog.findFirst({
      where: { status: { in: ["PENDING", "RUNNING"] }, id: { not: restoreLogId } },
    });
    if (concurrent) throw new Error("Ya hay otra restauración en curso");

    // 3. Entrar en modo mantenimiento — a partir de aquí no entran escrituras nuevas.
    await enterMaintenanceMode(`Restauración en curso desde ${restoreLog.sourceFilename}`);
    enteredMaintenance = true;

    // 4. Backup de seguridad automático del estado ACTUAL, tomado después de
    // entrar en mantenimiento (si se tomara antes, una escritura que llegue
    // justo en el medio se perdería sin quedar en ningún lado).
    const safetyBackup = await prisma.systemBackup.create({ data: { type: "PRE_RESTORE", status: "PENDING" } });
    safetyBackupId = safetyBackup.id;
    await runBackupPipeline(safetyBackup.id);
    // Snapshot en memoria del resultado final ANTES del wipe de las tablas de
    // auditoría (paso 5) — se re-inserta después de que prisma db push las
    // recree vacías.
    safetyBackupFinal = await prisma.systemBackup.findUniqueOrThrow({ where: { id: safetyBackup.id } });
    await prisma.systemRestoreLog.update({ where: { id: restoreLogId }, data: { safetyBackupId: safetyBackup.id } });

    // Extraer el paquete completo para el resto del proceso.
    await fs.mkdir(workDir, { recursive: true });
    await execFileAsync("tar", ["xf", tarPath, "-C", workDir], { maxBuffer: 10 * 1024 * 1024 });

    // 5. pg_restore atómico. Antes, soltar cualquier tabla del schema actual
    // que el dump no conozca — ver el comentario de dropTablesNotInDump().
    await dropTablesNotInDump(path.join(workDir, "db.dump"));
    await runPgRestore(path.join(workDir, "db.dump"));

    // Backfill previo a db push: si el backup es de una versión antigua con
    // columnas provider/openrouterApiKey, remapa modelos OpenRouter → Gemini
    // antes de que el push las elimine (no-op si ya migrado).
    await execFileAsync(
      "npx",
      ["prisma", "db", "execute", "--file", "prisma/sql/migrate-off-openrouter.sql", "--schema", "prisma/schema.prisma"],
      { cwd: process.cwd(), timeout: BACKUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    ).catch(() => {});

    // 6. Reconciliar esquema — recrea system_backups/system_restore_logs
    // (vacías, dropeadas en el paso anterior) además de cubrir el caso de
    // restaurar un backup de una versión de schema distinta a la desplegada.
    await execFileAsync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      timeout: BACKUP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    await execFileAsync(
      "npx",
      ["prisma", "db", "execute", "--file", "prisma/sql/ensure-vector-index.sql", "--schema", "prisma/schema.prisma"],
      { cwd: process.cwd(), timeout: BACKUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );

    // Re-insertar el backup de seguridad de ESTA operación (la fila original
    // se perdió en el wipe del paso 5) — createdById siempre null para
    // PRE_RESTORE, así que no hay riesgo de FK colgante ahí.
    if (safetyBackupFinal) {
      await reinsertSafetyBackup(safetyBackupFinal).catch((e) =>
        console.error("[restore] No se pudo re-insertar el backup de seguridad tras el wipe:", e)
      );
    }

    // 7. Medios: extraer a staging, verificar conteo, y solo entonces mover
    // (rename atómico dentro del mismo volumen) — si algo falla antes de mover,
    // los medios actuales no se tocan.
    await extractMediaArchive(path.join(workDir, "media.tar.gz"), stagingDir);
    const extractedCount = await countExtractedFiles(stagingDir);
    if (extractedCount !== manifest.mediaFileCount) {
      throw new Error(
        `Los medios extraídos (${extractedCount}) no coinciden con el manifest (${manifest.mediaFileCount}) — la base de datos ya se restauró, pero los medios NO se tocaron. Reintenta la restauración completa en vez de continuar en este estado mixto.`
      );
    }

    await fs.mkdir(oldDir, { recursive: true });
    const currentEntries = await fs.readdir(MEDIA_ROOT, { withFileTypes: true });
    for (const entry of currentEntries) {
      if (entry.name.startsWith(".restore-")) continue;
      await fs.rename(path.join(MEDIA_ROOT, entry.name), path.join(oldDir, entry.name));
    }
    const stagedEntries = await fs.readdir(stagingDir, { withFileTypes: true });
    for (const entry of stagedEntries) {
      await fs.rename(path.join(stagingDir, entry.name), path.join(MEDIA_ROOT, entry.name));
    }

    // 8. Validación post-restore.
    const [newCounts, encryptionWarnings] = await Promise.all([getTableCounts(), checkEncryptionWarnings()]);
    const tableCountDiffs = Object.entries(manifest.tableCounts)
      .filter(([table, expected]) => (newCounts[table] ?? -1) !== expected)
      .map(([table, expected]) => `${table}: esperado ${expected}, obtenido ${newCounts[table] ?? "?"}`);

    // 9. Salir de modo mantenimiento.
    await exitMaintenanceMode();
    enteredMaintenance = false;

    // upsert, no update: la fila original de ESTE restoreLog también se
    // perdió en el wipe del paso 5 — se re-crea aquí con el resultado final.
    // requestedById se re-verifica porque, en una migración real entre
    // instancias, el admin que disparó la restauración puede ya no existir
    // en la tabla `users` recién restaurada (fue reemplazada por la del origen).
    const requesterStillExists = restoreLog.requestedById
      ? await prisma.user.findUnique({ where: { id: restoreLog.requestedById }, select: { id: true } })
      : null;
    const finalWarnings = { ...encryptionWarnings, tableCountDiffs } as unknown as Prisma.InputJsonValue;
    await prisma.systemRestoreLog.upsert({
      where: { id: restoreLogId },
      create: {
        id: restoreLogId,
        status: "COMPLETED",
        sourceType: restoreLog.sourceType,
        sourceFilename: restoreLog.sourceFilename,
        sourcePath: restoreLog.sourcePath,
        safetyBackupId,
        requestedById: requesterStillExists ? restoreLog.requestedById : null,
        encryptionKeyMismatch,
        postRestoreWarnings: finalWarnings,
        startedAt: restoreLog.startedAt,
        completedAt: new Date(),
      },
      update: {
        status: "COMPLETED",
        encryptionKeyMismatch,
        postRestoreWarnings: finalWarnings,
        completedAt: new Date(),
      },
    });

    // 10. Notificar.
    const hasWarnings =
      encryptionKeyMismatch ||
      encryptionWarnings.waAccounts.length > 0 ||
      encryptionWarnings.appSettingsUserIds.length > 0 ||
      encryptionWarnings.googleAccounts.length > 0;
    await notifyAdmins(
      "RESTORE_COMPLETED",
      "Restauración completada",
      hasWarnings
        ? `Restauración completada desde ${restoreLog.sourceFilename}. Algunas credenciales cifradas requieren reconfiguración manual — revisa el detalle.`
        : `Restauración completada desde ${restoreLog.sourceFilename}. Todos los datos, incluidas las credenciales cifradas, se restauraron correctamente.`
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (enteredMaintenance) {
      await exitMaintenanceMode().catch(() => {});
    }
    // Si dropTablesNotInDump() ya corrió pero pg_restore (u otro paso) falló
    // después, esas tablas quedaron dropeadas sin recrear — reconcilia el
    // schema para no dejarlas faltantes permanentemente tras un intento
    // fallido. No-op seguro si nunca se llegó a dropTablesNotInDump().
    await execFileAsync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: process.cwd(),
      timeout: BACKUP_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }).catch(() => {});
    // Reinsertar el backup de seguridad ANTES del upsert de abajo — si el
    // fallo ocurrió después del drop del paso 5, system_backups ya se
    // recreó vacía por el db push de arriba, así que la fila de
    // safetyBackupId todavía no existe y el upsert (que la referencia por FK)
    // truena en silencio sin esto (ver el comentario de reinsertSafetyBackup).
    if (safetyBackupFinal) {
      await reinsertSafetyBackup(safetyBackupFinal).catch((e) =>
        console.error("[restore] No se pudo re-insertar el backup de seguridad en el camino de fallo:", e)
      );
    }
    // upsert por la misma razón que en el camino feliz: la fila puede haberse
    // perdido en el wipe si el fallo ocurrió después del paso 5.
    const requesterStillExistsOnFail = restoreLog.requestedById
      ? await prisma.user.findUnique({ where: { id: restoreLog.requestedById }, select: { id: true } }).catch(() => null)
      : null;
    await prisma.systemRestoreLog
      .upsert({
        where: { id: restoreLogId },
        create: {
          id: restoreLogId,
          status: "FAILED",
          sourceType: restoreLog.sourceType,
          sourceFilename: restoreLog.sourceFilename,
          sourcePath: restoreLog.sourcePath,
          safetyBackupId,
          requestedById: requesterStillExistsOnFail ? restoreLog.requestedById : null,
          errorMessage: message.slice(0, 4000),
          startedAt: restoreLog.startedAt,
          completedAt: new Date(),
        },
        update: {
          status: "FAILED",
          errorMessage: message.slice(0, 4000),
          completedAt: new Date(),
          ...(safetyBackupId ? { safetyBackupId } : {}),
        },
      })
      .catch(() => {});
    await notifyAdmins("RESTORE_FAILED", "Restauración fallida", message.slice(0, 500)).catch(() => {});
    throw err;
  } finally {
    // Limpieza best-effort SIEMPRE, éxito o fallo — si esto solo corriera en
    // el camino feliz, un fallo después del swap de medios dejaría
    // .restore-old-<id>/.restore-staging-<id> huérfanos que además
    // contaminarían el próximo backup (ver el --exclude en media-archive.ts,
    // que es la segunda barrera para ese mismo problema).
    await fs.rm(oldDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    // El historial previo de system_backups se pierde en el wipe (ver
    // dropTablesNotInDump()) — sus archivos .tar quedan huérfanos en disco, ahora
    // sin fila que los referencie. Se reconcilian aquí, no solo en la
    // rotación diaria, para no esperar hasta el próximo backup automático.
    await purgeOrphanedBackupFiles().catch(() => {});
  }
}
