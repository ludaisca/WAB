import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { importNewLeadsForSource } from "@/lib/google/lead-sheet-import";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const accountIds = await getUserAccountIds(session.user.id);
    const source = await prisma.leadSheetSource.findFirst({
      where: { id, waAccountId: { in: accountIds } },
      include: { waAccount: true, waTemplate: true },
    });
    if (!source) {
      return NextResponse.json({ error: "Fuente no encontrada" }, { status: 404 });
    }

    try {
      const result = await importNewLeadsForSource(source);
      return NextResponse.json(result);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "Error desconocido";
      await prisma.leadSheetSource.update({ where: { id }, data: { lastRunAt: new Date(), lastError: message.slice(0, 500) } });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
