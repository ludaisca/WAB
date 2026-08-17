import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { reportRangeToUtc } from "@/lib/reports/date-range";
import { getReportDashboard } from "@/lib/reports/queries/dashboard";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Mismo cap que POST /api/reportes — evita un rango de años completos
// disparando agregados innecesariamente amplios por accidente.
const MAX_REPORT_RANGE_DAYS = 400;

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    // Más permisivo que report-generate:10/hora — se espera un re-fetch cada
    // vez que el admin cambia el rango de fechas mientras explora el dashboard.
    const { allowed } = await rateLimit(`report-dashboard:${session.user.id}`, 120, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!dateFrom || !dateTo || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
      return NextResponse.json({ error: "dateFrom/dateTo son requeridos en formato YYYY-MM-DD" }, { status: 400 });
    }
    if (dateFrom > dateTo) {
      return NextResponse.json({ error: "El rango de fechas es inválido (desde > hasta)" }, { status: 400 });
    }

    const { gte, lt } = reportRangeToUtc(dateFrom, dateTo);
    const rangeDays = (lt.getTime() - gte.getTime()) / 86_400_000;
    if (rangeDays > MAX_REPORT_RANGE_DAYS) {
      return NextResponse.json({ error: `El rango no puede superar ${MAX_REPORT_RANGE_DAYS} días` }, { status: 400 });
    }

    const accountIds = await getUserAccountIds(session.user.id);
    const data = await getReportDashboard(accountIds, session.user.id, gte, lt);

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
