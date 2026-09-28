import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { reportRangeToUtc } from "@/lib/reports/date-range";
import { getSentMessagesStats } from "@/lib/estadisticas/sent-messages";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Filtro interactivo de la card "Mensajes enviados" del Panel — cuenta +
// rango de fechas, mismo contrato que /api/estadisticas/campanas (sin
// restricción de rol, ya que el Panel es accesible a todos los roles).
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { allowed } = await rateLimit(`dashboard-mensajes-enviados:${session.user.id}`, 120, 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });
    }

    const accountIds = await getUserAccountIds(session.user.id);

    const { searchParams } = new URL(req.url);
    const accountIdParam = searchParams.get("accountId");
    if (accountIdParam && !accountIds.includes(accountIdParam)) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }
    const scopedAccountIds = accountIdParam ? [accountIdParam] : accountIds;

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
      return NextResponse.json({ error: "dateFrom y dateTo deben venir juntos" }, { status: 400 });
    }

    let range: { gte: Date; lt: Date } | undefined;
    if (dateFrom && dateTo) {
      if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
        return NextResponse.json({ error: "dateFrom/dateTo deben tener formato YYYY-MM-DD" }, { status: 400 });
      }
      if (dateFrom > dateTo) {
        return NextResponse.json({ error: "El rango de fechas es inválido (desde > hasta)" }, { status: 400 });
      }
      range = reportRangeToUtc(dateFrom, dateTo);
    }

    const data = await getSentMessagesStats(scopedAccountIds, range);

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
