import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeBackup } from "@/lib/backup/serialize";

const BACKUP_ROOT = process.env.BACKUP_ROOT || "/app/backups";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { id } = await params;
  const backup = await prisma.systemBackup.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  if (!backup) return NextResponse.json({ error: "Backup no encontrado" }, { status: 404 });

  return NextResponse.json({ backup: serializeBackup(backup) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const backup = await prisma.systemBackup.findUnique({ where: { id } });
    if (!backup) return NextResponse.json({ error: "Backup no encontrado" }, { status: 404 });
    if (backup.status === "PENDING" || backup.status === "RUNNING") {
      return NextResponse.json({ error: "No se puede eliminar un respaldo en curso" }, { status: 409 });
    }

    if (backup.filename) {
      await fs.rm(path.join(BACKUP_ROOT, backup.filename), { force: true }).catch(() => {});
    }
    await prisma.systemBackup.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
