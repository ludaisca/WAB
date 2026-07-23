import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeRestoreLog } from "@/lib/backup/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { id } = await params;
  const log = await prisma.systemRestoreLog.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      sourceBackup: { select: { id: true, type: true } },
      safetyBackup: { select: { id: true, filename: true } },
    },
  });
  if (!log) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return NextResponse.json({ restoreLog: serializeRestoreLog(log) });
}
