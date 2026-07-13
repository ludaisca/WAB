import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { resolveAbsolutePath } from "@/lib/whatsapp/media-store";

const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS ?? 90);
const BATCH_SIZE = 200;

export async function processMediaCleanupJob() {
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

    for (const msg of batch) {
      try {
        await fs.unlink(resolveAbsolutePath(msg.mediaUrl!));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[media-cleanup] No se pudo borrar ${msg.mediaUrl}:`, err);
        }
      }
    }

    await prisma.wAMessage.updateMany({
      where: { id: { in: batch.map((m) => m.id) } },
      data: { mediaUrl: null },
    });

    deleted += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  if (deleted > 0) {
    console.log(`[media-cleanup] ${deleted} archivo(s) de media purgado(s) (retención: ${RETENTION_DAYS}d)`);
  }
}
