import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";
import { dedupeMediaFiles, purgeOrphanMediaFiles } from "@/lib/whatsapp/media-maintenance";

const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS ?? 90);
const BATCH_SIZE = 200;

export async function processMediaCleanupJob() {
  // Mantenimiento de espacio (duplicados + huérfanos): independiente de la
  // retención por antigüedad, así que corre aunque MEDIA_RETENTION_DAYS=0.
  // Cada paso es best-effort — un fallo aquí no debe impedir la purga por edad.
  await runMaintenanceStep("dedupe", dedupeMediaFiles);
  await runMaintenanceStep("huérfanos", purgeOrphanMediaFiles);

  if (!RETENTION_DAYS || RETENTION_DAYS <= 0) return;

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let deleted = 0;
  for (;;) {
    const batch = await prisma.wAMessage.findMany({
      where: { mediaUrl: { not: null }, timestamp: { lt: cutoff } },
      select: { id: true, mediaUrl: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    await prisma.wAMessage.updateMany({
      where: { id: { in: batch.map((m) => m.id) } },
      data: { mediaUrl: null },
    });

    // Una misma ruta la comparten muchos mensajes (la cabecera de una
    // campaña, o copias deduplicadas): el archivo solo se borra cuando YA no
    // queda ningún mensaje que lo referencie — si no, un mensaje viejo que
    // vence borraría la imagen de otros mensajes todavía vigentes.
    for (const url of new Set(batch.map((m) => m.mediaUrl!))) {
      if ((await prisma.wAMessage.count({ where: { mediaUrl: url } })) > 0) continue;
      try {
        await fs.unlink(resolveAbsolutePath(url));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[media-cleanup] No se pudo borrar ${url}:`, err);
        }
      }
    }

    deleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  if (deleted > 0) {
    console.log(`[media-cleanup] ${deleted} archivo(s) de media purgado(s) (retención: ${RETENTION_DAYS}d)`);
  }
}

async function runMaintenanceStep(label: string, step: () => Promise<{ removed: number; freedBytes: number }>) {
  try {
    const { removed, freedBytes } = await step();
    if (removed > 0) {
      console.log(`[media-cleanup] ${label}: ${removed} archivo(s) eliminados (${(freedBytes / 1e6).toFixed(1)} MB liberados)`);
    }
  } catch (err) {
    console.error(`[media-cleanup] Falló el paso "${label}":`, err);
  }
}
