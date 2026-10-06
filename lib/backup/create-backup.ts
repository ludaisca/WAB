import { promises as fs } from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseDatabaseUrl } from "./pg-connection";
import { archiveMedia } from "./media-archive";
import { sha256File } from "./checksum";
import { getTableCounts } from "./table-counts";
import {
  BACKUP_MANIFEST_VERSION,
  encryptionKeyFingerprint,
  prismaSchemaHash,
  type BackupManifest,
} from "./manifest";
import { purgeOldBackups } from "./retention";
import { uploadBackupToS3 } from "./s3-storage";

const execFileAsync = promisify(execFile);

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";
const BACKUP_TIMEOUT_MS = Number(process.env.BACKUP_TIMEOUT_MS) || 30 * 60 * 1000;

// Hash (sha256) de un miembro del .tar leído en streaming con `tar xOf` — sin
// extraer nada a disco.
function sha256TarMember(tarPath: string, member: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn("tar", ["xOf", tarPath, member]);
    let stderr = "";
    child.stdout.on("data", (chunk) => hash.update(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(hash.digest("hex"));
      else reject(new Error(`tar xOf ${member} falló (${code}): ${stderr.slice(0, 500)}`));
    });
  });
}

// Con retención de UNA sola copia, un respaldo corrupto que reemplace al
// bueno sería irrecuperable. Antes de marcarlo COMPLETED (y por tanto antes de
// que la rotación borre el anterior) se relee el .tar FINAL y se compara con
// los checksums del manifest.
async function verifyFinalArchive(finalPath: string, manifest: BackupManifest): Promise<void> {
  const [dbSha, mediaSha] = await Promise.all([
    sha256TarMember(finalPath, "db.dump"),
    sha256TarMember(finalPath, "media.tar.gz"),
  ]);
  if (dbSha !== manifest.dbDumpSha256 || mediaSha !== manifest.mediaArchiveSha256) {
    throw new Error("Verificación del respaldo fallida: el .tar final no coincide con los checksums del manifest");
  }
}

