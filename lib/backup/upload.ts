import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";
const MAX_RESTORE_UPLOAD_BYTES = Number(process.env.MAX_RESTORE_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024;

export interface UploadedBackup {
  uploadToken: string;
  relativePath: string; // relativo a BACKUP_ROOT, ej. "uploads/<uuid>.tar"
  size: number;
}

// Streaming a disco vía pipeline — nunca formData()/arrayBuffer(), inviable en
// memoria para backups de varios GB. MAX_RESTORE_UPLOAD_BYTES se aplica dos
// veces: por Content-Length declarado (rechazo temprano) y por conteo real de
// bytes durante el streaming (por si el header viene ausente o mentido).
export async function streamUploadToFile(request: Request): Promise<UploadedBackup> {
  if (!request.body) throw new Error("Solicitud sin cuerpo");

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 0 && declaredLength > MAX_RESTORE_UPLOAD_BYTES) {
    throw new Error(`El archivo excede el máximo permitido (${Math.floor(MAX_RESTORE_UPLOAD_BYTES / 1e9)}GB)`);
  }

  const uploadsDir = path.join(BACKUP_ROOT, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const uploadToken = randomUUID();
  const relativePath = path.join("uploads", `${uploadToken}.tar`);
  const absPath = path.join(BACKUP_ROOT, relativePath);

  let bytesWritten = 0;
  const nodeStream = Readable.fromWeb(request.body as NodeWebReadableStream);
  nodeStream.on("data", (chunk: Buffer) => {
    bytesWritten += chunk.length;
    if (bytesWritten > MAX_RESTORE_UPLOAD_BYTES) {
      nodeStream.destroy(new Error("El archivo excede el tamaño máximo permitido durante la subida"));
    }
  });

  try {
    await pipeline(nodeStream, createWriteStream(absPath));
  } catch (err) {
    await fs.rm(absPath, { force: true }).catch(() => {});
    throw err;
  }

  return { uploadToken, relativePath, size: bytesWritten };
}

export function discardUpload(relativePath: string): Promise<void> {
  return fs.rm(path.join(BACKUP_ROOT, relativePath), { force: true }).catch(() => {});
}
