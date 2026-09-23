import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { reportRangeToUtc } from "@/lib/reports/date-range";
import { getCampaignSectionStats } from "@/lib/estadisticas/campaign-stats";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Filtro interactivo de la pestaña "Campañas" en /estadisticas — cuenta +
// rango de fechas. A diferencia de /api/reportes/dashboard, sin restricción
// de rol admin: /estadisticas ya es accesible a user/ejecutivo (no está en
// PROTECTED/EXECUTIVE_BLOCKED/USER_BLOCKED de proxy.ts), esta ruta sigue esa
// misma regla.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Más permisivo que report-generate — se espera un re-fetch cada vez que
    // el usuario cambia cuenta/rango mientras explora el dashboard.
    const { allowed } = await rateLimit(`estadisticas-campanas:${session.user.id}`, 120, 3600);
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

    // Ambos o ninguno — un rango a medias no tiene un límite bien definido.
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

    const data = await getCampaignSectionStats(scopedAccountIds, range);

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