async function runPgDump(dumpPath: string): Promise<void> {
  const conn = parseDatabaseUrl();
  // -Fc (formato custom): comprimido internamente, restaurable selectivamente
  // y compatible con `pg_restore --clean` — ver restore-backup.ts.
  //
  // --exclude-table de system_backups/system_restore_logs es deliberado, no un
  // descuido: son metadata operativa DE ESTA INSTANCIA (qué archivos existen en
  // BACKUP_ROOT de este servidor), no datos de negocio portables. Si se
  // incluyeran, un restore quedaría auto-referenciado de forma incorrecta — la
  // fila del propio backup que se está generando queda capturada a mitad de
  // camino (status RUNNING, sin filename todavía, porque el dump corre ANTES
  // de que el pipeline la marque COMPLETED) y un restore posterior de ese mismo
  // archivo sobrescribiría el historial real con esa foto a medias. Al
  // excluirlas, pg_restore --clean no genera ningún DROP/CREATE para estas dos
  // tablas y el historial de backups/restauraciones de la instancia actual
  // sobrevive intacto a través de cualquier restauración.
  await execFileAsync(
    "pg_dump",
    [
      "-h", conn.host,
      "-p", conn.port,
      "-U", conn.user,
      "-d", conn.database,
      "-Fc",
      "--no-owner",
      "--no-privileges",
      "--exclude-table=system_backups",
      "--exclude-table=system_restore_logs",
      "-f", dumpPath,
    ],
    { env: { ...process.env, PGPASSWORD: conn.password }, timeout: BACKUP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
  );
}

// Ejecuta el pipeline completo de un SystemBackup cuya fila ya existe con
// status PENDING (la crea la API para MANUAL, el worker para SCHEDULED/PRE_RESTORE).
// Lanza en caso de fallo (tras marcar la fila FAILED) para que el caller decida
// qué hacer — el worker de backup simplemente deja que BullMQ marque el job
// fallido; el pipeline de restauración aborta todo el restore si el backup de
// seguridad automático (PRE_RESTORE) falla.
export async function runBackupPipeline(backupId: string): Promise<void> {
  const backup = await prisma.systemBackup.update({
    where: { id: backupId },
    data: { status: "RUNNING" },
    include: { createdBy: { select: { id: true, email: true } } },
  });

  const tmpDir = path.join(BACKUP_ROOT, "tmp", backupId);

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    const dumpPath = path.join(tmpDir, "db.dump");
    await runPgDump(dumpPath);

    const mediaArchivePath = path.join(tmpDir, "media.tar.gz");
    const mediaStats = await archiveMedia(mediaArchivePath);

    const [dbDumpSha256, mediaArchiveSha256, tableCounts, pgVersionRows, schemaHash, dumpStat, mediaArchiveStat] =
      await Promise.all([
        sha256File(dumpPath),
        sha256File(mediaArchivePath),
        getTableCounts(),
        prisma.$queryRawUnsafe<{ version: string }[]>("SELECT version()"),
        prismaSchemaHash(),
        fs.stat(dumpPath),
        fs.stat(mediaArchivePath),
      ]);

    const manifest: BackupManifest = {
      version: BACKUP_MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      type: backup.type,
      generatedBy: backup.createdBy ? { userId: backup.createdBy.id, email: backup.createdBy.email } : null,
      prismaSchemaHash: schemaHash,
      postgresVersion: pgVersionRows[0]?.version ?? "unknown",
      encryptionKeyFingerprint: encryptionKeyFingerprint(),
      tableCounts,
      mediaFileCount: mediaStats.fileCount,
      mediaTotalBytes: mediaStats.totalBytes,
      dbDumpSha256,
      mediaArchiveSha256,
      totalSizeBytes: dumpStat.size + mediaArchiveStat.size,
    };

    const manifestPath = path.join(tmpDir, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const filename = `backup-${manifest.createdAt.replace(/[:.]/g, "-")}-${backup.type.toLowerCase()}-${backupId}.tar`;
    const finalPath = path.join(BACKUP_ROOT, filename);
    // Paquete final: un solo .tar SIN comprimir en la capa externa — db.dump y
    // media.tar.gz ya van comprimidos por separado, y así manifest.json queda
    // legible ("peekable") sin descomprimir todo el archivo.
    await execFileAsync("tar", ["cf", finalPath, "-C", tmpDir, "manifest.json", "db.dump", "media.tar.gz"], {
      maxBuffer: 10 * 1024 * 1024,
    });

    try {
      await verifyFinalArchive(finalPath, manifest);
    } catch (err) {
      // Un .tar que no verifica no debe quedar en disco ni compararse como válido.
      await fs.rm(finalPath, { force: true }).catch(() => {});
      throw err;
    }

    const finalStat = await fs.stat(finalPath);

    await prisma.systemBackup.update({
      where: { id: backupId },
      data: {
        status: "COMPLETED",
        filename,
        sizeBytes: BigInt(finalStat.size),
        manifest: manifest as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await fs.rm(tmpDir, { recursive: true, force: true });

    // Best-effort: un fallo de red/credencial acá no debe tumbar un backup
    // local que ya es válido, ni disparar el retry de BullMQ sobre un
    // pg_dump que sí funcionó — solo queda registrado en la fila.
    try {
      const s3Key = await uploadBackupToS3(finalPath, filename);
      await prisma.systemBackup.update({ where: { id: backupId }, data: { s3Key, s3UploadError: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.systemBackup
        .update({ where: { id: backupId }, data: { s3UploadError: message.slice(0, 4000) } })
        .catch(() => {});
    }

    if (backup.type !== "PRE_RESTORE") {
      await purgeOldBackups();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.systemBackup
      .update({
        where: { id: backupId },
        data: { status: "FAILED", errorMessage: message.slice(0, 4000), completedAt: new Date() },
      })
      .catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
