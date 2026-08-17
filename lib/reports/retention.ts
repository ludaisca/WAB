import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

const REPORTS_ROOT = process.env.REPORTS_ROOT || "/app/reports";
const RETENTION_COUNT = Number(process.env.REPORTS_RETENTION_COUNT) || 20;

// Versión simplificada de lib/backup/retention.ts — sin reconciliación de
// archivos huérfanos ni stale-uploads: esas existen ahí porque una
// restauración dropea system_backups a mitad de camino y porque hay un flujo
// de subida de archivo para preview de restore. Reportes no tiene ninguno de
// los dos escenarios. Se llama al final de cada generación exitosa — no hace
// falta un cron nuevo. Borrado manual siempre disponible vía DELETE.
export async function purgeOldReports(): Promise<void> {
  const toPurge = await prisma.systemReport.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { id: true, filename: true },
    skip: RETENTION_COUNT,
  });
  if (toPurge.length === 0) return;

  for (const r of toPurge) {
    if (r.filename) {
      await fs.rm(path.join(REPORTS_ROOT, r.filename), { force: true }).catch(() => {});
    }
  }
  await prisma.systemReport.deleteMany({ where: { id: { in: toPurge.map((r) => r.id) } } });
}
