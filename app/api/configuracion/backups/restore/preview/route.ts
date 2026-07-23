import { NextResponse } from "next/server";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { streamUploadToFile, discardUpload } from "@/lib/backup/upload";
import { buildRestorePreview } from "@/lib/backup/restore-backup";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

// Sin tocar ningún dato — valida manifest+checksums (y, para HISTORY, que el
// backup exista) y devuelve un resumen para que el admin decida antes de
// disparar la restauración real en POST .../restore/route.ts.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { allowed } = await rateLimit(`backup-restore-preview:${session.user.id}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const { historyId } = (await req.json()) as { historyId?: string };
      if (!historyId) return NextResponse.json({ error: "historyId requerido" }, { status: 400 });

      const backup = await prisma.systemBackup.findUnique({ where: { id: historyId } });
      if (!backup || backup.status !== "COMPLETED" || !backup.filename) {
        return NextResponse.json({ error: "Backup no disponible" }, { status: 404 });
      }

      const preview = await buildRestorePreview(path.join(BACKUP_ROOT, backup.filename));
      return NextResponse.json({
        sourceType: "HISTORY" as const,
        historyId,
        sourceFilename: backup.filename,
        ...preview,
      });
    }

    // Subida binaria cruda (streaming a disco, ver lib/backup/upload.ts) —
    // nunca formData()/arrayBuffer(), inviable en memoria para varios GB.
    const filenameHeader = req.headers.get("x-backup-filename");
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
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
