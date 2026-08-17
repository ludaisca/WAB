import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const REPORTS_ROOT = process.env.REPORTS_ROOT || "/app/reports";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const report = await prisma.systemReport.findUnique({ where: { id } });
    if (!report) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
    if (report.status === "PENDING" || report.status === "RUNNING") {
      return NextResponse.json({ error: "No se puede eliminar un reporte en curso" }, { status: 409 });
    }

    if (report.filename) {
      await fs.rm(path.join(REPORTS_ROOT, report.filename), { force: true }).catch(() => {});
    }
    await prisma.systemReport.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
