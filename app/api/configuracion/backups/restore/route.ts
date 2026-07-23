import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { restoreQueue } from "@/lib/queue";
import { validateBackupFile } from "@/lib/backup/restore-backup";
import { serializeRestoreLog } from "@/lib/backup/serialize";
import { RESTORE_CONFIRMATION_PHRASE } from "@/lib/backup/constants";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const logs = await prisma.systemRestoreLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      sourceBackup: { select: { id: true, type: true } },
      safetyBackup: { select: { id: true, filename: true } },
    },
  });

  return NextResponse.json({ logs: logs.map(serializeRestoreLog) });
}

interface RestoreTriggerBody {
  sourceType?: "UPLOADED" | "HISTORY";
  uploadToken?: string;
  historyId?: string;
  sourceFilename?: string;
  confirmationPhrase?: string;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`backup-restore-trigger:${session.user.id}`, 5, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const body = (await req.json()) as RestoreTriggerBody;

    // Revalidada server-side — nunca confiar solo en el disabled del botón.
    if (body.confirmationPhrase !== RESTORE_CONFIRMATION_PHRASE) {
      return NextResponse.json(
        { error: `Debes escribir exactamente "${RESTORE_CONFIRMATION_PHRASE}" para confirmar` },
        { status: 400 }
      );
    }

    const existing = await prisma.systemRestoreLog.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
    if (existing) {
      return NextResponse.json({ error: "Ya hay una restauración en curso" }, { status: 409 });
    }

    let sourcePath: string;
    let sourceFilename: string;
    let sourceBackupId: string | null = null;

    if (body.sourceType === "HISTORY") {
      if (!body.historyId) return NextResponse.json({ error: "historyId requerido" }, { status: 400 });
      const backup = await prisma.systemBackup.findUnique({ where: { id: body.historyId } });
      if (!backup || backup.status !== "COMPLETED" || !backup.filename) {
        return NextResponse.json({ error: "Backup no disponible" }, { status: 404 });
      }
      sourcePath = backup.filename;
      sourceFilename = backup.filename;
      sourceBackupId = backup.id;
    } else if (body.sourceType === "UPLOADED") {
      if (!body.uploadToken) return NextResponse.json({ error: "uploadToken requerido" }, { status: 400 });
      sourcePath = path.join("uploads", `${body.uploadToken}.tar`);
      try {
        await fs.stat(path.join(BACKUP_ROOT, sourcePath));
      } catch {
        return NextResponse.json({ error: "El archivo subido ya no está disponible, vuelve a subirlo" }, { status: 404 });
      }
      sourceFilename = body.sourceFilename || `${body.uploadToken}.tar`;
    } else {
      return NextResponse.json({ error: "sourceType inválido" }, { status: 400 });
    }

    // Revalida el manifest/checksums justo antes de encolar — el archivo pudo
    // cambiar entre el preview y este trigger.
    try {
      await validateBackupFile(path.join(BACKUP_ROOT, sourcePath));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Archivo de backup inválido";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const restoreLog = await prisma.systemRestoreLog.create({
      data: {
        status: "PENDING",
        sourceType: body.sourceType,
        sourceBackupId,
        sourceFilename,
        sourcePath,
        requestedById: session.user.id,
      },
    });

    await restoreQueue.add("restore", { restoreLogId: restoreLog.id }, { jobId: restoreLog.id });

    return NextResponse.json({ restoreLog: serializeRestoreLog(restoreLog) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
