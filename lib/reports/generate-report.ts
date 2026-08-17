import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getUserAccountIds } from "@/lib/shared-accounts";
import { dateKeyInTz } from "@/lib/timezone";
import { buildReportWorkbook } from "./build-workbook";
import { purgeOldReports } from "./retention";

const REPORTS_ROOT = process.env.REPORTS_ROOT || "/app/reports";

// Ejecuta el pipeline completo de un SystemReport cuya fila ya existe con
// status PENDING (la crea la API POST /api/reportes). Mimetiza
// lib/backup/create-backup.ts:runBackupPipeline pero mucho más simple: un
// solo archivo, sin tmp dir, sin checksums/manifest (no hay nada que
// restaurar, es un artefacto de solo lectura). Lanza en caso de fallo (tras
// marcar la fila FAILED) para que BullMQ decida reintentar.
export async function runReportPipeline(reportId: string): Promise<void> {
  const report = await prisma.systemReport.update({
    where: { id: reportId },
    data: { status: "RUNNING" },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });

  try {
    await fs.mkdir(REPORTS_ROOT, { recursive: true });

    const accountIds = report.createdById ? await getUserAccountIds(report.createdById) : [];
    const workbook = await buildReportWorkbook({
      accountIds,
      userId: report.createdById!,
      role: "admin",
      gte: report.rangeFrom,
      lt: report.rangeTo,
      generatedByLabel: report.createdBy?.name ?? report.createdBy?.email ?? "—",
    });

    const filename = `reporte-${dateKeyInTz(report.rangeFrom)}_a_${dateKeyInTz(new Date(report.rangeTo.getTime() - 1))}-${reportId}.xlsx`;
    const finalPath = path.join(REPORTS_ROOT, filename);
    await workbook.xlsx.writeFile(finalPath);
    const stat = await fs.stat(finalPath);

    await prisma.systemReport.update({
      where: { id: reportId },
      data: { status: "COMPLETED", filename, sizeBytes: stat.size, completedAt: new Date() },
    });

    await purgeOldReports();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.systemReport
      .update({
        where: { id: reportId },
        data: { status: "FAILED", errorMessage: message.slice(0, 4000), completedAt: new Date() },
      })
      .catch(() => {});
    throw err;
  }
}
