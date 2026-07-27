import { NextResponse } from "next/server";
import { createReadStream, promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureLocalBackupFile } from "@/lib/backup/s3-storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { id } = await params;
  const backup = await prisma.systemBackup.findUnique({ where: { id } });
  if (!backup || !backup.filename || backup.status !== "COMPLETED") {
    return NextResponse.json({ error: "Backup no disponible" }, { status: 404 });
  }

  let absPath: string;
  let stat;
  try {
    absPath = await ensureLocalBackupFile(backup);
    stat = await fs.stat(absPath);
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado en disco ni en almacenamiento externo" }, { status: 404 });
  }

  const stream = createReadStream(absPath);
  const headers = new Headers();
  headers.set("Content-Type", "application/x-tar");
  headers.set("Content-Length", String(stat.size));
  headers.set("Content-Disposition", `attachment; filename="${encodeURIComponent(backup.filename)}"`);

  return new Response(stream as unknown as ReadableStream, { headers });
}
