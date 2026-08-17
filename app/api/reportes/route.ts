import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { reportQueue } from "@/lib/queue";
import { serializeReport } from "@/lib/reports/serialize";
import { reportRangeToUtc } from "@/lib/reports/date-range";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Cap defensivo — evita que un rango de años completos dispare un job
// desmedido por accidente. 400 días cubre holgadamente cualquier análisis
// anual razonable con margen.
const MAX_REPORT_RANGE_DAYS = 400;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const reports = await prisma.systemReport.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    return NextResponse.json({ reports: reports.map(serializeReport) });
  } catch (error) {
    // Misma ventana transitoria documentada en app/api/configuracion/backups/route.ts:
    // si alguna vez corre una restauración completa, la tabla puede no existir
    // por unos segundos mientras `prisma db push` la recrea.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return NextResponse.json({ reports: [] });
    }
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`report-generate:${session.user.id}`, 10, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const body = await req.json().catch(() => null);
    const dateFrom = body?.dateFrom;
    const dateTo = body?.dateTo;

    if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
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

    const report = await prisma.systemReport.create({
      data: { status: "PENDING", rangeFrom: gte, rangeTo: lt, createdById: session.user.id },
    });

    await reportQueue.add("manual", { reportId: report.id }, { jobId: report.id });

    return NextResponse.json({ report: serializeReport(report) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
