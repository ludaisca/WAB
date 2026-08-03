import { NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { streamUploadToFile, discardUpload } from "@/lib/backup/upload";
import { buildRestorePreview } from "@/lib/backup/restore-backup";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

// Contraparte sin sesión de POST /api/configuracion/backups/restore/preview —
// solo el caso de archivo subido tiene sentido aquí (no hay historial de
// respaldos todavía en un despliegue nuevo). Solo alcanzable con 0 usuarios en
// el sistema, igual que el resto de /api/onboarding/**; valida manifest +
// checksums sin tocar ningún dato para que el admin decida antes de disparar
// la restauración real en POST /api/onboarding/restore.
export async function POST(req: Request) {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return NextResponse.json(
      { error: "El sistema ya fue configurado. Inicia sesión normalmente." },
      { status: 409 }
    );
  }

  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const { allowed } = await rateLimit(`onboarding-restore-preview:${ip}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Demasiados intentos. Intenta de nuevo más tarde." }, { status: 429 });
  }

  const filenameHeader = req.headers.get("x-backup-filename");

  try {
    // Streaming a disco (ver lib/backup/upload.ts) — nunca formData()/arrayBuffer().
    const upload = await streamUploadToFile(req);
    try {
      const preview = await buildRestorePreview(path.join(BACKUP_ROOT, upload.relativePath));
      return NextResponse.json({
        sourceType: "UPLOADED" as const,
        uploadToken: upload.uploadToken,
        sourceFilename: filenameHeader ? decodeURIComponent(filenameHeader) : `${upload.uploadToken}.tar`,
        ...preview,
      });
    } catch (err) {
      await discardUpload(upload.relativePath);
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al validar el archivo subido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
