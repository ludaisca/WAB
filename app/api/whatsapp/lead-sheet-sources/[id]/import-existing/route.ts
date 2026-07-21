import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { importNewLeadsForSource, LEAD_SHEET_MAX_BACKFILL } from "@/lib/google/lead-sheet-import";
import { rateLimit } from "@/lib/rate-limit";

// Acción manual explícita — reprocesa filas marcadas "seeded" (vistas al conectar
// la fuente, sin enviarles nada) para el caso en que sí se quiera avisar al
// histórico de una fuente en particular. Body opcional { dateFrom?, dateTo? }
// (fechas "YYYY-MM-DD") para acotar el reenvío a la fecha de registro del lead
// en vez de todo el histórico — ver "Importar por fecha" en el detalle de la fuente.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role === "ejecutivo") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const rl = await rateLimit(`lead-sheet-import-existing:${session.user.id}`, 3, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiadas importaciones en poco tiempo — intenta de nuevo en un minuto" },
        { status: 429 }
      );
    }

    const { id } = await params;

    // El botón original llama sin body — se tolera que el parseo falle.
    let dateFrom: Date | null = null;
    let dateTo: Date | null = null;
    try {
      const body = await req.json();
      if (body?.dateFrom) dateFrom = new Date(`${body.dateFrom}T00:00:00.000Z`);
      if (body?.dateTo) dateTo = new Date(`${body.dateTo}T23:59:59.999Z`);
    } catch {
      // sin body -> comportamiento original, importa todo el histórico "seeded"
    }
    if (dateFrom && Number.isNaN(dateFrom.getTime())) dateFrom = null;
    if (dateTo && Number.isNaN(dateTo.getTime())) dateTo = null;

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
        includeExisting: true,
        limit: LEAD_SHEET_MAX_BACKFILL,
        dateFrom,
        dateTo,
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
