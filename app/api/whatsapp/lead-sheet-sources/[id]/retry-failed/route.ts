import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { importNewLeadsForSource, LEAD_SHEET_MAX_BACKFILL } from "@/lib/google/lead-sheet-import";
import { rateLimit } from "@/lib/rate-limit";

// Acción manual explícita — reenvía la plantilla a las filas de la fuente que
// quedaron "failed" (el tick automático nunca las reintenta). Cada fila que sale
// bien pasa a "sent"; las que vuelven a fallar conservan el nuevo errorMessage.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`lead-sheet-retry-failed:${session.user.id}`, 3, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados reintentos en poco tiempo — intenta de nuevo en un minuto" },
        { status: 429 }
      );
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
      const result = await importNewLeadsForSource(source, {
        retryFailed: true,
        limit: LEAD_SHEET_MAX_BACKFILL,
      });
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
