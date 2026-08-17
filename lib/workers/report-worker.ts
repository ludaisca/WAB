import { prisma } from "@/lib/prisma";
import { runReportPipeline } from "@/lib/reports/generate-report";
import { dateKeyInTz } from "@/lib/timezone";

interface AttemptInfo {
  attemptsMade: number;
  maxAttempts: number;
}

async function notifyReportResult(reportId: string): Promise<void> {
  const report = await prisma.systemReport.findUnique({ where: { id: reportId } });
  if (!report) return;

  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const isCompleted = report.status === "COMPLETED";
  const title = isCompleted ? "Reporte listo" : "Error al generar el reporte";
  const rangeLabel = `${dateKeyInTz(report.rangeFrom)} al ${dateKeyInTz(new Date(report.rangeTo.getTime() - 1))}`;
  const body = isCompleted
    ? `El reporte del ${rangeLabel} ya está disponible para descargar.`
    : (report.errorMessage?.slice(0, 500) ?? "Error desconocido al generar el reporte.");

  await Promise.all(
    admins.map((a) =>
      prisma.notification.create({
        data: {
          userId: a.id,
          type: isCompleted ? "REPORT_READY" : "REPORT_FAILED",
          title,
          body,
          link: "/reportes",
        },
      })
    )
  );
}

// data.reportId ya existe con status PENDING (creado por POST /api/reportes).
export async function processReportJob(
  data: { reportId: string },
  attemptInfo: AttemptInfo = { attemptsMade: 0, maxAttempts: 1 }
): Promise<void> {
  try {
    await runReportPipeline(data.reportId);
    await notifyReportResult(data.reportId);
  } catch (err) {
    const isLastAttempt = attemptInfo.attemptsMade + 1 >= attemptInfo.maxAttempts;
    if (!isLastAttempt) {
      // Fallo transitorio (ej. picos de carga en la DB) — reintentable sin
      // riesgo, es un job de solo lectura. Solo se notifica en el último
      // intento para no saturar la campanita.
      throw err;
    }
    await notifyReportResult(data.reportId);
  }
}
