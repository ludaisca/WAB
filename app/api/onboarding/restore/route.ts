import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { restoreQueue } from "@/lib/queue";
import { validateBackupFile } from "@/lib/backup/restore-backup";
import { RESTORE_CONFIRMATION_PHRASE } from "@/lib/backup/constants";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

interface RestoreTriggerBody {
  uploadToken?: string;
  sourceFilename?: string;
  confirmationPhrase?: string;
}

// Contraparte sin sesión de POST /api/configuracion/backups/restore — dispara
// la restauración de un respaldo subido en vez de crear el primer admin desde
// cero (útil al migrar una instancia existente a un despliegue nuevo). Solo
// alcanzable con 0 usuarios en el sistema; requestedById queda null (ya es un
// caso soportado, ver el comentario sobre nullability en SystemRestoreLog).
export async function POST(req: Request) {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json(
        { error: "El sistema ya fue configurado. Inicia sesión normalmente." },
        { status: 409 }
      );
    }

    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const { allowed } = await rateLimit(`onboarding-restore-trigger:${ip}`, 5, 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
    }

    const body = (await req.json()) as RestoreTriggerBody;

    // Revalidada server-side — nunca confiar solo en el disabled del botón.
    if (body.confirmationPhrase !== RESTORE_CONFIRMATION_PHRASE) {
      return NextResponse.json(
        { error: `Debes escribir exactamente "${RESTORE_CONFIRMATION_PHRASE}" para confirmar` },
        { status: 400 }
      );
    }
    if (!body.uploadToken) {
      return NextResponse.json({ error: "uploadToken requerido" }, { status: 400 });
    }

    const existing = await prisma.systemRestoreLog.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
    if (existing) {
      return NextResponse.json({ error: "Ya hay una restauración en curso" }, { status: 409 });
    }

    const sourcePath = path.join("uploads", `${body.uploadToken}.tar`);
    try {
      await fs.stat(path.join(BACKUP_ROOT, sourcePath));
    } catch {
      return NextResponse.json({ error: "El archivo subido ya no está disponible, vuelve a subirlo" }, { status: 404 });
    }
    const sourceFilename = body.sourceFilename || `${body.uploadToken}.tar`;

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
        sourceType: "UPLOADED",
        sourceFilename,
        sourcePath,
        requestedById: null,
      },
    });

    await restoreQueue.add("restore", { restoreLogId: restoreLog.id }, { jobId: restoreLog.id });

    return NextResponse.json({ id: restoreLog.id, status: restoreLog.status }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
