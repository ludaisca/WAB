import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncSingleExport } from "@/lib/google/sheet-export-runner";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const existing = await prisma.sheetExport.findFirst({ where: { id, userId: session.user.id } });
    if (!existing) {
      return NextResponse.json({ error: "Exportación no encontrada" }, { status: 404 });
    }

    await syncSingleExport(session.user.id, id);

    const updated = await prisma.sheetExport.findUniqueOrThrow({ where: { id } });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al sincronizar";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
