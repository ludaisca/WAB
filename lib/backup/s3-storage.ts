import { createWriteStream, createReadStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

export interface S3StorageConfig {
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// Lee SystemConfig y descifra el secreto — null si S3 está deshabilitado o
// faltan campos requeridos (bucket/access key/secret). Región tiene fallback
// a "auto" (convención de R2; la propia SDK exige algún valor no vacío).
export async function getS3Config(): Promise<S3StorageConfig | null> {
  const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
  if (!config?.s3Enabled) return null;
  if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) return null;

  return {
    endpoint: config.s3Endpoint || null,
    region: config.s3Region || "auto",
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: decrypt(config.s3SecretAccessKey),
    forcePathStyle: config.s3ForcePathStyle,
  };
}

function buildClient(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function keyFor(filename: string): string {
  return `backups/${filename}`;
}

// Streaming multipart — nunca cargar el .tar completo en memoria, los
// respaldos con medios llegan a varios GB (ver MAX_RESTORE_UPLOAD_BYTES) y un
// PutObject plano además tiene un tope duro de 5GB en S3 real.
export async function uploadBackupToS3(localPath: string, filename: string): Promise<string> {
  const config = await getS3Config();
  if (!config) throw new Error("S3 no está configurado o habilitado");

  const client = buildClient(config);
  const key = keyFor(filename);

  const upload = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(localPath),
    },
  });
  await upload.done();

  return key;
}

// Best-effort — nunca lanza, solo loggea. La retención local no debe fallar
// por un objeto S3 que ya no existe o un bucket temporalmente inalcanzable.
export async function deleteBackupFromS3(s3Key: string): Promise<void> {
  try {
    const config = await getS3Config();
    if (!config) return;
    const client = buildClient(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: s3Key }));
  } catch (err) {
    console.error(`[s3-storage] Error borrando ${s3Key} de S3:`, err);
  }
}

export async function downloadBackupFromS3(s3Key: string, destPath: string): Promise<void> {
  const config = await getS3Config();
  if (!config) throw new Error("S3 no está configurado o habilitado");

  const client = buildClient(config);
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: s3Key }));
  if (!response.Body) throw new Error(`Objeto S3 ${s3Key} sin contenido`);

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await pipeline(response.Body as Readable, createWriteStream(destPath));
  } catch (err) {
    await fs.rm(destPath, { force: true }).catch(() => {});
    throw err;
  }
}

// Único lugar que decide "¿el .tar ya está en disco, o hay que traerlo de
// S3 primero?" — usado por descarga, preview de restauración y el propio
// pipeline de restauración. Esto es lo que habilita recuperar un respaldo
// aunque el volumen local ya no exista.
export async function ensureLocalBackupFile(backup: { filename: string | null; s3Key: string | null }): Promise<string> {
  if (!backup.filename) throw new Error("Backup sin archivo asociado");

  const localPath = path.join(BACKUP_ROOT, backup.filename);
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // no está en disco, seguimos abajo
  }

  if (!backup.s3Key) throw new Error("Archivo no encontrado en disco y sin copia en S3");
  await downloadBackupFromS3(backup.s3Key, localPath);
  return localPath;
}

// Prueba real de la conexión, usada por el botón "Probar conexión" antes de
// guardar. HeadBucket primero; algunos tokens R2 con permisos acotados a
// "Object Read & Write" no permiten operaciones a nivel de bucket, así que
// ante un 403 se intenta un PutObject+DeleteObject de una key inofensiva
// antes de reportar el fallo.
export async function testS3Connection(config: S3StorageConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = buildClient(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { ok: true };
  } catch (headErr) {
    const probeKey = "backups/.wab-connection-test";
    try {
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: probeKey, Body: "wab-connection-test" }));
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: probeKey }));
      return { ok: true };
    } catch (putErr) {
      const message = putErr instanceof Error ? putErr.message : String(putErr);
      const headMessage = headErr instanceof Error ? headErr.message : String(headErr);
      return { ok: false, error: message || headMessage };
    }
  }
}
