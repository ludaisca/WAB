import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { backupQueue } from "@/lib/queue";
import { serializeBackup } from "@/lib/backup/serialize";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const backups = await prisma.systemBackup.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });

  return NextResponse.json({ backups: backups.map(serializeBackup) });
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`backup-create:${session.user.id}`, 5, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const running = await prisma.systemBackup.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
    if (running) {
      return NextResponse.json({ error: "Ya hay un respaldo en curso" }, { status: 409 });
    }

    const backup = await prisma.systemBackup.create({
      data: { type: "MANUAL", status: "PENDING", createdById: session.user.id },
    });

    await backupQueue.add("manual", { backupId: backup.id }, { jobId: backup.id });

    return NextResponse.json({ backup: serializeBackup(backup) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
